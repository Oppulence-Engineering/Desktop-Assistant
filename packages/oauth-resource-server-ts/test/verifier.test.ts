import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type KeyLike, SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Verifier, TokenError } from '../src/verifier.js';
import { hasAllScopes } from '../src/claims.js';

const KID = 'test-key-1';
const ISSUER = 'https://oauth.solomon-ai.co';
const AUDIENCE = 'canvas-api';

let server: Server;
let baseURL: string;
let privateKey: KeyLike;

beforeAll(async () => {
  const kp = await generateKeyPair('RS256');
  privateKey = kp.privateKey;
  const jwk = await exportJWK(kp.publicKey);
  jwk.kid = KID;
  jwk.alg = 'RS256';
  jwk.use = 'sig';

  server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseURL = `http://127.0.0.1:${port}/jwks`;
});

afterAll(() => server.close());

async function sign(claims: Record<string, unknown>, opts?: { aud?: string; iss?: string; expSec?: number }): Promise<string> {
  let jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(opts?.iss ?? ISSUER)
    .setAudience(opts?.aud ?? AUDIENCE)
    .setExpirationTime(`${opts?.expSec ?? 3600}s`);
  return jwt.sign(privateKey);
}

function newVerifier(): Verifier {
  return new Verifier({ issuerUrl: ISSUER, audience: AUDIENCE, jwksUrl: baseURL });
}

describe('Verifier', () => {
  it('verifies a valid token and extracts claims', async () => {
    const token = await sign({
      sub: 'internal-id',
      scope: 'invoices:read customers:read',
      ext: { workos_user_id: 'user_abc', email: 'u@example.com' },
    });
    const claims = await newVerifier().verify(token);
    expect(claims.workosUserId).toBe('user_abc');
    expect(claims.email).toBe('u@example.com');
    expect(hasAllScopes(claims, 'invoices:read', 'customers:read')).toBe(true);
    expect(claims.scopes).not.toContain('transactions:write');
  });

  it('reads scopes from the scp array claim', async () => {
    const token = await sign({ scp: ['a:read', 'b:write'] });
    const claims = await newVerifier().verify(token);
    expect(hasAllScopes(claims, 'a:read', 'b:write')).toBe(true);
  });

  it('rejects the wrong audience', async () => {
    const token = await sign({}, { aud: 'other-api' });
    await expect(newVerifier().verify(token)).rejects.toBeInstanceOf(TokenError);
  });

  it('rejects the wrong issuer', async () => {
    const token = await sign({}, { iss: 'https://evil.example.com' });
    await expect(newVerifier().verify(token)).rejects.toBeInstanceOf(TokenError);
  });

  it('rejects an expired token', async () => {
    const token = await sign({}, { expSec: -60 });
    await expect(newVerifier().verify(token)).rejects.toBeInstanceOf(TokenError);
  });
});
