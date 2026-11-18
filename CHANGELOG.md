# Changelog

All notable changes to **DiffPulse AI Code Review** will be documented in this file.

## [1.0.0] - 2026-11-18

### Added
- Multi-provider AI code review engine supporting `openai`, `anthropic`, `gemini`, `openai-compatible`, and `heuristic-only` modes.
- Built-in deterministic security & quality heuristics (leaked keys/tokens, disabled TLS verification, `eval()`/`new Function()`, XSS sinks, interpolated shell `exec()`, leftover debug statements).
- Exact diff hunk line-number tracking for inline PR review comments with automatic fallback to summary findings and duplicate-comment avoidance.
- Sticky PR summary comment updates (`<!-- diffpulse-ai-review -->`) and GitHub Actions job summary output.
- Optional repository-level `.github/diffpulse.yml` / `.diffpulse.yml` configuration support.
- Local CLI runner (`npm run review:local`) for reviewing local `git diff` changes.
- GitHub Marketplace metadata (`action.yml` targeting `node24`) and CI/release workflows.
