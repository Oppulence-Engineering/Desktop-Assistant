import "server-only";

import { createHash, randomBytes, randomUUID } from "crypto";

import type { WorkOSPKCECookie } from "@/lib/auth/schemas";

/** Must stay aligned with the PKCE cookie maxAge in lib/auth/cookies.ts. */
export const PKCE_MAX_AGE_SECONDS = 60 * 30;

function base64url(input: Buffer): string {
  return input.toString("base64url");
}

/**
 * Creates a WorkOS AuthKit PKCE challenge. The verifier stays in a sealed
 * HTTP-only cookie; only the S256 challenge and opaque state leave the server.
 */
export function createPKCECookie(returnTo: string): WorkOSPKCECookie & { codeChallenge: string } {
  const codeVerifier = base64url(randomBytes(32));
  return {
    version: 1,
    state: randomUUID(),
    codeVerifier,
    codeChallenge: base64url(createHash("sha256").update(codeVerifier).digest()),
    returnTo,
    createdAt: Math.floor(Date.now() / 1000),
  };
}

/** Rejects PKCE state that outlived the sealed cookie's intended lifetime. */
export function isPKCECookieFresh(
  pending: WorkOSPKCECookie,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  return nowSeconds - pending.createdAt <= PKCE_MAX_AGE_SECONDS;
}

/** Allows only same-origin relative redirects after login/logout. */
export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/")) return "/app";
  if (raw.startsWith("//")) return "/app";
  try {
    const parsed = new URL(raw, "https://rowboat.invalid");
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return "/app";
  }
}
