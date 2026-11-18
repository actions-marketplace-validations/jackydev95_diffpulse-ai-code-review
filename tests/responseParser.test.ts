import { describe, expect, it } from 'vitest';
import {
  deduplicateAndSortFindings,
  parseAIReviewResponse,
} from '../src/review/parser';
import { ReviewFinding } from '../src/review/types';

describe('review/parser', () => {
  it('parses fenced JSON responses and normalizes fields', () => {
    const raw = [
      'Here is the review:',
      '```json',
      JSON.stringify({
        summary: 'Looks mostly solid with one null-check gap.',
        findings: [
          {
            file: 'src/user.ts',
            line: 25,
            severity: 'HIGH',
            category: 'BUG',
            title: 'Possible null dereference',
            description: 'user.profile may be undefined before accessing avatarUrl.',
            suggestion: 'Use optional chaining: user.profile?.avatarUrl',
          },
          {
            file: '',
            line: 1,
            severity: 'low',
            category: 'style',
            title: 'Invalid entry without file',
            description: 'Should be skipped.',
          },
        ],
      }),
      '```',
    ].join('\n');

    const parsed = parseAIReviewResponse(raw);
    expect(parsed.summary).toBe('Looks mostly solid with one null-check gap.');
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]).toMatchObject({
      file: 'src/user.ts',
      line: 25,
      severity: 'high',
      category: 'bug',
      title: 'Possible null dereference',
      source: 'ai',
    });
  });

  it('deduplicates identical findings keeping higher severity and sorts descending', () => {
    const input: ReviewFinding[] = [
      {
        file: 'src/b.ts',
        line: 5,
        severity: 'low',
        category: 'style',
        title: 'Unused variable',
        description: 'low',
        source: 'ai',
      },
      {
        file: 'src/a.ts',
        line: 10,
        severity: 'medium',
        category: 'security',
        title: 'Unsafe input',
        description: 'medium',
        source: 'ai',
      },
      {
        file: 'src/a.ts',
        line: 10,
        severity: 'critical',
        category: 'security',
        title: 'Unsafe input',
        description: 'critical',
        source: 'heuristic',
      },
    ];

    const sorted = deduplicateAndSortFindings(input);
    expect(sorted).toHaveLength(2);
    expect(sorted[0].severity).toBe('critical');
    expect(sorted[1].severity).toBe('low');
  });
});
