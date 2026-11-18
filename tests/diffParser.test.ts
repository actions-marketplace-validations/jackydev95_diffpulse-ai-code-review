import { describe, expect, it } from 'vitest';
import {
  parsePatch,
  parsePullRequestFile,
  parseUnifiedGitDiff,
} from '../src/diff/parser';

describe('diff/parser', () => {
  it('tracks added, deleted, and context line numbers accurately across hunks', () => {
    const patch = [
      '@@ -10,5 +10,6 @@ function calc(a: number) {',
      '   const base = 1;',
      '-  return a + base;',
      '+  const bonus = 2;',
      '+  return a + base + bonus;',
      ' }',
      '@@ -30,2 +31,3 @@ export function helper() {',
      '   return true;',
      '+  // trailing note',
      ' }',
    ].join('\n');

    const { hunks, commentableLines, addedLines } = parsePatch(patch);
    expect(hunks).toHaveLength(2);

    expect(Array.from(addedLines)).toEqual([11, 12, 32]);
    expect(Array.from(commentableLines)).toEqual([10, 11, 12, 13, 31, 32, 33]);
    expect(hunks[0].lines[1]).toEqual({
      type: 'del',
      content: '  return a + base;',
      oldLine: 11,
      newLine: null,
    });
  });

  it('handles empty patches cleanly', () => {
    const parsed = parsePullRequestFile({
      filename: 'assets/logo.png',
      status: 'added',
      additions: 0,
      deletions: 0,
    });
    expect(parsed.hunks).toEqual([]);
    expect(parsed.commentableLines.size).toBe(0);
  });

  it('parses unified git diff output into RawPullRequestFile entries', () => {
    const diff = [
      'diff --git a/src/app.ts b/src/app.ts',
      'index 1111111..2222222 100644',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,2 +1,3 @@',
      ' const x = 1;',
      '+const y = 2;',
      ' export { x };',
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1,1 @@',
      '+export const created = true;',
    ].join('\n');

    const files = parseUnifiedGitDiff(diff);
    expect(files).toHaveLength(2);
    expect(files[0].filename).toBe('src/app.ts');
    expect(files[0].status).toBe('modified');
    expect(files[0].additions).toBe(1);
    expect(files[1].filename).toBe('src/new.ts');
    expect(files[1].status).toBe('added');
  });
});
