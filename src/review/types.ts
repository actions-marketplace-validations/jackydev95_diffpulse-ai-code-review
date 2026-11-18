export type AIProviderName =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openai-compatible'
  | 'heuristic-only';

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type ReviewCategory =
  | 'bug'
  | 'security'
  | 'performance'
  | 'maintainability'
  | 'testing'
  | 'style';

export type ReviewEventMode = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES' | 'AUTO';

export interface DiffLine {
  type: 'add' | 'del' | 'context';
  content: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
}

export interface ParsedDiffFile {
  filename: string;
  previousFilename?: string;
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed';
  additions: number;
  deletions: number;
  patch: string;
  hunks: DiffHunk[];
  /** New-file line numbers present in the diff (added or context lines on RIGHT side). */
  commentableLines: Set<number>;
  /** Strictly added new-file line numbers. */
  addedLines: Set<number>;
}

export interface RawPullRequestFile {
  filename: string;
  previousFilename?: string;
  status: ParsedDiffFile['status'];
  additions: number;
  deletions: number;
  patch?: string;
}

export interface ReviewFinding {
  file: string;
  line: number;
  severity: Severity;
  category: ReviewCategory;
  title: string;
  description: string;
  suggestion?: string;
  source: 'heuristic' | 'ai';
  ruleId?: string;
}

export interface ReviewResult {
  summary: string;
  findings: ReviewFinding[];
  inlineFindings: ReviewFinding[];
  summaryOnlyFindings: ReviewFinding[];
  reviewedFiles: string[];
  skippedFiles: Array<{ filename: string; reason: string }>;
  batchesProcessed: number;
  providerUsed: AIProviderName;
  modelUsed: string;
  countsBySeverity: Record<Severity, number>;
}

export interface PullRequestContext {
  owner: string;
  repo: string;
  pullNumber: number;
  title: string;
  body: string;
  author: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  isDraft: boolean;
}

export interface ReviewConfig {
  githubToken: string;
  provider: AIProviderName;
  apiKey: string;
  model: string;
  baseUrl?: string;
  customPrompt?: string;
  reviewEvent: ReviewEventMode;
  severityThreshold: Severity;
  failOnSeverity?: Severity;
  includePatterns: string[];
  excludePatterns: string[];
  maxFiles: number;
  maxDiffChars: number;
  maxComments: number;
  enableHeuristics: boolean;
  skipDrafts: boolean;
  updateSummaryComment: boolean;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  dryRun: boolean;
}

export const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function isSeverityAtLeast(severity: Severity, threshold: Severity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[threshold];
}
