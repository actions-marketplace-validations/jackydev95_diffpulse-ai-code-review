import { postJson } from './http';
import {
  LLMCompletionRequest,
  LLMProvider,
  ProviderError,
  normalizeBaseUrl,
} from './types';

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

export class OpenAIProvider implements LLMProvider {
  public readonly name: string;
  public readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly isCompatibleMode: boolean;

  constructor(options: {
    providerName?: 'openai' | 'openai-compatible';
    apiKey: string;
    model: string;
    baseUrl?: string;
  }) {
    this.isCompatibleMode = options.providerName === 'openai-compatible';
    this.name = options.providerName ?? 'openai';
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = normalizeBaseUrl(options.baseUrl || 'https://api.openai.com/v1');
  }

  async complete(request: LLMCompletionRequest): Promise<string> {
    const url = `${this.baseUrl}/chat/completions`;
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const basePayload = {
      model: this.model,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
    };

    let data: OpenAIChatCompletionResponse;
    try {
      data = await postJson<OpenAIChatCompletionResponse>({
        provider: this.name,
        url,
        headers,
        body: {
          ...basePayload,
          response_format: { type: 'json_object' },
        },
        timeoutMs: request.timeoutMs,
      });
    } catch (err) {
      // Some OpenAI-compatible servers reject response_format=json_object with HTTP 400.
      if (this.isCompatibleMode && err instanceof ProviderError && err.statusCode === 400) {
        data = await postJson<OpenAIChatCompletionResponse>({
          provider: this.name,
          url,
          headers,
          body: basePayload,
          timeoutMs: request.timeoutMs,
        });
      } else {
        throw err;
      }
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new ProviderError(this.name, undefined, 'Response contained no assistant message content.');
    }
    return content;
  }
}
