import { MarketplacePlanDefinition, PricingModel } from './plans';

export type SubscriptionStatus = 'active' | 'pending_cancellation' | 'cancelled';

export interface AccountSubscription {
  accountId: number;
  accountLogin: string;
  accountType: 'User' | 'Organization';
  planId: number;
  planName: string;
  pricingModel: PricingModel;
  billingCycle: 'monthly' | 'yearly';
  unitCount: number;
  onFreeTrial: boolean;
  freeTrialEndsOn: string | null;
  effectiveDate: string;
  status: SubscriptionStatus;
  pendingChange?: {
    planId: number;
    planName: string;
    unitCount: number;
    billingCycle: 'monthly' | 'yearly';
    effectiveDate: string;
  };
  usageMonth: string;
  reviewsUsedThisMonth: number;
  updatedAt: string;
}

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  subscription: AccountSubscription;
  plan: MarketplacePlanDefinition;
}

function currentYearMonth(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export class SubscriptionStore {
  protected readonly records = new Map<number, AccountSubscription>();

  get(accountId: number): AccountSubscription | undefined {
    return this.records.get(accountId);
  }

  list(): AccountSubscription[] {
    return Array.from(this.records.values());
  }

  upsert(subscription: AccountSubscription): AccountSubscription {
    this.records.set(subscription.accountId, subscription);
    return subscription;
  }

  /**
   * Checks monthly PR review quota for an account (defaulting to Free plan if no subscription exists)
   * and increments usage when allowed.
   */
  consumeReviewQuota(
    account: { id: number; login: string; type: 'User' | 'Organization' },
    plans: MarketplacePlanDefinition[],
    now: Date = new Date()
  ): QuotaCheckResult {
    const freePlan = plans.find((p) => p.key === 'free') ?? plans[0];
    const ym = currentYearMonth(now);
    let sub = this.records.get(account.id);

    if (!sub || sub.status === 'cancelled') {
      sub = {
        accountId: account.id,
        accountLogin: account.login,
        accountType: account.type,
        planId: freePlan.marketplacePlanId,
        planName: freePlan.name,
        pricingModel: freePlan.pricingModel,
        billingCycle: 'monthly',
        unitCount: 1,
        onFreeTrial: false,
        freeTrialEndsOn: null,
        effectiveDate: now.toISOString(),
        status: 'active',
        usageMonth: ym,
        reviewsUsedThisMonth: 0,
        updatedAt: now.toISOString(),
      };
    }

    if (sub.usageMonth !== ym) {
      sub = {
        ...sub,
        usageMonth: ym,
        reviewsUsedThisMonth: 0,
      };
    }

    const plan =
      plans.find((p) => p.marketplacePlanId === sub!.planId) ?? freePlan;

    const limit = plan.entitlements.maxPrReviewsPerMonth;
    if (limit !== null && sub.reviewsUsedThisMonth >= limit) {
      this.upsert(sub);
      return {
        allowed: false,
        reason: `Monthly PR review limit reached (${sub.reviewsUsedThisMonth}/${limit}) on the ${plan.name} plan.`,
        subscription: sub,
        plan,
      };
    }

    const updated: AccountSubscription = {
      ...sub,
      reviewsUsedThisMonth: sub.reviewsUsedThisMonth + 1,
      updatedAt: now.toISOString(),
    };
    this.upsert(updated);

    return {
      allowed: true,
      subscription: updated,
      plan,
    };
  }
}
