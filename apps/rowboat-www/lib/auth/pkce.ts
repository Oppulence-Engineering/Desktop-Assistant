import "server-only";

import { createHash, randomBytes, randomUUID } from "crypto";

import type { WorkOSPKCECookie } from "@/lib/auth/schemas";

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
