import { ParsedDiffFile, RawPullRequestFile } from '../review/types';
import { matchesAnyGlob } from '../utils/glob';
import { parsePullRequestFile } from './parser';

export const DEFAULT_EXCLUDE_PATTERNS: string[] = [
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/bun.lockb',
  '**/Cargo.lock',
  '**/Gemfile.lock',
  '**/poetry.lock',
  '**/composer.lock',
  '**/go.sum',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
  '**/*.snap',
  'dist/**',
  'build/**',
  '.next/**',
  'coverage/**',
  'vendor/**',
];

export interface FilterResult {
  included: ParsedDiffFile[];
  skipped: Array<{ filename: string; reason: string }>;
}

/**
 * Filters raw PR files based on status, patch availability, include/exclude globs, and maxFiles.
 */
export function filterPullRequestFiles(
  files: RawPullRequestFile[],
  options: {
    includePatterns: string[];
    excludePatterns: string[];
    maxFiles: number;
  }
): FilterResult {
  const included: ParsedDiffFile[] = [];
  const skipped: Array<{ filename: string; reason: string }> = [];
  const allExcludes = [...DEFAULT_EXCLUDE_PATTERNS, ...options.excludePatterns];

  for (const file of files) {
    if (file.status === 'removed') {
      skipped.push({ filename: file.filename, reason: 'File removed' });
      continue;
    }

    if (!file.patch || file.patch.trim().length === 0) {
      skipped.push({
        filename: file.filename,
        reason: 'No text diff available (binary or oversized patch)',
      });
      continue;
    }

    if (matchesAnyGlob(file.filename, allExcludes)) {
      skipped.push({ filename: file.filename, reason: 'Matched exclude pattern' });
      continue;
    }

    if (
      options.includePatterns.length > 0 &&
      !matchesAnyGlob(file.filename, options.includePatterns)
    ) {
      skipped.push({ filename: file.filename, reason: 'Did not match include pattern' });
      continue;
    }

    if (included.length >= options.maxFiles) {
      skipped.push({
        filename: file.filename,
        reason: `Exceeded max-files limit (${options.maxFiles})`,
      });
      continue;
    }

    const parsed = parsePullRequestFile(file);
    if (parsed.hunks.length === 0) {
      skipped.push({ filename: file.filename, reason: 'No diff hunks to review' });
      continue;
    }

    included.push(parsed);
  }

  return { included, skipped };
}
