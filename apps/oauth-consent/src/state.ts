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
  expiresAt: number;
}

interface BrowserFlow {
  stateHash: string;
  cookieBinding: string;
  nonce: string;
  expiresAt: number;
  challenge?: string;
  consentSessionId?: string;
}

export class StateStore {
  private readonly consent = new Map<string, ConsentSession>();
  private readonly consentByChallenge = new Map<string, string>();
  private readonly loginFlows = new Map<string, BrowserFlow>();
  private readonly stepUpFlows = new Map<string, BrowserFlow>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  createConsent(input: Omit<ConsentSession, 'id' | 'csrf' | 'status' | 'expiresAt'>): ConsentSession {
    this.purge();
    const previousId = this.consentByChallenge.get(input.challenge);
    if (previousId) {
      const previous = this.consent.get(previousId);
      if (previous && !['approved', 'denied', 'failed'].includes(previous.status)) previous.status = 'failed';
    }
    const session: ConsentSession = {
      ...input,
      id: randomToken(),
      csrf: randomToken(),
      status: 'created',
      expiresAt: this.now() + this.ttlMs,
    };
    this.consent.set(session.id, session);
    this.consentByChallenge.set(session.challenge, session.id);
    return session;
  }

  getConsent(id: string): ConsentSession {
    this.purge();
    const session = this.consent.get(id);
    if (!session) throw conflict('consent_session_missing');
    return session;
  }

  transition(id: string, expected: ConsentStatus | ConsentStatus[], next: ConsentStatus): ConsentSession {
    const session = this.getConsent(id);
    const allowed = Array.isArray(expected) ? expected : [expected];
    if (!allowed.includes(session.status)) throw conflict('consent_replay');
    session.status = next;
    return session;
  }

  setSelectedScopes(id: string, scopes: string[]): ConsentSession {
    const session = this.getConsent(id);
    session.selectedScopes = [...scopes];
    return session;
  }

  failConsent(id: string): void {
    const session = this.consent.get(id);
    if (session && !['approved', 'denied'].includes(session.status)) session.status = 'failed';
  }

  createLoginFlow(challenge: string): BrowserFlow & { state: string } {
    const flow = this.createBrowserFlow({ challenge });
    this.loginFlows.set(flow.stateHash, flow);
    return flow;
  }

  consumeLoginFlow(state: string, cookieBinding: string | undefined): BrowserFlow {
    return this.consumeBrowserFlow(this.loginFlows, state, cookieBinding, 'login');
  }

  createStepUpFlow(consentSessionId: string): BrowserFlow & { state: string } {
    const flow = this.createBrowserFlow({ consentSessionId });
    this.stepUpFlows.set(flow.stateHash, flow);
    return flow;
  }

  consumeStepUpFlow(state: string, cookieBinding: string | undefined): BrowserFlow {
    return this.consumeBrowserFlow(this.stepUpFlows, state, cookieBinding, 'step_up');
  }

  private createBrowserFlow(
    input: Pick<BrowserFlow, 'challenge'> | Pick<BrowserFlow, 'consentSessionId'>,
  ): BrowserFlow & { state: string } {
    this.purge();
    const state = randomToken();
    return {
      ...input,
      state,
      stateHash: hashToken(state),
      cookieBinding: randomToken(),
      nonce: randomToken(),
      expiresAt: this.now() + this.ttlMs,
    };
  }

  private consumeBrowserFlow(
    flows: Map<string, BrowserFlow>,
    state: string,
    cookieBinding: string | undefined,
    kind: string,
  ): BrowserFlow {
    this.purge();
    if (!state || !cookieBinding) throw badRequest(`${kind}_state_invalid`);
    const key = hashToken(state);
    const flow = flows.get(key);
    flows.delete(key);
    if (!flow || flow.cookieBinding !== cookieBinding) throw conflict(`${kind}_state_replay`);
    return flow;
  }

  private purge(): void {
    const now = this.now();
    for (const [id, session] of this.consent) {
      if (session.expiresAt <= now) {
        session.status = 'failed';
        this.consent.delete(id);
        if (this.consentByChallenge.get(session.challenge) === id) this.consentByChallenge.delete(session.challenge);
      }
    }
    for (const flows of [this.loginFlows, this.stepUpFlows]) {
      for (const [key, flow] of flows) if (flow.expiresAt <= now) flows.delete(key);
    }
  }
}
