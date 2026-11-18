import { ParsedDiffFile } from '../review/types';

export interface DiffBatch {
  files: ParsedDiffFile[];
  renderedDiff: string;
  charCount: number;
}

/**
 * Renders a parsed file diff with explicit new-file line numbers so models cite exact lines.
 */
export function renderNumberedDiff(file: ParsedDiffFile): string {
  const parts: string[] = [
    `=== File: ${file.filename} (status: ${file.status}, +${file.additions}/-${file.deletions}) ===`,
  ];

  for (const hunk of file.hunks) {
    parts.push(hunk.header);
    for (const line of hunk.lines) {
      if (line.type === 'add') {
        parts.push(`L${line.newLine} + ${line.content}`);
      } else if (line.type === 'del') {
        parts.push(`     - ${line.content}`);
      } else {
        parts.push(`L${line.newLine}   ${line.content}`);
      }
    }
  }

  return parts.join('\n');
}

/**
 * Packs parsed files into character-budgeted batches for LLM review calls.
 */
export function createDiffBatches(
  files: ParsedDiffFile[],
  maxDiffChars: number
): DiffBatch[] {
  if (files.length === 0) {
    return [];
  }

  const budget = Math.max(1000, maxDiffChars);
  const batches: DiffBatch[] = [];
  let currentFiles: ParsedDiffFile[] = [];
  let currentParts: string[] = [];
  let currentChars = 0;

  for (const file of files) {
    let rendered = renderNumberedDiff(file);
    if (rendered.length > budget) {
      rendered = `${rendered.slice(0, budget - 80)}\n... [diff truncated at ${budget} chars]`;
    }

    const needsFlush =
      currentFiles.length > 0 && currentChars + 2 + rendered.length > budget;
    if (needsFlush) {
      batches.push({
        files: currentFiles,
        renderedDiff: currentParts.join('\n\n'),
        charCount: currentChars,
      });
      currentFiles = [];
      currentParts = [];
      currentChars = 0;
    }

    const separatorChars = currentParts.length > 0 ? 2 : 0;
    currentFiles.push(file);
    currentParts.push(rendered);
    currentChars += separatorChars + rendered.length;
  }

  if (currentFiles.length > 0) {
    batches.push({
      files: currentFiles,
      renderedDiff: currentParts.join('\n\n'),
      charCount: currentChars,
    });
  }

  return batches;
}
