import { z } from 'zod';
import type { JWTPayload } from 'jose';

/**
 * ClaimsSchema is the zod schema for verified, normalized claims extracted from
 * a token. The exported {@link Claims} type is inferred from it, so the schema
 * is the single source of truth and is also available to consumers that want to
 * validate claims at runtime.
 */
export const ClaimsSchema = z.object({
  subject: z.string(),
  issuer: z.string(),
  audience: z.array(z.string()),
  scopes: z.array(z.string()),
  /** Expiry as epoch seconds. */
  expiresAt: z.number(),
  /** Not-before and issued-at timestamps as epoch seconds when present. */
  notBefore: z.number().optional(),
  issuedAt: z.number().optional(),
  /** RFC 012 connector actor fields. */
  userId: z.string(),
  organizationId: z.string().optional(),
  connectionId: z.string().optional(),
  connectorId: z.string().optional(),
  credentialGeneration: z.number().int().positive().optional(),
  tokenId: z.string().optional(),
  trustTier: z.string().optional(),
  workosUserId: z.string().optional(),
  workosOrgId: z.string().optional(),
  email: z.string().optional(),
  /** The full claim set, for non-standard claims. */
  raw: z.custom<JWTPayload>(),
});

/** Verified, normalized claims extracted from a token. */
export type Claims = z.infer<typeof ClaimsSchema>;

function toStringArray(v: unknown): string[] {
  if (typeof v === 'string') return v ? [v] : [];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return [];
}

function extractScopes(p: JWTPayload): string[] {
  if (typeof p.scope === 'string' && p.scope) return p.scope.split(/\s+/).filter(Boolean);
  if (Array.isArray((p as Record<string, unknown>).scp)) return toStringArray((p as Record<string, unknown>).scp);
  if (typeof (p as Record<string, unknown>).scp === 'string') {
    return (((p as Record<string, unknown>).scp as string) || '').split(/\s+/).filter(Boolean);
  }
  return [];
}

function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) if (typeof v === 'string' && v) return v;
  return undefined;
}

/** Normalizes a verified JWT payload into Claims. */
export function claimsFromPayload(p: JWTPayload): Claims {
  const ext = (p.ext as Record<string, unknown> | undefined) ?? undefined;
  const record = p as Record<string, unknown>;
  const userId = firstString(ext?.user_id, record.user_id, ext?.workos_user_id, record.workos_user_id, p.sub) ?? '';
  const organizationId = firstString(
    ext?.organization_id,
    record.organization_id,
    ext?.org_id,
    record.org_id,
    ext?.workos_org_id,
    record.workos_org_id,
  );
  return {
    subject: typeof p.sub === 'string' ? p.sub : '',
    issuer: typeof p.iss === 'string' ? p.iss : '',
    audience: toStringArray(p.aud),
    scopes: extractScopes(p),
    expiresAt: typeof p.exp === 'number' ? p.exp : 0,
    notBefore: typeof p.nbf === 'number' ? p.nbf : undefined,
    issuedAt: typeof p.iat === 'number' ? p.iat : undefined,
    userId,
    organizationId,
    connectionId: firstString(ext?.connection_id, record.connection_id),
    connectorId: firstString(ext?.connector_id, record.connector_id),
    credentialGeneration: firstPositiveInteger(ext?.credential_generation, record.credential_generation),
    tokenId: firstString(p.jti, ext?.token_id, record.token_id),
    trustTier: firstString(ext?.trust_tier, record.trust_tier),
    workosUserId: firstString(ext?.workos_user_id, record.workos_user_id, userId),
    workosOrgId: firstString(ext?.workos_org_id, record.workos_org_id, organizationId),
    email: firstString(ext?.email, record.email),
    raw: p,
  };
}

function firstPositiveInteger(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  }
  return undefined;
}

export function hasScope(c: Claims, scope: string): boolean {
  return c.scopes.includes(scope);
}

export function hasAllScopes(c: Claims, ...scopes: string[]): boolean {
  return scopes.every((s) => c.scopes.includes(s));
}

export function hasAnyScope(c: Claims, ...scopes: string[]): boolean {
  return scopes.some((s) => c.scopes.includes(s));
}
