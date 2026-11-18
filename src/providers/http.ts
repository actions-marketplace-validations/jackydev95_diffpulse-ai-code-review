import { ProviderError } from './types';

export interface JsonRequestOptions {
  provider: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs: number;
}

/**
 * Executes an HTTP POST JSON request with timeout and structured provider errors.
 */
export async function postJson<TResponse>(options: JsonRequestOptions): Promise<TResponse> {
  let response: Response;
  try {
    response = await fetch(options.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ProviderError(options.provider, undefined, `Network or timeout error: ${message}`);
  }

  const rawText = await response.text();
  if (!response.ok) {
    const snippet = rawText.slice(0, 400).replace(/\s+/g, ' ').trim();
    throw new ProviderError(
      options.provider,
      response.status,
      `HTTP ${response.status} ${response.statusText}: ${snippet}`
    );
  }

  try {
    return JSON.parse(rawText) as TResponse;
  } catch {
    throw new ProviderError(
      options.provider,
      response.status,
      `Returned invalid JSON response: ${rawText.slice(0, 200)}`
    );
  }
}
