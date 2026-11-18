export type PricingModel = 'free' | 'flat-rate' | 'per-unit';

export interface MarketplacePlanDefinition {
  key: 'free' | 'pro' | 'business';
  /** Numeric plan ID assigned by GitHub Marketplace (configurable via env). */
  marketplacePlanId: number;
  name: string;
  pricingModel: PricingModel;
  monthlyPriceUsd: number;
  yearlyPriceUsd: number;
  unitName?: string;
  freeTrialDays: number;
  bullets: string[];
  entitlements: {
    aiEnabled: boolean;
    /** Null means unlimited PR reviews per month. */
    maxPrReviewsPerMonth: number | null;
    maxFilesPerReview: number;
    maxDiffChars: number;
    allowCustomPrompt: boolean;
  };
}

function parsePlanId(envVal: string | undefined, fallback: number): number {
  const parsed = envVal ? Number.parseInt(envVal, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getMarketplacePlans(
  env: Record<string, string | undefined> = process.env
): MarketplacePlanDefinition[] {
  return [
    {
      key: 'free',
      marketplacePlanId: parsePlanId(env.PLAN_ID_FREE, 1),
      name: 'Free',
      pricingModel: 'free',
      monthlyPriceUsd: 0,
      yearlyPriceUsd: 0,
      freeTrialDays: 0,
      bullets: [
        'Deterministic security & secret-leak heuristics',
        'Up to 50 pull request reviews per month',
        'Up to 20 changed files per review',
        'Sticky PR summary comments',
      ],
      entitlements: {
        aiEnabled: false,
        maxPrReviewsPerMonth: 50,
        maxFilesPerReview: 20,
        maxDiffChars: 16000,
        allowCustomPrompt: false,
      },
    },
    {
      key: 'pro',
      marketplacePlanId: parsePlanId(env.PLAN_ID_PRO, 2),
      name: 'Pro Team',
      pricingModel: 'flat-rate',
      monthlyPriceUsd: 29,
      yearlyPriceUsd: 290,
      freeTrialDays: 14,
      bullets: [
        'Full AI code review (OpenAI, Anthropic, or Gemini)',
        'Up to 500 pull request reviews per month',
        'Line-anchored inline PR review comments',
        'Custom .github/diffpulse.yml rules & prompts',
      ],
      entitlements: {
        aiEnabled: true,
        maxPrReviewsPerMonth: 500,
        maxFilesPerReview: 40,
        maxDiffChars: 24000,
        allowCustomPrompt: true,
      },
    },
    {
      key: 'business',
      marketplacePlanId: parsePlanId(env.PLAN_ID_BUSINESS, 3),
      name: 'Business',
      pricingModel: 'per-unit',
      monthlyPriceUsd: 12,
      yearlyPriceUsd: 120,
      unitName: 'seat',
      freeTrialDays: 14,
      bullets: [
        'Everything in Pro Team, scaled per developer seat',
        'Unlimited pull request reviews per month',
        'Up to 100 changed files & 48k diff budget per review',
        'Priority AI model routing & AUTO review approvals',
      ],
      entitlements: {
        aiEnabled: true,
        maxPrReviewsPerMonth: null,
        maxFilesPerReview: 100,
        maxDiffChars: 48000,
        allowCustomPrompt: true,
      },
    },
  ];
}

export function findPlanByMarketplaceId(
  planId: number,
  plans: MarketplacePlanDefinition[]
): MarketplacePlanDefinition | undefined {
  return plans.find((plan) => plan.marketplacePlanId === planId);
}
