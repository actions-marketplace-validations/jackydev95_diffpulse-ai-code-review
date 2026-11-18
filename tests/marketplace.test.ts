import { createHmac, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGitHubAppJwt } from '../src/app/githubAppAuth';
import {
  handleMarketplacePurchaseEvent,
  MarketplaceWebhookPayload,
} from '../src/app/marketplace';
import { getMarketplacePlans } from '../src/app/plans';
import { verifyGitHubWebhookSignature } from '../src/app/signature';
import { SubscriptionStore } from '../src/app/store';

function makePurchasePayload(
  action: MarketplaceWebhookPayload['action'],
  overrides: Partial<MarketplaceWebhookPayload['marketplace_purchase']> = {},
  effectiveDate: string = '2026-11-01T00:00:00Z'
): MarketplaceWebhookPayload {
  return {
    action,
    effective_date: effectiveDate,
    marketplace_purchase: {
      account: { id: 9001, login: 'acme-org', type: 'Organization' },
      billing_cycle: 'monthly',
      unit_count: 1,
      on_free_trial: true,
      free_trial_ends_on: '2026-11-15T00:00:00Z',
      plan: {
        id: 2,
        name: 'Pro Team',
        price_model: 'FLAT_RATE',
        monthly_price_in_cents: 2900,
        yearly_price_in_cents: 29000,
      },
      ...overrides,
    },
  };
}

describe('app/plans, signature, store & marketplace', () => {
  it('defines Free, Flat-rate, and Per-unit plans with monthly & yearly USD prices', () => {
    const plans = getMarketplacePlans({});
    expect(plans).toHaveLength(3);

    const free = plans.find((p) => p.pricingModel === 'free');
    const flat = plans.find((p) => p.pricingModel === 'flat-rate');
    const perUnit = plans.find((p) => p.pricingModel === 'per-unit');

    expect(free?.monthlyPriceUsd).toBe(0);
    expect(flat?.monthlyPriceUsd).toBeGreaterThan(0);
    expect(flat?.yearlyPriceUsd).toBeGreaterThan(0);
    expect(perUnit?.monthlyPriceUsd).toBeGreaterThan(0);
    expect(perUnit?.yearlyPriceUsd).toBeGreaterThan(0);
    expect(perUnit?.unitName).toBe('seat');
  });

  it('verifies X-Hub-Signature-256 HMAC signatures safely', () => {
    const body = Buffer.from('{"hello":"world"}', 'utf8');
    const secret = 'super-webhook-secret';
    const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

    expect(verifyGitHubWebhookSignature(body, sig, secret)).toBe(true);
    expect(verifyGitHubWebhookSignature(body, sig, 'wrong-secret')).toBe(false);
    expect(verifyGitHubWebhookSignature('{"hello":"tampered"}', sig, secret)).toBe(false);
    expect(verifyGitHubWebhookSignature(body, undefined, secret)).toBe(false);
  });

  it('handles marketplace_purchase lifecycle and persists subscriptions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'diffpulse-store-'));
    try {
      const storePath = join(dir, 'subs.json');
      const store = new SubscriptionStore(storePath);
      const plans = getMarketplacePlans({});

      // Purchased Pro flat-rate
      const created = handleMarketplacePurchaseEvent(
        makePurchasePayload('purchased'),
        store,
        plans
      );
      expect(created.planName).toBe('Pro Team');
      expect(created.status).toBe('active');
      expect(created.onFreeTrial).toBe(true);

      // Pending downgrade
      const pending = handleMarketplacePurchaseEvent(
        makePurchasePayload('pending_change', {
          plan: {
            id: 1,
            name: 'Free',
            price_model: 'FREE',
            monthly_price_in_cents: 0,
            yearly_price_in_cents: 0,
          },
        }),
        store,
        plans
      );
      expect(pending.pendingChange?.planName).toBe('Free');

      // Cancel pending change
      const cleared = handleMarketplacePurchaseEvent(
        makePurchasePayload('pending_change_cancelled'),
        store,
        plans
      );
      expect(cleared.pendingChange).toBeUndefined();

      // Upgrade to per-unit Business with 5 seats yearly
      const upgraded = handleMarketplacePurchaseEvent(
        makePurchasePayload('changed', {
          billing_cycle: 'yearly',
          unit_count: 5,
          on_free_trial: false,
          free_trial_ends_on: null,
          plan: {
            id: 3,
            name: 'Business',
            price_model: 'PER_UNIT',
            monthly_price_in_cents: 1200,
            yearly_price_in_cents: 12000,
            unit_name: 'seat',
          },
        }),
        store,
        plans
      );
      expect(upgraded.pricingModel).toBe('per-unit');
      expect(upgraded.unitCount).toBe(5);
      expect(upgraded.billingCycle).toBe('yearly');

      // Reload from disk to verify persistence
      const reloaded = new SubscriptionStore(storePath);
      expect(reloaded.get(9001)?.unitCount).toBe(5);

      // Immediate vs future cancellation
      const pendingCancel = handleMarketplacePurchaseEvent(
        makePurchasePayload('cancelled', {}, '2099-01-01T00:00:00Z'),
        reloaded,
        plans
      );
      expect(pendingCancel.status).toBe('pending_cancellation');

      const immediateCancel = handleMarketplacePurchaseEvent(
        makePurchasePayload('cancelled', {}, '2020-01-01T00:00:00Z'),
        reloaded,
        plans
      );
      expect(immediateCancel.status).toBe('cancelled');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('enforces Free monthly quota and resets across month boundaries', () => {
    const store = new SubscriptionStore();
    const plans = getMarketplacePlans({});
    const account = { id: 77, login: 'octo', type: 'User' as const };
    const nov = new Date('2026-11-18T10:00:00Z');

    for (let i = 0; i < 50; i += 1) {
      const res = store.consumeReviewQuota(account, plans, nov);
      expect(res.allowed).toBe(true);
    }

    const blocked = store.consumeReviewQuota(account, plans, nov);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain('50/50');

    const dec = new Date('2026-12-01T00:00:00Z');
    const reset = store.consumeReviewQuota(account, plans, dec);
    expect(reset.allowed).toBe(true);
    expect(reset.subscription.reviewsUsedThisMonth).toBe(1);
  });

  it('signs valid RS256 JWTs for GitHub App authentication', () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });

    const jwt = createGitHubAppJwt('12345', privateKey, 1700000000);
    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);
    const decodedPayload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8')
    );
    expect(decodedPayload).toMatchObject({
      iss: '12345',
      iat: 1699999940,
      exp: 1700000540,
    });
  });
});
