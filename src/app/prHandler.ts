import { mergeRepoConfig, parseRepoConfigYaml } from '../config/repoConfig';
import { GitHubPullRequestClient } from '../github/prClient';
import { createProvider, resolveModelName } from '../providers';
import { runReviewEngine } from '../review/engine';
import { AIProviderName, ReviewConfig } from '../review/types';
import { getInstallationAccessToken } from './githubAppAuth';
import { MarketplacePlanDefinition } from './plans';
import { SubscriptionStore } from './store';

export interface PullRequestWebhookPayload {
  action: string;
  number: number;
  installation?: {
    id: number;
  };
  pull_request?: {
    number: number;
    draft?: boolean;
  };
  repository: {
    name: string;
    owner: {
      id: number;
      login: string;
      type: 'User' | 'Organization';
    };
  };
}

export interface AppServerRuntimeConfig {
  appId: string;
  privateKey: string;
  aiProvider: AIProviderName;
  aiApiKey: string;
  aiModel?: string;
  aiBaseUrl?: string;
  marketplaceSlug: string;
}

export interface PullRequestHandleOutcome {
  status: 'reviewed' | 'skipped' | 'quota_exceeded';
  reason?: string;
  issuesCount?: number;
  planName?: string;
}

const REVIEWABLE_PR_ACTIONS = new Set(['opened', 'synchronize', 'reopened']);

/**
 * Processes a GitHub App `pull_request` webhook event, enforcing Marketplace plan entitlements.
 */
export async function handlePullRequestWebhook(
  payload: PullRequestWebhookPayload,
  runtime: AppServerRuntimeConfig,
  store: SubscriptionStore,
  plans: MarketplacePlanDefinition[],
  log: (msg: string) => void = console.log
): Promise<PullRequestHandleOutcome> {
  if (!REVIEWABLE_PR_ACTIONS.has(payload.action)) {
    return { status: 'skipped', reason: `Ignored pull_request action "${payload.action}".` };
  }

  const installationId = payload.installation?.id;
  if (!installationId) {
    return { status: 'skipped', reason: 'Missing installation.id on webhook payload.' };
  }

  if (payload.pull_request?.draft) {
    return { status: 'skipped', reason: 'Skipped draft pull request.' };
  }

  const owner = payload.repository.owner;
  const quota = store.consumeReviewQuota(
    { id: owner.id, login: owner.login, type: owner.type },
    plans
  );

  if (!quota.allowed) {
    return {
      status: 'quota_exceeded',
      reason: quota.reason,
      planName: quota.plan.name,
    };
  }

  const token = await getInstallationAccessToken(
    runtime.appId,
    runtime.privateKey,
    installationId
  );
  const client = new GitHubPullRequestClient(token);
  const pr = await client.getPullRequestContext(
    owner.login,
    payload.repository.name,
    payload.number
  );

  if (pr.isDraft) {
    return { status: 'skipped', reason: 'Skipped draft pull request.' };
  }

  const effectiveProvider: AIProviderName =
    quota.plan.entitlements.aiEnabled && runtime.aiApiKey
      ? runtime.aiProvider
      : 'heuristic-only';

  let config: ReviewConfig = {
    githubToken: token,
    provider: effectiveProvider,
    apiKey: effectiveProvider === 'heuristic-only' ? '' : runtime.aiApiKey,
    model: resolveModelName(effectiveProvider, runtime.aiModel),
    baseUrl: runtime.aiBaseUrl,
    reviewEvent: quota.plan.key === 'business' ? 'AUTO' : 'COMMENT',
    severityThreshold: 'low',
    includePatterns: [],
    excludePatterns: [],
    maxFiles: quota.plan.entitlements.maxFilesPerReview,
    maxDiffChars: quota.plan.entitlements.maxDiffChars,
    maxComments: 25,
    enableHeuristics: true,
    skipDrafts: true,
    updateSummaryComment: true,
    temperature: 0.1,
    maxTokens: 2500,
    timeoutMs: 60000,
    dryRun: false,
  };

  if (quota.plan.entitlements.allowCustomPrompt) {
    const rawRepoYaml =
      (await client.readRepoFile(
        owner.login,
        payload.repository.name,
        '.github/diffpulse.yml',
        pr.headSha
      )) ??
      (await client.readRepoFile(
        owner.login,
        payload.repository.name,
        '.diffpulse.yml',
        pr.headSha
      ));

    if (rawRepoYaml) {
      config = mergeRepoConfig(config, parseRepoConfigYaml(rawRepoYaml), new Set());
      // Clamp repo config limits to plan entitlements.
      config.maxFiles = Math.min(config.maxFiles, quota.plan.entitlements.maxFilesPerReview);
      config.maxDiffChars = Math.min(config.maxDiffChars, quota.plan.entitlements.maxDiffChars);
    }
  }

  const provider = createProvider(config);
  const files = await client.listPullRequestFiles(
    owner.login,
    payload.repository.name,
    payload.number
  );

  const result = await runReviewEngine({
    pr,
    files,
    config,
    provider,
    log,
  });

  await client.publishReview(pr, result, config, log);

  return {
    status: 'reviewed',
    issuesCount: result.findings.length,
    planName: quota.plan.name,
  };
}
