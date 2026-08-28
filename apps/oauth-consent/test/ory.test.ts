import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OryAdmin, type ConsentDecisionBinding } from '../src/ory.js';

const binding: ConsentDecisionBinding = {
  challenge: 'challenge_proof',
  subject: 'user_test',
  clientId: 'desktop',
  requestedAudience: ['mcp:canvas'],
  requestedScopes: ['offline_access', 'canvas:read'],
  decision: 'approve',
  grantedAudience: ['mcp:canvas'],
  grantedScopes: ['offline_access', 'canvas:read'],
};

function consentSession(overrides: Record<string, unknown> = {}) {
  return {
    consent_request_id: 'request_proof',
    handled_at: '2026-08-28T03:00:00Z',
    consent_request: {
      skip: false,
      challenge: binding.challenge,
      subject: binding.subject,
      client: { client_id: binding.clientId },
      requested_access_token_audience: binding.requestedAudience,
      requested_scope: binding.requestedScopes,
    },
    grant_access_token_audience: binding.grantedAudience,
    grant_scope: binding.grantedScopes,
    ...overrides,
  };
}

describe('Hydra authoritative consent outcome proof', () => {
  let server: Server;
  let baseUrl: string;
  let sessions: unknown[];
  let requestStatus: 404 | 409 | 410;
  let terminalRedirect: string;

  beforeEach(async () => {
    sessions = [];
    requestStatus = 410;
    terminalRedirect = 'http://desktop.test/callback?code=authorization-code';
    const app = express();
    app.get('/admin/oauth2/auth/requests/consent', (_req, res) => {
      if (requestStatus === 410) return res.status(410).json({ redirect_to: terminalRedirect });
      return res.status(requestStatus).json({ error: 'terminal' });
    });
    app.get('/admin/oauth2/auth/sessions/consent', (_req, res) => res.json(sessions));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('accepts a lost-response commit only when Hydra returns an exact challenge and grant binding', async () => {
    sessions = [consentSession()];
    const probe = await new OryAdmin(baseUrl, 2_000).probeConsentDecision(binding);
    expect(probe).toEqual({
      state: 'committed',
      proof: expect.objectContaining({
        outcome: 'accepted',
        source: 'consent_session',
        challenge: binding.challenge,
        subject: binding.subject,
        clientId: binding.clientId,
        requestedAudience: binding.requestedAudience,
        requestedScopes: binding.requestedScopes,
        grantedAudience: binding.grantedAudience,
        grantedScopes: binding.grantedScopes,
        consentRequestId: 'request_proof',
      }),
    });
  });

  it.each([404, 409, 410] as const)(
    'returns indeterminate for terminal status %s when no authoritative outcome proof exists',
    async (status) => {
      requestStatus = status;
      const probe = await new OryAdmin(baseUrl, 2_000).probeConsentDecision(binding);
      expect(probe).toEqual({ state: 'indeterminate', reason: 'hydra_terminal_outcome_unproven' });
    },
  );

  it('accepts an authoritative access_denied terminal redirect only for the matching denial intent', async () => {
    terminalRedirect = 'http://desktop.test/callback?error=access_denied';
    const denial = { ...binding, decision: 'deny' as const, grantedAudience: [], grantedScopes: [] };
    const probe = await new OryAdmin(baseUrl, 2_000).probeConsentDecision(denial);
    expect(probe).toEqual({
      state: 'committed',
      proof: expect.objectContaining({
        outcome: 'rejected',
        source: 'terminal_redirect',
        challenge: binding.challenge,
        subject: binding.subject,
        clientId: binding.clientId,
        requestedAudience: binding.requestedAudience,
        requestedScopes: binding.requestedScopes,
      }),
    });
  });

  it('returns indeterminate when Hydra exposes the challenge with mismatched subject, client, audience, or scopes', async () => {
    sessions = [
      consentSession({
        consent_request: {
          skip: false,
          challenge: binding.challenge,
          subject: 'other_user',
          client: { client_id: binding.clientId },
          requested_access_token_audience: binding.requestedAudience,
          requested_scope: binding.requestedScopes,
        },
      }),
    ];
    const probe = await new OryAdmin(baseUrl, 2_000).probeConsentDecision(binding);
    expect(probe).toEqual({ state: 'indeterminate', reason: 'hydra_accepted_session_binding_mismatch' });
  });
});
