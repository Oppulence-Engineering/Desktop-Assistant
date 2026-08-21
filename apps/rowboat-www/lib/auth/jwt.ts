import "server-only";

import { WorkOSAccessTokenClaimsSchema, type WorkOSAccessTokenClaims } from "@/lib/auth/schemas";

/**
 * Decodes a JWT payload without treating it as trusted. rowboat-www uses this
 * only for display metadata and WorkOS logout hints; rowboat-api remains the
 * verifier and authorization authority for every dashboard API request.
 */
export function decodeUnverifiedWorkOSClaims(accessToken: string): WorkOSAccessTokenClaims {
  const [, payload] = accessToken.split(".");
  if (!payload) return {};
  try {
    const raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return WorkOSAccessTokenClaimsSchema.parse(raw);
  } catch {
    return {};
  }
}
