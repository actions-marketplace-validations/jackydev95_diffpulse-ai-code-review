export interface LLMCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(request: LLMCompletionRequest): Promise<string>;
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly statusCode: number | undefined,
    message: string
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'ProviderError';
  }
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}
