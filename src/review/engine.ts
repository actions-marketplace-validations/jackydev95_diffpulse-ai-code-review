import { createDiffBatches } from '../diff/batcher';
import { filterPullRequestFiles } from '../diff/filter';
import { resolveModelName } from '../providers';
import { LLMProvider } from '../providers/types';
import { runHeuristicChecks } from './heuristics';
import { deduplicateAndSortFindings, parseAIReviewResponse } from './parser';
import { buildSystemPrompt, buildUserPrompt } from './prompt';
import {
  ParsedDiffFile,
  PullRequestContext,
  RawPullRequestFile,
  ReviewConfig,
  ReviewFinding,
  ReviewResult,
  Severity,
  isSeverityAtLeast,
} from './types';

export interface RunReviewOptions {
  pr: PullRequestContext;
  files: RawPullRequestFile[];
  config: ReviewConfig;
  provider: LLMProvider | null;
  log?: (message: string) => void;
}

function emptySeverityCounts(): Record<Severity, number> {
  return {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
}

/**
 * Executes the full code review pipeline: filter -> heuristics -> AI batches -> classify inline vs summary.
 */
export async function runReviewEngine(options: RunReviewOptions): Promise<ReviewResult> {
  const { pr, files, config, provider, log = () => {} } = options;
  const modelUsed = provider?.model ?? resolveModelName(config.provider, config.model);

  const { included, skipped } = filterPullRequestFiles(files, {
    includePatterns: config.includePatterns,
    excludePatterns: config.excludePatterns,
    maxFiles: config.maxFiles,
  });

  if (included.length === 0) {
    return {
      summary: 'No eligible changed files matched the review filters.',
      findings: [],
      inlineFindings: [],
      summaryOnlyFindings: [],
      reviewedFiles: [],
      skippedFiles: skipped,
      batchesProcessed: 0,
      providerUsed: config.provider,
      modelUsed,
      countsBySeverity: emptySeverityCounts(),
    };
  }

  const allFindings: ReviewFinding[] = [];
  const batchSummaries: string[] = [];

  if (config.enableHeuristics) {
    const heuristicFindings = runHeuristicChecks(included);
    log(`Heuristic analyzer found ${heuristicFindings.length} raw issue(s).`);
    allFindings.push(...heuristicFindings);
  }

  let batchesProcessed = 0;
  if (provider) {
    const batches = createDiffBatches(included, config.maxDiffChars);
    const systemPrompt = buildSystemPrompt(config.customPrompt);

    for (let i = 0; i < batches.length; i += 1) {
      const batch = batches[i];
      log(
        `Reviewing batch ${i + 1}/${batches.length} (${batch.files.length} file(s), ${batch.charCount} chars)...`
      );
      const userPrompt = buildUserPrompt(pr, batch, i, batches.length);
      const rawResponse = await provider.complete({
        systemPrompt,
        userPrompt,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        timeoutMs: config.timeoutMs,
      });

      const parsed = parseAIReviewResponse(rawResponse);
      if (parsed.summary) {
        batchSummaries.push(parsed.summary);
      }
      allFindings.push(...parsed.findings);
      batchesProcessed += 1;
    }
  }

  const filtered = deduplicateAndSortFindings(allFindings).filter((finding) =>
    isSeverityAtLeast(finding.severity, config.severityThreshold)
  );

  const fileMap = new Map<string, ParsedDiffFile>(included.map((f) => [f.filename, f]));
  const inlineFindings: ReviewFinding[] = [];
  const summaryOnlyFindings: ReviewFinding[] = [];

  for (const finding of filtered) {
    const parsedFile = fileMap.get(finding.file);
    const canAnchorInline =
      parsedFile !== undefined &&
      parsedFile.commentableLines.has(finding.line) &&
      inlineFindings.length < config.maxComments;

    if (canAnchorInline) {
      inlineFindings.push(finding);
    } else {
      summaryOnlyFindings.push(finding);
    }
  }

  const countsBySeverity = emptySeverityCounts();
  for (const finding of filtered) {
    countsBySeverity[finding.severity] += 1;
  }

  const summary = buildOverallSummary(batchSummaries, filtered, included.length, config);

  return {
    summary,
    findings: filtered,
    inlineFindings,
    summaryOnlyFindings,
    reviewedFiles: included.map((f) => f.filename),
    skippedFiles: skipped,
    batchesProcessed,
    providerUsed: config.provider,
    modelUsed,
    countsBySeverity,
  };
}

function buildOverallSummary(
  batchSummaries: string[],
  findings: ReviewFinding[],
  reviewedFileCount: number,
  config: ReviewConfig
): string {
  if (batchSummaries.length > 0) {
    return batchSummaries.join(' ');
  }

  if (findings.length === 0) {
    return `Reviewed ${reviewedFileCount} file(s) using ${config.provider}; no issues at or above "${config.severityThreshold}" severity were detected.`;
  }

  return `Heuristic review of ${reviewedFileCount} file(s) detected ${findings.length} issue(s) at or above "${config.severityThreshold}" severity.`;
}
