import { AIProviderName, ReviewConfig } from '../review/types';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { OpenAIProvider } from './openai';
import { LLMProvider } from './types';

export const DEFAULT_MODELS: Record<AIProviderName, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-20250514',
  gemini: 'gemini-2.5-flash',
  'openai-compatible': 'gpt-4o-mini',
  'heuristic-only': 'heuristic-v1',
};

export function resolveModelName(provider: AIProviderName, explicitModel?: string): string {
  const trimmed = explicitModel?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_MODELS[provider];
}

/**
 * Creates an LLMProvider instance for the configured AI provider, or null for heuristic-only mode.
 */
export function createProvider(config: Pick<ReviewConfig, 'provider' | 'apiKey' | 'model' | 'baseUrl'>): LLMProvider | null {
  if (config.provider === 'heuristic-only') {
    return null;
  }

  const model = resolveModelName(config.provider, config.model);

  if (config.provider !== 'openai-compatible' && !config.apiKey.trim()) {
    throw new Error(
      `Missing api-key for provider "${config.provider}". Supply api-key or set provider: heuristic-only.`
    );
  }

  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider({
        providerName: 'openai',
        apiKey: config.apiKey,
        model,
        baseUrl: config.baseUrl,
      });
    case 'openai-compatible':
      if (!config.baseUrl?.trim()) {
        throw new Error('base-url is required when provider is "openai-compatible".');
      }
      return new OpenAIProvider({
        providerName: 'openai-compatible',
        apiKey: config.apiKey,
        model,
        baseUrl: config.baseUrl,
      });
    case 'anthropic':
      return new AnthropicProvider({
        apiKey: config.apiKey,
        model,
        baseUrl: config.baseUrl,
      });
    case 'gemini':
      return new GeminiProvider({
        apiKey: config.apiKey,
        model,
        baseUrl: config.baseUrl,
      });
    default: {
      const exhaustive: never = config.provider;
      throw new Error(`Unsupported provider: ${String(exhaustive)}`);
    }
  }
}
