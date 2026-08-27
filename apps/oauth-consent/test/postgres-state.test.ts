import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConsentContext } from '../src/rowboat.js';
import { PostgresStateStore } from '../src/state.js';

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

suite('PostgreSQL state store multi-instance behavior', () => {
  const poolA = new Pool({ connectionString: url });
  const poolB = new Pool({ connectionString: url });
  const a = new PostgresStateStore(poolA, 60_000);
  const b = new PostgresStateStore(poolB, 60_000);

  beforeAll(async () => {
    const migration = await readFile(
      new URL('../migrations/20260827210000_shared_state_and_audit_outbox.sql', import.meta.url),
      'utf8',
    );
    await poolA.query(
      'DROP TABLE IF EXISTS oauth_consent_audit_outbox, oauth_consent_browser_flows, oauth_consent_sessions CASCADE',
    );
    await poolA.query(migration);
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
    await a.prepareDecision(session.id, 'approve', payload);

    const restarted = new PostgresStateStore(poolB, 60_000);
    expect((await restarted.pendingDecisions(10)).map((item) => item.id)).toContain(session.id);
    await restarted.finalizeDecision(session.id, payload);
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
});
