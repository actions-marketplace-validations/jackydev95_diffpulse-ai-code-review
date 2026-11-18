import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies a GitHub webhook payload against `X-Hub-Signature-256` (`sha256=<hex>`).
 */
export function verifyGitHubWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!secret || !signatureHeader) {
    return false;
  }

  const expectedHex = createHmac('sha256', secret).update(rawBody).digest('hex');
  const expected = Buffer.from(`sha256=${expectedHex}`, 'utf8');
  const actual = Buffer.from(signatureHeader.trim(), 'utf8');

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}
