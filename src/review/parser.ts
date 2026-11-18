import {
  ReviewCategory,
  ReviewFinding,
  SEVERITY_RANK,
  Severity,
} from './types';

const VALID_SEVERITIES = new Set<Severity>([
  'info',
  'low',
  'medium',
  'high',
  'critical',
]);

const VALID_CATEGORIES = new Set<ReviewCategory>([
  'bug',
  'security',
  'performance',
  'maintainability',
  'testing',
  'style',
]);

export interface ParsedAIResponse {
  summary: string;
  findings: ReviewFinding[];
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

function normalizeSeverity(value: unknown): Severity {
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim() as Severity;
    if (VALID_SEVERITIES.has(lower)) {
      return lower;
    }
  }
  return 'medium';
}

function normalizeCategory(value: unknown): ReviewCategory {
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim() as ReviewCategory;
    if (VALID_CATEGORIES.has(lower)) {
      return lower;
    }
  }
  return 'bug';
}

/**
 * Parses an LLM JSON response into a normalized summary and list of ReviewFinding items.
 */
export function parseAIReviewResponse(rawText: string): ParsedAIResponse {
  const jsonText = extractJsonObject(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse AI response as JSON: ${msg}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI response JSON root must be an object.');
  }

  const record = parsed as Record<string, unknown>;
  const summary =
    typeof record.summary === 'string' && record.summary.trim().length > 0
      ? record.summary.trim()
      : 'AI review completed.';

  const rawFindings = Array.isArray(record.findings) ? record.findings : [];
  const findings: ReviewFinding[] = [];

  for (const item of rawFindings) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Record<string, unknown>;
    const file = typeof f.file === 'string' ? f.file.trim() : '';
    const title = typeof f.title === 'string' ? f.title.trim() : '';
    const description = typeof f.description === 'string' ? f.description.trim() : '';
    const lineNum = typeof f.line === 'number' ? Math.trunc(f.line) : Number.parseInt(String(f.line ?? '0'), 10);

    if (!file || !title || !description) {
      continue;
    }

    findings.push({
      file,
      line: Number.isFinite(lineNum) && lineNum > 0 ? lineNum : 1,
      severity: normalizeSeverity(f.severity),
      category: normalizeCategory(f.category),
      title: title.slice(0, 140),
      description,
      suggestion:
        typeof f.suggestion === 'string' && f.suggestion.trim().length > 0
          ? f.suggestion.trim()
          : undefined,
      source: 'ai',
    });
  }

  return { summary, findings };
}

/**
 * Deduplicates findings on the same file+line+title (preferring higher severity) and sorts by severity desc.
 */
export function deduplicateAndSortFindings(findings: ReviewFinding[]): ReviewFinding[] {
  const seen = new Map<string, ReviewFinding>();

  for (const finding of findings) {
    const key = `${finding.file}:${finding.line}:${finding.title.toLowerCase()}`;
    const existing = seen.get(key);
    if (!existing || SEVERITY_RANK[finding.severity] > SEVERITY_RANK[existing.severity]) {
      seen.set(key, finding);
    }
  }

  return Array.from(seen.values()).sort((a, b) => {
    const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sevDiff !== 0) return sevDiff;
    const fileDiff = a.file.localeCompare(b.file);
    if (fileDiff !== 0) return fileDiff;
    return a.line - b.line;
  });
}
