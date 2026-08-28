import { importJWK, jwtVerify, type JWK, type KeyLike } from 'jose';
import { z } from 'zod';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { type Claims, claimsFromPayload } from './claims.js';
import { AuthorizationError, classifyTokenError } from './errors.js';

const DEFAULT_ALGS = ['RS256'];
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1 << 20;
const DEFAULT_JWKS_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_UNKNOWN_KID_TTL_MS = 30_000;
const DEFAULT_UNKNOWN_KID_REFRESH_COOLDOWN_MS = 30_000;

const BaseConfigSchema = z.object({
  issuerUrl: z.string().min(1),
  audience: z.string().min(1),
  jwksUrl: z.string().min(1),
  clockToleranceSec: z.number().nonnegative().optional(),
  algorithms: z.array(z.string()).optional(),
  allowedJwksOrigins: z.array(z.string()).optional(),
  allowLocalhostDevelopment: z.boolean().optional(),
  requestTimeoutMs: z.number().positive().optional(),
  maxJwksResponseBytes: z.number().int().positive().optional(),
  jwksCacheTtlMs: z.number().positive().optional(),
  unknownKidCacheTtlMs: z.number().nonnegative().optional(),
  unknownKidRefreshCooldownMs: z.number().nonnegative().optional(),
  now: z.function().args().returns(z.number()).optional(),
});

/** Configuration for the fail-closed RFC 012 connector verifier. */
export const VerifierConfigSchema = BaseConfigSchema.extend({ requiredOrganizationId: z.string().min(1).optional() });
export type VerifierConfig = z.infer<typeof VerifierConfigSchema>;
/** Configuration for the explicit generic verifier. */
export const GenericVerifierConfigSchema = BaseConfigSchema;
export type GenericVerifierConfig = z.infer<typeof GenericVerifierConfigSchema>;

/** @deprecated Use AuthorizationError. */
export class TokenError extends AuthorizationError {
  constructor(...args: ConstructorParameters<typeof AuthorizationError>) { super(...args); this.name = 'TokenError'; }
}

type Config = VerifierConfig;
type KeyMap = Map<string, KeyLike | Uint8Array>;

/** Fail-closed RFC 012 verifier requiring connector actor claims. */
export class Verifier {
  private keys: KeyMap = new Map();
  private keysExpireAt = 0;
  private readonly negative = new Map<string, number>();
  private refreshPromise?: Promise<void>;
  private nextUnknownKidRefreshAt = 0;
  private readonly cfg: Config;
  private readonly jwksUrl: URL;
  private readonly allowedOrigins: Set<string>;
  protected requireActor: boolean;

  constructor(cfg: VerifierConfig, requireActor = true) {
    this.cfg = VerifierConfigSchema.parse(cfg);
    this.requireActor = requireActor;
    if (requireActor && this.cfg.algorithms && (this.cfg.algorithms.length !== 1 || this.cfg.algorithms[0] !== 'RS256')) {
      throw new Error('primary RFC 012 verifier requires exactly RS256; use GenericVerifier for other algorithms');
    }
    this.jwksUrl = validateUrl(this.cfg.jwksUrl, !!this.cfg.allowLocalhostDevelopment);
    this.allowedOrigins = buildAllowedOrigins(this.cfg);
    this.assertAllowed(this.jwksUrl);
  }

  protected static generic(cfg: GenericVerifierConfig): Verifier {
    const instance = new Verifier(cfg);
    instance.requireActor = false;
    return instance;
  }

  async verify(token: string): Promise<Claims> {
    try {
      const header = decodeHeader(token);
      const key = await this.keyFor(header.kid);
      const tolerance = this.cfg.clockToleranceSec ?? 60;
      const requiredClaims = this.requireActor ? ['exp', 'iat', 'nbf'] : ['exp'];
      const now = this.now();
      const { payload } = await jwtVerify(token, key, { issuer: this.cfg.issuerUrl, audience: this.cfg.audience, clockTolerance: tolerance, algorithms: this.cfg.algorithms ?? DEFAULT_ALGS, requiredClaims, currentDate: new Date(now) });
      const nowSec = Math.floor(now / 1000);
      if (typeof payload.iat === 'number' && payload.iat > nowSec + tolerance) throw new Error('"iat" claim timestamp check failed');
      const claims = claimsFromPayload(payload);
      if (this.requireActor) {
        if (!claims.subject || !claims.userId || !claims.organizationId || !claims.connectionId || !claims.connectorId || !claims.credentialGeneration || !claims.tokenId || claims.issuedAt === undefined || claims.notBefore === undefined) throw new Error('required RFC 012 connector claim missing');
        if (this.cfg.requiredOrganizationId && claims.organizationId !== this.cfg.requiredOrganizationId) throw new Error('required organization claim missing or mismatched');
      }
      return claims;
    } catch (err) {
      const classified = classifyTokenError(err);
      throw new TokenError(classified.code, classified.status, classified.message, err);
    }
  }

  private async keyFor(kid: string): Promise<KeyLike | Uint8Array> {
    const now = this.now();
    if (!this.keys.size) await this.refresh();
    else if (now >= this.keysExpireAt) {
      await this.refresh();
      const refreshed = this.keys.get(kid);
      if (!refreshed) { this.negative.set(kid, this.now() + (this.cfg.unknownKidCacheTtlMs ?? DEFAULT_UNKNOWN_KID_TTL_MS)); throw new Error('unknown kid'); }
      return refreshed;
    }
    const cached = this.keys.get(kid); if (cached) return cached;
    if ((this.negative.get(kid) ?? 0) > now) throw new Error('unknown kid (negative cached)');
    if (!this.refreshPromise && now < this.nextUnknownKidRefreshAt) {
      this.negative.set(kid, now + (this.cfg.unknownKidCacheTtlMs ?? DEFAULT_UNKNOWN_KID_TTL_MS));
      throw new Error('unknown kid (refresh cooldown)');
    }
    if (!this.refreshPromise) this.nextUnknownKidRefreshAt = now + (this.cfg.unknownKidRefreshCooldownMs ?? DEFAULT_UNKNOWN_KID_REFRESH_COOLDOWN_MS);
    await this.refresh();
    const refreshed = this.keys.get(kid);
    if (!refreshed) { this.negative.set(kid, this.now() + (this.cfg.unknownKidCacheTtlMs ?? DEFAULT_UNKNOWN_KID_TTL_MS)); throw new Error('unknown kid'); }
    return refreshed;
  }

  private now(): number { return this.cfg.now?.() ?? Date.now(); }

  private async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.fetchKeys().finally(() => { this.refreshPromise = undefined; });
    return this.refreshPromise;
  }

  private async fetchKeys(): Promise<void> {
    const bytes = await fetchBounded(this.jwksUrl, !!this.cfg.allowLocalhostDevelopment, this.cfg.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS, this.cfg.maxJwksResponseBytes ?? DEFAULT_MAX_BYTES);
    const body = JSON.parse(new TextDecoder().decode(bytes)) as { keys?: JWK[] };
    const next: KeyMap = new Map();
    for (const jwk of body.keys ?? []) {
      if (jwk.kty !== 'RSA' || typeof jwk.kid !== 'string' || !jwk.kid || (jwk.use && jwk.use !== 'sig')) continue;
      next.set(jwk.kid, await importJWK(jwk, 'RS256'));
    }
    if (!next.size) throw new Error('JWKS contains no usable RSA signing keys');
    this.keys = next;
    this.keysExpireAt = this.now() + (this.cfg.jwksCacheTtlMs ?? DEFAULT_JWKS_CACHE_TTL_MS);
    for (const kid of next.keys()) this.negative.delete(kid);
  }

  private assertAllowed(url: URL): void { if (!this.allowedOrigins.has(url.origin)) throw new Error(`JWKS origin ${url.origin} is not allowlisted`); }
}

/** Explicit generic JWT verifier. Actor claims are not required. */
export class GenericVerifier extends Verifier {
  constructor(cfg: GenericVerifierConfig) { super(cfg, false); }
}

function decodeHeader(token: string): { kid: string } {
  const part = token.split('.')[0]; if (!part) throw new Error('malformed token');
  const header = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { kid?: unknown };
  if (typeof header.kid !== 'string' || !header.kid) throw new Error('token missing kid');
  return { kid: header.kid };
}
function validateUrl(raw: string, dev: boolean): URL {
  const u = new URL(raw);
  if (u.username || u.password || u.hash) throw new Error('remote URL must not contain userinfo or fragment');
  if (u.protocol !== 'https:' && !(dev && u.protocol === 'http:' && isLocalhost(u.hostname))) throw new Error('HTTPS is required; HTTP localhost requires explicit development option');
  return u;
}
function buildAllowedOrigins(cfg: Config): Set<string> {
  const dev = !!cfg.allowLocalhostDevelopment;
  const issuer = validateUrl(cfg.issuerUrl, dev);
  const origins = new Set([issuer.origin]);
  for (const raw of cfg.allowedJwksOrigins ?? []) { const u = validateUrl(raw, dev); if (u.pathname !== '/') throw new Error('allowed JWKS origins must not contain paths'); origins.add(u.origin); }
  return origins;
}
function isLocalhost(host: string): boolean { return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1'; }
function forbiddenAddress(address: string): boolean {
  if (isLocalhost(address)) return true;
  if (address.includes(':')) return address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe8') || address.startsWith('fe9') || address.startsWith('fea') || address.startsWith('feb') || address.startsWith('ff') || address === '::';
  const p = address.split('.').map(Number); if (p.length !== 4) return true;
  const [a = -1, b = -1] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
async function resolveSafeAddress(url: URL, dev: boolean): Promise<{ address: string; family: number }> {
  const records = isIP(url.hostname) ? [{ address: url.hostname, family: isIP(url.hostname) }] : await lookup(url.hostname, { all: true, verbatim: true });
  if (!records.length || records.some(({ address }) => forbiddenAddress(address) && !(dev && isLocalhost(url.hostname)))) throw new Error('JWKS host resolves to a blocked address');
  return records[0]!;
}
async function fetchBounded(url: URL, dev: boolean, timeoutMs: number, limit: number): Promise<Uint8Array> {
  const pinned = await resolveSafeAddress(url, dev);
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'GET', headers: { accept: 'application/json' },
      lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) { response.resume(); reject(new Error('JWKS redirects are blocked')); return; }
      if (status !== 200) { response.resume(); reject(new Error(`JWKS returned ${status}`)); return; }
      const declared = Number(response.headers['content-length'] ?? 0);
      if (declared > limit) { response.destroy(); reject(new Error('JWKS response exceeds configured limit')); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > limit) response.destroy(new Error('JWKS response exceeds configured limit')); else chunks.push(chunk); });
      response.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
      response.on('error', reject);
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('JWKS request timed out')));
    request.on('error', reject); request.end();
  });
}

export function bearerToken(authorization: string | undefined | null): string | null {
  if (!authorization) return null; const m = /^Bearer\s+(.+)$/i.exec(authorization.trim()); return m?.[1]?.trim() ?? null;
}
