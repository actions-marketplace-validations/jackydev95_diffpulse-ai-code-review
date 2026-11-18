import * as github from '@actions/github';
import {
  PullRequestContext,
  RawPullRequestFile,
  ReviewConfig,
  ReviewResult,
} from '../review/types';
import {
  SUMMARY_COMMENT_MARKER,
  formatInlineComment,
  formatSummaryMarkdown,
  resolveGitHubReviewEvent,
} from './formatter';

type Octokit = ReturnType<typeof github.getOctokit>;

export class GitHubPullRequestClient {
  private readonly octokit: Octokit;

  constructor(token: string) {
    this.octokit = github.getOctokit(token);
  }

  async getPullRequestContext(
    owner: string,
    repo: string,
    pullNumber: number
  ): Promise<PullRequestContext> {
    const { data } = await this.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });

    return {
      owner,
      repo,
      pullNumber,
      title: data.title,
      body: data.body ?? '',
      author: data.user?.login ?? 'unknown',
      baseRef: data.base.ref,
      headRef: data.head.ref,
      headSha: data.head.sha,
      isDraft: Boolean(data.draft),
    };
  }

  async listPullRequestFiles(
    owner: string,
    repo: string,
    pullNumber: number
  ): Promise<RawPullRequestFile[]> {
    const files = await this.octokit.paginate(this.octokit.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });

    return files.map((file) => ({
      filename: file.filename,
      previousFilename: file.previous_filename,
      status: file.status as RawPullRequestFile['status'],
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch,
    }));
  }

  /**
   * Fetches repository file content at the PR head ref (used for optional .diffpulse.yml).
   */
  async readRepoFile(
    owner: string,
    repo: string,
    path: string,
    ref: string
  ): Promise<string | null> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref,
      });

      if (!Array.isArray(data) && data.type === 'file' && typeof data.content === 'string') {
        return Buffer.from(data.content, 'base64').toString('utf8');
      }
      return null;
    } catch {
      return null;
    }
  }

  async publishReview(
    pr: PullRequestContext,
    result: ReviewResult,
    config: ReviewConfig,
    log: (msg: string) => void = () => {}
  ): Promise<void> {
    const event = resolveGitHubReviewEvent(config.reviewEvent, result);
    const existingKeys = await this.getExistingInlineCommentKeys(pr);

    const pendingComments = result.inlineFindings
      .map((finding) => ({
        path: finding.file,
        line: finding.line,
        side: 'RIGHT' as const,
        body: formatInlineComment(finding),
      }))
      .filter((comment) => !existingKeys.has(`${comment.path}:${comment.line}:${comment.body}`));

    const summaryBody = formatSummaryMarkdown(result);

    if (config.updateSummaryComment) {
      await this.upsertSummaryComment(pr, summaryBody);
    }

    const shouldSubmitPullReview =
      pendingComments.length > 0 ||
      event !== 'COMMENT' ||
      !config.updateSummaryComment;

    if (!shouldSubmitPullReview) {
      return;
    }

    const reviewBody = config.updateSummaryComment
      ? `DiffPulse AI review completed (${result.findings.length} total issue(s), ${pendingComments.length} new inline comment(s)).`
      : summaryBody;

    try {
      await this.octokit.rest.pulls.createReview({
        owner: pr.owner,
        repo: pr.repo,
        pull_number: pr.pullNumber,
        commit_id: pr.headSha,
        event,
        body: reviewBody,
        comments: pendingComments,
      });
    } catch (err) {
      // Fallback: if GitHub rejects any inline anchor (HTTP 422), submit the review without inline comments.
      const status = (err as { status?: number })?.status;
      if (status === 422 && pendingComments.length > 0) {
        log(
          'Warning: GitHub rejected one or more inline diff anchors (HTTP 422). Retrying review without inline comments.'
        );
        await this.octokit.rest.pulls.createReview({
          owner: pr.owner,
          repo: pr.repo,
          pull_number: pr.pullNumber,
          commit_id: pr.headSha,
          event,
          body: summaryBody,
        });
      } else {
        throw err;
      }
    }
  }

  private async getExistingInlineCommentKeys(pr: PullRequestContext): Promise<Set<string>> {
    const existing = await this.octokit.paginate(
      this.octokit.rest.pulls.listReviewComments,
      {
        owner: pr.owner,
        repo: pr.repo,
        pull_number: pr.pullNumber,
        per_page: 100,
      }
    );

    const keys = new Set<string>();
    for (const comment of existing) {
      if (comment.path && typeof comment.line === 'number') {
        keys.add(`${comment.path}:${comment.line}:${comment.body}`);
      }
    }
    return keys;
  }

  private async upsertSummaryComment(pr: PullRequestContext, body: string): Promise<void> {
    const comments = await this.octokit.paginate(
      this.octokit.rest.issues.listComments,
      {
        owner: pr.owner,
        repo: pr.repo,
        issue_number: pr.pullNumber,
        per_page: 100,
      }
    );

    const existing = comments.find(
      (c) => typeof c.body === 'string' && c.body.includes(SUMMARY_COMMENT_MARKER)
    );

    if (existing) {
      await this.octokit.rest.issues.updateComment({
        owner: pr.owner,
        repo: pr.repo,
        comment_id: existing.id,
        body,
      });
    } else {
      await this.octokit.rest.issues.createComment({
        owner: pr.owner,
        repo: pr.repo,
        issue_number: pr.pullNumber,
        body,
      });
    }
  }
}
