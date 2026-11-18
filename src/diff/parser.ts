import { DiffHunk, DiffLine, ParsedDiffFile, RawPullRequestFile } from '../review/types';

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/**
 * Parses a unified diff patch string into structured hunks and line-number sets.
 */
export function parsePatch(patch: string): {
  hunks: DiffHunk[];
  commentableLines: Set<number>;
  addedLines: Set<number>;
} {
  const hunks: DiffHunk[] = [];
  const commentableLines = new Set<number>();
  const addedLines = new Set<number>();

  if (!patch.trim()) {
    return { hunks, commentableLines, addedLines };
  }

  const rawLines = patch.split(/\r?\n/);
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of rawLines) {
    const hunkMatch = raw.match(HUNK_HEADER_RE);
    if (hunkMatch) {
      oldLine = Number.parseInt(hunkMatch[1], 10);
      newLine = Number.parseInt(hunkMatch[3], 10);
      currentHunk = {
        oldStart: oldLine,
        oldLines: hunkMatch[2] ? Number.parseInt(hunkMatch[2], 10) : 1,
        newStart: newLine,
        newLines: hunkMatch[4] ? Number.parseInt(hunkMatch[4], 10) : 1,
        header: raw,
        lines: [],
      };
      hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk) {
      continue;
    }

    if (raw.startsWith('\\ No newline at end of file')) {
      continue;
    }

    let diffLine: DiffLine;
    if (raw.startsWith('+')) {
      diffLine = {
        type: 'add',
        content: raw.slice(1),
        oldLine: null,
        newLine,
      };
      commentableLines.add(newLine);
      addedLines.add(newLine);
      newLine += 1;
    } else if (raw.startsWith('-')) {
      diffLine = {
        type: 'del',
        content: raw.slice(1),
        oldLine,
        newLine: null,
      };
      oldLine += 1;
    } else {
      const content = raw.startsWith(' ') ? raw.slice(1) : raw;
      diffLine = {
        type: 'context',
        content,
        oldLine,
        newLine,
      };
      commentableLines.add(newLine);
      oldLine += 1;
      newLine += 1;
    }

    currentHunk.lines.push(diffLine);
  }

  return { hunks, commentableLines, addedLines };
}

/**
 * Converts a GitHub PR file entry into a ParsedDiffFile.
 */
export function parsePullRequestFile(file: RawPullRequestFile): ParsedDiffFile {
  const patch = file.patch ?? '';
  const { hunks, commentableLines, addedLines } = parsePatch(patch);
  return {
    filename: file.filename,
    previousFilename: file.previousFilename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    patch,
    hunks,
    commentableLines,
    addedLines,
  };
}

/**
 * Parses output from `git diff` into RawPullRequestFile objects for local CLI reviews.
 */
export function parseUnifiedGitDiff(diffText: string): RawPullRequestFile[] {
  if (!diffText.trim()) {
    return [];
  }

  const sections = diffText.split(/^diff --git /m).filter((s) => s.trim().length > 0);
  const files: RawPullRequestFile[] = [];

  for (const section of sections) {
    const lines = section.split(/\r?\n/);
    const headerLine = lines[0] ?? '';
    const pathMatch = headerLine.match(/^a\/(.+?) b\/(.+)$/);
    const filename = pathMatch ? pathMatch[2] : headerLine.trim();

    let status: RawPullRequestFile['status'] = 'modified';
    if (lines.some((l) => l.startsWith('new file mode'))) {
      status = 'added';
    } else if (lines.some((l) => l.startsWith('deleted file mode'))) {
      status = 'removed';
    } else if (lines.some((l) => l.startsWith('rename from '))) {
      status = 'renamed';
    }

    const firstHunkIdx = lines.findIndex((l) => l.startsWith('@@ '));
    const patch = firstHunkIdx >= 0 ? lines.slice(firstHunkIdx).join('\n') : '';
    let additions = 0;
    let deletions = 0;
    for (const line of lines.slice(Math.max(firstHunkIdx, 0))) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
      else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
    }

    files.push({
      filename,
      status,
      additions,
      deletions,
      patch,
    });
  }

  return files;
}
