import { Redis } from '@upstash/redis';
import { MarketplacePlanDefinition } from './plans';
import {
  AccountSubscription,
  QuotaCheckResult,
  SubscriptionStore,
  consumeQuotaWithStore,
} from './store';

export interface RedisLike {
  get<TData = unknown>(key: string): Promise<TData | null>;
  set(key: string, value: unknown): Promise<unknown>;
}

const KEY_PREFIX = 'diffpulse:subscription:';

/**
 * Upstash Redis-backed SubscriptionStore for serverless Vercel deployments.
 */
export class RedisSubscriptionStore implements SubscriptionStore {
  private readonly redis: RedisLike;

  constructor(redisClient?: RedisLike) {
    if (redisClient) {
      this.redis = redisClient;
      return;
    }

    const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    if (url && token) {
      this.redis = new Redis({ url, token });
    } else {
      this.redis = Redis.fromEnv();
    }
  }

  async get(accountId: number): Promise<AccountSubscription | undefined> {
    const value = await this.redis.get<AccountSubscription>(`${KEY_PREFIX}${accountId}`);
    return value ?? undefined;
  }

  async upsert(subscription: AccountSubscription): Promise<AccountSubscription> {
    await this.redis.set(`${KEY_PREFIX}${subscription.accountId}`, subscription);
    return subscription;
  }

  async consumeReviewQuota(
    account: { id: number; login: string; type: 'User' | 'Organization' },
    plans: MarketplacePlanDefinition[],
    now: Date = new Date()
  ): Promise<QuotaCheckResult> {
    return consumeQuotaWithStore(this, account, plans, now);
  }
}

export function createServerlessStore(): SubscriptionStore | undefined {
  const hasRedis = Boolean(
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
      (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
  );
  return hasRedis ? new RedisSubscriptionStore() : undefined;
}
