import type { Pool, PoolClient } from 'pg';
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
  hydraRedirectTo?: string;
  expiresAt: number;
  createdAt: number;
}

export interface BrowserFlow {
  stateHash: string;
  state?: string;
  cookieBinding: string;
  nonce: string;
  expiresAt: number;
  challenge?: string;
  consentSessionId?: string;
}

export interface StepUpFlowClaim {
  flow: BrowserFlow;
  claimToken?: string;
  replacement?: BrowserFlow;
}

export interface AuditOutboxItem {
  id: string;
  payload: unknown;
  attempts: number;
}

export interface DecisionClaim {
  session: ConsentSession;
  claimToken: string;
}

type NewConsent = Omit<
  ConsentSession,
  | 'id'
  | 'csrf'
  | 'status'
  | 'expiresAt'
  | 'createdAt'
  | 'selectedScopes'
  | 'decision'
  | 'decisionPayload'
  | 'hydraCommittedAt'
  | 'hydraRedirectTo'
>;

export interface ConsentStateStore {
  createConsent(input: NewConsent): Promise<ConsentSession> | ConsentSession;
  getOrCreateShownConsent(
    input: NewConsent,
    audit: (session: ConsentSession) => unknown,
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
  claimStepUpFlow(
    state: string,
    cookieBinding: string | undefined,
    leaseMs: number,
  ): Promise<StepUpFlowClaim> | StepUpFlowClaim;
  recoverStepUpFlow(
    claim: StepUpFlowClaim,
  ): Promise<BrowserFlow & { state: string }> | (BrowserFlow & { state: string });
  completeStepUpFlow(claim: StepUpFlowClaim): Promise<void> | void;
  enqueueAudit(id: string, payload: unknown): Promise<void> | void;
  claimAudits(limit: number): Promise<AuditOutboxItem[]> | AuditOutboxItem[];
  completeAudit(id: string): Promise<void> | void;
  retryAudit(id: string, error: string): Promise<void> | void;
  prepareDecision(
    id: string,
    decision: 'approve' | 'deny',
    payload: unknown,
    leaseMs: number,
  ): Promise<DecisionClaim> | DecisionClaim;
  claimDecisions(limit: number, leaseMs: number): Promise<DecisionClaim[]> | DecisionClaim[];
  replaceClaimedDecision(
    claim: DecisionClaim,
    decision: 'approve' | 'deny',
    payload: unknown,
  ): Promise<DecisionClaim> | DecisionClaim;
  finalizeDecision(claim: DecisionClaim, redirectTo?: string): Promise<void> | void;
  retryDecision(claim: DecisionClaim, error: string): Promise<void> | void;
  ready(): Promise<boolean> | boolean;
  cleanup(): Promise<void> | void;
}

/** Process-local implementation for unit tests only. Production startup never constructs it. */
export class StateStore implements ConsentStateStore {
  private consent = new Map<string, ConsentSession>();
  private flows = new Map<
    string,
    BrowserFlow & { kind: string; claimToken?: string; leaseUntil?: number; supersededBy?: string }
  >();
  private outbox = new Map<string, AuditOutboxItem>();
  private decisions = new Map<
    string,
    { token?: string; leaseUntil?: number; nextAttemptAt: number; attempts: number }
  >();

  constructor(
    private ttlMs: number,
    private now: () => number = Date.now,
  ) {}

  createConsent(input: NewConsent): ConsentSession {
    if ([...this.consent.values()].some((value) => value.challenge === input.challenge))
      throw conflict('consent_challenge_active');
    const value = this.newConsent(input, 'created');
    this.consent.set(value.id, value);
    return value;
  }

  getOrCreateShownConsent(input: NewConsent, audit: (session: ConsentSession) => unknown): ConsentSession {
    const existing = [...this.consent.values()].find((value) => value.challenge === input.challenge);
    if (existing) {
      assertSameConsent(existing, input);
      if (existing.status !== 'shown') throw conflict('consent_replay');
      return existing;
    }
    const value = this.newConsent(input, 'shown');
    this.consent.set(value.id, value);
    this.enqueueAudit(`${value.id}:shown`, audit(value));
    return value;
  }

  private newConsent(input: NewConsent, status: ConsentStatus): ConsentSession {
    const createdAt = this.now();
    return {
      ...input,
      id: randomToken(),
      csrf: randomToken(),
      status,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
    };
  }

  getConsent(id: string): ConsentSession {
    const value = this.consent.get(id);
    if (!value || (value.expiresAt <= this.now() && value.status !== 'processing'))
      throw conflict('consent_session_missing');
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
    if (!['shown', 'step_up_pending'].includes(value.status)) throw conflict('consent_replay');
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
    if (!state || !binding) throw badRequest('login_state_invalid');
    const key = hashToken(state);
    const flow = this.flows.get(key);
    this.flows.delete(key);
    if (!flow || flow.kind !== 'login' || flow.cookieBinding !== binding || flow.expiresAt <= this.now())
      throw conflict('login_state_replay');
    return flow;
  }

  createStepUpFlow(consentSessionId: string) {
    return this.createFlow('step_up', { consentSessionId });
  }

  claimStepUpFlow(state: string, binding: string | undefined, leaseMs: number): StepUpFlowClaim {
    if (!state || !binding) throw badRequest('step_up_state_invalid');
    const flow = this.flows.get(hashToken(state));
    if (!flow || flow.kind !== 'step_up' || flow.cookieBinding !== binding || flow.expiresAt <= this.now())
      throw conflict('step_up_state_replay');
    if (flow.supersededBy) {
      const replacement = this.flows.get(flow.supersededBy);
      if (!replacement?.state) throw badRequest('step_up_state_invalid');
      return { flow, replacement };
    }
    if (flow.leaseUntil && flow.leaseUntil > this.now()) throw conflict('step_up_state_busy');
    flow.claimToken = randomToken();
    flow.leaseUntil = this.now() + leaseMs;
    return { flow, claimToken: flow.claimToken };
  }

  recoverStepUpFlow(claim: StepUpFlowClaim): BrowserFlow & { state: string } {
    if (!claim.claimToken) throw conflict('step_up_claim_invalid');
    const old = this.flows.get(claim.flow.stateHash);
    if (!old || old.claimToken !== claim.claimToken) throw conflict('step_up_claim_invalid');
    if (old.supersededBy) {
      const existing = this.flows.get(old.supersededBy);
      if (!existing?.state) throw conflict('step_up_claim_invalid');
      return existing as BrowserFlow & { state: string };
    }
    const replacement = this.createFlow('step_up', { consentSessionId: old.consentSessionId }, old.cookieBinding);
    old.supersededBy = replacement.stateHash;
    old.claimToken = undefined;
    old.leaseUntil = undefined;
    return replacement;
  }

  completeStepUpFlow(claim: StepUpFlowClaim): void {
    if (!claim.claimToken) throw conflict('step_up_claim_invalid');
    const flow = this.flows.get(claim.flow.stateHash);
    if (!flow || flow.claimToken !== claim.claimToken) throw conflict('step_up_claim_invalid');
    this.flows.delete(flow.stateHash);
    for (const [key, candidate] of this.flows) if (candidate.supersededBy === flow.stateHash) this.flows.delete(key);
  }

  private createFlow(
    kind: string,
    input: Pick<BrowserFlow, 'challenge'> | Pick<BrowserFlow, 'consentSessionId'>,
    cookieBinding = randomToken(),
  ) {
    const state = randomToken();
    const flow = {
      ...input,
      state,
      stateHash: hashToken(state),
      cookieBinding,
      nonce: randomToken(),
      expiresAt: this.now() + this.ttlMs,
      kind,
    };
    this.flows.set(flow.stateHash, flow);
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

  prepareDecision(id: string, decision: 'approve' | 'deny', payload: unknown, leaseMs: number): DecisionClaim {
    const value = this.transition(id, ['shown', 'step_up_pending'], 'processing');
    value.decision = decision;
    value.decisionPayload = payload;
    const claimToken = randomToken();
    this.decisions.set(id, {
      token: claimToken,
      leaseUntil: this.now() + leaseMs,
      nextAttemptAt: this.now(),
      attempts: 1,
    });
    return { session: value, claimToken };
  }

  claimDecisions(limit: number, leaseMs: number): DecisionClaim[] {
    const claims: DecisionClaim[] = [];
    for (const session of this.consent.values()) {
      if (claims.length >= limit || session.status !== 'processing' || !session.decision) continue;
      const meta = this.decisions.get(session.id) ?? { nextAttemptAt: 0, attempts: 0 };
      if ((meta.leaseUntil ?? 0) > this.now() || meta.nextAttemptAt > this.now()) continue;
      const claimToken = randomToken();
      this.decisions.set(session.id, {
        ...meta,
        token: claimToken,
        leaseUntil: this.now() + leaseMs,
        attempts: meta.attempts + 1,
      });
      claims.push({ session, claimToken });
    }
    return claims;
  }

  replaceClaimedDecision(claim: DecisionClaim, decision: 'approve' | 'deny', payload: unknown): DecisionClaim {
    this.assertDecisionClaim(claim);
    claim.session.decision = decision;
    claim.session.decisionPayload = payload;
    return claim;
  }

  finalizeDecision(claim: DecisionClaim, redirectTo?: string): void {
    this.assertDecisionClaim(claim);
    const value = claim.session;
    value.status = value.decision === 'approve' ? 'approved' : 'denied';
    value.hydraCommittedAt = this.now();
    value.hydraRedirectTo = redirectTo;
    this.enqueueAudit(`${value.id}:final`, value.decisionPayload);
    this.decisions.delete(value.id);
  }

  retryDecision(claim: DecisionClaim, _error: string): void {
    this.assertDecisionClaim(claim);
    const meta = this.decisions.get(claim.session.id)!;
    meta.token = undefined;
    meta.leaseUntil = undefined;
    meta.nextAttemptAt = this.now();
  }

  private assertDecisionClaim(claim: DecisionClaim): void {
    if (this.decisions.get(claim.session.id)?.token !== claim.claimToken) throw conflict('decision_claim_invalid');
  }

  ready(): boolean {
    return true;
  }

  cleanup(): void {
    for (const [id, value] of this.consent)
      if (value.expiresAt <= this.now() && value.status !== 'processing') this.consent.delete(id);
    for (const [id, value] of this.flows) if (value.expiresAt <= this.now()) this.flows.delete(id);
  }
}

export class PostgresStateStore implements ConsentStateStore {
  constructor(
    private readonly pool: Pool,
    private readonly ttlMs: number,
  ) {}

  async createConsent(input: NewConsent): Promise<ConsentSession> {
    const session = newConsent(input, this.ttlMs, 'created');
    try {
      await this.insertConsent(this.pool, session);
      return session;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw conflict('consent_challenge_active');
      throw error;
    }
  }

  async getOrCreateShownConsent(
    input: NewConsent,
    audit: (session: ConsentSession) => unknown,
  ): Promise<ConsentSession> {
    const candidate = newConsent(input, this.ttlMs, 'shown');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await this.insertConsent(client, candidate, true);
      if (inserted) {
        await insertAudit(client, `${candidate.id}:shown`, audit(candidate));
        await client.query('COMMIT');
        return candidate;
      }
      const result = await client.query(`${CONSENT_SELECT} WHERE challenge=$1 FOR UPDATE`, [input.challenge]);
      if (!result.rowCount) throw conflict('consent_challenge_active');
      const existing = rowToConsent(result.rows[0]);
      assertSameConsent(existing, input);
      if (existing.status !== 'shown') throw conflict('consent_replay');
      await client.query('COMMIT');
      return existing;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async insertConsent(
    client: Pick<Pool, 'query'> | PoolClient,
    session: ConsentSession,
    ignoreConflict = false,
  ) {
    const result = await client.query(
      `INSERT INTO oauth_consent_sessions
       (id, challenge, csrf, subject, hydra_client_id, context, status, expires_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8 / 1000.0),to_timestamp($9 / 1000.0))
       ${ignoreConflict ? 'ON CONFLICT DO NOTHING' : ''} RETURNING id`,
      [
        session.id,
        session.challenge,
        session.csrf,
        session.subject,
        session.hydraClientId,
        JSON.stringify(session.context),
        session.status,
        session.expiresAt,
        session.createdAt,
      ],
    );
    return Boolean(result.rowCount);
  }

  async getConsent(id: string): Promise<ConsentSession> {
    const result = await this.pool.query(
      `${CONSENT_SELECT} WHERE id=$1 AND (expires_at > now() OR status='processing')`,
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
      `UPDATE oauth_consent_sessions SET status=$2, version=version+1
       WHERE id=$1 AND status = ANY($3::text[]) AND expires_at > now() RETURNING ${CONSENT_COLUMNS}`,
      [id, next, allowed],
    );
    if (!result.rowCount) throw conflict('consent_replay');
    return rowToConsent(result.rows[0]);
  }

  async setSelectedScopes(id: string, scopes: string[]): Promise<ConsentSession> {
    const result = await this.pool.query(
      `UPDATE oauth_consent_sessions SET selected_scopes=$2, version=version+1
       WHERE id=$1 AND status = ANY($3::text[]) AND expires_at > now() RETURNING ${CONSENT_COLUMNS}`,
      [id, JSON.stringify(scopes), ['shown', 'step_up_pending']],
    );
    if (!result.rowCount) throw conflict('consent_replay');
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
    if (!state || !binding) throw badRequest('login_state_invalid');
    const result = await this.pool.query(
      `DELETE FROM oauth_consent_browser_flows
       WHERE state_hash=$1 AND kind='login' AND cookie_binding=$2 AND expires_at > now()
       RETURNING ${FLOW_COLUMNS}`,
      [hashToken(state), binding],
    );
    if (!result.rowCount) throw conflict('login_state_replay');
    return rowToFlow(result.rows[0]);
  }

  async createStepUpFlow(consentSessionId: string) {
    return this.createFlow('step_up', { consentSessionId });
  }

  private async createFlow(
    kind: string,
    input: Pick<BrowserFlow, 'challenge'> | Pick<BrowserFlow, 'consentSessionId'>,
    cookieBinding = randomToken(),
    client: Pick<Pool, 'query'> | PoolClient = this.pool,
  ): Promise<BrowserFlow & { state: string }> {
    const state = randomToken();
    const flow: BrowserFlow & { state: string } = {
      ...input,
      state,
      stateHash: hashToken(state),
      cookieBinding,
      nonce: randomToken(),
      expiresAt: Date.now() + this.ttlMs,
    };
    await client.query(
      `INSERT INTO oauth_consent_browser_flows
       (state_hash, state_value, kind, cookie_binding, nonce, challenge, consent_session_id, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8 / 1000.0))`,
      [
        flow.stateHash,
        flow.state,
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

  async claimStepUpFlow(state: string, binding: string | undefined, leaseMs: number): Promise<StepUpFlowClaim> {
    if (!state || !binding) throw badRequest('step_up_state_invalid');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT ${FLOW_COLUMNS}, claim_token, extract(epoch from lease_until)*1000 AS lease_until_ms, superseded_by
         FROM oauth_consent_browser_flows
         WHERE state_hash=$1 AND kind='step_up' AND cookie_binding=$2 AND expires_at > now() FOR UPDATE`,
        [hashToken(state), binding],
      );
      if (!result.rowCount) throw conflict('step_up_state_replay');
      const row = result.rows[0];
      const flow = rowToFlow(row);
      if (row.superseded_by) {
        const replacement = await client.query(
          `SELECT ${FLOW_COLUMNS} FROM oauth_consent_browser_flows
           WHERE state_hash=$1 AND kind='step_up' AND cookie_binding=$2 AND expires_at > now()`,
          [row.superseded_by, binding],
        );
        if (!replacement.rowCount) throw badRequest('step_up_state_invalid');
        await client.query('COMMIT');
        return { flow, replacement: rowToFlow(replacement.rows[0]) };
      }
      if (row.lease_until_ms && Number(row.lease_until_ms) > Date.now()) throw conflict('step_up_state_busy');
      const claimToken = randomToken();
      await client.query(
        `UPDATE oauth_consent_browser_flows SET claim_token=$2, lease_until=now() + ($3::int * interval '1 millisecond')
         WHERE state_hash=$1`,
        [flow.stateHash, claimToken, leaseMs],
      );
      await client.query('COMMIT');
      return { flow, claimToken };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async recoverStepUpFlow(claim: StepUpFlowClaim): Promise<BrowserFlow & { state: string }> {
    if (!claim.claimToken) throw conflict('step_up_claim_invalid');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT ${FLOW_COLUMNS}, superseded_by FROM oauth_consent_browser_flows
         WHERE state_hash=$1 AND claim_token=$2 AND expires_at > now() FOR UPDATE`,
        [claim.flow.stateHash, claim.claimToken],
      );
      if (!result.rowCount) throw conflict('step_up_claim_invalid');
      const old = rowToFlow(result.rows[0]);
      if (result.rows[0].superseded_by) {
        const existing = await client.query(
          `SELECT ${FLOW_COLUMNS} FROM oauth_consent_browser_flows WHERE state_hash=$1`,
          [result.rows[0].superseded_by],
        );
        if (!existing.rowCount) throw conflict('step_up_claim_invalid');
        await client.query('COMMIT');
        return requireState(rowToFlow(existing.rows[0]));
      }
      const replacement = await this.createFlow(
        'step_up',
        { consentSessionId: old.consentSessionId },
        old.cookieBinding,
        client,
      );
      await client.query(
        `UPDATE oauth_consent_browser_flows SET superseded_by=$2, claim_token=NULL, lease_until=NULL WHERE state_hash=$1`,
        [old.stateHash, replacement.stateHash],
      );
      await client.query('COMMIT');
      return replacement;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async completeStepUpFlow(claim: StepUpFlowClaim): Promise<void> {
    if (!claim.claimToken) throw conflict('step_up_claim_invalid');
    const result = await this.pool.query(
      `WITH completed AS (
         DELETE FROM oauth_consent_browser_flows WHERE state_hash=$1 AND claim_token=$2 RETURNING state_hash
       )
       DELETE FROM oauth_consent_browser_flows WHERE superseded_by IN (SELECT state_hash FROM completed)
       RETURNING state_hash`,
      [claim.flow.stateHash, claim.claimToken],
    );
    if (!result.rowCount) {
      const current = await this.pool.query('SELECT 1 FROM oauth_consent_browser_flows WHERE state_hash=$1', [
        claim.flow.stateHash,
      ]);
      if (current.rowCount) throw conflict('step_up_claim_invalid');
    }
  }

  async enqueueAudit(id: string, payload: unknown): Promise<void> {
    await insertAudit(this.pool, id, payload);
  }

  async claimAudits(limit: number): Promise<AuditOutboxItem[]> {
    const result = await this.pool.query(
      `WITH claimed AS (
         SELECT id FROM oauth_consent_audit_outbox
         WHERE delivered_at IS NULL AND next_attempt_at <= now()
           AND (locked_at IS NULL OR locked_at < now() - interval '1 minute')
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1
       )
       UPDATE oauth_consent_audit_outbox o SET locked_at=now(), attempts=attempts+1
       FROM claimed WHERE o.id=claimed.id RETURNING o.id,o.payload,o.attempts`,
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
      `UPDATE oauth_consent_audit_outbox
       SET locked_at=NULL, last_error=$2,
           next_attempt_at=now() + (least(300, power(2, least(attempts, 8))) * interval '1 second')
       WHERE id=$1 AND delivered_at IS NULL`,
      [id, error.slice(0, 1000)],
    );
  }

  async prepareDecision(
    id: string,
    decision: 'approve' | 'deny',
    payload: unknown,
    leaseMs: number,
  ): Promise<DecisionClaim> {
    const claimToken = randomToken();
    const result = await this.pool.query(
      `UPDATE oauth_consent_sessions
       SET status='processing', decision=$2, decision_payload=$3, decision_claim_token=$4,
           decision_lease_until=now() + ($5::int * interval '1 millisecond'), decision_attempts=decision_attempts+1,
           decision_next_attempt_at=now(), decision_last_error=NULL, version=version+1
       WHERE id=$1 AND status = ANY($6::text[]) AND expires_at > now()
       RETURNING ${CONSENT_COLUMNS}`,
      [id, decision, JSON.stringify(payload), claimToken, leaseMs, ['shown', 'step_up_pending']],
    );
    if (!result.rowCount) throw conflict('consent_replay');
    return { session: rowToConsent(result.rows[0]), claimToken };
  }

  async claimDecisions(limit: number, leaseMs: number): Promise<DecisionClaim[]> {
    const claimToken = randomToken();
    const result = await this.pool.query(
      `WITH claimed AS (
         SELECT id FROM oauth_consent_sessions
         WHERE status='processing' AND decision IS NOT NULL AND decision_next_attempt_at <= now()
           AND (decision_lease_until IS NULL OR decision_lease_until <= now())
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1
       )
       UPDATE oauth_consent_sessions s
       SET decision_claim_token=$2, decision_lease_until=now() + ($3::int * interval '1 millisecond'),
           decision_attempts=decision_attempts+1, version=version+1
       FROM claimed WHERE s.id=claimed.id RETURNING ${prefixedConsentColumns('s')}`,
      [limit, claimToken, leaseMs],
    );
    return result.rows.map((row) => ({ session: rowToConsent(row), claimToken }));
  }

  async replaceClaimedDecision(
    claim: DecisionClaim,
    decision: 'approve' | 'deny',
    payload: unknown,
  ): Promise<DecisionClaim> {
    const result = await this.pool.query(
      `UPDATE oauth_consent_sessions SET decision=$3, decision_payload=$4, version=version+1
       WHERE id=$1 AND status='processing' AND decision_claim_token=$2 RETURNING ${CONSENT_COLUMNS}`,
      [claim.session.id, claim.claimToken, decision, JSON.stringify(payload)],
    );
    if (!result.rowCount) throw conflict('decision_claim_invalid');
    return { session: rowToConsent(result.rows[0]), claimToken: claim.claimToken };
  }

  async finalizeDecision(claim: DecisionClaim, redirectTo?: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE oauth_consent_sessions
         SET status=CASE decision WHEN 'approve' THEN 'approved' ELSE 'denied' END,
             hydra_committed_at=COALESCE(hydra_committed_at,now()), hydra_redirect_to=COALESCE($3,hydra_redirect_to),
             decision_claim_token=NULL, decision_lease_until=NULL, decision_last_error=NULL, version=version+1
         WHERE id=$1 AND status='processing' AND decision IS NOT NULL AND decision_claim_token=$2
         RETURNING id, decision_payload`,
        [claim.session.id, claim.claimToken, redirectTo ?? null],
      );
      if (!result.rowCount) throw conflict('decision_claim_invalid');
      await insertAudit(client, `${claim.session.id}:final`, result.rows[0].decision_payload);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async retryDecision(claim: DecisionClaim, error: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE oauth_consent_sessions
       SET decision_claim_token=NULL, decision_lease_until=NULL, decision_last_error=$3,
           decision_next_attempt_at=now() + (least(60, power(2, least(decision_attempts, 6))) * interval '1 second'),
           version=version+1
       WHERE id=$1 AND status='processing' AND decision_claim_token=$2`,
      [claim.session.id, claim.claimToken, error.slice(0, 1000)],
    );
    if (!result.rowCount) throw conflict('decision_claim_invalid');
  }

  async ready(): Promise<boolean> {
    await this.pool.query('SELECT 1');
    return true;
  }

  async cleanup(): Promise<void> {
    await this.pool.query(`DELETE FROM oauth_consent_browser_flows WHERE expires_at <= now()`);
    await this.pool.query(`DELETE FROM oauth_consent_sessions WHERE expires_at <= now() AND status <> 'processing'`);
    await this.pool.query(`DELETE FROM oauth_consent_audit_outbox WHERE delivered_at < now() - interval '30 days'`);
  }
}

const CONSENT_COLUMNS = `id, challenge, csrf, subject, hydra_client_id, context, status, selected_scopes, decision,
 decision_payload, extract(epoch from hydra_committed_at)*1000 AS hydra_committed_at_ms, hydra_redirect_to,
 extract(epoch from expires_at)*1000 AS expires_at_ms, extract(epoch from created_at)*1000 AS created_at_ms`;
const CONSENT_SELECT = `SELECT ${CONSENT_COLUMNS} FROM oauth_consent_sessions`;
const FLOW_COLUMNS = `state_hash, state_value, cookie_binding, nonce, challenge, consent_session_id,
 extract(epoch from expires_at)*1000 AS expires_at_ms`;

function prefixedConsentColumns(prefix: string): string {
  return `
    ${prefix}.id, ${prefix}.challenge, ${prefix}.csrf, ${prefix}.subject, ${prefix}.hydra_client_id,
    ${prefix}.context, ${prefix}.status, ${prefix}.selected_scopes, ${prefix}.decision, ${prefix}.decision_payload,
    extract(epoch from ${prefix}.hydra_committed_at)*1000 AS hydra_committed_at_ms, ${prefix}.hydra_redirect_to,
    extract(epoch from ${prefix}.expires_at)*1000 AS expires_at_ms,
    extract(epoch from ${prefix}.created_at)*1000 AS created_at_ms`;
}

function newConsent(input: NewConsent, ttlMs: number, status: ConsentStatus): ConsentSession {
  const createdAt = Date.now();
  return {
    ...input,
    id: randomToken(),
    csrf: randomToken(),
    status,
    createdAt,
    expiresAt: createdAt + ttlMs,
  };
}

async function insertAudit(client: Pick<Pool, 'query'> | PoolClient, id: string, payload: unknown): Promise<void> {
  await client.query(
    `INSERT INTO oauth_consent_audit_outbox (id, payload, next_attempt_at) VALUES ($1,$2,now()) ON CONFLICT (id) DO NOTHING`,
    [id, JSON.stringify(payload)],
  );
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
    hydraRedirectTo: row.hydra_redirect_to ? String(row.hydra_redirect_to) : undefined,
    expiresAt: Number(row.expires_at_ms),
    createdAt: Number(row.created_at_ms),
  };
}

function rowToFlow(row: Record<string, unknown>): BrowserFlow {
  return {
    stateHash: String(row.state_hash),
    state: row.state_value ? String(row.state_value) : undefined,
    cookieBinding: String(row.cookie_binding),
    nonce: String(row.nonce),
    challenge: row.challenge ? String(row.challenge) : undefined,
    consentSessionId: row.consent_session_id ? String(row.consent_session_id) : undefined,
    expiresAt: Number(row.expires_at_ms),
  };
}

function requireState(flow: BrowserFlow): BrowserFlow & { state: string } {
  if (!flow.state) throw conflict('step_up_recovery_unavailable');
  return flow as BrowserFlow & { state: string };
}

function assertSameConsent(existing: ConsentSession, input: NewConsent): void {
  if (
    existing.challenge !== input.challenge ||
    existing.subject !== input.subject ||
    existing.hydraClientId !== input.hydraClientId ||
    stableJson(consentSecurityContext(existing.context)) !== stableJson(consentSecurityContext(input.context))
  ) {
    throw conflict('consent_challenge_context_mismatch');
  }
}

function consentSecurityContext(context: ConsentContext): unknown {
  return {
    subject: context.subject,
    clientId: context.client.id,
    connectorId: context.connector.id,
    audience: context.connector.audience,
    scopes: context.scopes
      .map(({ name, tier, required, requires_step_up }) => ({ name, tier, required, requires_step_up }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    entitlement: context.entitlement,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
