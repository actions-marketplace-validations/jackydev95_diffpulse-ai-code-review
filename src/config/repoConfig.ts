import * as yaml from 'js-yaml';
import { ReviewConfig, Severity } from '../review/types';

export interface RepoDiffPulseConfig {
  customPrompt?: string;
  severityThreshold?: Severity;
  failOnSeverity?: Severity;
  includePatterns?: string[];
  excludePatterns?: string[];
  maxFiles?: number;
  maxDiffChars?: number;
  maxComments?: number;
  enableHeuristics?: boolean;
  skipDrafts?: boolean;
}

const VALID_SEVERITIES = new Set<string>(['info', 'low', 'medium', 'high', 'critical']);

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean);
}

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  return undefined;
}

/**
 * Parses YAML content from `.github/diffpulse.yml` or `.diffpulse.yml`.
 */
export function parseRepoConfigYaml(rawYaml: string): RepoDiffPulseConfig {
  const loaded = yaml.load(rawYaml);
  if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
    return {};
  }

  const record = loaded as Record<string, unknown>;
  const config: RepoDiffPulseConfig = {};

  if (typeof record.custom_prompt === 'string') {
    config.customPrompt = record.custom_prompt;
  } else if (typeof record.customPrompt === 'string') {
    config.customPrompt = record.customPrompt;
  }

  const sev = record.severity_threshold ?? record.severityThreshold;
  if (typeof sev === 'string' && VALID_SEVERITIES.has(sev.toLowerCase())) {
    config.severityThreshold = sev.toLowerCase() as Severity;
  }

  const failSev = record.fail_on_severity ?? record.failOnSeverity;
  if (typeof failSev === 'string' && VALID_SEVERITIES.has(failSev.toLowerCase())) {
    config.failOnSeverity = failSev.toLowerCase() as Severity;
  }

  config.includePatterns = asStringArray(record.include_patterns ?? record.includePatterns);
  config.excludePatterns = asStringArray(record.exclude_patterns ?? record.excludePatterns);
  config.maxFiles = asPositiveInt(record.max_files ?? record.maxFiles);
  config.maxDiffChars = asPositiveInt(record.max_diff_chars ?? record.maxDiffChars);
  config.maxComments = asPositiveInt(record.max_comments ?? record.maxComments);

  const heuristics = record.enable_heuristics ?? record.enableHeuristics;
  if (typeof heuristics === 'boolean') {
    config.enableHeuristics = heuristics;
  }

  const skipDrafts = record.skip_drafts ?? record.skipDrafts;
  if (typeof skipDrafts === 'boolean') {
    config.skipDrafts = skipDrafts;
  }

  return config;
}

/**
 * Merges repository-level `.diffpulse.yml` config into base Action config.
 */
export function mergeRepoConfig(
  base: ReviewConfig,
  repoConfig: RepoDiffPulseConfig,
  explicitInputs: Set<string>
): ReviewConfig {
  const merged: ReviewConfig = { ...base };

  if (repoConfig.customPrompt && !explicitInputs.has('custom-prompt')) {
    merged.customPrompt = repoConfig.customPrompt;
  }
  if (repoConfig.severityThreshold && !explicitInputs.has('severity-threshold')) {
    merged.severityThreshold = repoConfig.severityThreshold;
  }
  if (repoConfig.failOnSeverity && !explicitInputs.has('fail-on-severity')) {
    merged.failOnSeverity = repoConfig.failOnSeverity;
  }
  if (repoConfig.includePatterns && !explicitInputs.has('include-patterns')) {
    merged.includePatterns = repoConfig.includePatterns;
  }
  if (repoConfig.excludePatterns) {
    merged.excludePatterns = Array.from(
      new Set([...merged.excludePatterns, ...repoConfig.excludePatterns])
    );
  }
  if (repoConfig.maxFiles && !explicitInputs.has('max-files')) {
    merged.maxFiles = repoConfig.maxFiles;
  }
  if (repoConfig.maxDiffChars && !explicitInputs.has('max-diff-chars')) {
    merged.maxDiffChars = repoConfig.maxDiffChars;
  }
  if (repoConfig.maxComments && !explicitInputs.has('max-comments')) {
    merged.maxComments = repoConfig.maxComments;
  }
  if (
    repoConfig.enableHeuristics !== undefined &&
    !explicitInputs.has('enable-heuristics')
  ) {
    merged.enableHeuristics = repoConfig.enableHeuristics;
  }
  if (repoConfig.skipDrafts !== undefined && !explicitInputs.has('skip-drafts')) {
    merged.skipDrafts = repoConfig.skipDrafts;
  }

  return merged;
}
