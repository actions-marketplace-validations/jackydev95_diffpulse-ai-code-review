import { createSign } from 'node:crypto';

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Normalizes PEM private keys stored with escaped `\n` in environment variables.
 */
export function normalizePrivateKey(rawKey: string): string {
  return rawKey.includes('\\n') ? rawKey.replace(/\\n/g, '\n') : rawKey;
}

/**
 * Creates a short-lived RS256 JWT for authenticating as a GitHub App.
 */
export function createGitHubAppJwt(
  appId: string,
  privateKeyPem: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iat: nowSeconds - 60,
      exp: nowSeconds + 9 * 60,
      iss: appId,
    })
  );

  const signingInput = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = base64UrlEncode(signer.sign(normalizePrivateKey(privateKeyPem)));
  return `${signingInput}.${signature}`;
}

/**
 * Exchanges a GitHub App JWT for an installation access token.
 */
export async function getInstallationAccessToken(
  appId: string,
  privateKeyPem: string,
  installationId: number,
  apiBaseUrl: string = 'https://api.github.com'
): Promise<string> {
  const jwt = createGitHubAppJwt(appId, privateKeyPem);
  const url = `${apiBaseUrl.replace(/\/+$/, '')}/app/installations/${installationId}/access_tokens`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'DiffPulse-GitHub-App',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to obtain installation token (HTTP ${response.status}): ${body.slice(0, 300)}`
    );
  }

  const data = (await response.json()) as { token?: string };
  if (!data.token) {
    throw new Error('GitHub installation access token response missing "token".');
  }
  return data.token;
}
