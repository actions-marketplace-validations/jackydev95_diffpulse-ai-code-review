import { DiffBatch } from '../diff/batcher';
import { PullRequestContext } from './types';

export function buildSystemPrompt(customPrompt?: string): string {
  const parts: string[] = [
    'You are DiffPulse, an expert senior software engineer and application security reviewer.',
    'Review the provided pull request diff and identify concrete defects, security risks, edge-case bugs, race conditions, performance regressions, and missing error handling or test coverage.',
    '',
    'Rules:',
    '1. Focus on substantive issues. Do NOT report trivial formatting nitpicks or praise.',
    '2. Cite exact file paths as shown in the `=== File: ... ===` headers.',
    '3. Each line in the diff is prefixed with `L<number>` for its new-file line number. Set `line` to the exact integer after `L` on the line where the issue occurs.',
    '4. Only report issues introduced or directly affected by the diff.',
    '5. Respond ONLY with a valid JSON object matching this exact schema (no markdown fences or commentary outside JSON):',
    '{',
    '  "summary": "Concise 2-4 sentence assessment of the changes in this batch.",',
    '  "findings": [',
    '    {',
    '      "file": "path/to/file.ts",',
    '      "line": 42,',
    '      "severity": "critical | high | medium | low | info",',
    '      "category": "bug | security | performance | maintainability | testing | style",',
    '      "title": "Short issue headline (max 80 chars)",',
    '      "description": "Clear explanation of why this is a problem and its impact.",',
    '      "suggestion": "Actionable recommendation or fixed code snippet (optional)"',
    '    }',
    '  ]',
    '}',
    '6. If there are no issues worth reporting, return `"findings": []`.',
  ];

  if (customPrompt?.trim()) {
    parts.push('', 'Repository-specific review instructions:', customPrompt.trim());
  }

  return parts.join('\n');
}

export function buildUserPrompt(
  pr: Pick<PullRequestContext, 'title' | 'body' | 'baseRef' | 'headRef' | 'author'>,
  batch: DiffBatch,
  batchIndex: number,
  totalBatches: number
): string {
  const truncatedBody = pr.body.trim().slice(0, 1500);
  return [
    `Pull Request: ${pr.title}`,
    `Author: @${pr.author} | Base: ${pr.baseRef} <- Head: ${pr.headRef}`,
    `Batch: ${batchIndex + 1} of ${totalBatches} (${batch.files.map((f) => f.filename).join(', ')})`,
    truncatedBody ? `PR Description:\n${truncatedBody}` : 'PR Description: (none)',
    '',
    'Diff to review:',
    batch.renderedDiff,
  ].join('\n');
}
