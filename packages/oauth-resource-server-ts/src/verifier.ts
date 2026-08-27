import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { type Claims, claimsFromPayload } from './claims.js';
import { AuthorizationError, classifyTokenError } from './errors.js';

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
  clockToleranceSec: z.number().nonnegative().optional(),
  /**
   * Accepted signing algorithms. Defaults to RS256 only.
   */
  algorithms: z.array(z.string()).optional(),
});

export type VerifierConfig = z.infer<typeof VerifierConfigSchema>;

const DEFAULT_ALGS = ['RS256'];

/** @deprecated Use AuthorizationError. */
export class TokenError extends AuthorizationError {
  constructor(...args: ConstructorParameters<typeof AuthorizationError>) {
    super(...args);
    this.name = 'TokenError';
  }
}

/**
 * Verifier validates bearer JWTs against a cached JWKS, mirroring the Go
 * oauthrs library so the suite enforces auth identically.
 */
export class Verifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly cfg: VerifierConfig;

  constructor(cfg: VerifierConfig) {
    this.cfg = VerifierConfigSchema.parse(cfg);
    // A zero cooldown makes an unknown kid trigger one immediate re-fetch. jose
    // still coalesces concurrent reloads and caches successful JWKS responses.
    this.jwks = createRemoteJWKSet(new URL(this.cfg.jwksUrl), { cooldownDuration: 0 });
  }

  /** Verifies signature + standard claims and returns normalized Claims. */
  async verify(token: string): Promise<Claims> {
    try {
      const clockTolerance = this.cfg.clockToleranceSec ?? 60;
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.cfg.issuerUrl,
        audience: this.cfg.audience,
        clockTolerance,
        algorithms: this.cfg.algorithms ?? DEFAULT_ALGS,
        requiredClaims: ['exp'],
      });
      const now = Math.floor(Date.now() / 1000);
      if (typeof payload.iat === 'number' && payload.iat > now + clockTolerance) {
        throw new Error('"iat" claim timestamp check failed');
      }
      return claimsFromPayload(payload);
    } catch (err) {
      const classified = classifyTokenError(err);
      throw new TokenError(classified.code, classified.status, classified.message, err);
    }
  }
}

/** Extracts the token from an "Authorization: Bearer <token>" header value. */
export function bearerToken(authorization: string | undefined | null): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return m && m[1] ? m[1].trim() : null;
}
