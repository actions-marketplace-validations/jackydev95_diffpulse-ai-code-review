import { getMarketplacePlans } from '../src/app/plans';
import { handleAppRequest } from '../src/app/router';
import { SubscriptionStore } from '../src/app/store';
import { AIProviderName } from '../src/review/types';

// Note: On serverless Vercel Functions, process memory is ephemeral across cold starts.
// Connect Upstash Redis or Postgres before processing live paid subscriptions.
const store = new SubscriptionStore();

async function dispatch(request: Request): Promise<Response> {
  const plans = getMarketplacePlans(process.env);
  return handleAppRequest(request, {
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? '',
    runtime: {
      appId: process.env.GITHUB_APP_ID ?? '',
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY ?? '',
      aiProvider: (process.env.AI_PROVIDER ?? 'openai') as AIProviderName,
      aiApiKey: process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
      aiModel: process.env.AI_MODEL,
      aiBaseUrl: process.env.AI_BASE_URL,
      marketplaceSlug: process.env.MARKETPLACE_SLUG ?? 'diffpulse-ai-code-review',
    },
    store,
    plans,
    log: (msg) => console.error(`[diffpulse-vercel] ${msg}`),
  });
}

export async function GET(request: Request): Promise<Response> {
  return dispatch(request);
}

export async function POST(request: Request): Promise<Response> {
  return dispatch(request);
}
