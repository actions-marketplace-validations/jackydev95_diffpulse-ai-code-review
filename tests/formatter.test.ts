import { describe, expect, it } from 'vitest';
import { mergeRepoConfig, parseRepoConfigYaml } from '../src/config/repoConfig';
import {
  SUMMARY_COMMENT_MARKER,
  formatInlineComment,
  formatSummaryMarkdown,
  resolveGitHubReviewEvent,
} from '../src/github/formatter';
import { ReviewConfig, ReviewResult } from '../src/review/types';

const baseResult: ReviewResult = {
  summary: 'Reviewed changes cleanly.',
  findings: [],
  inlineFindings: [],
  summaryOnlyFindings: [
    {
      file: 'src/app.ts',
      line: 99,
      severity: 'high',
      category: 'security',
      title: 'Missing auth check',
      description: 'Route handler skips token verification.',
      suggestion: 'Call verifySession(req).',
      source: 'ai',
    },
  ],
  reviewedFiles: ['src/app.ts'],
  skippedFiles: [{ filename: 'package-lock.json', reason: 'Matched exclude pattern' }],
  batchesProcessed: 1,
  providerUsed: 'openai',
  modelUsed: 'gpt-4o-mini',
  countsBySeverity: {
    critical: 0,
    high: 1,
    medium: 0,
    low: 0,
    info: 0,
  },
};

describe('github/formatter & config/repoConfig', () => {
  it('resolves AUTO review event to REQUEST_CHANGES when high/critical exist', () => {
    expect(resolveGitHubReviewEvent('AUTO', baseResult)).toBe('REQUEST_CHANGES');
    expect(
      resolveGitHubReviewEvent('AUTO', {
        ...baseResult,
        countsBySeverity: { critical: 0, high: 0, medium: 2, low: 0, info: 0 },
      })
    ).toBe('COMMENT');
    expect(resolveGitHubReviewEvent('APPROVE', baseResult)).toBe('APPROVE');
  });

  it('formats inline and summary markdown with sticky comment marker', () => {
    const inline = formatInlineComment(baseResult.summaryOnlyFindings[0]);
    expect(inline).toContain('[HIGH] Missing auth check');
    expect(inline).toContain('**Suggestion:** Call verifySession(req).');

    const summary = formatSummaryMarkdown(baseResult);
    expect(summary.startsWith(SUMMARY_COMMENT_MARKER)).toBe(true);
    expect(summary).toContain('| High | 1 |');
    expect(summary).toContain('### Additional Findings');
    expect(summary).toContain('Skipped 1 file(s)');
  });

  it('parses and merges .diffpulse.yml respecting explicit action inputs', () => {
    const yamlCfg = parseRepoConfigYaml(`
custom_prompt: "Focus on SQL injection."
severity_threshold: medium
exclude_patterns:
  - "**/*.generated.ts"
max_files: 15
`);

    const baseConfig: ReviewConfig = {
      githubToken: 'tok',
      provider: 'openai',
      apiKey: 'key',
      model: 'gpt-4o-mini',
      reviewEvent: 'COMMENT',
      severityThreshold: 'low',
      includePatterns: [],
      excludePatterns: ['docs/**'],
      maxFiles: 40,
      maxDiffChars: 24000,
      maxComments: 25,
      enableHeuristics: true,
      skipDrafts: true,
      updateSummaryComment: true,
      temperature: 0.1,
      maxTokens: 2500,
      timeoutMs: 60000,
      dryRun: false,
    };

    const merged = mergeRepoConfig(
      baseConfig,
      yamlCfg,
      new Set(['severity-threshold'])
    );

    expect(merged.customPrompt).toBe('Focus on SQL injection.');
    // Explicit input wins over repo config:
    expect(merged.severityThreshold).toBe('low');
    // Unset input picks up repo config:
    expect(merged.maxFiles).toBe(15);
    // Exclude patterns merge cleanly:
    expect(merged.excludePatterns).toEqual(['docs/**', '**/*.generated.ts']);
  });
});
