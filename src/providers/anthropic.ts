import { postJson } from './http';
import {
  LLMCompletionRequest,
  LLMProvider,
  ProviderError,
  normalizeBaseUrl,
} from './types';

interface AnthropicMessagesResponse {
  content?: Array<{
    type: string;
    text?: string;
  }>;
}

export class AnthropicProvider implements LLMProvider {
  public readonly name = 'anthropic';
  public readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: { apiKey: string; model: string; baseUrl?: string }) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = normalizeBaseUrl(options.baseUrl || 'https://api.anthropic.com');
  }

  async complete(request: LLMCompletionRequest): Promise<string> {
    const url = `${this.baseUrl}/v1/messages`;
    const data = await postJson<AnthropicMessagesResponse>({
      provider: this.name,
      url,
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: this.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        system: request.systemPrompt,
        messages: [{ role: 'user', content: request.userPrompt }],
      },
      timeoutMs: request.timeoutMs,
    });

    const text = data.content
      ?.filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text ?? '')
      .join('\n')
      .trim();

    if (!text) {
      throw new ProviderError(this.name, undefined, 'Response contained no text blocks.');
    }

    return text;
  }
}
