import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { type Claims, claimsFromPayload } from './claims.js';

/**
 * VerifierConfigSchema is the zod schema for a {@link Verifier}'s configuration.
 * The exported {@link VerifierConfig} type is inferred from it, and the schema
 * is exported so callers can validate config from untrusted sources (env, JSON).
 */
export const VerifierConfigSchema = z.object({
  /** Expected `iss` claim. If set, mismatching issuers are rejected. */
  issuerUrl: z.string().optional(),
  /** Expected `aud` claim (e.g. "canvas-api"). If set, enforced. */
  audience: z.string().optional(),
  /** JWKS endpoint URL (required). */
  jwksUrl: z.string(),
  /** Allowed clock skew in seconds (default 60). */
  clockToleranceSec: z.number().optional(),
  /**
   * Accepted signing algorithms. Defaults to the asymmetric set; symmetric
   * (HS*) is intentionally excluded so a leaked public key can't forge tokens.
   */
  algorithms: z.array(z.string()).optional(),
});

export type VerifierConfig = z.infer<typeof VerifierConfigSchema>;

const DEFAULT_ALGS = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512', 'PS256', 'PS384', 'PS512'];

export class TokenError extends Error {}

/**
 * Verifier validates bearer JWTs against a cached JWKS, mirroring the Go
 * oauthrs library so the suite enforces auth identically.
 */
export class Verifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly cfg: VerifierConfig;

  constructor(cfg: VerifierConfig) {
    if (!cfg.jwksUrl) throw new Error('oauthrs: jwksUrl is required');
    this.cfg = cfg;
    this.jwks = createRemoteJWKSet(new URL(cfg.jwksUrl));
  }

  /** Verifies signature + standard claims and returns normalized Claims. */
  async verify(token: string): Promise<Claims> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.cfg.issuerUrl,
        audience: this.cfg.audience,
        clockTolerance: this.cfg.clockToleranceSec ?? 60,
        algorithms: this.cfg.algorithms ?? DEFAULT_ALGS,
        requiredClaims: ['exp'],
      });
      return claimsFromPayload(payload);
    } catch (err) {
      throw new TokenError(`oauthrs: verify failed: ${(err as Error).message}`);
    }
  }
}

/** Extracts the token from an "Authorization: Bearer <token>" header value. */
export function bearerToken(authorization: string | undefined | null): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return m && m[1] ? m[1].trim() : null;
}
