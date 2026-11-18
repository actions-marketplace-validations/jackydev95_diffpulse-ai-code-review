import { ParsedDiffFile, ReviewCategory, ReviewFinding, Severity } from './types';

interface HeuristicRule {
  id: string;
  severity: Severity;
  category: ReviewCategory;
  title: string;
  description: string;
  suggestion: string;
  pattern: RegExp;
  skipTests?: boolean;
  /** Optional guard to filter out placeholders or safe lines. */
  isFalsePositive?: (lineContent: string, filename: string) => boolean;
}

const TEST_FILE_RE = /(^|\/)(__tests__|tests?|spec)(\/|\.)|\.(test|spec)\.[jt]sx?$/i;
const PLACEHOLDER_RE = /(example|placeholder|dummy|mock|fake|changeme|your[_-]?|xxx|\*{3,}|<\w+>)/i;

const HEURISTIC_RULES: HeuristicRule[] = [
  {
    id: 'SEC001',
    severity: 'critical',
    category: 'security',
    title: 'Private key material detected in diff',
    description: 'A PEM private key header was added to source control.',
    suggestion: 'Remove the private key from the commit, rotate it immediately, and load it from a secrets manager or CI secret.',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  {
    id: 'SEC002',
    severity: 'critical',
    category: 'security',
    title: 'Potential cloud or VCS access token committed',
    description: 'A literal credential matching an AWS, GitHub, or Slack token format was detected.',
    suggestion: 'Revoke the token immediately and inject credentials at runtime via environment variables or secret storage.',
    pattern: /(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/,
    isFalsePositive: (line, filename) => TEST_FILE_RE.test(filename) && PLACEHOLDER_RE.test(line),
  },
  {
    id: 'SEC003',
    severity: 'high',
    category: 'security',
    title: 'Possible hardcoded secret or password literal',
    description: 'An assignment to a secret/token/password variable uses a non-empty string literal.',
    suggestion: 'Move sensitive credentials to environment variables or a secret manager rather than hardcoding them.',
    pattern: /\b(?:api_?key|secret_?key|client_?secret|access_?token|auth_?token|db_?password|password)\b\s*[:=]\s*['"][^'"\s]{12,}['"]/i,
    skipTests: true,
    isFalsePositive: (line) => PLACEHOLDER_RE.test(line) || /process\.env|import\.meta\.env|os\.environ/i.test(line),
  },
  {
    id: 'SEC004',
    severity: 'high',
    category: 'security',
    title: 'TLS certificate verification disabled',
    description: 'Disabling TLS verification exposes connections to man-in-the-middle attacks.',
    suggestion: 'Keep certificate validation enabled and configure custom CA certificates if talking to internal endpoints.',
    pattern: /(?:rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]0['"]|verify\s*=\s*False\b)/,
    skipTests: true,
  },
  {
    id: 'SEC005',
    severity: 'high',
    category: 'security',
    title: 'Dynamic code evaluation via eval() or new Function()',
    description: 'Evaluating dynamic strings as code creates code-injection risks and hinders static optimization.',
    suggestion: 'Replace eval/new Function with explicit parsing, JSON.parse, or a safe lookup map.',
    pattern: /(?:\beval\s*\(|\bnew\s+Function\s*\()/,
    skipTests: true,
    isFalsePositive: (line) => /^\s*(?:\/\/|\/\*|\*)/.test(line),
  },
  {
    id: 'SEC006',
    severity: 'medium',
    category: 'security',
    title: 'Potential XSS sink via raw HTML assignment',
    description: 'Assigning raw strings to innerHTML or dangerouslySetInnerHTML can introduce XSS vulnerabilities if unsanitized.',
    suggestion: 'Prefer textContent/standard JSX rendering, or sanitize HTML with a vetted sanitizer such as DOMPurify.',
    pattern: /(?:dangerouslySetInnerHTML|\.innerHTML\s*=)/,
    skipTests: true,
  },
  {
    id: 'SEC007',
    severity: 'high',
    category: 'security',
    title: 'Interpolated shell command in exec()',
    description: 'String interpolation inside shell exec() calls can allow command injection if inputs are untrusted.',
    suggestion: 'Use execFile() or spawn() with an argument array and shell: false instead of interpolated command strings.',
    pattern: /\bexec(?:Sync)?\s*\(\s*`[^`]*\$\{/,
    skipTests: true,
  },
  {
    id: 'DBG001',
    severity: 'low',
    category: 'maintainability',
    title: 'Debugger breakpoint left in code',
    description: 'A runtime debugger statement was added and may halt execution or leak into production.',
    suggestion: 'Remove the breakpoint statement before merging.',
    pattern: /(?:\bdebugger\s*;|\bpdb\.set_trace\(\)|\bbinding\.pry\b)/,
    skipTests: true,
  },
  {
    id: 'DBG002',
    severity: 'info',
    category: 'maintainability',
    title: 'Console debug statement added',
    description: 'A console.log call was added in application code.',
    suggestion: 'Remove temporary debug logging or replace it with a structured logger.',
    pattern: /\bconsole\.log\s*\(/,
    skipTests: true,
    isFalsePositive: (line) => /^\s*\/\//.test(line),
  },
];

/**
 * Runs deterministic static/heuristic rules on added lines across parsed diff files.
 */
export function runHeuristicChecks(files: ParsedDiffFile[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const file of files) {
    const isTestFile = TEST_FILE_RE.test(file.filename);

    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type !== 'add' || line.newLine === null) {
          continue;
        }

        for (const rule of HEURISTIC_RULES) {
          if (rule.skipTests && isTestFile) {
            continue;
          }
          if (!rule.pattern.test(line.content)) {
            continue;
          }
          if (rule.isFalsePositive?.(line.content, file.filename)) {
            continue;
          }

          findings.push({
            file: file.filename,
            line: line.newLine,
            severity: rule.severity,
            category: rule.category,
            title: rule.title,
            description: rule.description,
            suggestion: rule.suggestion,
            source: 'heuristic',
            ruleId: rule.id,
          });
        }
      }
    }
  }

  return findings;
}
