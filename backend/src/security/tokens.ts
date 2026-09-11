import crypto from 'node:crypto';

export function createOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashOpaqueToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function timingSafeEqualString(left: unknown, right: unknown): boolean {
  if (typeof left !== 'string' || typeof right !== 'string') {
    return false;
  }

  const leftDigest = crypto.createHash('sha256').update(left).digest();
  const rightDigest = crypto.createHash('sha256').update(right).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

export type OAuthProvider = 'github' | 'orcid' | 'bitbucket' | 'gitlab';

export interface OAuthStatePayload {
  provider: OAuthProvider;
  nonce: string;
  userId: number | null;
  expiresAt: number;
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function signOAuthState(payload: OAuthStatePayload, secret: string): string {
  const encodedPayload = encodeJson(payload);
  const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

export function verifyOAuthState(token: string, secret: string): OAuthStatePayload | null {
  const [encodedPayload, suppliedSignature, extra] = token.split('.');
  if (!encodedPayload || !suppliedSignature || extra) {
    return null;
  }

  const expectedSignature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  if (!timingSafeEqualString(suppliedSignature, expectedSignature)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<OAuthStatePayload>;
    if (
      !['github', 'orcid', 'bitbucket', 'gitlab'].includes(String(parsed.provider)) ||
      typeof parsed.nonce !== 'string' || parsed.nonce.length < 32 ||
      (parsed.userId !== null && (!Number.isSafeInteger(parsed.userId) || Number(parsed.userId) < 1)) ||
      !Number.isSafeInteger(parsed.expiresAt)
    ) {
      return null;
    }

    return parsed as OAuthStatePayload;
  } catch {
    return null;
  }
}
