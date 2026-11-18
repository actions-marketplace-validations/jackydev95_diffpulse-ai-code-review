import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProvider } from '../src/providers';
import { AnthropicProvider } from '../src/providers/anthropic';
import { GeminiProvider } from '../src/providers/gemini';
import { OpenAIProvider } from '../src/providers/openai';

const sampleRequest = {
  systemPrompt: 'system',
  userPrompt: 'user',
  temperature: 0.1,
  maxTokens: 500,
  timeoutMs: 5000,
};

describe('providers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('validates createProvider configuration', () => {
    expect(
      createProvider({ provider: 'heuristic-only', apiKey: '', model: '' })
    ).toBeNull();

    expect(() =>
      createProvider({ provider: 'openai', apiKey: '', model: '' })
    ).toThrow(/Missing api-key/);

    expect(() =>
      createProvider({ provider: 'openai-compatible', apiKey: 'k', model: 'm' })
    ).toThrow(/base-url is required/);
  });

  it('calls OpenAI chat completions and falls back on 400 in openai-compatible mode', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('response_format not supported', {
          status: 400,
          statusText: 'Bad Request',
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"summary":"ok","findings":[]}' } }],
          }),
          { status: 200 }
        )
      );

    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAIProvider({
      providerName: 'openai-compatible',
      apiKey: 'test-key',
      model: 'llama-3.3-70b',
      baseUrl: 'https://api.example.com/v1/',
    });

    const out = await provider.complete(sampleRequest);
    expect(out).toBe('{"summary":"ok","findings":[]}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/v1/chat/completions');
  });

  it('calls Anthropic messages API with required headers', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: '{"summary":"anthropic ok","findings":[]}' }],
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AnthropicProvider({
      apiKey: 'ant-key',
      model: 'claude-sonnet-4-20250514',
    });

    const out = await provider.complete(sampleRequest);
    expect(out).toContain('anthropic ok');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init as RequestInit).headers).toMatchObject({
      'x-api-key': 'ant-key',
      'anthropic-version': '2023-06-01',
    });
  });

  it('calls Gemini generateContent API using x-goog-api-key header', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '{"summary":"gemini ok","findings":[]}' }],
              },
            },
          ],
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GeminiProvider({
      apiKey: 'gem-key',
      model: 'gemini-2.5-flash',
    });

    const out = await provider.complete(sampleRequest);
    expect(out).toContain('gemini ok');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
    );
    expect((init as RequestInit).headers).toMatchObject({
      'x-goog-api-key': 'gem-key',
    });
  });
});
