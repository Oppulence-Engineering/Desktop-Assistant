import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type Express, type Request, type Response as ExpressResponse } from 'express';
import { exportJWK, generateKeyPair, SignJWT, type JWK, type JWTPayload, type KeyLike } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
import { hookSignatureV1, safeEqual } from '../src/crypto.js';
import type { ConsentContext } from '../src/rowboat.js';
import { buildApp } from '../src/server.js';
import { StateStore } from '../src/state.js';

const HOOK_SECRET = 'hook-secret-that-is-at-least-thirty-two-bytes';
const COOKIE_SECRET = 'cookie-secret-that-is-at-least-thirty-two-bytes';
const CLIENT_ID = 'rowboat-desktop';
const SUBJECT = 'user_123';
const AUDIENCE = 'mcp:canvas';
const STEP_UP_ACR = 'urn:rowboat:loa:money-moving';

type ConsentRequest = {
  skip: boolean;
  subject: string;
  challenge: string;
  requested_scope: string[];
  requested_access_token_audience: string[];
  client: { client_id: string };
};

type Scope = ConsentContext['scopes'][number];

const lowScope: Scope = {
  name: 'canvas:invoices.read',
  display_name: 'Read invoices from the catalog',
  description: 'Catalog-authored invoice visibility copy.',
  tier: 'low',
  required: true,
  requires_step_up: false,
};
const mediumScope: Scope = {
  name: 'canvas:customers.write',
  display_name: 'Modify customer records',
  description: 'Catalog-authored customer modification copy.',
  tier: 'medium',
  required: false,
  requires_step_up: false,
};
const highScope: Scope = {
  name: 'canvas:dunning.execute',
  display_name: 'Execute dunning workflows',
  description: 'Catalog-authored dunning execution copy.',
  tier: 'high',
  required: false,
  requires_step_up: false,
};
const moneyScope: Scope = {
  name: 'canvas:payments.execute',
  display_name: 'Execute a payment',
  description: 'Catalog-authored payment execution copy.',
  tier: 'money-moving',
  required: false,
  requires_step_up: true,
};

class OryMock {
  readonly app = express();
  readonly consents = new Map<string, ConsentRequest>();
  readonly acceptedConsents: unknown[] = [];
  readonly rejectedConsents: unknown[] = [];
  readonly acceptedLogins: unknown[] = [];
  readonly acceptedLogouts: string[] = [];
  failConsentBody?: string;

  constructor() {
    this.app.use(express.json());
    this.app.get('/admin/oauth2/auth/requests/login', (req, res) => {
      const challenge = String(req.query.login_challenge);
      res.json({ skip: false, subject: '', challenge });
    });
    this.app.put('/admin/oauth2/auth/requests/login/accept', (req, res) => {
      this.acceptedLogins.push(req.body);
      res.json({ redirect_to: 'http://desktop.test/login-complete' });
    });
    this.app.get('/admin/oauth2/auth/requests/consent', (req, res) => {
      if (this.failConsentBody) return res.status(500).send(this.failConsentBody);
      const challenge = String(req.query.consent_challenge);
      const consent = this.consents.get(challenge);
      if (!consent) return res.status(404).json({ error: 'missing' });
      return res.json(consent);
    });
    this.app.put('/admin/oauth2/auth/requests/consent/accept', (req, res) => {
      this.acceptedConsents.push(req.body);
      res.json({ redirect_to: 'http://desktop.test/consent-complete' });
    });
    this.app.put('/admin/oauth2/auth/requests/consent/reject', (req, res) => {
      this.rejectedConsents.push(req.body);
      res.json({ redirect_to: 'http://desktop.test/consent-denied' });
    });
    this.app.put('/admin/oauth2/auth/requests/logout/accept', (req, res) => {
      this.acceptedLogouts.push(String(req.query.logout_challenge));
      res.json({ redirect_to: 'http://desktop.test/logout-complete' });
    });
  }

  setConsent(challenge: string, scopes: Scope[], overrides: Partial<ConsentRequest> = {}): void {
    this.consents.set(challenge, {
      skip: false,
      subject: SUBJECT,
      challenge,
      requested_scope: ['offline_access', ...scopes.map((scope) => scope.name)],
      requested_access_token_audience: [AUDIENCE],
      client: { client_id: CLIENT_ID },
      ...overrides,
    });
  }
}

class WorkOSMock {
  readonly app = express();
  readonly tokenClaims = new Map<string, JWTPayload>();
  private privateKey!: KeyLike;
  private publicJwk!: JWK;
  private baseUrl = '';

  async initialize(): Promise<void> {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    this.privateKey = privateKey;
    this.publicJwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
    this.app.use(express.urlencoded({ extended: false }));
    this.app.get('/.well-known/openid-configuration', (_req, res) => {
      res.json({
        authorization_endpoint: `${this.baseUrl}/authorize`,
        token_endpoint: `${this.baseUrl}/token`,
        jwks_uri: `${this.baseUrl}/jwks`,
        issuer: this.baseUrl,
      });
    });
    this.app.get('/jwks', (_req, res) => res.json({ keys: [this.publicJwk] }));
    this.app.get('/authorize', (_req, res) => res.status(204).end());
    this.app.post('/token', async (req, res) => {
      const claims = this.tokenClaims.get(String(req.body.code));
      if (!claims) return res.status(400).json({ error: 'invalid_grant', secret: 'must-not-leak' });
      const token = await new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(this.baseUrl)
        .setAudience(CLIENT_ID)
        .setSubject(String(claims.sub ?? SUBJECT))
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(this.privateKey);
      return res.json({ id_token: token });
    });
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }
}

class RowboatMock {
  readonly app = express();
  readonly audits: Array<Record<string, unknown>> = [];
  verifiedRequests = 0;
  badResponseSignature = false;
  failNextAudits = 0;
  contextFactory: (request: Record<string, unknown>) => ConsentContext = (request) =>
    makeContext((request.requested_scopes as string[]).map(scopeByName), {
      subject: String(request.workos_user_id),
      client: { id: String(request.hydra_client_id), display_name: 'Rowboat Desktop' },
    });

  constructor() {
    this.app.use(express.text({ type: 'application/json', limit: '1mb' }));
    this.app.post('/oauth-hooks/pre-consent', (req, res) => {
      if (!this.verifyRequest(req)) return res.status(401).json({ error: 'bad signature' });
      const request = JSON.parse(String(req.body)) as Record<string, unknown>;
      return this.sendSigned(req, res, this.contextFactory(request));
    });
    this.app.post('/oauth-hooks/consent-audit', (req, res) => {
      if (!this.verifyRequest(req)) return res.status(401).json({ error: 'bad signature' });
      this.audits.push(JSON.parse(String(req.body)) as Record<string, unknown>);
      if (this.failNextAudits-- > 0) return res.status(503).json({ error: 'temporary' });
      return this.sendSigned(req, res, { accepted: true });
    });
  }

  private verifyRequest(req: Request): boolean {
    const timestamp = String(req.headers['x-hook-timestamp'] ?? '');
    const nonce = String(req.headers['x-hook-nonce'] ?? '');
    const supplied = String(req.headers['x-hook-signature'] ?? '').replace(/^sha256=/, '');
    const expected = hookSignatureV1(HOOK_SECRET, req.method, req.path, timestamp, nonce, String(req.body));
    const valid = Boolean(timestamp && nonce && safeEqual(supplied, expected));
    if (valid) this.verifiedRequests += 1;
    return valid;
  }

  private sendSigned(req: Request, res: ExpressResponse, payload: unknown): ExpressResponse {
    const body = JSON.stringify(payload);
    const timestamp = String(req.headers['x-hook-timestamp']);
    const nonce = String(req.headers['x-hook-nonce']);
    const signature = this.badResponseSignature
      ? 'invalid'
      : hookSignatureV1(HOOK_SECRET, req.method, req.path, timestamp, nonce, body);
    res.set({
      'content-type': 'application/json',
      'x-hook-timestamp': timestamp,
      'x-hook-nonce': nonce,
      'x-hook-signature': `sha256=${signature}`,
    });
    return res.send(body);
  }
}

class BrowserClient {
  private readonly cookies = new Map<string, string>();

  async get(baseUrl: string, path: string, cookieOverride?: string): Promise<Response> {
    return this.request(`${baseUrl}${path}`, { method: 'GET' }, cookieOverride);
  }

  async post(
    baseUrl: string,
    path: string,
    values: Array<[string, string]>,
    cookieOverride?: string,
  ): Promise<Response> {
    const body = new URLSearchParams();
    for (const [key, value] of values) body.append(key, value);
    return this.request(
      `${baseUrl}${path}`,
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body },
      cookieOverride,
    );
  }

  cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  private async request(url: string, init: RequestInit, cookieOverride?: string): Promise<Response> {
    const headers = new Headers(init.headers);
    const cookies = cookieOverride ?? this.cookieHeader();
    if (cookies) headers.set('cookie', cookies);
    const response = await fetch(url, { ...init, headers, redirect: 'manual' });
    this.captureCookies(response);
    return response;
  }

  private captureCookies(response: Response): void {
    const combined = response.headers.get('set-cookie');
    if (!combined) return;
    for (const cookie of combined.split(/,(?=\s*rowboat_)/)) {
      const [pair, ...attributes] = cookie.trim().split(';');
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (!value || attributes.some((attribute) => attribute.trim().toLowerCase() === 'max-age=0'))
        this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

type RunningServer = { url: string; close: () => Promise<void> };

async function listen(app: Express): Promise<RunningServer> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => close(server) };
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function makeContext(scopes: Scope[], overrides: Partial<ConsentContext> = {}): ConsentContext {
  return {
    request_id: 'ctx_123',
    subject: SUBJECT,
    client: { id: CLIENT_ID, display_name: 'Rowboat Desktop' },
    connector: { id: 'canvas', display_name: 'Canvas Treasury', audience: AUDIENCE },
    scopes,
    entitlement: { allowed: true },
    ...overrides,
  };
}

function scopeByName(name: string): Scope {
  const scope = [lowScope, mediumScope, highScope, moneyScope].find((candidate) => candidate.name === name);
  if (!scope) {
    return {
      name,
      display_name: `Unknown ${name}`,
      description: `Unknown ${name}`,
      tier: 'low',
      required: false,
      requires_step_up: false,
    };
  }
  return scope;
}

function csrf(html: string): string {
  const match = html.match(/name="csrf" value="([^"]+)"/);
  if (!match) throw new Error('missing csrf');
  return match[1];
}

function eventNames(rowboat: RowboatMock): unknown[] {
  return rowboat.audits.map((event) => event.event);
}

interface Harness {
  ory: OryMock;
  workos: WorkOSMock;
  rowboat: RowboatMock;
  browser: BrowserClient;
  app: RunningServer;
  store: StateStore;
  servers: RunningServer[];
}

let harness: Harness;

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const ory = new OryMock();
  const workos = new WorkOSMock();
  await workos.initialize();
  const rowboat = new RowboatMock();
  const oryServer = await listen(ory.app);
  const workosServer = await listen(workos.app);
  workos.setBaseUrl(workosServer.url);
  const rowboatServer = await listen(rowboat.app);
  const cfg: Config = {
    port: 3000,
    cookieSecret: COOKIE_SECRET,
    cookieSecure: false,
    sessionTtlMs: 600_000,
    upstreamTimeoutMs: 2_000,
    databaseUrl: 'postgres://test/test',
    auditRetryIntervalMs: 5_000,
    ory: { adminUrl: oryServer.url },
    workos: {
      clientId: CLIENT_ID,
      apiKey: 'workos-test-key',
      issuer: workosServer.url,
      redirectUri: 'http://consent.test/callback',
      stepUpRedirectUri: 'http://consent.test/step-up/callback',
      stepUpAcr: STEP_UP_ACR,
      stepUpAmr: 'mfa',
    },
    rowboatApi: {
      baseUrl: rowboatServer.url,
      hookSecret: HOOK_SECRET,
      contextPath: '/oauth-hooks/pre-consent',
      auditPath: '/oauth-hooks/consent-audit',
      signatureMaxAgeMs: 300_000,
    },
  };
  const store = new StateStore(cfg.sessionTtlMs);
  const app = await listen(buildApp(cfg, { store }));
  harness = {
    ory,
    workos,
    rowboat,
    browser: new BrowserClient(),
    app,
    store,
    servers: [app, rowboatServer, workosServer, oryServer],
  };
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(harness.servers.map((server) => server.close()));
});

describe('Hydra login and logout', () => {
  it('uses nonce-bound WorkOS login, accepts Hydra login, rejects callback replay, and preserves logout', async () => {
    const login = await harness.browser.get(harness.app.url, '/login?login_challenge=login_1');
    expect(login.status).toBe(302);
    const authorize = new URL(login.headers.get('location')!);
    expect(authorize.pathname).toBe('/authorize');
    const nonce = authorize.searchParams.get('nonce')!;
    const state = authorize.searchParams.get('state')!;
    const originalCookies = harness.browser.cookieHeader();
    harness.workos.tokenClaims.set('login-code', { sub: SUBJECT, nonce, amr: ['pwd'] });

    const callback = await harness.browser.get(
      harness.app.url,
      `/callback?code=login-code&state=${encodeURIComponent(state)}`,
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('http://desktop.test/login-complete');
    expect(harness.ory.acceptedLogins).toEqual([expect.objectContaining({ subject: SUBJECT })]);

    const replay = await harness.browser.get(
      harness.app.url,
      `/callback?code=login-code&state=${encodeURIComponent(state)}`,
      originalCookies,
    );
    expect(replay.status).toBe(409);

    const logout = await harness.browser.get(harness.app.url, '/logout?logout_challenge=logout_1');
    expect(logout.status).toBe(302);
    expect(harness.ory.acceptedLogouts).toEqual(['logout_1']);
  });
});

describe('consent rendering and decisions', () => {
  it('renders trusted catalog copy by tier with product/client and required/optional scopes, then grants only selected scopes', async () => {
    const challenge = 'consent_render';
    const scopes = [lowScope, mediumScope, highScope, moneyScope];
    harness.ory.setConsent(challenge, scopes);
    const shown = await harness.browser.get(harness.app.url, `/consent?consent_challenge=${challenge}`);
    const html = await shown.text();

    expect(shown.status).toBe(200);
    expect(html).toContain('Canvas Treasury');
    expect(html).toContain('Rowboat Desktop');
    expect(html).toContain(lowScope.display_name);
    expect(html).toContain(lowScope.description);
    expect(html.indexOf('data-tier="low"')).toBeLessThan(html.indexOf('data-tier="medium"'));
    expect(html.indexOf('data-tier="medium"')).toBeLessThan(html.indexOf('data-tier="high"'));
    expect(html.indexOf('data-tier="high"')).toBeLessThan(html.indexOf('data-tier="money-moving"'));
    expect(html).toContain(`data-scope="${lowScope.name}" data-required="true"`);
    expect(html).toContain(`data-scope="${mediumScope.name}" data-required="false"`);
    expect(harness.ory.acceptedConsents).toHaveLength(0);
    expect(eventNames(harness.rowboat)).toEqual(['consent.shown']);

    const approved = await harness.browser.post(harness.app.url, '/consent/decision', [
      ['csrf', csrf(html)],
      ['decision', 'approve'],
      ['scope', lowScope.name],
      ['scope', mediumScope.name],
    ]);
    expect(approved.status).toBe(302);
    expect(eventNames(harness.rowboat)).toEqual(['consent.shown', 'consent.granted']);
    expect(harness.ory.acceptedConsents).toEqual([
      expect.objectContaining({
        grant_scope: ['offline_access', lowScope.name, mediumScope.name],
        grant_access_token_audience: [AUDIENCE],
        session: expect.objectContaining({
          access_token: { ext: expect.objectContaining({ workos_user_id: SUBJECT }) },
        }),
      }),
    ]);
    expect(harness.rowboat.verifiedRequests).toBe(3);
  });

  it('supports an explicit deny POST and audits it after rejecting with Hydra', async () => {
    const challenge = 'consent_deny';
    harness.ory.setConsent(challenge, [lowScope]);
    const shown = await harness.browser.get(harness.app.url, `/consent?consent_challenge=${challenge}`);
    const denied = await harness.browser.post(harness.app.url, '/consent/decision', [
      ['csrf', csrf(await shown.text())],
      ['decision', 'deny'],
    ]);
    expect(denied.status).toBe(302);
    expect(eventNames(harness.rowboat)).toEqual(['consent.shown', 'consent.denied']);
    expect(harness.ory.rejectedConsents).toEqual([
      expect.objectContaining({ error: 'access_denied', error_description: expect.any(String) }),
    ]);
    expect(harness.ory.acceptedConsents).toHaveLength(0);
  });

  it('redirects after Hydra approval and retains a failed final audit for replay', async () => {
    const challenge = 'consent_audit_retry';
    harness.ory.setConsent(challenge, [lowScope]);
    const shown = await harness.browser.get(harness.app.url, `/consent?consent_challenge=${challenge}`);
    harness.rowboat.failNextAudits = 1;
    const approved = await harness.browser.post(harness.app.url, '/consent/decision', [
      ['csrf', csrf(await shown.text())],
      ['decision', 'approve'],
      ['scope', lowScope.name],
    ]);
    expect(approved.status).toBe(302);
    expect(harness.ory.acceptedConsents).toHaveLength(1);
    const pending = await harness.store.claimAudits(10);
    expect(pending).toEqual([expect.objectContaining({ id: expect.stringContaining(':consent.granted') })]);
  });

  it('renders entitlement/upsell denial separately and cannot approve it', async () => {
    const challenge = 'consent_plan';
    harness.ory.setConsent(challenge, [lowScope]);
    harness.rowboat.contextFactory = () =>
      makeContext([lowScope], {
        entitlement: {
          allowed: false,
          reason: 'scope_not_in_plan',
          required_plan: 'Business',
          upgrade_url: 'rowboat://billing',
          message: 'This scope is available on Business.',
        },
      });
    const shown = await harness.browser.get(harness.app.url, `/consent?consent_challenge=${challenge}`);
    const html = await shown.text();
    expect(html).toContain('Connection unavailable');
    expect(html).toContain('data-entitlement-reason="scope_not_in_plan"');
    expect(html).toContain('This scope is available on Business.');
    expect(html).not.toContain('Approve selected access');

    const approve = await harness.browser.post(harness.app.url, '/consent/decision', [
      ['csrf', csrf(html)],
      ['decision', 'approve'],
      ['scope', lowScope.name],
    ]);
    expect(approve.status).toBe(403);
    expect(harness.ory.acceptedConsents).toHaveLength(0);
  });

  it('requires server-enforced extra confirmation for selected high scopes', async () => {
    const challenge = 'consent_high';
    harness.ory.setConsent(challenge, [lowScope, highScope]);
    const shown = await harness.browser.get(harness.app.url, `/consent?consent_challenge=${challenge}`);
    const html = await shown.text();
    const values: Array<[string, string]> = [
      ['csrf', csrf(html)],
      ['decision', 'approve'],
      ['scope', lowScope.name],
      ['scope', highScope.name],
    ];
    const missingConfirmation = await harness.browser.post(harness.app.url, '/consent/decision', values);
    expect(missingConfirmation.status).toBe(400);
    expect(await missingConfirmation.text()).toContain('high_scope_confirmation_required');
    expect(harness.ory.acceptedConsents).toHaveLength(0);

    const approved = await harness.browser.post(harness.app.url, '/consent/decision', [
      ...values,
      ['confirm_high', 'yes'],
    ]);
    expect(approved.status).toBe(302);
    expect(harness.ory.acceptedConsents).toHaveLength(1);
  });
});

describe('money-moving WorkOS step-up', () => {
  it('uses a separate nonce-bound flow and verifies matching WorkOS amr/acr before approval', async () => {
    const challenge = 'consent_money';
    harness.ory.setConsent(challenge, [lowScope, moneyScope]);
    const shown = await harness.browser.get(harness.app.url, `/consent?consent_challenge=${challenge}`);
    const html = await shown.text();
    const stepUp = await harness.browser.post(harness.app.url, '/consent/decision', [
      ['csrf', csrf(html)],
      ['decision', 'approve'],
      ['scope', lowScope.name],
      ['scope', moneyScope.name],
      ['confirm_high', 'yes'],
    ]);
    expect(stepUp.status).toBe(302);
    expect(harness.ory.acceptedConsents).toHaveLength(0);
    const authorize = new URL(stepUp.headers.get('location')!);
    expect(authorize.searchParams.get('redirect_uri')).toBe('http://consent.test/step-up/callback');
    expect(authorize.searchParams.get('prompt')).toBe('login');
    expect(authorize.searchParams.get('max_age')).toBe('0');
    expect(authorize.searchParams.get('acr_values')).toBe(STEP_UP_ACR);
    const nonce = authorize.searchParams.get('nonce')!;
    const state = authorize.searchParams.get('state')!;
    const originalCookies = harness.browser.cookieHeader();
    harness.workos.tokenClaims.set('step-code', {
      sub: SUBJECT,
      nonce,
      amr: ['pwd', 'mfa'],
      acr: STEP_UP_ACR,
    });

    const callback = await harness.browser.get(
      harness.app.url,
      `/step-up/callback?code=step-code&state=${encodeURIComponent(state)}`,
    );
    expect(callback.status).toBe(302);
    expect(harness.ory.acceptedConsents).toHaveLength(1);
    expect(eventNames(harness.rowboat)).toEqual(['consent.shown', 'consent.granted']);

    const replay = await harness.browser.get(
      harness.app.url,
      `/step-up/callback?code=step-code&state=${encodeURIComponent(state)}`,
      originalCookies,
    );
    expect(replay.status).toBe(409);
  });

  it.each([
    ['missing mfa', { sub: SUBJECT, amr: ['pwd'], acr: STEP_UP_ACR }, 'step_up_assurance_insufficient'],
    ['wrong acr', { sub: SUBJECT, amr: ['mfa'], acr: 'urn:wrong' }, 'step_up_assurance_insufficient'],
    ['identity mismatch', { sub: 'user_other', amr: ['mfa'], acr: STEP_UP_ACR }, 'step_up_identity_mismatch'],
  ])('rejects %s', async (_label, claims, expectedCode) => {
    const challenge = `consent_step_failure_${expectedCode}`;
    harness.ory.setConsent(challenge, [lowScope, moneyScope]);
    const shown = await harness.browser.get(harness.app.url, `/consent?consent_challenge=${challenge}`);
    const stepUp = await harness.browser.post(harness.app.url, '/consent/decision', [
      ['csrf', csrf(await shown.text())],
      ['decision', 'approve'],
      ['scope', lowScope.name],
      ['scope', moneyScope.name],
      ['confirm_high', 'yes'],
    ]);
    const authorize = new URL(stepUp.headers.get('location')!);
    const nonce = authorize.searchParams.get('nonce')!;
    const state = authorize.searchParams.get('state')!;
    harness.workos.tokenClaims.set('bad-step', { ...claims, nonce });
    const callback = await harness.browser.get(
      harness.app.url,
      `/step-up/callback?code=bad-step&state=${encodeURIComponent(state)}`,
    );
    expect(callback.status).toBe(403);
    expect(await callback.text()).toContain(expectedCode);
    expect(harness.ory.acceptedConsents).toHaveLength(0);
    expect(eventNames(harness.rowboat)).toEqual(['consent.shown']);
  });
});

describe('consent security rejection paths', () => {
  it.each([
    [
      'unknown scope',
      [lowScope],
      { requested_scope: [lowScope.name, 'canvas:unknown.read'] },
      400,
      'unknown_or_missing_scope',
    ],
    [
      'audience mismatch',
      [lowScope],
      { requested_access_token_audience: ['mcp:other'] },
      403,
      'consent_audience_mismatch',
    ],
    [
      'multiple audiences',
      [lowScope],
      { requested_access_token_audience: [AUDIENCE, 'mcp:other'] },
      403,
      'consent_audience_mismatch',
    ],
  ])('rejects %s', async (_label, scopes, overrides, status, code) => {
    const challenge = `security_${code}`;
    harness.ory.setConsent(challenge, scopes, overrides as Partial<ConsentRequest>);
    harness.rowboat.contextFactory = () => makeContext(scopes);
    const response = await harness.browser.get(harness.app.url, `/consent?consent_challenge=${challenge}`);
    expect(response.status).toBe(status);
    expect(await response.text()).toContain(code);
    expect(harness.ory.acceptedConsents).toHaveLength(0);
    expect(harness.rowboat.audits).toHaveLength(0);
  });

  it.each([
    ['subject', { subject: 'user_other' }],
    ['client', { client: { id: 'other-client', display_name: 'Rowboat Desktop' as const } }],
  ])('rejects %s identity mismatch from the signed context', async (_label, overrides) => {
    const challenge = `identity_${_label}`;
    harness.ory.setConsent(challenge, [lowScope]);
    harness.rowboat.contextFactory = () => makeContext([lowScope], overrides);
    const response = await harness.browser.get(harness.app.url, `/consent?consent_challenge=${challenge}`);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('consent_identity_mismatch');
    expect(harness.rowboat.audits).toHaveLength(0);
  });

  it('rejects CSRF, scope escalation, missing required scopes, and form replay', async () => {
    const challenge = 'security_form';
    harness.ory.setConsent(challenge, [lowScope, mediumScope]);
    const shown = await harness.browser.get(harness.app.url, `/consent?consent_challenge=${challenge}`);
    const html = await shown.text();
    const originalCookies = harness.browser.cookieHeader();

    const csrfFailure = await harness.browser.post(harness.app.url, '/consent/decision', [
      ['csrf', 'wrong'],
      ['decision', 'approve'],
      ['scope', lowScope.name],
    ]);
    expect(csrfFailure.status).toBe(403);

    const escalation = await harness.browser.post(harness.app.url, '/consent/decision', [
      ['csrf', csrf(html)],
      ['decision', 'approve'],
      ['scope', lowScope.name],
      ['scope', 'canvas:admin.execute'],
    ]);
    expect(escalation.status).toBe(400);

    const requiredMissing = await harness.browser.post(harness.app.url, '/consent/decision', [
      ['csrf', csrf(html)],
      ['decision', 'approve'],
      ['scope', mediumScope.name],
    ]);
    expect(requiredMissing.status).toBe(400);

    const approved = await harness.browser.post(harness.app.url, '/consent/decision', [
      ['csrf', csrf(html)],
      ['decision', 'approve'],
      ['scope', lowScope.name],
    ]);
    expect(approved.status).toBe(302);

    const replay = await harness.browser.post(
      harness.app.url,
      '/consent/decision',
      [
        ['csrf', csrf(html)],
        ['decision', 'approve'],
        ['scope', lowScope.name],
      ],
      originalCookies,
    );
    expect(replay.status).toBe(409);
    expect(harness.ory.acceptedConsents).toHaveLength(1);
  });

  it('requires a valid signed rowboat-api response', async () => {
    const challenge = 'security_hmac_response';
    harness.ory.setConsent(challenge, [lowScope]);
    harness.rowboat.badResponseSignature = true;
    const response = await harness.browser.get(harness.app.url, `/consent?consent_challenge=${challenge}`);
    expect(response.status).toBe(502);
    expect(await response.text()).toContain('rowboat_hook_signature_invalid');
    expect(harness.rowboat.verifiedRequests).toBe(1);
  });

  it('does not expose raw upstream response bodies', async () => {
    const challenge = 'security_safe_error';
    harness.ory.failConsentBody = 'TOP_SECRET_UPSTREAM_BODY';
    const response = await harness.browser.get(harness.app.url, `/consent?consent_challenge=${challenge}`);
    const body = await response.text();
    expect(response.status).toBe(502);
    expect(body).toContain('ory_upstream_500');
    expect(body).not.toContain('TOP_SECRET_UPSTREAM_BODY');
  });
});
