import { MarketplacePlanDefinition } from './plans';
import { AccountSubscription } from './store';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTrialDaysRemaining(freeTrialEndsOn: string | null): string {
  if (!freeTrialEndsOn) return 'N/A';
  const diffMs = Date.parse(freeTrialEndsOn) - Date.now();
  if (Number.isNaN(diffMs)) return freeTrialEndsOn;
  const days = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  return `${days} day(s) remaining (ends ${escapeHtml(freeTrialEndsOn.slice(0, 10))})`;
}

/**
 * Renders the Setup / Billing Dashboard HTML page for GitHub Marketplace customers.
 */
export function renderBillingDashboardHtml(options: {
  marketplaceSlug: string;
  plans: MarketplacePlanDefinition[];
  subscription?: AccountSubscription;
  isMarketplaceConfigured?: boolean;
}): string {
  const {
    marketplaceSlug,
    plans,
    subscription,
    isMarketplaceConfigured = Boolean(subscription),
  } = options;
  const safeSlug = encodeURIComponent(marketplaceSlug);
  const marketplaceBaseUrl = `https://github.com/marketplace/${safeSlug}`;

  const planCards = plans
    .map((plan) => {
      const priceText =
        plan.pricingModel === 'free'
          ? '$0 / month (Free forever)'
          : plan.pricingModel === 'flat-rate'
            ? `$${plan.monthlyPriceUsd}/mo or $${plan.yearlyPriceUsd}/yr (Flat-rate)`
            : `$${plan.monthlyPriceUsd}/${plan.unitName ?? 'unit'}/mo or $${plan.yearlyPriceUsd}/${plan.unitName ?? 'unit'}/yr (Per-unit)`;

      const isActive = subscription?.planId === plan.marketplacePlanId;

      let actionHref = '/install-app';
      let actionLabel = 'Setup GitHub App First';
      let targetBlank = false;

      if (isMarketplaceConfigured) {
        targetBlank = true;
        if (isActive) {
          actionHref = marketplaceBaseUrl;
          actionLabel = 'Manage on GitHub Marketplace';
        } else if (subscription) {
          actionHref = `${marketplaceBaseUrl}/upgrade/${plan.marketplacePlanId}/${subscription.accountId}`;
          actionLabel = `Select ${plan.name}`;
        } else {
          actionHref = marketplaceBaseUrl;
          actionLabel = `View ${plan.name} on Marketplace`;
        }
      }

      return `
        <div class="card ${isActive ? 'active' : ''}">
          <div class="badge">${escapeHtml(plan.pricingModel.toUpperCase())}</div>
          <h3>${escapeHtml(plan.name)} ${isActive ? '<span>(Current)</span>' : ''}</h3>
          <p class="price">${escapeHtml(priceText)}</p>
          ${plan.freeTrialDays > 0 ? `<p class="trial">${plan.freeTrialDays}-day free trial available</p>` : ''}
          <ul>
            ${plan.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}
          </ul>
          <a class="btn ${isMarketplaceConfigured ? '' : 'secondary'}" href="${escapeHtml(actionHref)}" ${targetBlank ? 'target="_blank" rel="noopener"' : ''}>
            ${escapeHtml(actionLabel)}
          </a>
        </div>
      `;
    })
    .join('\n');

  const statusHtml = subscription
    ? `
      <section class="status-box">
        <h2>Current Subscription — ${escapeHtml(subscription.accountLogin)}</h2>
        <table>
          <tr><th>Account Type</th><td>${escapeHtml(subscription.accountType)} (#${subscription.accountId})</td></tr>
          <tr><th>Current Plan</th><td><strong>${escapeHtml(subscription.planName)}</strong> (${escapeHtml(subscription.pricingModel)})</td></tr>
          <tr><th>Status</th><td>${escapeHtml(subscription.status)}</td></tr>
          <tr><th>Billing Cycle</th><td>${escapeHtml(subscription.billingCycle)}</td></tr>
          <tr><th>Free Trial</th><td>${subscription.onFreeTrial ? formatTrialDaysRemaining(subscription.freeTrialEndsOn) : 'No'}</td></tr>
          <tr><th>Seats / Units</th><td>${subscription.unitCount} purchased</td></tr>
          <tr><th>PR Reviews (${escapeHtml(subscription.usageMonth)})</th><td>${subscription.reviewsUsedThisMonth} used</td></tr>
        </table>
        ${
          subscription.pendingChange
            ? `<p class="pending">Pending change to <strong>${escapeHtml(subscription.pendingChange.planName)}</strong> (${subscription.pendingChange.unitCount} unit(s), ${escapeHtml(subscription.pendingChange.billingCycle)}) effective ${escapeHtml(subscription.pendingChange.effectiveDate)}.</p>`
            : ''
        }
        <p><a class="btn" href="${escapeHtml(marketplaceBaseUrl)}" target="_blank" rel="noopener">Manage Billing on GitHub Marketplace</a></p>
      </section>
    `
    : `
      <section class="status-box">
        <h2>DiffPulse GitHub App & Marketplace Billing</h2>
        ${
          isMarketplaceConfigured
            ? `<p>Install or manage your subscription directly via GitHub Marketplace. Pass <code>?account_id=&lt;id&gt;</code> to inspect a specific organization's active plan and seat usage.</p>`
            : `<p class="warn"><strong>Setup in progress:</strong> This server is live, but your GitHub App &amp; Marketplace listing haven't been linked yet (<code>GITHUB_APP_ID</code> / <code>PLAN_ID_*</code> are not set). Click below to create the GitHub App in 1 click, then publish its Marketplace listing.</p>`
        }
        <p><a class="btn" href="/install-app">1-Click GitHub App Setup (Manifest)</a></p>
      </section>
    `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DiffPulse AI Code Review — Plans & Billing</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 32px; background: #0d1117; color: #e6edf3; }
    .container { max-width: 1020px; margin: 0 auto; }
    h1, h2, h3 { margin-top: 0; }
    .status-box { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 20px; margin-bottom: 28px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0 18px; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #21262d; }
    th { color: #8b949e; width: 220px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: 18px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 20px; display: flex; flex-direction: column; }
    .card.active { border-color: #2f81f7; box-shadow: 0 0 0 1px #2f81f7; }
    .badge { display: inline-block; font-size: 11px; font-weight: 600; color: #79c0ff; background: #1f6feb22; padding: 3px 8px; border-radius: 99px; width: fit-content; margin-bottom: 10px; }
    .price { font-size: 16px; font-weight: 600; color: #58a6ff; margin: 4px 0 8px; }
    .trial { font-size: 13px; color: #3fb950; margin: 0 0 10px; }
    ul { padding-left: 18px; flex: 1; color: #c9d1d9; }
    li { margin-bottom: 6px; }
    .btn { display: inline-block; text-align: center; padding: 9px 14px; border-radius: 6px; background: #238636; color: #fff; text-decoration: none; font-weight: 600; margin-top: 10px; }
    .btn:hover { background: #2ea043; }
    .btn.secondary { background: #21262d; border: 1px solid #30363d; color: #c9d1d9; }
    .btn.secondary:hover { background: #30363d; }
    .pending, .warn { color: #d29922; }
    code { background: #0d1117; padding: 2px 5px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>DiffPulse AI Code Review — Marketplace Plans</h1>
    ${statusHtml}
    <section class="grid">
      ${planCards}
    </section>
  </div>
</body>
</html>`;
}
