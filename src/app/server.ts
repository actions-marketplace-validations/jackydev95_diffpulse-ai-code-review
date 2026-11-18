import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AIProviderName } from '../review/types';
import { renderBillingDashboardHtml } from './billingPage';
import { handleMarketplacePurchaseEvent, MarketplaceWebhookPayload } from './marketplace';
import { getMarketplacePlans, MarketplacePlanDefinition } from './plans';
import {
  AppServerRuntimeConfig,
  handlePullRequestWebhook,
  PullRequestWebhookPayload,
} from './prHandler';
import { verifyGitHubWebhookSignature } from './signature';
import { SubscriptionStore } from './store';

const MAX_BODY_BYTES = 5 * 1024 * 1024;

export interface CreateAppServerOptions {
  webhookSecret: string;
  runtime: AppServerRuntimeConfig;
  store?: SubscriptionStore;
  plans?: MarketplacePlanDefinition[];
  log?: (msg: string) => void;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

function sendHtml(res: ServerResponse, statusCode: number, html: string): void {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
  });
  res.end(html);
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

/**
 * Creates the DiffPulse GitHub App & Marketplace Billing HTTP server.
 */
export function createAppServer(options: CreateAppServerOptions): {
  server: Server;
  store: SubscriptionStore;
  plans: MarketplacePlanDefinition[];
} {
  const store = options.store ?? new SubscriptionStore(process.env.SUBSCRIPTION_STORE_PATH);
  const plans = options.plans ?? getMarketplacePlans();
  const log = options.log ?? ((msg: string) => console.log(`[diffpulse-app] ${msg}`));

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const method = req.method ?? 'GET';

      if (method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { ok: true, service: 'diffpulse-github-app' });
        return;
      }

      if (method === 'GET' && url.pathname === '/api/plans') {
        sendJson(res, 200, { plans });
        return;
      }

      if (method === 'GET' && url.pathname.startsWith('/api/billing/')) {
        const accountId = Number.parseInt(url.pathname.slice('/api/billing/'.length), 10);
        if (!Number.isFinite(accountId)) {
          sendJson(res, 400, { error: 'Invalid accountId' });
          return;
        }
        const sub = store.get(accountId);
        if (!sub) {
          sendJson(res, 404, { error: 'Subscription not found' });
          return;
        }
        sendJson(res, 200, { subscription: sub });
        return;
      }

      if (method === 'GET' && (url.pathname === '/' || url.pathname === '/billing' || url.pathname === '/setup')) {
        const accountIdParam = url.searchParams.get('account_id');
        const accountId = accountIdParam ? Number.parseInt(accountIdParam, 10) : Number.NaN;
        const subscription = Number.isFinite(accountId) ? store.get(accountId) : undefined;
        const html = renderBillingDashboardHtml({
          marketplaceSlug: options.runtime.marketplaceSlug,
          plans,
          subscription,
        });
        sendHtml(res, 200, html);
        return;
      }

      if (method === 'POST' && url.pathname === '/webhooks/github') {
        let rawBody: Buffer;
        try {
          rawBody = await readRawBody(req);
        } catch (err) {
          if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
            sendJson(res, 413, { error: 'Webhook payload exceeds 5 MB limit' });
            return;
          }
          throw err;
        }

        const signature = req.headers['x-hub-signature-256'] as string | undefined;
        if (!verifyGitHubWebhookSignature(rawBody, signature, options.webhookSecret)) {
          sendJson(res, 401, { error: 'Invalid webhook signature' });
          return;
        }

        const eventName = String(req.headers['x-github-event'] ?? '').toLowerCase();
        const payload = JSON.parse(rawBody.toString('utf8')) as unknown;

        if (eventName === 'ping') {
          sendJson(res, 200, { ok: true, event: 'ping' });
          return;
        }

        if (eventName === 'marketplace_purchase') {
          const updated = handleMarketplacePurchaseEvent(
            payload as MarketplaceWebhookPayload,
            store,
            plans
          );
          log(
            `Marketplace event processed for ${updated.accountLogin} (#${updated.accountId}): plan=${updated.planName}, status=${updated.status}, units=${updated.unitCount}`
          );
          sendJson(res, 200, { ok: true, subscription: updated });
          return;
        }

        if (eventName === 'pull_request') {
          const outcome = await handlePullRequestWebhook(
            payload as PullRequestWebhookPayload,
            options.runtime,
            store,
            plans,
            log
          );
          sendJson(res, outcome.status === 'quota_exceeded' ? 402 : 200, outcome);
          return;
        }

        sendJson(res, 200, { ok: true, ignoredEvent: eventName });
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Server error: ${message}`);
      sendJson(res, 500, { error: 'Internal server error' });
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

const isEntrypoint =
  typeof require !== 'undefined' && require.main === module;

if (isEntrypoint) {
  startAppServerFromEnv();
}
