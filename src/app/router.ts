import { renderBillingDashboardHtml } from './billingPage';
import {
  exchangeManifestCode,
  renderManifestInstallerHtml,
  renderManifestSuccessHtml,
} from './manifest';
import { handleMarketplacePurchaseEvent, MarketplaceWebhookPayload } from './marketplace';
import { MarketplacePlanDefinition } from './plans';
import {
  AppServerRuntimeConfig,
  handlePullRequestWebhook,
  PullRequestWebhookPayload,
} from './prHandler';
import { verifyGitHubWebhookSignature } from './signature';
import { SubscriptionStore } from './store';

export interface AppRouterContext {
  webhookSecret: string;
  runtime: AppServerRuntimeConfig;
  store: SubscriptionStore;
  plans: MarketplacePlanDefinition[];
  log: (msg: string) => void;
}

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function htmlResponse(
  status: number,
  html: string,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...extraHeaders,
    },
  });
}

function resolveRoutePath(url: URL): string {
  const rewritten = url.searchParams.get('__route');
  if (rewritten !== null) {
    return rewritten.startsWith('/') ? rewritten : `/${rewritten}`;
  }
  return url.pathname;
}

function resolvePublicOrigin(request: Request, url: URL): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = forwardedHost ?? request.headers.get('host') ?? url.host;
  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  return `${proto}://${host}`;
}

/**
 * Shared Web-API Request/Response router used by both Vercel Functions and the standalone Node server.
 */
export async function handleAppRequest(
  request: Request,
  ctx: AppRouterContext
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const pathname = resolveRoutePath(url);
    const method = request.method.toUpperCase();

    if (method === 'GET' && pathname === '/health') {
      return jsonResponse(200, { ok: true, service: 'diffpulse-github-app' });
    }

    if (method === 'GET' && pathname === '/api/plans') {
      return jsonResponse(200, { plans: ctx.plans });
    }

    if (method === 'GET' && pathname === '/install-app') {
      const origin = resolvePublicOrigin(request, url);
      return htmlResponse(200, renderManifestInstallerHtml(origin));
    }

    if (method === 'GET' && pathname === '/install-app/callback') {
      const code = url.searchParams.get('code') ?? '';
      if (!code) {
        return jsonResponse(400, { error: 'Missing ?code parameter from GitHub' });
      }
      const created = await exchangeManifestCode(code);
      return htmlResponse(200, renderManifestSuccessHtml(created), {
        'Cache-Control': 'no-store',
      });
    }

    if (method === 'GET' && pathname.startsWith('/api/billing/')) {
      const accountId = Number.parseInt(pathname.slice('/api/billing/'.length), 10);
      if (!Number.isFinite(accountId)) {
        return jsonResponse(400, { error: 'Invalid accountId' });
      }
      const sub = await ctx.store.get(accountId);
      if (!sub) {
        return jsonResponse(404, { error: 'Subscription not found' });
      }
      return jsonResponse(200, { subscription: sub });
    }

    if (
      method === 'GET' &&
      (pathname === '/' || pathname === '/billing' || pathname === '/setup')
    ) {
      const accountIdParam = url.searchParams.get('account_id');
      const accountId = accountIdParam ? Number.parseInt(accountIdParam, 10) : Number.NaN;
      const subscription = Number.isFinite(accountId)
        ? await ctx.store.get(accountId)
        : undefined;
      return htmlResponse(
        200,
        renderBillingDashboardHtml({
          marketplaceSlug: ctx.runtime.marketplaceSlug,
          plans: ctx.plans,
          subscription,
        })
      );
    }

    if (method === 'POST' && pathname === '/webhooks/github') {
      const rawBody = Buffer.from(await request.arrayBuffer());
      const signature = request.headers.get('x-hub-signature-256') ?? undefined;

      if (!verifyGitHubWebhookSignature(rawBody, signature, ctx.webhookSecret)) {
        return jsonResponse(401, { error: 'Invalid webhook signature' });
      }

      const eventName = (request.headers.get('x-github-event') ?? '').toLowerCase();
      const payload = JSON.parse(rawBody.toString('utf8')) as unknown;

      if (eventName === 'ping') {
        return jsonResponse(200, { ok: true, event: 'ping' });
      }

      if (eventName === 'marketplace_purchase') {
        const updated = await handleMarketplacePurchaseEvent(
          payload as MarketplaceWebhookPayload,
          ctx.store,
          ctx.plans
        );
        ctx.log(
          `Marketplace event processed for ${updated.accountLogin} (#${updated.accountId}): plan=${updated.planName}, status=${updated.status}, units=${updated.unitCount}`
        );
        return jsonResponse(200, { ok: true, subscription: updated });
      }

      if (eventName === 'pull_request') {
        const outcome = await handlePullRequestWebhook(
          payload as PullRequestWebhookPayload,
          ctx.runtime,
          ctx.store,
          ctx.plans,
          ctx.log
        );
        return jsonResponse(outcome.status === 'quota_exceeded' ? 402 : 200, outcome);
      }

      return jsonResponse(200, { ok: true, ignoredEvent: eventName });
    }

    return jsonResponse(404, { error: 'Not found' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.log(`Server error: ${message}`);
    return jsonResponse(500, { error: 'Internal server error' });
  }
}
