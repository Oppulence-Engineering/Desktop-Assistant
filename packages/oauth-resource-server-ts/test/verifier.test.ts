import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type KeyLike, SignJWT, exportJWK, generateKeyPair } from 'jose';
import {
  AuthorizationError,
  GenericVerifier,
  Verifier,
  hasAllScopes,
  requireMCPToken,
  type AuthedRequest,
  type MCPTokenOptions,
  type ResponseLike,
} from '../src/index.js';

const KID = 'test-key-1';
const ROTATED_KID = 'test-key-2';
const ISSUER = 'https://oauth.solomon-ai.co';
const AUDIENCE = 'canvas-api';

let server: Server;
let baseURL: string;
let privateKey: KeyLike;
let rotatedPrivateKey: KeyLike;
let jwks: Record<string, unknown>[];
let jwksRequests = 0;

beforeAll(async () => {
  const kp = await generateKeyPair('RS256');
  const rotated = await generateKeyPair('RS256');
  privateKey = kp.privateKey;
  rotatedPrivateKey = rotated.privateKey;
  const jwk = await exportJWK(kp.publicKey);
  Object.assign(jwk, { kid: KID, alg: 'RS256', use: 'sig' });
  const rotatedJwk = await exportJWK(rotated.publicKey);
  Object.assign(rotatedJwk, { kid: ROTATED_KID, alg: 'RS256', use: 'sig' });
  jwks = [jwk];

  server = createServer((_req, res) => {
    jwksRequests += 1;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: jwks }));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseURL = `http://127.0.0.1:${port}/jwks`;

  // Keep the rotated JWK available for the unknown-kid test without exposing it
  // until that test explicitly rotates the server response.
  (globalThis as Record<string, unknown>).__rotatedJwk = rotatedJwk;
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).__rotatedJwk;
  server.close();
});

function baseClaims(): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: 'usr_123',
    iat: now,
    nbf: now - 1,
    jti: 'tok_123',
    scope: 'canvas.read canvas.watch',
    organization_id: 'org_123',
    connection_id: 'conn_123',
    connector_id: 'canvas',
    trust_tier: 'act',
  };
}

async function sign(
  claims: Record<string, unknown> = {},
  opts?: { aud?: string; iss?: string; expSec?: number; kid?: string; key?: KeyLike },
): Promise<string> {
  return new SignJWT({ ...baseClaims(), ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: opts?.kid ?? KID })
    .setIssuer(opts?.iss ?? ISSUER)
    .setAudience(opts?.aud ?? AUDIENCE)
    .setExpirationTime(`${opts?.expSec ?? 3600}s`)
    .sign(opts?.key ?? privateKey);
}

function newVerifier(): Verifier {
  return new Verifier({
    issuerUrl: ISSUER,
    audience: AUDIENCE,
    jwksUrl: baseURL,
    allowedJwksOrigins: [new URL(baseURL).origin],
    allowLocalhostDevelopment: true,
  });
}

function expectCode(error: unknown, code: AuthorizationError['code']): void {
  expect(error).toBeInstanceOf(AuthorizationError);
  expect((error as AuthorizationError).code).toBe(code);
}

async function expectRejectCode(promise: Promise<unknown>, code: AuthorizationError['code']): Promise<void> {
  const result = await promise.then(
    () => ({ rejected: false as const, error: undefined }),
    (error: unknown) => ({ rejected: true as const, error }),
  );
  expect(result.rejected).toBe(true);
  if (result.rejected) expectCode(result.error, code);
}

class MockResponse implements ResponseLike {
  statusCode = 200;
  headers: Record<string, string> = {};
  body: unknown;

  status(code: number): ResponseLike {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value;
  }

  json(body: unknown): void {
    this.body = body;
  }
}

async function runMiddleware(options: MCPTokenOptions, approvalToken?: string): Promise<{ res: MockResponse; next: boolean }> {
  const req: AuthedRequest = {
    method: 'POST',
    url: '/money',
    headers: {
      authorization: `Bearer ${await sign()}`,
      ...(approvalToken ? { 'x-approval-token': approvalToken } : {}),
    },
  };
  const res = new MockResponse();
  let next = false;
  await requireMCPToken(newVerifier(), options)(req, res, () => {
    next = true;
  });
  return { res, next };
}

describe('RFC 012 verifier contract', () => {
  it('fails closed on config and exposes generic verification explicitly', async () => {
    expect(() => new Verifier({ issuerUrl: '', audience: AUDIENCE, jwksUrl: baseURL })).toThrow();
    expect(() => new Verifier({ issuerUrl: ISSUER, audience: '', jwksUrl: baseURL })).toThrow();
    const config = {
      issuerUrl: ISSUER, audience: AUDIENCE, jwksUrl: baseURL,
      allowedJwksOrigins: [new URL(baseURL).origin], allowLocalhostDevelopment: true,
    };
    const token = await sign({ connection_id: undefined, connector_id: undefined, jti: undefined });
    await expectRejectCode(new Verifier(config).verify(token), 'token_invalid_signature');
    await expect(new GenericVerifier(config).verify(token)).resolves.toMatchObject({ subject: 'usr_123' });
  });

  it('enforces a configured required organization', async () => {
    const verifier = new Verifier({
      issuerUrl: ISSUER, audience: AUDIENCE, jwksUrl: baseURL,
      allowedJwksOrigins: [new URL(baseURL).origin], allowLocalhostDevelopment: true,
      requiredOrganizationId: 'org_required',
    });
    await expectRejectCode(verifier.verify(await sign({ organization_id: 'org_other' })), 'token_invalid_signature');
  });

  it('rejects unsafe JWKS URLs and requires explicit localhost development mode', () => {
    const base = { issuerUrl: ISSUER, audience: AUDIENCE };
    for (const jwksUrl of ['http://keys.example/jwks', 'https://user@keys.example/jwks', 'https://keys.example/jwks#fragment']) {
      expect(() => new Verifier({ ...base, jwksUrl, allowedJwksOrigins: ['https://keys.example'] })).toThrow();
    }
    expect(() => new Verifier({ ...base, jwksUrl: baseURL, allowedJwksOrigins: [new URL(baseURL).origin] })).toThrow();
  });

  it('coalesces concurrent unknown-kid refresh and negative-caches misses', async () => {
    const before = jwksRequests;
    const unknown = await sign({}, { kid: 'never-present' });
    const verifier = newVerifier();
    await Promise.all(Array.from({ length: 12 }, () => verifier.verify(unknown).catch(() => undefined)));
    expect(jwksRequests - before).toBe(2); // initial load + one coalesced miss refresh
    await verifier.verify(unknown).catch(() => undefined);
    expect(jwksRequests - before).toBe(2);
  });

  it('verifies a valid token and normalizes connector actor claims', async () => {
    const token = await sign({ ext: { workos_user_id: 'user_abc', email: 'u@example.com' } });
    const claims = await newVerifier().verify(token);
    expect(claims).toMatchObject({
      userId: 'user_abc',
      organizationId: 'org_123',
      connectionId: 'conn_123',
      connectorId: 'canvas',
      tokenId: 'tok_123',
      trustTier: 'act',
      email: 'u@example.com',
    });
    expect(hasAllScopes(claims, 'canvas.read', 'canvas.watch')).toBe(true);
  });

  it('rejects the wrong audience with audience_mismatch', async () => {
    await expectRejectCode(newVerifier().verify(await sign({}, { aud: 'other-api' })), 'audience_mismatch');
  });

  it('rejects expired tokens with token_expired', async () => {
    await expectRejectCode(newVerifier().verify(await sign({}, { expSec: -120 })), 'token_expired');
  });

  it.each(['nbf', 'iat'])('validates %s with 60-second skew', async (claim) => {
    const now = Math.floor(Date.now() / 1000);
    await expectRejectCode(newVerifier().verify(await sign({ [claim]: now + 120 })), 'token_invalid_signature');
    await expect(newVerifier().verify(await sign({ [claim]: now + 30 }))).resolves.toBeDefined();
  });

  it('rejects HS256 and other algorithms under the RS256-only default', async () => {
    const hmac = await new SignJWT(baseClaims())
      .setProtectedHeader({ alg: 'HS256', kid: KID })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('public-key-confusion-secret'));
    await expectRejectCode(newVerifier().verify(hmac), 'token_invalid_signature');

    const rsa512 = await generateKeyPair('RS512');
    const otherAlg = await new SignJWT(baseClaims())
      .setProtectedHeader({ alg: 'RS512', kid: 'rs512' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('1h')
      .sign(rsa512.privateKey);
    await expectRejectCode(newVerifier().verify(otherAlg), 'token_invalid_signature');
  });

  it('refetches JWKS when a previously unknown kid appears', async () => {
    const verifier = newVerifier();
    await verifier.verify(await sign());
    const before = jwksRequests;
    jwks = [...jwks, (globalThis as Record<string, unknown>).__rotatedJwk as Record<string, unknown>];
    await expect(verifier.verify(await sign({}, { kid: ROTATED_KID, key: rotatedPrivateKey }))).resolves.toBeDefined();
    expect(jwksRequests).toBeGreaterThan(before);
  });

  it('rate limits sequential distinct-kid misses issuer-wide and allows rotation after cooldown', async () => {
    let now = Date.parse('2026-08-27T00:00:00Z');
    const verifier = new GenericVerifier({
      issuerUrl: ISSUER,
      audience: AUDIENCE,
      jwksUrl: baseURL,
      allowedJwksOrigins: [new URL(baseURL).origin],
      allowLocalhostDevelopment: true,
      unknownKidCacheTtlMs: 2_000,
      unknownKidRefreshCooldownMs: 10_000,
      now: () => now,
    });
    await verifier.verify(await sign());
    const initialRequests = jwksRequests;

    await expectRejectCode(verifier.verify(await sign({}, { kid: 'attacker-1' })), 'token_invalid_signature');
    await expectRejectCode(verifier.verify(await sign({}, { kid: 'attacker-2' })), 'token_invalid_signature');
    expect(jwksRequests).toBe(initialRequests + 1);

    now += 3_000; // per-kid negative cache expired, issuer-wide cooldown has not
    await expectRejectCode(verifier.verify(await sign({}, { kid: 'attacker-3' })), 'token_invalid_signature');
    expect(jwksRequests).toBe(initialRequests + 1);

    const rotation = await generateKeyPair('RS256');
    const rotationJwk = await exportJWK(rotation.publicKey);
    Object.assign(rotationJwk, { kid: 'post-cooldown-rotation', alg: 'RS256', use: 'sig' });
    jwks = [...jwks, rotationJwk];
    now += 8_000;
    await expect(verifier.verify(await sign({}, { kid: 'post-cooldown-rotation', key: rotation.privateKey }))).resolves.toBeDefined();
    expect(jwksRequests).toBe(initialRequests + 2);
  });

});

describe('RFC 012 middleware parity', () => {
  it('enforces all-of and any-of scopes', async () => {
    await expect(runMiddleware({ requiredScopes: ['canvas.read', 'canvas.watch'] })).resolves.toMatchObject({ next: true });
    const allFail = await runMiddleware({ requiredScopes: ['canvas.read', 'canvas.write'] });
    expect(allFail.res).toMatchObject({ statusCode: 403, body: { code: 'scope_missing' } });
    await expect(runMiddleware({ anyScopes: ['canvas.write', 'canvas.watch'] })).resolves.toMatchObject({ next: true });
    const anyFail = await runMiddleware({ anyScopes: ['canvas.write', 'canvas.pay'] });
    expect(anyFail.res).toMatchObject({ statusCode: 403, body: { code: 'scope_missing' } });
  });

  it('enforces a route-level audience', async () => {
    await expect(runMiddleware({ audience: AUDIENCE })).resolves.toMatchObject({ next: true });
    const mismatch = await runMiddleware({ audience: 'mcp:other' });
    expect(mismatch.res).toMatchObject({ statusCode: 401, body: { code: 'audience_mismatch' } });
  });

  it('returns connection_revoked for inactive or failed status validation', async () => {
    const revoked = await runMiddleware({ connectionValidator: () => false });
    expect(revoked.res).toMatchObject({ statusCode: 403, body: { code: 'connection_revoked' } });
  });

  it('requires and validates X-Approval-Token with HTTP 428', async () => {
    const validator = (token: string, _claims: unknown, req: AuthedRequest) => token === 'good' && req.url === '/money';
    const missing = await runMiddleware({ approvalValidator: validator });
    expect(missing.res).toMatchObject({ statusCode: 428, body: { code: 'approval_required' } });
    const invalid = await runMiddleware({ approvalValidator: validator }, 'bad');
    expect(invalid.res).toMatchObject({ statusCode: 428, body: { code: 'approval_required' } });
    await expect(runMiddleware({ approvalValidator: validator }, 'good')).resolves.toMatchObject({ next: true });
  });

  it('returns token_missing when Authorization is absent', async () => {
    const req: AuthedRequest = { headers: {} };
    const res = new MockResponse();
    await requireMCPToken(newVerifier())(req, res, () => undefined);
    expect(res).toMatchObject({ statusCode: 401, body: { code: 'token_missing' } });
  });
});
