import { describe, expect, it } from 'vitest';
import { LLMProvider } from '../src/providers/types';
import { runReviewEngine } from '../src/review/engine';
import { PullRequestContext, ReviewConfig } from '../src/review/types';

const samplePr: PullRequestContext = {
  owner: 'acme',
  repo: 'demo',
  pullNumber: 12,
  title: 'Add auth middleware',
  body: 'Implements JWT verification.',
  author: 'alice',
  baseRef: 'main',
  headRef: 'feat/auth',
  headSha: 'abc123',
  isDraft: false,
};

const baseConfig: ReviewConfig = {
  githubToken: 'tok',
  provider: 'openai',
  apiKey: 'key',
  model: 'gpt-4o-mini',
  reviewEvent: 'COMMENT',
  severityThreshold: 'medium',
  includePatterns: [],
  excludePatterns: [],
  maxFiles: 20,
  maxDiffChars: 24000,
  maxComments: 1,
  enableHeuristics: true,
  skipDrafts: true,
  updateSummaryComment: true,
  temperature: 0.1,
  maxTokens: 2500,
  timeoutMs: 10000,
  dryRun: false,
};

describe('review/engine', () => {
  it('combines heuristics and AI findings, filters by threshold, and splits inline vs summary-only', async () => {
    const mockProvider: LLMProvider = {
      name: 'openai',
      model: 'gpt-4o-mini',
      async complete() {
        return JSON.stringify({
          summary: 'Found one race condition and one minor nit.',
          findings: [
            {
              file: 'src/auth.ts',
              line: 3, // inside diff hunk
              severity: 'high',
              category: 'bug',
              title: 'Unawaited async verify',
              description: 'verifyToken returns a Promise and must be awaited.',
            },
            {
              file: 'src/auth.ts',
              line: 999, // outside diff hunk -> summaryOnly
              severity: 'medium',
              category: 'testing',
              title: 'Missing negative unit test',
              description: 'Add a test for expired tokens.',
            },
            {
              file: 'src/auth.ts',
              line: 2,
              severity: 'low', // below medium threshold -> filtered out
              category: 'style',
              title: 'Rename variable',
              description: 'Minor naming suggestion.',
            },
          ],
        });
      },
    };

    const result = await runReviewEngine({
      pr: samplePr,
      files: [
        {
          filename: 'src/auth.ts',
          status: 'modified',
          additions: 3,
          deletions: 0,
          patch: [
            '@@ -1,2 +1,5 @@',
            ' import { verifyToken } from "./jwt";',
            '+export function checkAuth(token: string) {',
            '+  const ok = verifyToken(token);',
            '+  console.log(ok);', // heuristic info -> filtered by medium threshold
            '+  return eval("ok");', // heuristic high (line 5) -> overflow past maxComments=1 -> summaryOnly
            ' }',
          ].join('\n'),
        },
      ],
      config: baseConfig,
      provider: mockProvider,
    });

    expect(result.batchesProcessed).toBe(1);
    expect(result.findings).toHaveLength(3); // 2 high + 1 medium (low & info filtered out)
    expect(result.countsBySeverity.high).toBe(2);
    expect(result.countsBySeverity.medium).toBe(1);
    // maxComments is 1, so 1 goes inline and 2 go to summaryOnly
    expect(result.inlineFindings).toHaveLength(1);
    expect(result.summaryOnlyFindings).toHaveLength(2);
  });

  it('supports heuristic-only mode with no LLM provider', async () => {
    const result = await runReviewEngine({
      pr: samplePr,
      files: [
        {
          filename: 'src/debug.ts',
          status: 'added',
          additions: 1,
          deletions: 0,
          patch: '@@ -0,0 +1,1 @@\n+debugger;',
        },
      ],
      config: {
        ...baseConfig,
        provider: 'heuristic-only',
        severityThreshold: 'low',
      },
      provider: null,
    });

    expect(result.batchesProcessed).toBe(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].ruleId).toBe('DBG001');
  });
});
