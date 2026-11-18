import { describe, expect, it } from 'vitest';
import { parsePullRequestFile } from '../src/diff/parser';
import { runHeuristicChecks } from '../src/review/heuristics';

describe('review/heuristics', () => {
  it('detects private keys, tokens, eval, and disabled TLS in added lines', () => {
    const fakeToken = 'ghp_' + 'AbCdEf1234567890GhIjKlMn';
    const fakeKeyHeader = '-----BEGIN ' + 'PRIVATE KEY-----';

    const file = parsePullRequestFile({
      filename: 'src/auth/client.ts',
      status: 'modified',
      additions: 4,
      deletions: 0,
      patch: [
        '@@ -1,1 +1,6 @@',
        ' import https from "https";',
        `+const token = "${fakeToken}";`,
        `+const key = "${fakeKeyHeader}";`,
        '+const agent = new https.Agent({ rejectUnauthorized: false });',
        '+const fn = eval("1 + 1");',
        '+console.log("debug");',
      ].join('\n'),
    });

    const findings = runHeuristicChecks([file]);
    const ruleIds = findings.map((f) => f.ruleId);

    expect(ruleIds).toContain('SEC002');
    expect(ruleIds).toContain('SEC001');
    expect(ruleIds).toContain('SEC004');
    expect(ruleIds).toContain('SEC005');
    expect(ruleIds).toContain('DBG002');
    expect(findings.every((f) => f.source === 'heuristic')).toBe(true);
  });

  it('ignores debug statements and placeholder secrets in test files', () => {
    const testFile = parsePullRequestFile({
      filename: 'tests/auth.test.ts',
      status: 'added',
      additions: 3,
      deletions: 0,
      patch: [
        '@@ -0,0 +1,3 @@',
        '+const api_key = "example_placeholder_secret_value";',
        '+console.log("test output");',
        '+eval("test");',
      ].join('\n'),
    });

    const findings = runHeuristicChecks([testFile]);
    expect(findings).toHaveLength(0);
  });
});
