import { createHmac } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppServer } from '../src/app/server';
import { InMemorySubscriptionStore } from '../src/app/store';

function signBody(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('app/server HTTP integration', () => {
  const activeServers: Array<{ close: (cb: () => void) => void }> = [];

  afterEach(async () => {
    for (const srv of activeServers) {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
    activeServers.length = 0;
  });

  it('serves health, plans, signed marketplace_purchase webhooks, and billing dashboard', async () => {
    const secret = 'test-webhook-secret';
    const { server } = createAppServer({
      webhookSecret: secret,
      store: new InMemorySubscriptionStore(),
      runtime: {
        appId: '101',
        privateKey: '',
        aiProvider: 'heuristic-only',
        aiApiKey: '',
        marketplaceSlug: 'diffpulse-ai-code-review',
      },
      log: () => {},
    });
    activeServers.push(server);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const healthRes = await fetch(`${baseUrl}/health`);
    expect(healthRes.status).toBe(200);
    expect(await healthRes.json()).toMatchObject({ ok: true });

    const plansRes = await fetch(`${baseUrl}/api/plans`);
    expect(plansRes.status).toBe(200);
    const plansJson = (await plansRes.json()) as { plans: unknown[] };
    expect(plansJson.plans).toHaveLength(3);

    // Reject invalid signature
    const unauthRes = await fetch(`${baseUrl}/webhooks/github`, {
      method: 'POST',
      headers: {
        'x-github-event': 'marketplace_purchase',
        'x-hub-signature-256': 'sha256=bad',
      },
      body: '{}',
    });
    expect(unauthRes.status).toBe(401);

    // Accept valid marketplace_purchase webhook
    const purchaseBody = JSON.stringify({
      action: 'purchased',
      effective_date: '2026-11-18T00:00:00Z',
      marketplace_purchase: {
        account: { id: 555, login: 'demo-team', type: 'Organization' },
        billing_cycle: 'yearly',
        unit_count: 8,
        on_free_trial: true,
        free_trial_ends_on: '2026-12-02T00:00:00Z',
        plan: {
          id: 3,
          name: 'Business',
          price_model: 'PER_UNIT',
          monthly_price_in_cents: 1200,
          yearly_price_in_cents: 12000,
          unit_name: 'seat',
        },
      },
    });

    const hookRes = await fetch(`${baseUrl}/webhooks/github`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-github-event': 'marketplace_purchase',
        'x-hub-signature-256': signBody(purchaseBody, secret),
      },
      body: purchaseBody,
    });
    expect(hookRes.status).toBe(200);

    const apiBilling = await fetch(`${baseUrl}/api/billing/555`);
    expect(apiBilling.status).toBe(200);
    const billingJson = (await apiBilling.json()) as {
      subscription: { planName: string; unitCount: number; billingCycle: string };
    };
    expect(billingJson.subscription).toMatchObject({
      planName: 'Business',
      unitCount: 8,
      billingCycle: 'yearly',
    });

    const unconfiguredHtmlRes = await fetch(`${baseUrl}/billing`);
    expect(unconfiguredHtmlRes.status).toBe(200);
    const unconfiguredHtml = await unconfiguredHtmlRes.text();
    expect(unconfiguredHtml).toContain('Setup GitHub App First');
    expect(unconfiguredHtml).not.toContain('/upgrade/2');

    const htmlRes = await fetch(`${baseUrl}/billing?account_id=555`);
    expect(htmlRes.status).toBe(200);
    const html = await htmlRes.text();
    expect(html).toContain('Current Subscription — demo-team');
    expect(html).toContain('8 purchased');
    expect(html).toContain('Manage Billing on GitHub Marketplace');
    expect(html).toContain('/upgrade/2/555');

    const installRes = await fetch(`${baseUrl}/install-app`);
    expect(installRes.status).toBe(200);
    const installHtml = await installRes.text();
    expect(installHtml).toContain('1-Click GitHub App Setup');
    expect(installHtml).toContain('/webhooks/github');
  });
});
