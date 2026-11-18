import * as core from '@actions/core';
import * as github from '@actions/github';
import { loadActionInputs } from './config/inputs';
import { mergeRepoConfig, parseRepoConfigYaml } from './config/repoConfig';
import { formatSummaryMarkdown } from './github/formatter';
import { GitHubPullRequestClient } from './github/prClient';
import { createProvider } from './providers';
import { runReviewEngine } from './review/engine';
import { isSeverityAtLeast } from './review/types';

export async function run(): Promise<void> {
  try {
    const { config: baseConfig, explicitInputs } = loadActionInputs();
    const prPayload = github.context.payload.pull_request;

    if (!prPayload || typeof prPayload.number !== 'number') {
      core.info(
        `No pull_request payload found for event "${github.context.eventName}". Skipping review.`
      );
      core.setOutput('review-status', 'skipped');
      core.setOutput('issues-count', '0');
      core.setOutput('critical-count', '0');
      core.setOutput('high-count', '0');
      core.setOutput('summary', 'Skipped: not a pull request event.');
      return;
    }

    if (!baseConfig.githubToken) {
      throw new Error(
        'Missing github-token. Ensure permissions include pull-requests: write and pass ${{ secrets.GITHUB_TOKEN }}.'
      );
    }

    const { owner, repo } = github.context.repo;
    const pullNumber = prPayload.number;
    const client = new GitHubPullRequestClient(baseConfig.githubToken);

    const pr = await client.getPullRequestContext(owner, repo, pullNumber);

    // Load optional repository config from PR head ref.
    let config = baseConfig;
    const rawRepoYaml =
      (await client.readRepoFile(owner, repo, '.github/diffpulse.yml', pr.headSha)) ??
      (await client.readRepoFile(owner, repo, '.diffpulse.yml', pr.headSha));

    if (rawRepoYaml) {
      core.info('Loaded repository configuration from diffpulse.yml.');
      config = mergeRepoConfig(baseConfig, parseRepoConfigYaml(rawRepoYaml), explicitInputs);
    }

    if (config.skipDrafts && pr.isDraft) {
      core.info(`PR #${pullNumber} is a draft and skip-drafts is enabled. Skipping review.`);
      core.setOutput('review-status', 'skipped');
      core.setOutput('issues-count', '0');
      core.setOutput('critical-count', '0');
      core.setOutput('high-count', '0');
      core.setOutput('summary', 'Skipped draft pull request.');
      return;
    }

    const provider = createProvider(config);
    const files = await client.listPullRequestFiles(owner, repo, pullNumber);
    core.info(`Fetched ${files.length} changed file(s) from PR #${pullNumber}.`);

    const result = await runReviewEngine({
      pr,
      files,
      config,
      provider,
      log: (msg) => core.info(msg),
    });

    if (config.dryRun) {
      core.info('dry-run enabled; skipping GitHub review submission.');
      core.info(formatSummaryMarkdown(result));
    } else {
      await client.publishReview(pr, result, config, (msg) => core.warning(msg));
      core.info(
        `Published review with ${result.inlineFindings.length} inline comment(s) and ${result.summaryOnlyFindings.length} summary-only finding(s).`
      );
    }

    const summaryMarkdown = formatSummaryMarkdown(result);
    await core.summary.addRaw(summaryMarkdown).write();

    core.setOutput('summary', result.summary);
    core.setOutput('issues-count', String(result.findings.length));
    core.setOutput('critical-count', String(result.countsBySeverity.critical));
    core.setOutput('high-count', String(result.countsBySeverity.high));
    core.setOutput('review-status', 'completed');

    if (config.failOnSeverity) {
      const blockingFindings = result.findings.filter((f) =>
        isSeverityAtLeast(f.severity, config.failOnSeverity!)
      );
      if (blockingFindings.length > 0) {
        core.setFailed(
          `DiffPulse found ${blockingFindings.length} issue(s) at or above "${config.failOnSeverity}" severity.`
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setOutput('review-status', 'failed');
    core.setFailed(message);
  }
}

run();
