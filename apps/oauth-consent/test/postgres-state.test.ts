import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { exportJWK, generateKeyPair, SignJWT, type JWK, type JWTPayload, type KeyLike } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import { OryRequestError, type OryAdmin } from '../src/ory.js';
import type { AuditRequest, ConsentContext, RowboatHooks } from '../src/rowboat.js';
import { buildApp, InjectedPostHydraCrash, reconcileDecisions } from '../src/server.js';
import { PostgresStateStore } from '../src/state.js';
import { WorkOS } from '../src/workos.js';

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const context = {
  request_id: 'ctx_test',
  subject: 'user_test',
  client: { id: 'desktop', display_name: 'Rowboat Desktop' },
  connector: { id: 'canvas', display_name: 'Canvas', audience: 'mcp:canvas' },
  scopes: [],
  entitlement: { allowed: true },
} as ConsentContext;
const moneyContext = {
  ...context,
  scopes: [
    {
      name: 'canvas:payments.execute',
      display_name: 'Execute payments',
      description: 'Execute a payment.',
      tier: 'money-moving',
      required: true,
      requires_step_up: true,
    },
  ],
} as ConsentContext;

const config: Config = {
  port: 3000,
  cookieSecret: 'postgres-cookie-secret-that-is-at-least-thirty-two-bytes',
  cookieSecure: false,
  sessionTtlMs: 60_000,
  upstreamTimeoutMs: 2_000,
  databaseUrl: url ?? 'postgres://unused',
  auditRetryIntervalMs: 1_000,
  decisionLeaseMs: 1_000,
  ory: { adminUrl: 'http://unused.test' },
  workos: {
    clientId: 'desktop',
    apiKey: 'unused',
    issuer: 'https://unused.test',
    redirectUri: 'https://unused.test/callback',
    stepUpRedirectUri: 'https://unused.test/step-up/callback',
    stepUpAcr: 'urn:test:mfa',
    stepUpAmr: 'mfa',
  },
  rowboatApi: {
    baseUrl: 'https://unused.test',
    hookSecret: 'postgres-hook-secret-that-is-at-least-thirty-two-bytes',
    contextPath: '/context',
    auditPath: '/audit',
    signatureMaxAgeMs: 300_000,
  },
};

class FakeOry {
  terminal = false;
  hydraCommits = 0;
  acceptCalls = 0;
  readonly challenge: string;
  readonly consentContext: ConsentContext;

  constructor(challenge: string, consentContext = context) {
    this.challenge = challenge;
    this.consentContext = consentContext;
  }

  async getConsentRequest(challenge: string) {
    if (challenge !== this.challenge || this.terminal) throw new OryRequestError(410);
    return {
      skip: false,
      subject: this.consentContext.subject,
      challenge,
      requested_scope: ['offline_access', ...this.consentContext.scopes.map((scope) => scope.name)],
      requested_access_token_audience: [this.consentContext.connector.audience],
      client: { client_id: this.consentContext.client.id },
    };
  }

  async acceptConsent() {
    this.acceptCalls += 1;
    if (this.terminal) throw new OryRequestError(409);
    this.terminal = true;
    this.hydraCommits += 1;
    return { redirect_to: 'http://desktop.test/complete' };
  }

  async rejectConsent() {
    if (this.terminal) throw new OryRequestError(409);
    this.terminal = true;
    this.hydraCommits += 1;
    return { redirect_to: 'http://desktop.test/denied' };
  }

  async consentRequestPending() {
    return !this.terminal;
  }
}

class FakeHooks {
  readonly audits = new Map<string, AuditRequest>();
  contextCalls = 0;

  constructor(private readonly policy = context) {}

  async context() {
    this.contextCalls += 1;
    return { ...this.policy, request_id: `ctx_${this.contextCalls}` };
  }

  async audit(input: AuditRequest) {
    this.audits.set(input.eventId!, input);
  }
}

class WorkOSFaultServer {
  readonly app = express();
  readonly tokenClaims = new Map<string, JWTPayload>();
  failNextToken = 0;
  failNextJwks = 0;
  private privateKey!: KeyLike;
  private publicJwk!: JWK;
  private baseUrl = '';

  async initialize(): Promise<void> {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    this.privateKey = privateKey;
    this.publicJwk = { ...(await exportJWK(publicKey)), kid: 'pg-test-key', alg: 'RS256', use: 'sig' };
    this.app.use(express.urlencoded({ extended: false }));
    this.app.get('/.well-known/openid-configuration', (_req, res) =>
      res.json({
        authorization_endpoint: `${this.baseUrl}/authorize`,
        token_endpoint: `${this.baseUrl}/token`,
        jwks_uri: `${this.baseUrl}/jwks`,
        issuer: this.baseUrl,
      }),
    );
    this.app.get('/jwks', (_req, res) => {
      if (this.failNextJwks-- > 0) return res.status(503).json({ error: 'temporary' });
      return res.json({ keys: [this.publicJwk] });
    });
    this.app.post('/token', async (req, res) => {
      if (this.failNextToken-- > 0) return res.status(503).json({ error: 'temporary' });
      const claims = this.tokenClaims.get(String(req.body.code));
      if (!claims) return res.status(400).json({ error: 'invalid_grant' });
      const token = await new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'pg-test-key' })
        .setIssuer(this.baseUrl)
        .setAudience('desktop')
        .setSubject(String(claims.sub ?? context.subject))
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(this.privateKey);
      return res.json({ id_token: token });
    });
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl;
  }
}

class HttpBrowser {
  private cookies = '';

  cookieHeader(): string {
    return this.cookies;
  }

  async get(base: string, path: string): Promise<Response> {
    return this.request(`${base}${path}`, { method: 'GET' });
  }

  async post(base: string, path: string, values: Array<[string, string]>, cookie = this.cookies): Promise<Response> {
    const body = new URLSearchParams(values);
    return this.request(
      `${base}${path}`,
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body },
      cookie,
    );
  }

  private async request(url: string, init: RequestInit, cookie = this.cookies): Promise<Response> {
    const headers = new Headers(init.headers);
    if (cookie) headers.set('cookie', cookie);
    const response = await fetch(url, { ...init, headers, redirect: 'manual' });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      const pair = setCookie.split(';', 1)[0];
      const [name, value] = pair.split('=', 2);
      const current = new Map(
        this.cookies
          .split('; ')
          .filter(Boolean)
          .map((entry) => entry.split('=', 2) as [string, string]),
      );
      if (value) current.set(name, value);
      else current.delete(name);
      this.cookies = [...current].map(([key, entry]) => `${key}=${entry}`).join('; ');
    }
    return response;
  }
}

async function listen(app: ReturnType<typeof buildApp>): Promise<{ url: string; server: Server }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}`, server };
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function csrf(html: string): string {
  return /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';
}

suite('PostgreSQL state store multi-instance behavior', () => {
  const poolA = new Pool({ connectionString: url });
  const poolB = new Pool({ connectionString: url });
  const a = new PostgresStateStore(poolA, 60_000);
  const b = new PostgresStateStore(poolB, 60_000);

  beforeAll(async () => {
    const migrations = await Promise.all([
      readFile(new URL('../migrations/20260827210000_shared_state_and_audit_outbox.sql', import.meta.url), 'utf8'),
      readFile(new URL('../migrations/20260827220700_final_review_b_remediations.sql', import.meta.url), 'utf8'),
    ]);
    await poolA.query(
      'DROP TABLE IF EXISTS oauth_consent_audit_outbox, oauth_consent_browser_flows, oauth_consent_sessions CASCADE',
    );
    for (const migration of migrations) await poolA.query(migration);
  });
  afterAll(async () => {
    await Promise.all([poolA.end(), poolB.end()]);
  });

  it('shares flows across replicas and atomically consumes them once', async () => {
    const flow = await a.createLoginFlow('challenge_cross_process');
    const [first, second] = await Promise.allSettled([
      a.consumeLoginFlow(flow.state, flow.cookieBinding),
      b.consumeLoginFlow(flow.state, flow.cookieBinding),
    ]);
    expect([first.status, second.status].sort()).toEqual(['fulfilled', 'rejected']);
  });

  it('uses CAS transitions across replicas', async () => {
    const session = await a.createConsent({
      challenge: 'challenge_cas',
      subject: 'user_test',
      hydraClientId: 'desktop',
      context,
    });
    const results = await Promise.allSettled([
      a.transition(session.id, 'created', 'shown'),
      b.transition(session.id, 'created', 'shown'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });

  it('permits only one concurrent active session for a Hydra challenge', async () => {
    const results = await Promise.allSettled([
      a.createConsent({ challenge: 'challenge_unique', subject: 'user_test', hydraClientId: 'desktop', context }),
      b.createConsent({ challenge: 'challenge_unique', subject: 'user_test', hydraClientId: 'desktop', context }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('durably records intent before Hydra and atomically finalizes one semantic audit', async () => {
    const session = await a.createConsent({
      challenge: 'challenge_fault',
      subject: 'user_test',
      hydraClientId: 'desktop',
      context,
    });
    await a.transition(session.id, 'created', 'shown');
    const payload = { event: 'consent.granted', eventId: `${session.id}:final` };
    const initialClaim = await a.prepareDecision(session.id, 'approve', payload, 1_000);

    const restarted = new PostgresStateStore(poolB, 60_000);
    await poolA.query(
      `UPDATE oauth_consent_sessions SET decision_lease_until=now() - interval '1 second' WHERE id=$1`,
      [session.id],
    );
    const [replayed] = await restarted.claimDecisions(10, 1_000);
    expect(replayed?.session.id).toBe(session.id);
    expect(replayed?.claimToken).not.toBe(initialClaim.claimToken);
    await restarted.finalizeDecision(replayed!);
    const audits = await a.claimAudits(10);
    expect(audits.filter((item) => item.id === `${session.id}:final`)).toHaveLength(1);
  });

  it('cleans up expired browser flows and sessions', async () => {
    const short = new PostgresStateStore(poolA, -1);
    await short.createLoginFlow('expired_flow');
    const session = await short.createConsent({
      challenge: 'expired_session',
      subject: 'user_test',
      hydraClientId: 'desktop',
      context,
    });
    await short.cleanup();
    await expect(short.getConsent(session.id)).rejects.toThrow();
  });

  it('survives process restart and replays durable audit work once claimed', async () => {
    await a.enqueueAudit('restart:event', { event: 'consent.granted' });
    const restarted = new PostgresStateStore(poolB, 60_000);
    const items = await restarted.claimAudits(10);
    expect(items.map((item) => item.id)).toContain('restart:event');
    await restarted.completeAudit('restart:event');
    expect(await a.claimAudits(10)).toEqual([]);
  });

  it('allows exactly one of two reconcilers to claim an expired decision lease', async () => {
    const session = await a.createConsent({
      challenge: 'challenge_two_reconcilers',
      subject: 'user_test',
      hydraClientId: 'desktop',
      context,
    });
    await a.transition(session.id, 'created', 'shown');
    await a.prepareDecision(session.id, 'deny', { event: 'consent.denied' }, 1_000);
    await poolA.query(
      `UPDATE oauth_consent_sessions SET decision_lease_until=now() - interval '1 second' WHERE id=$1`,
      [session.id],
    );
    const [left, right] = await Promise.all([a.claimDecisions(10, 1_000), b.claimDecisions(10, 1_000)]);
    expect([...left, ...right].filter((claim) => claim.session.id === session.id)).toHaveLength(1);
  });

  it('converges after a post-Hydra crash with two reconcilers and one semantic final audit', async () => {
    const challenge = 'challenge_post_hydra_crash';
    const ory = new FakeOry(challenge);
    const hooks = new FakeHooks();
    const session = await a.createConsent({ challenge, subject: context.subject, hydraClientId: 'desktop', context });
    await a.transition(session.id, 'created', 'shown');
    await a.setSelectedScopes(session.id, []);
    await a.prepareDecision(
      session.id,
      'approve',
      {
        event: 'consent.granted',
        eventId: `${session.id}:final`,
        occurredAt: new Date().toISOString(),
        sessionId: session.id,
        context,
        scopes: [],
        result: 'approved',
      },
      1_000,
    );
    await poolA.query(
      `UPDATE oauth_consent_sessions SET decision_lease_until=now() - interval '1 second' WHERE id=$1`,
      [session.id],
    );

    await reconcileDecisions(a, ory as unknown as OryAdmin, hooks as unknown as RowboatHooks, 25, 1_000, {
      afterHydra: () => {
        throw new InjectedPostHydraCrash('simulated process death');
      },
    });
    expect(ory.hydraCommits).toBe(1);
    expect((await a.getConsent(session.id)).status).toBe('processing');

    await poolA.query(
      `UPDATE oauth_consent_sessions SET decision_lease_until=now() - interval '1 second' WHERE id=$1`,
      [session.id],
    );
    const reconciled = await Promise.all([
      reconcileDecisions(a, ory as unknown as OryAdmin, hooks as unknown as RowboatHooks, 25, 1_000),
      reconcileDecisions(b, ory as unknown as OryAdmin, hooks as unknown as RowboatHooks, 25, 1_000),
    ]);
    expect(reconciled.sort()).toEqual([0, 1]);
    expect(ory.hydraCommits).toBe(1);
    expect(ory.acceptCalls).toBe(2);
    expect((await a.getConsent(session.id)).status).toBe('approved');
    expect([...hooks.audits].filter(([id]) => id === `${session.id}:final`)).toHaveLength(1);
    const rows = await poolA.query('SELECT count(*)::int AS count FROM oauth_consent_audit_outbox WHERE id=$1', [
      `${session.id}:final`,
    ]);
    expect(rows.rows[0].count).toBe(1);
  });

  it.each(['exchange', 'jwks'] as const)(
    'recovers a PostgreSQL-backed MFA flow across replicas after transient %s failure',
    async (failure) => {
      const challenge = `challenge_pg_mfa_${failure}`;
      const ory = new FakeOry(challenge, moneyContext);
      const hooks = new FakeHooks(moneyContext);
      const issuer = new WorkOSFaultServer();
      await issuer.initialize();
      const issuerApp = await listen(issuer.app);
      issuer.setBaseUrl(issuerApp.url);
      const workos = new WorkOS(
        {
          ...config.workos,
          issuer: issuerApp.url,
          stepUpAcr: 'urn:test:mfa',
          stepUpAmr: 'mfa',
        },
        2_000,
      );
      const leftApp = await listen(
        buildApp(config, {
          store: a,
          ory: ory as unknown as OryAdmin,
          hooks: hooks as unknown as RowboatHooks,
          workos,
        }),
      );
      const rightApp = await listen(
        buildApp(config, {
          store: b,
          ory: ory as unknown as OryAdmin,
          hooks: hooks as unknown as RowboatHooks,
          workos,
        }),
      );
      try {
        const browser = new HttpBrowser();
        const shown = await browser.get(leftApp.url, `/consent?consent_challenge=${challenge}`);
        const html = await shown.text();
        const stepUp = await browser.post(leftApp.url, '/consent/decision', [
          ['csrf', csrf(html)],
          ['decision', 'approve'],
          ['scope', moneyContext.scopes[0].name],
          ['confirm_high', 'yes'],
        ]);
        expect(stepUp.status).toBe(302);
        const original = new URL(stepUp.headers.get('location')!);
        const originalState = original.searchParams.get('state')!;
        const originalNonce = original.searchParams.get('nonce')!;
        const originalCookies = browser.cookieHeader();
        issuer.tokenClaims.set('pg-transient', {
          sub: context.subject,
          nonce: originalNonce,
          amr: ['mfa'],
          acr: 'urn:test:mfa',
        });
        if (failure === 'exchange') issuer.failNextToken = 1;
        else issuer.failNextJwks = 1;

        const recovery = await browser.get(
          rightApp.url,
          `/step-up/callback?code=pg-transient&state=${encodeURIComponent(originalState)}`,
        );
        expect(recovery.status).toBe(302);
        const freshLocation = recovery.headers.get('location')!;
        const fresh = new URL(freshLocation);
        expect(fresh.searchParams.get('state')).not.toBe(originalState);

        const replay = await fetch(
          `${leftApp.url}/step-up/callback?code=pg-transient&state=${encodeURIComponent(originalState)}`,
          { headers: { cookie: originalCookies }, redirect: 'manual' },
        );
        expect(replay.status).toBe(302);
        expect(replay.headers.get('location')).toBe(freshLocation);

        issuer.tokenClaims.set('pg-fresh', {
          sub: context.subject,
          nonce: fresh.searchParams.get('nonce')!,
          amr: ['pwd', 'mfa'],
          acr: 'urn:test:mfa',
        });
        const completed = await browser.get(
          rightApp.url,
          `/step-up/callback?code=pg-fresh&state=${encodeURIComponent(fresh.searchParams.get('state')!)}`,
        );
        expect(completed.status).toBe(302);
        expect(ory.hydraCommits).toBe(1);
        const rows = await poolA.query(
          `SELECT count(*)::int AS count FROM oauth_consent_browser_flows WHERE consent_session_id IN
           (SELECT id FROM oauth_consent_sessions WHERE challenge=$1)`,
          [challenge],
        );
        expect(rows.rows[0].count).toBe(0);
      } finally {
        await Promise.all([close(leftApp.server), close(rightApp.server), close(issuerApp.server)]);
      }
    },
  );

  it('serves concurrent consent GETs and a dropped approval response across replicas with one session and audits', async () => {
    const challenge = 'challenge_dropped_response';
    const ory = new FakeOry(challenge);
    const hooks = new FakeHooks();
    const workos = {} as WorkOS;
    const leftApp = await listen(
      buildApp(config, {
        store: a,
        ory: ory as unknown as OryAdmin,
        hooks: hooks as unknown as RowboatHooks,
        workos,
      }),
    );
    const rightApp = await listen(
      buildApp(config, {
        store: b,
        ory: ory as unknown as OryAdmin,
        hooks: hooks as unknown as RowboatHooks,
        workos,
      }),
    );
    try {
      const leftBrowser = new HttpBrowser();
      const rightBrowser = new HttpBrowser();
      const [leftShown, rightShown] = await Promise.all([
        leftBrowser.get(leftApp.url, `/consent?consent_challenge=${challenge}`),
        rightBrowser.get(rightApp.url, `/consent?consent_challenge=${challenge}`),
      ]);
      expect(leftShown.status).toBe(200);
      expect(rightShown.status).toBe(200);
      const leftHtml = await leftShown.text();
      const counts = await poolA.query(
        `SELECT
           (SELECT count(*)::int FROM oauth_consent_sessions WHERE challenge=$1) AS sessions,
           (SELECT count(*)::int FROM oauth_consent_audit_outbox o
             JOIN oauth_consent_sessions s ON o.id=s.id || ':shown' WHERE s.challenge=$1) AS shown_audits`,
        [challenge],
      );
      expect(counts.rows[0]).toMatchObject({ sessions: 1, shown_audits: 1 });
      expect([...hooks.audits.values()].filter((audit) => audit.event === 'consent.shown')).toHaveLength(1);

      const values: Array<[string, string]> = [
        ['csrf', csrf(leftHtml)],
        ['decision', 'approve'],
      ];
      const originalCookies = leftBrowser.cookieHeader();
      const dropped = await leftBrowser.post(leftApp.url, '/consent/decision', values, originalCookies);
      expect(dropped.status).toBe(302);
      const retried = await leftBrowser.post(rightApp.url, '/consent/decision', values, originalCookies);
      expect(retried.status).toBe(302);
      expect(retried.headers.get('location')).toBe(dropped.headers.get('location'));
      expect(ory.hydraCommits).toBe(1);
      expect([...hooks.audits.values()].filter((audit) => audit.event === 'consent.granted')).toHaveLength(1);
      const finalCounts = await poolA.query(
        `SELECT
           (SELECT count(*)::int FROM oauth_consent_sessions WHERE challenge=$1) AS sessions,
           (SELECT count(*)::int FROM oauth_consent_audit_outbox o
             JOIN oauth_consent_sessions s ON o.id=s.id || ':final' WHERE s.challenge=$1) AS final_audits`,
        [challenge],
      );
      expect(finalCounts.rows[0]).toMatchObject({ sessions: 1, final_audits: 1 });
    } finally {
      await Promise.all([
        new Promise<void>((resolve, reject) => leftApp.server.close((error) => (error ? reject(error) : resolve()))),
        new Promise<void>((resolve, reject) => rightApp.server.close((error) => (error ? reject(error) : resolve()))),
      ]);
    }
  });
});
