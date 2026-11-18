import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AIProviderName } from '../review/types';
import { FileSubscriptionStore } from './fileStore';
import { getMarketplacePlans, MarketplacePlanDefinition } from './plans';
import { AppServerRuntimeConfig } from './prHandler';
import { handleAppRequest } from './router';
import { SubscriptionStore } from './store';

const MAX_BODY_BYTES = 5 * 1024 * 1024;

export interface CreateAppServerOptions {
  webhookSecret: string;
  runtime: AppServerRuntimeConfig;
  store?: SubscriptionStore;
  plans?: MarketplacePlanDefinition[];
  log?: (msg: string) => void;
}

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function toHeaders(rawHeaders: IncomingMessage['headers']): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (typeof value === 'string') {
      headers.set(key, value);
    }
  }
  return headers;
}

/**
 * Creates the DiffPulse GitHub App & Marketplace Billing HTTP server.
 */
export function createAppServer(options: CreateAppServerOptions): {
  server: Server;
  store: SubscriptionStore;
  plans: MarketplacePlanDefinition[];
} {
  const storePath = process.env.SUBSCRIPTION_STORE_PATH;
  const store =
    options.store ??
    (storePath ? new FileSubscriptionStore(storePath) : new SubscriptionStore());
  const plans = options.plans ?? getMarketplacePlans();
  const log = options.log ?? ((msg: string) => console.log(`[diffpulse-app] ${msg}`));

  const server = createServer(async (req, res: ServerResponse) => {
    try {
      const method = (req.method ?? 'GET').toUpperCase();
      const hasBody = method !== 'GET' && method !== 'HEAD';
      let rawBody: Buffer | undefined;

      if (hasBody) {
        try {
          rawBody = await readRawBody(req);
        } catch (err) {
          if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Webhook payload exceeds 5 MB limit' }));
            return;
          }
          throw err;
        }
      }

      const webReq = new Request(`http://localhost${req.url ?? '/'}`, {
        method,
        headers: toHeaders(req.headers),
        body: rawBody ? new Uint8Array(rawBody) : undefined,
      });

      const webRes = await handleAppRequest(webReq, {
        webhookSecret: options.webhookSecret,
        runtime: options.runtime,
        store,
        plans,
        log,
      });

      const responseBody = Buffer.from(await webRes.arrayBuffer());
      const responseHeaders: Record<string, string> = {};
      webRes.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      responseHeaders['Content-Length'] = String(responseBody.length);

      res.writeHead(webRes.status, responseHeaders);
      res.end(responseBody);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Server error: ${message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });

  return { server, store, plans };
}

export function startAppServerFromEnv(): Server {
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET ?? '';
  const appId = process.env.GITHUB_APP_ID ?? '';
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY ?? '';

  if (!webhookSecret) {
    throw new Error('GITHUB_WEBHOOK_SECRET is required to start the GitHub App server.');
  }

  const { server } = createAppServer({
    webhookSecret,
    runtime: {
      appId,
      privateKey,
      aiProvider: (process.env.AI_PROVIDER ?? 'openai') as AIProviderName,
      aiApiKey: process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
      aiModel: process.env.AI_MODEL,
      aiBaseUrl: process.env.AI_BASE_URL,
      marketplaceSlug: process.env.MARKETPLACE_SLUG ?? 'diffpulse-ai-code-review',
    },
  });

  server.listen(port, () => {
    console.log(`[diffpulse-app] Listening on http://localhost:${port}`);
  });
  return server;
}

const isEntrypoint = typeof require !== 'undefined' && require.main === module;

if (isEntrypoint) {
  startAppServerFromEnv();
}
