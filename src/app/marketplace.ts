import { MarketplacePlanDefinition, PricingModel, findPlanByMarketplaceId } from './plans';
import { AccountSubscription, SubscriptionStore } from './store';

export type MarketplacePurchaseAction =
  | 'purchased'
  | 'changed'
  | 'pending_change'
  | 'pending_change_cancelled'
  | 'cancelled';

export interface MarketplaceWebhookPayload {
  action: MarketplacePurchaseAction;
  effective_date: string;
  marketplace_purchase: {
    account: {
      id: number;
      login: string;
      type: 'User' | 'Organization';
    };
    billing_cycle: 'monthly' | 'yearly';
    unit_count: number;
    on_free_trial: boolean;
    free_trial_ends_on: string | null;
    plan: {
      id: number;
      name: string;
      price_model: 'FREE' | 'FLAT_RATE' | 'PER_UNIT';
      monthly_price_in_cents: number;
      yearly_price_in_cents: number;
      unit_name?: string | null;
    };
  };
}

function mapGitHubPriceModel(raw: string): PricingModel {
  switch (raw.toUpperCase()) {
    case 'FLAT_RATE':
      return 'flat-rate';
    case 'PER_UNIT':
      return 'per-unit';
    default:
      return 'free';
  }
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Processes a GitHub `marketplace_purchase` webhook event and updates the SubscriptionStore.
 */
export async function handleMarketplacePurchaseEvent(
  payload: MarketplaceWebhookPayload,
  store: SubscriptionStore,
  plans: MarketplacePlanDefinition[]
): Promise<AccountSubscription> {
  const purchase = payload.marketplace_purchase;
  const account = purchase.account;
  const existing = await store.get(account.id);
  const matchedPlan = findPlanByMarketplaceId(purchase.plan.id, plans);

  const resolvedPlanName = matchedPlan?.name ?? purchase.plan.name;
  const resolvedModel =
    matchedPlan?.pricingModel ?? mapGitHubPriceModel(purchase.plan.price_model);
  const nowIso = new Date().toISOString();

  const base: AccountSubscription = existing ?? {
    accountId: account.id,
    accountLogin: account.login,
    accountType: account.type,
    planId: purchase.plan.id,
    planName: resolvedPlanName,
    pricingModel: resolvedModel,
    billingCycle: purchase.billing_cycle,
    unitCount: Math.max(1, purchase.unit_count || 1),
    onFreeTrial: purchase.on_free_trial,
    freeTrialEndsOn: purchase.free_trial_ends_on,
    effectiveDate: payload.effective_date,
    status: 'active',
    usageMonth: currentMonth(),
    reviewsUsedThisMonth: 0,
    updatedAt: nowIso,
  };

  switch (payload.action) {
    case 'purchased':
    case 'changed': {
      return store.upsert({
        ...base,
        accountLogin: account.login,
        accountType: account.type,
        planId: purchase.plan.id,
        planName: resolvedPlanName,
        pricingModel: resolvedModel,
        billingCycle: purchase.billing_cycle,
        unitCount: Math.max(1, purchase.unit_count || 1),
        onFreeTrial: purchase.on_free_trial,
        freeTrialEndsOn: purchase.free_trial_ends_on,
        effectiveDate: payload.effective_date,
        status: 'active',
        pendingChange: undefined,
        updatedAt: nowIso,
      });
    }

    case 'pending_change': {
      return store.upsert({
        ...base,
        pendingChange: {
          planId: purchase.plan.id,
          planName: resolvedPlanName,
          unitCount: Math.max(1, purchase.unit_count || 1),
          billingCycle: purchase.billing_cycle,
          effectiveDate: payload.effective_date,
        },
        updatedAt: nowIso,
      });
    }

    case 'pending_change_cancelled': {
      return store.upsert({
        ...base,
        pendingChange: undefined,
        updatedAt: nowIso,
      });
    }

    case 'cancelled': {
      const effectiveTime = Date.parse(payload.effective_date);
      const isImmediate = Number.isNaN(effectiveTime) || effectiveTime <= Date.now();
      return store.upsert({
        ...base,
        effectiveDate: payload.effective_date,
        status: isImmediate ? 'cancelled' : 'pending_cancellation',
        pendingChange: undefined,
        updatedAt: nowIso,
      });
    }

    default: {
      const exhaustive: never = payload.action;
      throw new Error(`Unsupported marketplace_purchase action: ${String(exhaustive)}`);
    }
  }
}
