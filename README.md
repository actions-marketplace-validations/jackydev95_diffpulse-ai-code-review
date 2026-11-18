# DiffPulse AI Code Review

Automated GitHub Pull Request code reviewer powered by **OpenAI**, **Anthropic Claude**, **Google Gemini**, or any **OpenAI-compatible** endpoint (Groq, DeepSeek, OpenRouter, Ollama, vLLM), combined with fast built-in **security & code-quality heuristics**.

## Features

- **Multi-Provider AI Reviews**: Switch seamlessly between `openai`, `anthropic`, `gemini`, `openai-compatible`, or `heuristic-only` (zero API key required).
- **Deterministic Pre-Checks**: Catches leaked private keys/tokens, disabled TLS checks, `eval()`/`new Function()`, raw HTML XSS sinks, interpolated shell `exec()`, and leftover debugger statements before or alongside LLM analysis.
- **Line-Accurate Inline Comments**: Parses unified diff hunks to anchor inline PR comments strictly on valid diff lines (`RIGHT` side), preventing GitHub `422` errors and automatically moving overflow or out-of-hunk findings into the summary.
- **Sticky Summary & Deduplication**: Updates a single summary comment (`<!-- diffpulse-ai-review -->`) across pushes and skips duplicate inline comments.
- **Repo-Level Configuration**: Optional `.github/diffpulse.yml` or `.diffpulse.yml` for team-wide prompts, globs, and thresholds.
- **Node 24 Native Action**: Pre-bundled in `dist/index.js` targeting GitHub Actions `node24` with zero install step during workflow runs.

---

## Quick Start

Create `.github/workflows/code-review.yml` in your repository:

```yaml
name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - name: Run DiffPulse AI Code Review
        uses: <your-github-username>/diffpulse-ai-code-review@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          provider: openai
          api-key: ${{ secrets.OPENAI_API_KEY }}
          model: gpt-4o-mini
          severity-threshold: low
          review-event: AUTO
```

### Provider Examples

<details>
<summary>Anthropic Claude</summary>

```yaml
- uses: <your-github-username>/diffpulse-ai-code-review@v1
  with:
    provider: anthropic
    api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    model: claude-sonnet-4-20250514
```

</details>

<details>
<summary>Google Gemini</summary>

```yaml
- uses: <your-github-username>/diffpulse-ai-code-review@v1
  with:
    provider: gemini
    api-key: ${{ secrets.GEMINI_API_KEY }}
    model: gemini-2.5-flash
```

</details>

<details>
<summary>OpenAI-Compatible (OpenRouter / Groq / DeepSeek / Ollama)</summary>

```yaml
- uses: <your-github-username>/diffpulse-ai-code-review@v1
  with:
    provider: openai-compatible
    base-url: https://openrouter.ai/api/v1
    api-key: ${{ secrets.OPENROUTER_API_KEY }}
    model: anthropic/claude-3.5-sonnet
```

</details>

<details>
<summary>Heuristic-Only (No LLM API Key Needed)</summary>

```yaml
- uses: <your-github-username>/diffpulse-ai-code-review@v1
  with:
    provider: heuristic-only
    fail-on-severity: high
```

</details>

---

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `github-token` | `${{ github.token }}` | Token with `pull-requests: write` and `contents: read`. |
| `provider` | `openai` | `openai`, `anthropic`, `gemini`, `openai-compatible`, or `heuristic-only`. |
| `api-key` | `""` | Provider API key (optional for `heuristic-only` or unauthenticated local endpoints). |
| `model` | Provider default | Model name (`gpt-4o-mini`, `claude-sonnet-4-20250514`, `gemini-2.5-flash`). |
| `base-url` | `""` | Custom API base URL (required for `openai-compatible`). |
| `custom-prompt` | `""` | Additional instructions appended to the review system prompt. |
| `review-event` | `COMMENT` | `COMMENT`, `APPROVE`, `REQUEST_CHANGES`, or `AUTO` (`REQUEST_CHANGES` on `high`/`critical`). |
| `severity-threshold` | `low` | Minimum severity to report: `info`, `low`, `medium`, `high`, `critical`. |
| `fail-on-severity` | `none` | Fail the workflow check when findings meet or exceed this severity (`none` disables). |
| `include-patterns` | `""` | Comma or newline-separated globs to include (empty = all non-excluded files). |
| `exclude-patterns` | `""` | Additional glob patterns to exclude beyond built-in lockfiles/build artifacts. |
| `max-files` | `40` | Maximum number of changed files reviewed per run. |
| `max-diff-chars` | `24000` | Maximum character budget per LLM review batch. |
| `max-comments` | `25` | Maximum inline review comments posted per PR review. |
| `enable-heuristics` | `true` | Run deterministic security and debug-artifact checks. |
| `skip-drafts` | `true` | Skip draft pull requests. |
| `update-summary-comment` | `true` | Maintain a single sticky PR summary comment. |
| `temperature` | `0.1` | Model sampling temperature (`0` to `2`). |
| `max-tokens` | `2500` | Max output tokens per batch. |
| `timeout-ms` | `60000` | HTTP request timeout per AI call in milliseconds. |
| `dry-run` | `false` | Analyze diffs and log results without posting to GitHub. |

## Outputs

| Output | Description |
| --- | --- |
| `summary` | Generated review summary text. |
| `issues-count` | Total number of findings at or above `severity-threshold`. |
| `critical-count` | Count of `critical` findings. |
| `high-count` | Count of `high` findings. |
| `review-status` | `completed`, `skipped`, or `failed`. |

---

## Repository Config (`.github/diffpulse.yml`)

Teams can check in `.github/diffpulse.yml` (or `.diffpulse.yml`) to share defaults across workflows. See [.github/diffpulse.example.yml](.github/diffpulse.example.yml) for all supported keys. Explicit workflow `with:` inputs take precedence over file settings, while `exclude_patterns` are combined.

---

## Local Development & Testing

```bash
npm install
npm run typecheck
npm test
npm run build
```

Run a local review against your current `git diff`:

```bash
npm run review:local -- --provider heuristic-only
# Or with an LLM provider:
OPENAI_API_KEY=... npm run review:local -- --provider openai --model gpt-4o-mini
```

---

## Publishing to GitHub Marketplace

1. **Authenticate GitHub CLI & create a public repository** (GitHub Marketplace requires Actions to live in a **public** repository):
   ```bash
   gh auth login
   git init -b main
   git add .
   git commit -m "feat: initial DiffPulse AI Code Review v1.0.0"
   gh repo create diffpulse-ai-code-review --public --source=. --remote=origin --push
   ```
2. **Verify `action.yml` name uniqueness**:
   GitHub requires `name:` in `action.yml` to be globally unique across GitHub Marketplace. If `DiffPulse AI Code Review` is already taken when drafting your release, update `name:` in `action.yml`, commit, and push.
3. **Draft a Release & Publish to Marketplace**:
   - Open your repository on GitHub (`https://github.com/<you>/diffpulse-ai-code-review`) and click **action.yml** (you will see a banner: *"Publish this Action to the GitHub Marketplace"*), or go to **Releases → Draft a new release**.
   - Check **"Publish this Action to the GitHub Marketplace"**, accept the GitHub Marketplace Developer Agreement if prompted, select primary category **Code review** (and optional secondary **Code quality** or **Security**).
   - Set tag version to `v1.0.0`, target `main`, and click **Publish release**.
   - The included `.github/workflows/release.yml` workflow will automatically create/update the floating `v1` tag so users can reference `@v1`.

## License

[MIT](LICENSE)
