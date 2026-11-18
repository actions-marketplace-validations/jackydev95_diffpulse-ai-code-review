import * as core from '@actions/core';
import { resolveModelName } from '../providers';
import {
  AIProviderName,
  ReviewConfig,
  ReviewEventMode,
  Severity,
} from '../review/types';
import { parsePatternList } from '../utils/glob';

const PROVIDERS = new Set<AIProviderName>([
  'openai',
  'anthropic',
  'gemini',
  'openai-compatible',
  'heuristic-only',
]);

const REVIEW_EVENTS = new Set<ReviewEventMode>([
  'COMMENT',
  'APPROVE',
  'REQUEST_CHANGES',
  'AUTO',
]);

const SEVERITIES = new Set<Severity>([
  'info',
  'low',
  'medium',
  'high',
  'critical',
]);

function parseEnum<T extends string>(
  raw: string,
  allowed: Set<T>,
  fallback: T,
  fieldName: string,
  normalize: (v: string) => string = (v) => v.toLowerCase()
): T {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const normalized = normalize(trimmed) as T;
  if (!allowed.has(normalized)) {
    throw new Error(
      `Invalid value "${raw}" for "${fieldName}". Allowed: ${Array.from(allowed).join(', ')}`
    );
  }
  return normalized;
}

function parseIntInput(raw: string, fallback: number, min: number, fieldName: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(value) || value < min) {
    throw new Error(`Invalid integer "${raw}" for "${fieldName}" (minimum ${min}).`);
  }
  return value;
}

function parseFloatInput(
  raw: string,
  fallback: number,
  min: number,
  max: number,
  fieldName: string
): number {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const value = Number.parseFloat(trimmed);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(
      `Invalid number "${raw}" for "${fieldName}" (expected ${min}..${max}).`
    );
  }
  return value;
}

function parseBoolInput(raw: string, fallback: boolean): boolean {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return fallback;
  if (trimmed === 'true' || trimmed === '1' || trimmed === 'yes') return true;
  if (trimmed === 'false' || trimmed === '0' || trimmed === 'no') return false;
  return fallback;
}

function hasExplicitInput(name: string): boolean {
  const envKey = `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
  const val = process.env[envKey];
  return typeof val === 'string' && val.trim().length > 0;
}

export interface LoadedActionInputs {
  config: ReviewConfig;
  explicitInputs: Set<string>;
}

/**
 * Reads and validates GitHub Action inputs from `@actions/core`.
 */
export function loadActionInputs(): LoadedActionInputs {
  const githubToken =
    core.getInput('github-token') || process.env.GITHUB_TOKEN || '';

  const provider = parseEnum(
    core.getInput('provider'),
    PROVIDERS,
    'openai',
    'provider'
  );

  const apiKey = core.getInput('api-key') || '';
  if (apiKey) {
    core.setSecret(apiKey);
  }

  const model = resolveModelName(provider, core.getInput('model'));
  const baseUrl = core.getInput('base-url').trim() || undefined;
  const customPrompt = core.getInput('custom-prompt').trim() || undefined;

  const reviewEvent = parseEnum(
    core.getInput('review-event'),
    REVIEW_EVENTS,
    'COMMENT',
    'review-event',
    (v) => v.toUpperCase()
  );

  const severityThreshold = parseEnum(
    core.getInput('severity-threshold'),
    SEVERITIES,
    'low',
    'severity-threshold'
  );

  const rawFailOnSeverity = core.getInput('fail-on-severity').trim();
  const failOnSeverity =
    rawFailOnSeverity && rawFailOnSeverity.toLowerCase() !== 'none'
      ? parseEnum(rawFailOnSeverity, SEVERITIES, 'critical', 'fail-on-severity')
      : undefined;

  const includePatterns = parsePatternList(core.getInput('include-patterns'));
  const excludePatterns = parsePatternList(core.getInput('exclude-patterns'));

  const maxFiles = parseIntInput(core.getInput('max-files'), 40, 1, 'max-files');
  const maxDiffChars = parseIntInput(
    core.getInput('max-diff-chars'),
    24000,
    1000,
    'max-diff-chars'
  );
  const maxComments = parseIntInput(
    core.getInput('max-comments'),
    25,
    1,
    'max-comments'
  );

  const enableHeuristics = parseBoolInput(core.getInput('enable-heuristics'), true);
  const skipDrafts = parseBoolInput(core.getInput('skip-drafts'), true);
  const updateSummaryComment = parseBoolInput(
    core.getInput('update-summary-comment'),
    true
  );
  const dryRun = parseBoolInput(core.getInput('dry-run'), false);

  const temperature = parseFloatInput(
    core.getInput('temperature'),
    0.1,
    0,
    2,
    'temperature'
  );
  const maxTokens = parseIntInput(
    core.getInput('max-tokens'),
    2500,
    256,
    'max-tokens'
  );
  const timeoutMs = parseIntInput(
    core.getInput('timeout-ms'),
    60000,
    5000,
    'timeout-ms'
  );

  const trackedInputNames = [
    'custom-prompt',
    'severity-threshold',
    'fail-on-severity',
    'include-patterns',
    'exclude-patterns',
    'max-files',
    'max-diff-chars',
    'max-comments',
    'enable-heuristics',
    'skip-drafts',
  ];
  const explicitInputs = new Set(trackedInputNames.filter(hasExplicitInput));

  return {
    config: {
      githubToken,
      provider,
      apiKey,
      model,
      baseUrl,
      customPrompt,
      reviewEvent,
      severityThreshold,
      failOnSeverity,
      includePatterns,
      excludePatterns,
      maxFiles,
      maxDiffChars,
      maxComments,
      enableHeuristics,
      skipDrafts,
      updateSummaryComment,
      temperature,
      maxTokens,
      timeoutMs,
      dryRun,
    },
    explicitInputs,
  };
}
