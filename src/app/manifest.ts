function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface GitHubAppManifest {
  name: string;
  url: string;
  hook_attributes: {
    url: string;
    active: boolean;
  };
  redirect_url: string;
  callback_urls: string[];
  setup_url: string;
  public: boolean;
  default_events: string[];
  default_permissions: Record<string, string>;
}

/**
 * Builds a GitHub App Manifest JSON payload pre-configured for DiffPulse Code Review.
 */
export function buildGitHubAppManifest(
  origin: string,
  appName: string = 'DiffPulse AI Code Review'
): GitHubAppManifest {
  const cleanOrigin = origin.replace(/\/+$/, '');
  return {
    name: appName.trim() || 'DiffPulse AI Code Review',
    url: cleanOrigin,
    hook_attributes: {
      url: `${cleanOrigin}/webhooks/github`,
      active: true,
    },
    redirect_url: `${cleanOrigin}/install-app/callback`,
    callback_urls: [`${cleanOrigin}/setup`],
    setup_url: `${cleanOrigin}/setup`,
    public: true,
    default_events: ['pull_request'],
    default_permissions: {
      pull_requests: 'write',
      contents: 'read',
      metadata: 'read',
    },
  };
}

/**
 * Renders the 1-Click GitHub App creation page using GitHub App Manifests.
 */
export function renderManifestInstallerHtml(origin: string): string {
  const defaultManifest = JSON.stringify(buildGitHubAppManifest(origin));
  const scriptManifest = defaultManifest.replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Create DiffPulse GitHub App (1-Click)</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 32px; background: #0d1117; color: #e6edf3; }
    .box { max-width: 680px; margin: 0 auto; background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 24px; }
    label { display: block; font-weight: 600; margin: 14px 0 6px; }
    input[type="text"] { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 6px; border: 1px solid #30363d; background: #0d1117; color: #e6edf3; font-size: 14px; }
    .hint { font-size: 13px; color: #8b949e; margin-top: 4px; }
    button { margin-top: 20px; padding: 10px 18px; border: 0; border-radius: 6px; background: #238636; color: #fff; font-weight: 600; font-size: 15px; cursor: pointer; }
    button:hover { background: #2ea043; }
    code { background: #0d1117; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="box">
    <h1>1-Click GitHub App Setup</h1>
    <p>This creates your GitHub App on GitHub with <code>pull_requests: write</code>, <code>contents: read</code>, Webhook URL (<code>${escapeHtml(origin)}/webhooks/github</code>), and Setup URL pre-filled.</p>
    <form id="manifest-form" method="post" action="https://github.com/settings/apps/new">
      <label for="org">GitHub Organization Slug (required for Paid Marketplace Plans)</label>
      <input id="org" type="text" placeholder="e.g. my-company-org (leave empty for personal account)" />
      <div class="hint">GitHub Marketplace only allows paid plans under a verified Organization.</div>

      <label for="appName">GitHub App Name</label>
      <input id="appName" type="text" value="DiffPulse AI Code Review" />
      <div class="hint">Must be globally unique across GitHub Apps.</div>

      <input id="manifest-input" type="hidden" name="manifest" value="${escapeHtml(defaultManifest)}" />
      <button type="submit">Create GitHub App on GitHub</button>
    </form>
  </div>
  <script>
    const form = document.getElementById('manifest-form');
    const orgInput = document.getElementById('org');
    const nameInput = document.getElementById('appName');
    const manifestInput = document.getElementById('manifest-input');
    const baseManifest = ${scriptManifest};

    form.addEventListener('submit', function () {
      const org = orgInput.value.trim();
      const appName = nameInput.value.trim() || 'DiffPulse AI Code Review';
      form.action = org
        ? 'https://github.com/organizations/' + encodeURIComponent(org) + '/settings/apps/new'
        : 'https://github.com/settings/apps/new';
      manifestInput.value = JSON.stringify({ ...baseManifest, name: appName });
    });
  </script>
</body>
</html>`;
}

export interface ManifestConversionResponse {
  id: number;
  slug: string;
  name: string;
  html_url: string;
  webhook_secret: string | null;
  pem: string;
}

/**
 * Exchanges a temporary GitHub App Manifest code for App credentials and renders setup instructions.
 */
export async function exchangeManifestCode(
  code: string,
  apiBaseUrl: string = 'https://api.github.com'
): Promise<ManifestConversionResponse> {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(code)) {
    throw new Error('Invalid manifest conversion code format.');
  }

  const url = `${apiBaseUrl.replace(/\/+$/, '')}/app-manifests/${encodeURIComponent(code)}/conversions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'DiffPulse-GitHub-App',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub manifest exchange failed (HTTP ${response.status}): ${body.slice(0, 300)}`
    );
  }

  return (await response.json()) as ManifestConversionResponse;
}

export function renderManifestSuccessHtml(app: ManifestConversionResponse): string {
  const singleLinePem = app.pem.replace(/\r?\n/g, '\\n');
  const webhookSecret = app.webhook_secret ?? '';
  const appSettingsUrl = app.html_url
    ? `${app.html_url}`
    : `https://github.com/settings/apps/${encodeURIComponent(app.slug)}`;

  const commands = [
    `printf '%s' '${app.id}' | vercel env add GITHUB_APP_ID production`,
    `printf '%s' '${webhookSecret}' | vercel env add GITHUB_WEBHOOK_SECRET production`,
    `printf '%s' '${singleLinePem}' | vercel env add GITHUB_APP_PRIVATE_KEY production`,
    `vercel deploy --prod --yes`,
  ].join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GitHub App Created — ${escapeHtml(app.name)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 32px; background: #0d1117; color: #e6edf3; }
    .box { max-width: 780px; margin: 0 auto; background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 24px; }
    pre { background: #0d1117; border: 1px solid #30363d; padding: 14px; border-radius: 6px; overflow-x: auto; font-size: 13px; }
    .warn { color: #d29922; font-weight: 600; }
    a.btn { display: inline-block; padding: 10px 16px; border-radius: 6px; background: #238636; color: #fff; text-decoration: none; font-weight: 600; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="box">
    <h1>GitHub App Created: ${escapeHtml(app.name)}</h1>
    <p class="warn">Save these credentials now — this page is not stored and private keys are only shown once.</p>
    <p><strong>App ID:</strong> <code>${app.id}</code> | <strong>Slug:</strong> <code>${escapeHtml(app.slug)}</code></p>
    <h3>1. Save Environment Variables to Vercel</h3>
    <pre>${escapeHtml(commands)}</pre>
    <h3>2. Next: Add Pricing Plans in GitHub Marketplace</h3>
    <p>Open your GitHub App settings page, scroll to <strong>Marketplace → List in GitHub Marketplace</strong>, and create your Free, Flat-rate, and Per-unit plans.</p>
    <a class="btn" href="${escapeHtml(appSettingsUrl)}" target="_blank" rel="noopener">Open GitHub App Page</a>
  </div>
</body>
</html>`;
}
