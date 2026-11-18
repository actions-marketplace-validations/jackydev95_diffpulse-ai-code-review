import { describe, expect, it } from 'vitest';
import { createDiffBatches, renderNumberedDiff } from '../src/diff/batcher';
import { filterPullRequestFiles } from '../src/diff/filter';
import { parsePullRequestFile } from '../src/diff/parser';
import { matchesAnyGlob, parsePatternList } from '../src/utils/glob';

describe('utils/glob & diff/filter', () => {
  it('matches root and nested paths with ** globs', () => {
    expect(matchesAnyGlob('package-lock.json', ['**/package-lock.json'])).toBe(true);
    expect(matchesAnyGlob('packages/web/package-lock.json', ['**/package-lock.json'])).toBe(true);
    expect(matchesAnyGlob('src/utils/a.ts', ['src/**/*.ts'])).toBe(true);
    expect(matchesAnyGlob('src/a.js', ['src/**/*.ts'])).toBe(false);
    expect(parsePatternList('*.md,\nsrc/**\n')).toEqual(['*.md', 'src/**']);
  });

  it('filters lockfiles, removed files, missing patches, includes, and maxFiles', () => {
    const result = filterPullRequestFiles(
      [
        {
          filename: 'package-lock.json',
          status: 'modified',
          additions: 100,
          deletions: 50,
          patch: '@@ -1,1 +1,1 @@\n+x',
        },
        {
          filename: 'src/deleted.ts',
          status: 'removed',
          additions: 0,
          deletions: 10,
          patch: '@@ -1,1 +0,0 @@\n-x',
        },
        {
          filename: 'docs/readme.md',
          status: 'modified',
          additions: 1,
          deletions: 0,
          patch: '@@ -1,1 +1,2 @@\n a\n+b',
        },
        {
          filename: 'src/a.ts',
          status: 'modified',
          additions: 1,
          deletions: 0,
          patch: '@@ -1,1 +1,2 @@\n a\n+b',
        },
        {
          filename: 'src/b.ts',
          status: 'modified',
          additions: 1,
          deletions: 0,
          patch: '@@ -1,1 +1,2 @@\n a\n+b',
        },
      ],
      {
        includePatterns: ['src/**/*.ts'],
        excludePatterns: [],
        maxFiles: 1,
      }
    );

    expect(result.included.map((f) => f.filename)).toEqual(['src/a.ts']);
    expect(result.skipped).toEqual([
      { filename: 'package-lock.json', reason: 'Matched exclude pattern' },
      { filename: 'src/deleted.ts', reason: 'File removed' },
      { filename: 'docs/readme.md', reason: 'Did not match include pattern' },
      { filename: 'src/b.ts', reason: 'Exceeded max-files limit (1)' },
    ]);
  });
});

describe('diff/batcher', () => {
  it('renders numbered diff lines and splits batches within budget', () => {
    const longLine = 'x'.repeat(600);
    const f1 = parsePullRequestFile({
      filename: 'src/one.ts',
      status: 'modified',
      additions: 1,
      deletions: 0,
      patch: `@@ -1,1 +1,2 @@\n const a = 1;\n+const b = "${longLine}";`,
    });
    const f2 = parsePullRequestFile({
      filename: 'src/two.ts',
      status: 'added',
      additions: 1,
      deletions: 0,
      patch: `@@ -0,0 +1,1 @@\n+const c = "${longLine}";`,
    });

    const rendered = renderNumberedDiff(f1);
    expect(rendered).toContain('L1   const a = 1;');
    expect(rendered).toContain('L2 + const b =');

    const batches = createDiffBatches([f1, f2], 1000);
    expect(batches).toHaveLength(2);
    expect(batches[0].files[0].filename).toBe('src/one.ts');
    expect(batches[1].files[0].filename).toBe('src/two.ts');
  });
});
