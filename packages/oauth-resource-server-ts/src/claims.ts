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
  return {
    subject: typeof p.sub === 'string' ? p.sub : '',
    issuer: typeof p.iss === 'string' ? p.iss : '',
    audience: toStringArray(p.aud),
    scopes: extractScopes(p),
    expiresAt: typeof p.exp === 'number' ? p.exp : 0,
    workosUserId: firstString(ext?.workos_user_id, (p as Record<string, unknown>).workos_user_id, p.sub),
    workosOrgId: firstString(ext?.workos_org_id, (p as Record<string, unknown>).workos_org_id, (p as Record<string, unknown>).org_id),
    email: firstString(ext?.email, (p as Record<string, unknown>).email),
    raw: p,
  };
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
