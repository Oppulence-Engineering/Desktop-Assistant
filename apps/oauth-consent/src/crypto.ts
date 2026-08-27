import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

export function hmac(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function hookSignatureV1(
  secret: string,
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  body: string | Buffer,
): string {
  const digest = createHash('sha256').update(body).digest('hex');
  return hmac(['v1', method.toUpperCase(), path, timestamp, nonce, digest].join('\n'), secret);
}

export function signValue(value: string, secret: string): string {
  return `${value}.${hmac(value, secret)}`;
}

export function verifySignedValue(signed: string | undefined, secret: string): string | undefined {
  if (!signed) return undefined;
  const separator = signed.lastIndexOf('.');
  if (separator <= 0) return undefined;
  const value = signed.slice(0, separator);
  const actual = signed.slice(separator + 1);
  const expected = hmac(value, secret);
  return safeEqual(actual, expected) ? value : undefined;
}

export function safeEqual(left: string | undefined, right: string | undefined): boolean {
  if (left === undefined || right === undefined) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
