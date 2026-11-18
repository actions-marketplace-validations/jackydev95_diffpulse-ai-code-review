import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mergeRepoConfig, parseRepoConfigYaml } from './config/repoConfig';
import { parseUnifiedGitDiff } from './diff/parser';
import { formatSummaryMarkdown } from './github/formatter';
import { createProvider, resolveModelName } from './providers';
import { runReviewEngine } from './review/engine';
import { AIProviderName, ReviewConfig, Severity } from './review/types';

function readArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

function getLocalGitDiff(baseRef?: string): string {
  const gitArgs = baseRef ? ['diff', baseRef] : ['diff', 'HEAD'];
  try {
    return execFileSync('git', gitArgs, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  } catch {
    // Fallback if repo has no commits yet (HEAD doesn't exist).
    return execFileSync('git', ['diff', '--cached'], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const provider = (readArg(args, '--provider') ??
    process.env.DIFFPULSE_PROVIDER ??
    'heuristic-only') as AIProviderName;
  const apiKey =
    readArg(args, '--api-key') ??
    process.env.DIFFPULSE_API_KEY ??
    process.env.OPENAI_API_KEY ??
    process.env.ANTHROPIC_API_KEY ??
    process.env.GEMINI_API_KEY ??
    '';
  const model = resolveModelName(
    provider,
    readArg(args, '--model') ?? process.env.DIFFPULSE_MODEL
  );
  const baseUrl = readArg(args, '--base-url') ?? process.env.DIFFPULSE_BASE_URL;
  const gitBase = readArg(args, '--base');
  const severityThreshold = (readArg(args, '--severity') ?? 'low') as Severity;

  let config: ReviewConfig = {
    githubToken: '',
    provider,
    apiKey,
    model,
    baseUrl,
    reviewEvent: 'COMMENT',
    severityThreshold,
    includePatterns: [],
    excludePatterns: [],
    maxFiles: 40,
    maxDiffChars: 24000,
    maxComments: 25,
    enableHeuristics: true,
    skipDrafts: false,
    updateSummaryComment: true,
    temperature: 0.1,
    maxTokens: 2500,
    timeoutMs: 60000,
    dryRun: true,
  };

  for (const candidate of ['.github/diffpulse.yml', '.diffpulse.yml']) {
    const fullPath = resolve(process.cwd(), candidate);
    if (existsSync(fullPath)) {
      const yamlContent = readFileSync(fullPath, 'utf8');
      config = mergeRepoConfig(config, parseRepoConfigYaml(yamlContent), new Set());
      break;
    }
  }

  const diffText = getLocalGitDiff(gitBase);
  const files = parseUnifiedGitDiff(diffText);
  if (files.length === 0) {
    console.log('No git diff changes detected.');
    return;
  }

  const llmProvider = createProvider(config);
  const result = await runReviewEngine({
    pr: {
      owner: 'local',
      repo: 'workspace',
      pullNumber: 0,
      title: 'Local git diff review',
      body: '',
      author: 'local-user',
      baseRef: gitBase ?? 'HEAD',
      headRef: 'working-tree',
      headSha: 'local',
      isDraft: false,
    },
    files,
    config,
    provider: llmProvider,
    log: (msg) => console.log(`[diffpulse] ${msg}`),
  });

  console.log('\n' + formatSummaryMarkdown(result));
  if (result.inlineFindings.length > 0) {
    console.log('\n### Inline Findings\n');
    for (const f of result.inlineFindings) {
      console.log(
        `- [${f.severity.toUpperCase()}] ${f.file}:${f.line} — ${f.title}: ${f.description}`
      );
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
