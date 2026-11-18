import {
  ReviewEventMode,
  ReviewFinding,
  ReviewResult,
  Severity,
} from '../review/types';

export const SUMMARY_COMMENT_MARKER = '<!-- diffpulse-ai-review -->';

const SEVERITY_BADGE: Record<Severity, string> = {
  critical: '[CRITICAL]',
  high: '[HIGH]',
  medium: '[MEDIUM]',
  low: '[LOW]',
  info: '[INFO]',
};

/**
 * Resolves the GitHub Pull Request review event from the configured mode and findings.
 */
export function resolveGitHubReviewEvent(
  mode: ReviewEventMode,
  result: ReviewResult
): 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES' {
  if (mode !== 'AUTO') {
    return mode;
  }
  if (result.countsBySeverity.critical > 0 || result.countsBySeverity.high > 0) {
    return 'REQUEST_CHANGES';
  }
  return 'COMMENT';
}

/**
 * Formats a single inline PR review comment body.
 */
export function formatInlineComment(finding: ReviewFinding): string {
  const tag = finding.ruleId ? `${finding.category} · ${finding.ruleId}` : finding.category;
  const lines: string[] = [
    `**${SEVERITY_BADGE[finding.severity]} ${finding.title}** (\`${tag}\`)`,
    '',
    finding.description,
  ];

  if (finding.suggestion) {
    lines.push('', `**Suggestion:** ${finding.suggestion}`);
  }

  return lines.join('\n');
}

/**
 * Formats the main PR summary review/comment markdown body.
 */
export function formatSummaryMarkdown(result: ReviewResult): string {
  const { countsBySeverity } = result;
  const lines: string[] = [
    SUMMARY_COMMENT_MARKER,
    '## DiffPulse AI Code Review',
    '',
    result.summary,
    '',
    '| Severity | Count |',
    '| --- | ---: |',
    `| Critical | ${countsBySeverity.critical} |`,
    `| High | ${countsBySeverity.high} |`,
    `| Medium | ${countsBySeverity.medium} |`,
    `| Low | ${countsBySeverity.low} |`,
    `| Info | ${countsBySeverity.info} |`,
    '',
    `Reviewed **${result.reviewedFiles.length}** file(s) with \`${result.providerUsed}\` (\`${result.modelUsed}\`).`,
  ];

  if (result.summaryOnlyFindings.length > 0) {
    lines.push('', '### Additional Findings');
    for (const finding of result.summaryOnlyFindings) {
      lines.push(
        `- **${SEVERITY_BADGE[finding.severity]}** \`${finding.file}:${finding.line}\` — **${finding.title}**: ${finding.description}${
          finding.suggestion ? ` *Suggestion:* ${finding.suggestion}` : ''
        }`
      );
    }
  }

  if (result.skippedFiles.length > 0) {
    const preview = result.skippedFiles
      .slice(0, 15)
      .map((s) => `- \`${s.filename}\`: ${s.reason}`);
    if (result.skippedFiles.length > 15) {
      preview.push(`- ...and ${result.skippedFiles.length - 15} more`);
    }
    lines.push(
      '',
      `<details><summary>Skipped ${result.skippedFiles.length} file(s)</summary>`,
      '',
      ...preview,
      '',
      '</details>'
    );
  }

  return lines.join('\n');
}
