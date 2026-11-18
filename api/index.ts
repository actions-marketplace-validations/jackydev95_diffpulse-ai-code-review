import { getMarketplacePlans } from '../src/app/plans';
import { createServerlessStore } from '../src/app/redisStore';
import { handleAppRequest } from '../src/app/router';
import { InMemorySubscriptionStore } from '../src/app/store';
import { AIProviderName } from '../src/review/types';

// Uses Upstash Redis automatically when UPSTASH_REDIS_REST_URL / KV_REST_API_URL is set,
// falling back to an in-memory store for initial setup and testing.
const store = createServerlessStore() ?? new InMemorySubscriptionStore();

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
