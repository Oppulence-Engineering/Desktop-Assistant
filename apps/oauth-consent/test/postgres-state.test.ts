import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { exportJWK, generateKeyPair, SignJWT, type JWK, type JWTPayload, type KeyLike } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import {
  OryRequestError,
  type ConsentDecisionBinding,
  type ConsentDecisionProbe,
  type HydraOutcomeProof,
  type OryAdmin,
} from '../src/ory.js';
import type { AuditRequest, ConsentContext, RowboatHooks } from '../src/rowboat.js';
import { buildApp, InjectedPostHydraCrash, reconcileDecisions } from '../src/server.js';
import { PostgresStateStore } from '../src/state.js';
import { WorkOS } from '../src/workos.js';

const url = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_POSTGRES_STATE_TESTS === 'true' && !url) {
  throw new Error('release gate requires TEST_DATABASE_URL; PostgreSQL state-machine tests may not be skipped');
}
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
  terminal?: 'accepted' | 'rejected' | 'expired';
  loginTerminal = false;
  hydraCommits = 0;
  acceptCalls = 0;
  loginAcceptCalls = 0;
  failNextLoginAccept = 0;
  expireBeforeNextConsent = false;
  loseNextConsentResponse = false;
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

  async getLoginRequest(challenge: string) {
    if (challenge !== this.challenge || this.loginTerminal) throw new OryRequestError(410);
    return { skip: false, subject: '', challenge };
  }

  async acceptLogin(challenge: string, subject: string) {
    this.loginAcceptCalls += 1;
    if (challenge !== this.challenge || !subject) throw new OryRequestError(400);
    if (this.failNextLoginAccept-- > 0) throw new OryRequestError(503);
    if (this.loginTerminal) throw new OryRequestError(409);
    this.loginTerminal = true;
    return { redirect_to: 'http://desktop.test/login-complete' };
  }

  async loginRequestPending() {
    return !this.loginTerminal;
  }

  async acceptConsent() {
    this.acceptCalls += 1;
    if (this.expireBeforeNextConsent) {
      this.expireBeforeNextConsent = false;
      this.terminal = 'expired';
      throw new OryRequestError(410);
    }
    if (this.terminal) throw new OryRequestError(409);
    this.terminal = 'accepted';
    this.hydraCommits += 1;
    if (this.loseNextConsentResponse) {
      this.loseNextConsentResponse = false;
      throw new OryRequestError(503);
    }
    return { redirect_to: 'http://desktop.test/complete' };
  }

  async rejectConsent() {
    if (this.terminal) throw new OryRequestError(409);
    this.terminal = 'rejected';
    this.hydraCommits += 1;
    return { redirect_to: 'http://desktop.test/denied?error=access_denied' };
  }

  async consentRequestPending() {
    return !this.terminal;
  }

  async probeConsentDecision(binding: ConsentDecisionBinding): Promise<ConsentDecisionProbe> {
    if (!this.terminal) return { state: 'pending' };
    if (this.terminal === 'expired') {
      return { state: 'indeterminate', reason: 'hydra_terminal_outcome_unproven' };
    }
    const proof: HydraOutcomeProof = {
      outcome: this.terminal,
      source: this.terminal === 'accepted' ? 'consent_session' : 'terminal_redirect',
      challenge: binding.challenge,
      subject: binding.subject,
      clientId: binding.clientId,
      requestedAudience: [...binding.requestedAudience],
      requestedScopes: [...binding.requestedScopes],
      grantedAudience: this.terminal === 'accepted' ? [...binding.grantedAudience] : [],
      grantedScopes: this.terminal === 'accepted' ? [...binding.grantedScopes] : [],
      redirectTo:
        this.terminal === 'accepted'
          ? 'http://desktop.test/complete'
          : 'http://desktop.test/denied?error=access_denied',
      consentRequestId: this.terminal === 'accepted' ? `request_${binding.challenge}` : undefined,
    };
    const expected = binding.decision === 'approve' ? 'accepted' : 'rejected';
    return proof.outcome === expected
      ? { state: 'committed', proof }
      : { state: 'indeterminate', reason: 'hydra_terminal_outcome_conflicts_with_intent', proof };
  }
}

class FakeHooks {
  readonly audits = new Map<string, AuditRequest>();
  contextCalls = 0;

  constructor(public policy = context) {}

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
  tokenCalls = 0;
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
      this.tokenCalls += 1;
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
      readFile(
        new URL('../migrations/20260827232500_irreversible_outcomes_and_login_leases.sql', import.meta.url),
        'utf8',
      ),
      readFile(new URL('../migrations/20260828035100_authoritative_consent_outcomes.sql', import.meta.url), 'utf8'),
    ]);
    await poolA.query(
      'DROP TABLE IF EXISTS oauth_consent_audit_outbox, oauth_consent_browser_flows, oauth_consent_sessions CASCADE',
    );
    for (const migration of migrations) await poolA.query(migration);
  });
  afterAll(async () => {
    await Promise.all([poolA.end(), poolB.end()]);
  });

  it('shares flows across replicas and permits only one active login lease', async () => {
    const flow = await a.createLoginFlow('challenge_cross_process');
    const [first, second] = await Promise.allSettled([
      a.claimLoginFlow(flow.state, flow.cookieBinding, 1_000),
      b.claimLoginFlow(flow.state, flow.cookieBinding, 1_000),
    ]);
    expect([first.status, second.status].sort()).toEqual(['fulfilled', 'rejected']);
  });

  it.each(['workos', 'hydra'] as const)(
    'recovers the same login state across replicas after transient %s failure without consuming it early',
    async (failure) => {
      const challenge = `login_recovery_${failure}`;
      const ory = new FakeOry(challenge);
      const issuer = new WorkOSFaultServer();
      await issuer.initialize();
      const issuerApp = await listen(issuer.app);
      issuer.setBaseUrl(issuerApp.url);
      const workos = new WorkOS({ ...config.workos, issuer: issuerApp.url }, 2_000);
      const hooks = new FakeHooks();
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
        const login = await browser.get(leftApp.url, `/login?login_challenge=${challenge}`);
        const authorize = new URL(login.headers.get('location')!);
        const state = authorize.searchParams.get('state')!;
        const nonce = authorize.searchParams.get('nonce')!;
        const cookies = browser.cookieHeader();
        issuer.tokenClaims.set('login-recovery-code', { sub: context.subject, nonce, amr: ['pwd'] });
        if (failure === 'workos') issuer.failNextToken = 1;
        else ory.failNextLoginAccept = 1;

        const first = await browser.get(
          rightApp.url,
          `/callback?code=login-recovery-code&state=${encodeURIComponent(state)}`,
        );
        expect(first.status).toBe(502);

        const callbackPath = `/callback?code=login-recovery-code&state=${encodeURIComponent(state)}`;
        const recovered = await Promise.all([
          fetch(leftApp.url + callbackPath, { headers: { cookie: cookies }, redirect: 'manual' }),
          fetch(rightApp.url + callbackPath, { headers: { cookie: cookies }, redirect: 'manual' }),
        ]);
        expect(recovered.map((response) => response.status).sort()).toEqual([302, 409]);

        const replay = await fetch(leftApp.url + callbackPath, { headers: { cookie: cookies }, redirect: 'manual' });
        expect(replay.status).toBe(302);
        expect(replay.headers.get('location')).toBe('http://desktop.test/login-complete');
        expect(ory.loginAcceptCalls).toBe(failure === 'hydra' ? 2 : 1);
        expect(issuer.tokenCalls).toBe(failure === 'workos' ? 2 : 1);
        const rows = await poolA.query(
          `SELECT upstream_phase, login_subject, completed_at IS NOT NULL AS completed
           FROM oauth_consent_browser_flows WHERE challenge=$1`,
          [challenge],
        );
        expect(rows.rows).toEqual([{ upstream_phase: 'completed', login_subject: context.subject, completed: true }]);
      } finally {
        await Promise.all([close(leftApp.server), close(rightApp.server), close(issuerApp.server)]);
      }
    },
  );

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
    let accepted = await restarted.markHydraPending(replayed!);
    accepted = await restarted.recordHydraOutcome(accepted, {
      outcome: 'accepted',
      source: 'consent_session',
      challenge: session.challenge,
      subject: session.subject,
      clientId: session.hydraClientId,
      requestedAudience: session.hydraRequestedAudience,
      requestedScopes: session.hydraRequestedScopes,
      grantedAudience: [session.context.connector.audience],
      grantedScopes: ['offline_access'],
    });
    accepted = await restarted.recordAcceptedGrant(accepted);
    await restarted.finalizeDecision(accepted);
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

  it('records challenge expiry between durable intent and Hydra submission as indeterminate without semantic audit', async () => {
    const challenge = 'challenge_expired_after_intent';
    const ory = new FakeOry(challenge);
    const hooks = new FakeHooks();
    const session = await a.createConsent({
      challenge,
      subject: context.subject,
      hydraClientId: context.client.id,
      context,
    });
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
    ory.expireBeforeNextConsent = true;
    await poolA.query(
      `UPDATE oauth_consent_sessions SET decision_lease_until=now() - interval '1 second' WHERE id=$1`,
      [session.id],
    );

    const reconciled = await Promise.all([
      reconcileDecisions(a, ory as unknown as OryAdmin, hooks as unknown as RowboatHooks, 25, 1_000),
      reconcileDecisions(b, ory as unknown as OryAdmin, hooks as unknown as RowboatHooks, 25, 1_000),
    ]);
    expect(reconciled.sort()).toEqual([0, 1]);
    expect(ory.acceptCalls).toBe(1);
    expect(ory.hydraCommits).toBe(0);

    const terminal = await b.getConsent(session.id);
    expect(terminal.status).toBe('indeterminate');
    expect(terminal.hydraOutcomePhase).toBe('indeterminate');
    expect(terminal.decision).toBe('approve');
    expect(terminal.decisionPayload).toEqual(expect.objectContaining({ event: 'consent.granted' }));
    expect(terminal.decisionLastError).toBe('hydra_terminal_outcome_unproven');
    expect(terminal.hydraOutcomeProof).toBeUndefined();
    expect(await a.claimDecisions(25, 1_000)).toEqual([]);
    expect([...hooks.audits.values()].filter((audit) => audit.event === 'consent.granted')).toHaveLength(0);
    const audits = await poolA.query(`SELECT id FROM oauth_consent_audit_outbox WHERE id=$1`, [`${session.id}:final`]);
    expect(audits.rowCount).toBe(0);

    await poolA.query(`UPDATE oauth_consent_sessions SET expires_at=now() - interval '1 second' WHERE id=$1`, [
      session.id,
    ]);
    await a.cleanup();
    expect((await b.getConsent(session.id)).status).toBe('indeterminate');
  });

  it('uses an exact Hydra consent-session proof to converge a lost successful response once across replicas', async () => {
    const challenge = 'challenge_lost_success_response';
    const ory = new FakeOry(challenge);
    const hooks = new FakeHooks();
    const session = await a.createConsent({
      challenge,
      subject: context.subject,
      hydraClientId: context.client.id,
      context,
    });
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
    ory.loseNextConsentResponse = true;
    await poolA.query(
      `UPDATE oauth_consent_sessions SET decision_lease_until=now() - interval '1 second' WHERE id=$1`,
      [session.id],
    );

    const reconciled = await Promise.all([
      reconcileDecisions(a, ory as unknown as OryAdmin, hooks as unknown as RowboatHooks, 25, 1_000),
      reconcileDecisions(b, ory as unknown as OryAdmin, hooks as unknown as RowboatHooks, 25, 1_000),
    ]);
    expect(reconciled.sort()).toEqual([0, 1]);
    expect(ory.acceptCalls).toBe(1);
    expect(ory.hydraCommits).toBe(1);

    const terminal = await a.getConsent(session.id);
    expect(terminal.status).toBe('approved');
    expect(terminal.hydraOutcomePhase).toBe('accepted');
    expect(terminal.hydraOutcomeProof).toEqual(
      expect.objectContaining({
        outcome: 'accepted',
        source: 'consent_session',
        challenge,
        subject: context.subject,
        clientId: context.client.id,
        requestedAudience: [context.connector.audience],
        requestedScopes: ['offline_access'],
        grantedAudience: [context.connector.audience],
        grantedScopes: ['offline_access'],
      }),
    );
    expect([...hooks.audits.values()].filter((audit) => audit.event === 'consent.granted')).toHaveLength(1);
    const audits = await poolA.query(
      `SELECT count(*)::int AS count FROM oauth_consent_audit_outbox WHERE id=$1 AND delivered_at IS NOT NULL`,
      [`${session.id}:final`],
    );
    expect(audits.rows[0].count).toBe(1);
  });

  it('keeps an accepted Hydra outcome irreversible, then explicitly invalidates after entitlement removal', async () => {
    const challenge = 'challenge_post_hydra_crash';
    const ory = new FakeOry(challenge, moneyContext);
    const hooks = new FakeHooks(moneyContext);
    const session = await a.createConsent({
      challenge,
      subject: moneyContext.subject,
      hydraClientId: 'desktop',
      context: moneyContext,
    });
    await a.transition(session.id, 'created', 'shown');
    await a.setSelectedScopes(session.id, [moneyContext.scopes[0].name]);
    await a.prepareDecision(
      session.id,
      'approve',
      {
        event: 'consent.granted',
        eventId: `${session.id}:final`,
        occurredAt: new Date().toISOString(),
        sessionId: session.id,
        context: moneyContext,
        scopes: [moneyContext.scopes[0].name],
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
    const crashed = await a.getConsent(session.id);
    expect(crashed.status).toBe('processing');
    expect(crashed.decision).toBe('approve');
    expect(crashed.hydraOutcomePhase).toBe('accept_pending');

    hooks.policy = {
      ...moneyContext,
      entitlement: { allowed: false, reason: 'scope_not_in_plan' },
    };

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
    expect(ory.acceptCalls).toBe(1);
    const converged = await a.getConsent(session.id);
    expect(converged.status).toBe('invalidated');
    expect(converged.decision).toBe('approve');
    expect(converged.hydraOutcomePhase).toBe('accepted');
    expect(converged.grantRecordedAt).toBeTypeOf('number');
    expect([...hooks.audits].filter(([id]) => id === `${session.id}:final`)).toHaveLength(1);
    expect([...hooks.audits].filter(([id]) => id === `${session.id}:invalidated`)).toHaveLength(1);
    expect(hooks.audits.get(`${session.id}:final`)).toEqual(
      expect.objectContaining({
        event: 'consent.granted',
        result: 'approved',
        scopes: [moneyContext.scopes[0].name],
      }),
    );
    expect(hooks.audits.get(`${session.id}:invalidated`)).toEqual(
      expect.objectContaining({
        event: 'consent.denied',
        result: 'post_commit_entitlement_revoked',
        scopes: moneyContext.scopes.map((scope) => scope.name),
      }),
    );
    const rows = await poolA.query(
      `SELECT id, payload, delivered_at IS NOT NULL AS delivered
       FROM oauth_consent_audit_outbox WHERE id = ANY($1::text[]) ORDER BY id`,
      [[`${session.id}:final`, `${session.id}:invalidated`]],
    );
    expect(rows.rows).toEqual([
      expect.objectContaining({ id: `${session.id}:final`, delivered: true }),
      expect.objectContaining({ id: `${session.id}:invalidated`, delivered: true }),
    ]);
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
