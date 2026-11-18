import { postJson } from './http';
import {
  LLMCompletionRequest,
  LLMProvider,
  ProviderError,
  normalizeBaseUrl,
} from './types';

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

export class GeminiProvider implements LLMProvider {
  public readonly name = 'gemini';
  public readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: { apiKey: string; model: string; baseUrl?: string }) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = normalizeBaseUrl(
      options.baseUrl || 'https://generativelanguage.googleapis.com/v1beta'
    );
  }

  async complete(request: LLMCompletionRequest): Promise<string> {
    const encodedModel = encodeURIComponent(this.model);
    const url = `${this.baseUrl}/models/${encodedModel}:generateContent`;

    const data = await postJson<GeminiGenerateContentResponse>({
      provider: this.name,
      url,
      headers: {
        'x-goog-api-key': this.apiKey,
      },
      body: {
        systemInstruction: {
          parts: [{ text: request.systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: request.userPrompt }],
          },
        ],
        generationConfig: {
          temperature: request.temperature,
          maxOutputTokens: request.maxTokens,
          responseMimeType: 'application/json',
        },
      },
      timeoutMs: request.timeoutMs,
    });

    const text = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('\n')
      .trim();

    if (!text) {
      throw new ProviderError(this.name, undefined, 'Response contained no candidate text.');
    }

    return text;
  }
}
