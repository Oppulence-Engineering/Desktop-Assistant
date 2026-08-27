import type { Pool } from 'pg';
import { badRequest, conflict } from './errors.js';
import { hashToken, randomToken } from './crypto.js';
import type { ConsentContext } from './rowboat.js';

export type ConsentStatus = 'created' | 'shown' | 'step_up_pending' | 'processing' | 'approved' | 'denied' | 'failed';

export interface ConsentSession {
  id: string;
  challenge: string;
  csrf: string;
  subject: string;
  hydraClientId: string;
  context: ConsentContext;
  status: ConsentStatus;
  selectedScopes?: string[];
  decision?: 'approve' | 'deny';
  decisionPayload?: unknown;
  hydraCommittedAt?: number;
  expiresAt: number;
}

export interface BrowserFlow {
  stateHash: string;
  cookieBinding: string;
  nonce: string;
  expiresAt: number;
  challenge?: string;
  consentSessionId?: string;
}

export interface AuditOutboxItem {
  id: string;
  payload: unknown;
  attempts: number;
}

export interface ConsentStateStore {
  createConsent(
    input: Omit<ConsentSession, 'id' | 'csrf' | 'status' | 'expiresAt'>,
  ): Promise<ConsentSession> | ConsentSession;
  getConsent(id: string): Promise<ConsentSession> | ConsentSession;
  transition(
    id: string,
    expected: ConsentStatus | ConsentStatus[],
    next: ConsentStatus,
  ): Promise<ConsentSession> | ConsentSession;
  setSelectedScopes(id: string, scopes: string[]): Promise<ConsentSession> | ConsentSession;
  failConsent(id: string): Promise<void> | void;
  createLoginFlow(challenge: string): Promise<BrowserFlow & { state: string }> | (BrowserFlow & { state: string });
  consumeLoginFlow(state: string, cookieBinding: string | undefined): Promise<BrowserFlow> | BrowserFlow;
  createStepUpFlow(
    consentSessionId: string,
  ): Promise<BrowserFlow & { state: string }> | (BrowserFlow & { state: string });
  consumeStepUpFlow(state: string, cookieBinding: string | undefined): Promise<BrowserFlow> | BrowserFlow;
  enqueueAudit(id: string, payload: unknown): Promise<void> | void;
  claimAudits(limit: number): Promise<AuditOutboxItem[]> | AuditOutboxItem[];
  completeAudit(id: string): Promise<void> | void;
  retryAudit(id: string, error: string): Promise<void> | void;
  prepareDecision(id: string, decision: 'approve' | 'deny', payload: unknown): Promise<ConsentSession> | ConsentSession;
  finalizeDecision(id: string, payload: unknown): Promise<void> | void;
  pendingDecisions(limit: number): Promise<ConsentSession[]> | ConsentSession[];
  ready(): Promise<boolean> | boolean;
  cleanup(): Promise<void> | void;
}

/** Process-local implementation for unit tests only. Production startup never constructs it. */
export class StateStore implements ConsentStateStore {
  private consent = new Map<string, ConsentSession>();
  private flows = new Map<string, BrowserFlow & { kind: string }>();
  private outbox = new Map<string, AuditOutboxItem>();
  constructor(
    private ttlMs: number,
    private now: () => number = Date.now,
  ) {}
  createConsent(input: Omit<ConsentSession, 'id' | 'csrf' | 'status' | 'expiresAt'>): ConsentSession {
    for (const value of this.consent.values())
      if (value.challenge === input.challenge && !['approved', 'denied', 'failed'].includes(value.status))
        throw conflict('consent_challenge_active');
    const value = {
      ...input,
      id: randomToken(),
      csrf: randomToken(),
      status: 'created' as const,
      expiresAt: this.now() + this.ttlMs,
    };
    this.consent.set(value.id, value);
    return value;
  }
  getConsent(id: string): ConsentSession {
    const value = this.consent.get(id);
    if (!value || value.expiresAt <= this.now()) throw conflict('consent_session_missing');
    return value;
  }
  transition(id: string, expected: ConsentStatus | ConsentStatus[], next: ConsentStatus): ConsentSession {
    const value = this.getConsent(id);
    if (!(Array.isArray(expected) ? expected : [expected]).includes(value.status)) throw conflict('consent_replay');
    value.status = next;
    return value;
  }
  setSelectedScopes(id: string, scopes: string[]): ConsentSession {
    const value = this.getConsent(id);
    value.selectedScopes = [...scopes];
    return value;
  }
  failConsent(id: string): void {
    const value = this.consent.get(id);
    if (value && !['approved', 'denied'].includes(value.status)) value.status = 'failed';
  }
  createLoginFlow(challenge: string) {
    return this.createFlow('login', { challenge });
  }
  consumeLoginFlow(state: string, binding: string | undefined) {
    return this.consumeFlow('login', state, binding);
  }
  createStepUpFlow(consentSessionId: string) {
    return this.createFlow('step_up', { consentSessionId });
  }
  consumeStepUpFlow(state: string, binding: string | undefined) {
    return this.consumeFlow('step_up', state, binding);
  }
  private createFlow(kind: string, input: Pick<BrowserFlow, 'challenge'> | Pick<BrowserFlow, 'consentSessionId'>) {
    const state = randomToken();
    const flow = {
      ...input,
      state,
      stateHash: hashToken(state),
      cookieBinding: randomToken(),
      nonce: randomToken(),
      expiresAt: this.now() + this.ttlMs,
      kind,
    };
    this.flows.set(flow.stateHash, flow);
    return flow;
  }
  private consumeFlow(kind: string, state: string, binding: string | undefined): BrowserFlow {
    const key = hashToken(state);
    const flow = this.flows.get(key);
    this.flows.delete(key);
    if (
      !state ||
      !binding ||
      !flow ||
      flow.kind !== kind ||
      flow.cookieBinding !== binding ||
      flow.expiresAt <= this.now()
    )
      throw conflict(`${kind}_state_replay`);
    return flow;
  }
  enqueueAudit(id: string, payload: unknown): void {
    if (!this.outbox.has(id)) this.outbox.set(id, { id, payload, attempts: 0 });
  }
  claimAudits(limit: number): AuditOutboxItem[] {
    return [...this.outbox.values()].slice(0, limit).map((x) => ({ ...x, attempts: ++x.attempts }));
  }
  completeAudit(id: string): void {
    this.outbox.delete(id);
  }
  retryAudit(_id: string, _error: string): void {}
  prepareDecision(id: string, decision: 'approve' | 'deny', payload: unknown): ConsentSession {
    const value = this.transition(id, ['shown', 'step_up_pending'], 'processing');
    value.decision = decision;
    value.decisionPayload = payload;
    return value;
  }
  finalizeDecision(id: string, payload: unknown): void {
    const value = this.getConsent(id);
    value.status = value.decision === 'approve' ? 'approved' : 'denied';
    value.hydraCommittedAt = this.now();
    this.enqueueAudit(`${id}:final`, payload);
  }
  pendingDecisions(): ConsentSession[] {
    return [...this.consent.values()].filter((v) => v.status === 'processing' && !!v.decision);
  }
  ready(): boolean {
    return true;
  }
  cleanup(): void {
    for (const [id, value] of this.consent) if (value.expiresAt <= this.now()) this.consent.delete(id);
    for (const [id, value] of this.flows) if (value.expiresAt <= this.now()) this.flows.delete(id);
  }
}

export class PostgresStateStore implements ConsentStateStore {
  constructor(
    private readonly pool: Pool,
    private readonly ttlMs: number,
  ) {}

  async createConsent(input: Omit<ConsentSession, 'id' | 'csrf' | 'status' | 'expiresAt'>): Promise<ConsentSession> {
    const session: ConsentSession = {
      ...input,
      id: randomToken(),
      csrf: randomToken(),
      status: 'created',
      expiresAt: Date.now() + this.ttlMs,
    };
    try {
      await this.pool.query(
        `INSERT INTO oauth_consent_sessions (id, challenge, csrf, subject, hydra_client_id, context, status, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8 / 1000.0))`,
        [
          session.id,
          session.challenge,
          session.csrf,
          session.subject,
          session.hydraClientId,
          JSON.stringify(session.context),
          session.status,
          session.expiresAt,
        ],
      );
      return session;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw conflict('consent_challenge_active');
      throw error;
    }
  }

  async getConsent(id: string): Promise<ConsentSession> {
    const result = await this.pool.query(
      `SELECT id, challenge, csrf, subject, hydra_client_id, context, status, selected_scopes, extract(epoch from expires_at) * 1000 AS expires_at_ms FROM oauth_consent_sessions WHERE id=$1 AND expires_at > now()`,
      [id],
    );
    if (!result.rowCount) throw conflict('consent_session_missing');
    return rowToConsent(result.rows[0]);
  }

  async transition(
    id: string,
    expected: ConsentStatus | ConsentStatus[],
    next: ConsentStatus,
  ): Promise<ConsentSession> {
    const allowed = Array.isArray(expected) ? expected : [expected];
    const result = await this.pool.query(
      `UPDATE oauth_consent_sessions SET status=$2, version=version+1 WHERE id=$1 AND status = ANY($3::text[]) AND expires_at > now() RETURNING id, challenge, csrf, subject, hydra_client_id, context, status, selected_scopes, extract(epoch from expires_at) * 1000 AS expires_at_ms`,
      [id, next, allowed],
    );
    if (!result.rowCount) throw conflict('consent_replay');
    return rowToConsent(result.rows[0]);
  }

  async setSelectedScopes(id: string, scopes: string[]): Promise<ConsentSession> {
    const result = await this.pool.query(
      `UPDATE oauth_consent_sessions SET selected_scopes=$2, version=version+1 WHERE id=$1 AND expires_at > now() RETURNING id, challenge, csrf, subject, hydra_client_id, context, status, selected_scopes, extract(epoch from expires_at) * 1000 AS expires_at_ms`,
      [id, JSON.stringify(scopes)],
    );
    if (!result.rowCount) throw conflict('consent_session_missing');
    return rowToConsent(result.rows[0]);
  }

  async failConsent(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE oauth_consent_sessions SET status='failed', version=version+1 WHERE id=$1 AND status NOT IN ('approved','denied')`,
      [id],
    );
  }

  async createLoginFlow(challenge: string) {
    return this.createFlow('login', { challenge });
  }
  async consumeLoginFlow(state: string, binding: string | undefined) {
    return this.consumeFlow('login', state, binding);
  }
  async createStepUpFlow(consentSessionId: string) {
    return this.createFlow('step_up', { consentSessionId });
  }
  async consumeStepUpFlow(state: string, binding: string | undefined) {
    return this.consumeFlow('step_up', state, binding);
  }

  private async createFlow(
    kind: string,
    input: Pick<BrowserFlow, 'challenge'> | Pick<BrowserFlow, 'consentSessionId'>,
  ): Promise<BrowserFlow & { state: string }> {
    const state = randomToken();
    const flow: BrowserFlow & { state: string } = {
      ...input,
      state,
      stateHash: hashToken(state),
      cookieBinding: randomToken(),
      nonce: randomToken(),
      expiresAt: Date.now() + this.ttlMs,
    };
    await this.pool.query(
      `INSERT INTO oauth_consent_browser_flows (state_hash, kind, cookie_binding, nonce, challenge, consent_session_id, expires_at) VALUES ($1,$2,$3,$4,$5,$6,to_timestamp($7 / 1000.0))`,
      [
        flow.stateHash,
        kind,
        flow.cookieBinding,
        flow.nonce,
        flow.challenge ?? null,
        flow.consentSessionId ?? null,
        flow.expiresAt,
      ],
    );
    return flow;
  }

  private async consumeFlow(kind: string, state: string, binding: string | undefined): Promise<BrowserFlow> {
    if (!state || !binding) throw badRequest(`${kind}_state_invalid`);
    const result = await this.pool.query(
      `DELETE FROM oauth_consent_browser_flows WHERE state_hash=$1 AND kind=$2 AND cookie_binding=$3 AND expires_at > now() RETURNING state_hash, cookie_binding, nonce, challenge, consent_session_id, extract(epoch from expires_at) * 1000 AS expires_at_ms`,
      [hashToken(state), kind, binding],
    );
    if (!result.rowCount) throw badRequest(`${kind}_state_invalid`);
    const row = result.rows[0];
    return {
      stateHash: row.state_hash,
      cookieBinding: row.cookie_binding,
      nonce: row.nonce,
      challenge: row.challenge ?? undefined,
      consentSessionId: row.consent_session_id ?? undefined,
      expiresAt: Number(row.expires_at_ms),
    };
  }

  async enqueueAudit(id: string, payload: unknown): Promise<void> {
    await this.pool.query(
      `INSERT INTO oauth_consent_audit_outbox (id, payload, next_attempt_at) VALUES ($1,$2,now()) ON CONFLICT (id) DO NOTHING`,
      [id, JSON.stringify(payload)],
    );
  }
  async claimAudits(limit: number): Promise<AuditOutboxItem[]> {
    const result = await this.pool.query(
      `WITH claimed AS (SELECT id FROM oauth_consent_audit_outbox WHERE delivered_at IS NULL AND next_attempt_at <= now() AND (locked_at IS NULL OR locked_at < now() - interval '1 minute') ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1) UPDATE oauth_consent_audit_outbox o SET locked_at=now(), attempts=attempts+1 FROM claimed WHERE o.id=claimed.id RETURNING o.id,o.payload,o.attempts`,
      [limit],
    );
    return result.rows;
  }
  async completeAudit(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE oauth_consent_audit_outbox SET delivered_at=now(), locked_at=NULL, last_error=NULL WHERE id=$1`,
      [id],
    );
  }
  async retryAudit(id: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE oauth_consent_audit_outbox SET locked_at=NULL, last_error=$2, next_attempt_at=now() + (least(300, power(2, least(attempts, 8))) * interval '1 second') WHERE id=$1`,
      [id, error.slice(0, 1000)],
    );
  }

  async prepareDecision(id: string, decision: 'approve' | 'deny', payload: unknown): Promise<ConsentSession> {
    const result = await this.pool.query(
      `UPDATE oauth_consent_sessions SET status='processing', decision=$2, decision_payload=$3, version=version+1
       WHERE id=$1 AND status = ANY($4::text[]) AND expires_at > now()
       RETURNING id, challenge, csrf, subject, hydra_client_id, context, status, selected_scopes, decision, decision_payload,
       extract(epoch from hydra_committed_at)*1000 AS hydra_committed_at_ms, extract(epoch from expires_at)*1000 AS expires_at_ms`,
      [id, decision, JSON.stringify(payload), ['shown', 'step_up_pending']],
    );
    if (!result.rowCount) throw conflict('consent_replay');
    return rowToConsent(result.rows[0]);
  }

  async finalizeDecision(id: string, payload: unknown): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE oauth_consent_sessions SET status=CASE decision WHEN 'approve' THEN 'approved' ELSE 'denied' END,
         hydra_committed_at=COALESCE(hydra_committed_at,now()), version=version+1
         WHERE id=$1 AND status='processing' AND decision IS NOT NULL RETURNING id`,
        [id],
      );
      if (!result.rowCount) throw conflict('consent_replay');
      await client.query(
        `INSERT INTO oauth_consent_audit_outbox (id,payload,next_attempt_at) VALUES ($1,$2,now()) ON CONFLICT (id) DO NOTHING`,
        [`${id}:final`, JSON.stringify(payload)],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async pendingDecisions(limit: number): Promise<ConsentSession[]> {
    const result = await this.pool.query(
      `SELECT id, challenge, csrf, subject, hydra_client_id, context, status, selected_scopes, decision, decision_payload,
       extract(epoch from hydra_committed_at)*1000 AS hydra_committed_at_ms, extract(epoch from expires_at)*1000 AS expires_at_ms
       FROM oauth_consent_sessions WHERE status='processing' AND decision IS NOT NULL AND expires_at > now() ORDER BY created_at LIMIT $1`,
      [limit],
    );
    return result.rows.map(rowToConsent);
  }
  async ready(): Promise<boolean> {
    await this.pool.query('SELECT 1');
    return true;
  }
  async cleanup(): Promise<void> {
    await this.pool.query(`DELETE FROM oauth_consent_browser_flows WHERE expires_at <= now()`);
    await this.pool.query(`DELETE FROM oauth_consent_sessions WHERE expires_at <= now()`);
    await this.pool.query(`DELETE FROM oauth_consent_audit_outbox WHERE delivered_at < now() - interval '30 days'`);
  }
}

function rowToConsent(row: Record<string, unknown>): ConsentSession {
  return {
    id: String(row.id),
    challenge: String(row.challenge),
    csrf: String(row.csrf),
    subject: String(row.subject),
    hydraClientId: String(row.hydra_client_id),
    context: row.context as ConsentContext,
    status: row.status as ConsentStatus,
    selectedScopes: (row.selected_scopes as string[] | null) ?? undefined,
    decision: row.decision === 'approve' || row.decision === 'deny' ? row.decision : undefined,
    decisionPayload: row.decision_payload ?? undefined,
    hydraCommittedAt: row.hydra_committed_at_ms ? Number(row.hydra_committed_at_ms) : undefined,
    expiresAt: Number(row.expires_at_ms),
  };
}
