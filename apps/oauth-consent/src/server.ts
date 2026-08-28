import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Config } from './config.js';
import { safeEqual, signValue, verifySignedValue } from './crypto.js';
import { AppError, badRequest } from './errors.js';
import { consentPage, entitlementDeniedPage, errorPage } from './html.js';
import { OryAdmin, type ConsentDecisionBinding, type ConsentDecisionProbe, type HydraOutcomeProof } from './ory.js';
import { RowboatHooks, type AuditRequest, type ConsentContext } from './rowboat.js';
import { DrainState } from './shutdown.js';
import type { ConsentStateStore, ConsentSession, DecisionClaim, StepUpFlowClaim } from './state.js';
import { WorkOS } from './workos.js';

const LOGIN_COOKIE = 'rowboat_login';
const CONSENT_COOKIE = 'rowboat_consent';
const STEP_UP_COOKIE = 'rowboat_stepup';

const ChallengeSchema = z.string().min(1).max(2048);
const DecisionSchema = z.enum(['approve', 'deny']);

interface Dependencies {
  ory?: OryAdmin;
  workos?: WorkOS;
  hooks?: RowboatHooks;
  store?: ConsentStateStore;
  drain?: DrainState;
}

export function buildApp(cfg: Config, dependencies: Dependencies = {}): Express {
  const app = express();
  const ory = dependencies.ory ?? new OryAdmin(cfg.ory.adminUrl, cfg.upstreamTimeoutMs);
  const workos = dependencies.workos ?? new WorkOS(cfg.workos, cfg.upstreamTimeoutMs);
  const hooks = dependencies.hooks ?? new RowboatHooks(cfg.rowboatApi, cfg.upstreamTimeoutMs);
  const store = dependencies.store;
  if (!store) throw new Error('shared_state_store_required');
  const drain = dependencies.drain ?? new DrainState();
  const cookieOptions = {
    httpOnly: true,
    secure: cfg.cookieSecure,
    sameSite: 'lax' as const,
    maxAge: cfg.sessionTtlMs,
    path: '/',
  };

  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader(
      'content-security-policy',
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-content-type-options', 'nosniff');
    next();
  });

  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.post('/drainz', (req, res) => {
    if (!isLoopback(req.socket.remoteAddress)) return res.status(404).json({ error: 'not_found' });
    const started = drain.begin();
    return res.status(started ? 202 : 200).json({ status: 'draining' });
  });
  app.get('/readyz', async (_req, res) => {
    if (drain.isDraining()) return res.status(503).json({ status: 'draining' });
    try {
      await store.ready();
      if (drain.isDraining()) return res.status(503).json({ status: 'draining' });
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  app.use((_req, res, next) => {
    if (!drain.isDraining()) return next();
    res.setHeader('connection', 'close');
    res.setHeader('retry-after', '5');
    return res.status(503).json({ error: 'service_draining' });
  });
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));

  app.get(
    '/login',
    asyncRoute(async (req, res) => {
      const challenge = parseChallenge(req.query.login_challenge, 'login_challenge');
      const login = await ory.getLoginRequest(challenge);
      if (login.challenge !== challenge) throw badRequest('login_challenge_mismatch');
      if (login.skip) {
        if (!login.subject) throw badRequest('login_subject_missing');
        const { redirect_to } = await ory.acceptLogin(challenge, login.subject);
        return res.redirect(redirect_to);
      }
      const flow = await store.createLoginFlow(challenge);
      setSignedCookie(res, LOGIN_COOKIE, flow.cookieBinding, cfg.cookieSecret, cookieOptions);
      return res.redirect(await workos.authorizeLoginURL(flow.state, flow.nonce));
    }),
  );

  app.get(
    '/callback',
    asyncRoute(async (req, res) => {
      const code = ChallengeSchema.parse(req.query.code);
      const state = ChallengeSchema.parse(req.query.state);
      const binding = readSignedCookie(req, LOGIN_COOKIE, cfg.cookieSecret);
      let claim = await store.claimLoginFlow(state, binding, cfg.decisionLeaseMs);
      if (claim.flow.completedAt) {
        res.clearCookie(LOGIN_COOKIE, { ...cookieOptions, maxAge: undefined });
        return claim.flow.upstreamRedirectTo
          ? res.redirect(claim.flow.upstreamRedirectTo)
          : res.status(200).type('html').send(completedPage('Sign-in is complete. You may return to the application.'));
      }
      if (!claim.flow.challenge) throw badRequest('login_flow_invalid');
      const loginChallenge = claim.flow.challenge;
      try {
        if (!claim.flow.loginSubject) {
          const identity = await workos.exchangeLogin(code, claim.flow.nonce);
          claim = await store.recordLoginIdentity(claim, identity.workosUserId);
        }
        if (claim.flow.upstreamPhase === 'hydra_pending' && !(await ory.loginRequestPending(loginChallenge))) {
          await store.finalizeLoginFlow(claim);
          res.clearCookie(LOGIN_COOKIE, { ...cookieOptions, maxAge: undefined });
          return res
            .status(200)
            .type('html')
            .send(completedPage('Sign-in is complete. You may return to the application.'));
        }
        claim = await store.markLoginHydraPending(claim);
        const { redirect_to } = await ory.acceptLogin(loginChallenge, claim.flow.loginSubject!);
        await store.finalizeLoginFlow(claim, redirect_to);
        res.clearCookie(LOGIN_COOKIE, { ...cookieOptions, maxAge: undefined });
        return res.redirect(redirect_to);
      } catch (error) {
        if (claim.flow.upstreamPhase === 'hydra_pending') {
          try {
            if (!(await ory.loginRequestPending(loginChallenge))) {
              await store.finalizeLoginFlow(claim);
              res.clearCookie(LOGIN_COOKIE, { ...cookieOptions, maxAge: undefined });
              return res
                .status(200)
                .type('html')
                .send(completedPage('Sign-in is complete. You may return to the application.'));
            }
          } catch (probeError) {
            await store.retryLoginFlow(claim, errorMessage(probeError));
            throw probeError;
          }
        }
        await store.retryLoginFlow(claim, errorMessage(error));
        throw error;
      }
    }),
  );

  app.get(
    '/consent',
    asyncRoute(async (req, res) => {
      const challenge = parseChallenge(req.query.consent_challenge, 'consent_challenge');
      const consent = await ory.getConsentRequest(challenge);
      if (consent.challenge !== challenge || !consent.subject) throw badRequest('consent_identity_missing');
      const hydraClientId = consent.client?.client_id;
      if (!hydraClientId) throw badRequest('consent_client_missing');
      const requestedProductScopes = consent.requested_scope.filter((scope) => scope !== 'offline_access');
      const context = await hooks.context({
        challenge,
        workosUserId: consent.subject,
        hydraClientId,
        requestedAudience: consent.requested_access_token_audience,
        requestedScopes: requestedProductScopes,
      });
      validateContext(
        context,
        consent.subject,
        hydraClientId,
        consent.requested_access_token_audience,
        requestedProductScopes,
      );
      const session = await store.getOrCreateShownConsent(
        {
          challenge,
          subject: consent.subject,
          hydraClientId,
          hydraRequestedAudience: consent.requested_access_token_audience,
          hydraRequestedScopes: consent.requested_scope,
          context,
        },
        (created) =>
          ({
            event: 'consent.shown',
            eventId: `${created.id}:shown`,
            occurredAt: new Date(created.createdAt).toISOString(),
            sessionId: created.id,
            context: created.context,
            scopes: created.context.scopes.map((scope) => scope.name),
            result: created.context.entitlement.allowed ? 'eligible' : created.context.entitlement.reason,
          }) satisfies AuditRequest,
      );
      await drainAuditOutbox(store, hooks);
      setSignedCookie(res, CONSENT_COOKIE, session.id, cfg.cookieSecret, cookieOptions);
      return res
        .status(200)
        .type('html')
        .send(context.entitlement.allowed ? consentPage(session) : entitlementDeniedPage(session));
    }),
  );

  app.post(
    '/consent/decision',
    asyncRoute(async (req, res) => {
      const session = await consentSession(req, cfg, store);
      verifyCsrf(session, req.body.csrf);
      const decision = DecisionSchema.parse(req.body.decision);
      if (
        session.status === 'approved' ||
        session.status === 'denied' ||
        session.status === 'invalidated' ||
        session.status === 'indeterminate'
      ) {
        if (session.decision !== decision)
          throw new AppError(409, 'consent_replay', 'This decision is already complete.');
        if (session.status === 'indeterminate') throw indeterminateOutcomeError();
        res.clearCookie(CONSENT_COOKIE, { ...cookieOptions, maxAge: undefined });
        return session.hydraRedirectTo
          ? res.redirect(session.hydraRedirectTo)
          : res.status(200).type('html').send(completedPage());
      }
      if (session.status === 'processing')
        return res.status(202).type('html').send(completedPage('Authorization is being finalized.'));
      if (decision === 'deny') {
        const audit = finalAudit(
          session,
          'consent.denied',
          session.context.scopes.map((scope) => scope.name),
          session.context.entitlement.allowed
            ? 'user_denied'
            : (session.context.entitlement.reason ?? 'entitlement_denied'),
        );
        const claim = await store.prepareDecision(session.id, 'deny', audit, cfg.decisionLeaseMs);
        const redirectTo = await executeDecision(claim, store, hooks, ory);
        await drainAuditOutbox(store, hooks);
        res.clearCookie(CONSENT_COOKIE, { ...cookieOptions, maxAge: undefined });
        return redirectTo ? res.redirect(redirectTo) : res.status(200).type('html').send(completedPage());
      }

      if (!session.context.entitlement.allowed)
        throw new AppError(403, 'entitlement_denied', 'This connection is not available for the current plan.');
      const selected = selectedScopes(req.body.scope);
      validateSelectedScopes(session.context, selected);
      const selectedDefinitions = session.context.scopes.filter((scope) => selected.includes(scope.name));
      const needsHighConfirmation = selectedDefinitions.some(
        (scope) => scope.tier === 'high' || scope.tier === 'money-moving',
      );
      if (needsHighConfirmation && req.body.confirm_high !== 'yes') {
        throw badRequest('high_scope_confirmation_required', 'Confirm the high-trust access before approving.');
      }
      const requiresStepUp = selectedDefinitions.some((scope) => scope.requires_step_up);
      if (requiresStepUp) {
        await revalidateApproval(session, selected, hooks);
      }
      await store.setSelectedScopes(session.id, selected);
      if (requiresStepUp) {
        await store.transition(session.id, 'shown', 'step_up_pending');
        const flow = await store.createStepUpFlow(session.id);
        setSignedCookie(res, STEP_UP_COOKIE, flow.cookieBinding, cfg.cookieSecret, cookieOptions);
        return res.redirect(await workos.authorizeStepUpURL(flow.state, flow.nonce));
      }
      return finishApproval(res, session, selected, store, hooks, ory, cookieOptions, cfg.decisionLeaseMs);
    }),
  );

  app.get(
    '/step-up/callback',
    asyncRoute(async (req, res) => {
      const code = ChallengeSchema.parse(req.query.code);
      const state = ChallengeSchema.parse(req.query.state);
      const binding = readSignedCookie(req, STEP_UP_COOKIE, cfg.cookieSecret);
      const claim = await store.claimStepUpFlow(state, binding, cfg.decisionLeaseMs);
      if (claim.replacement) return redirectStepUp(res, claim, workos, cfg, cookieOptions);
      if (!claim.flow.consentSessionId) throw badRequest('step_up_flow_invalid');
      const session = await store.getConsent(claim.flow.consentSessionId);
      if (session.status !== 'step_up_pending' || !session.selectedScopes)
        throw new AppError(409, 'step_up_replay', 'This verification has already been used.');
      try {
        await workos.exchangeStepUp(code, claim.flow.nonce, session.subject);
      } catch (error) {
        if (error instanceof AppError && error.status >= 500) {
          const replacement = await store.recoverStepUpFlow(claim);
          setSignedCookie(res, STEP_UP_COOKIE, replacement.cookieBinding, cfg.cookieSecret, cookieOptions);
          return res.redirect(await workos.authorizeStepUpURL(replacement.state, replacement.nonce));
        }
        await store.completeStepUpFlow(claim);
        throw error;
      }
      await store.completeStepUpFlow(claim);
      res.clearCookie(STEP_UP_COOKIE, { ...cookieOptions, maxAge: undefined });
      return finishApproval(
        res,
        session,
        session.selectedScopes,
        store,
        hooks,
        ory,
        cookieOptions,
        cfg.decisionLeaseMs,
      );
    }),
  );

  app.get(
    '/logout',
    asyncRoute(async (req, res) => {
      const challenge = parseChallenge(req.query.logout_challenge, 'logout_challenge');
      const { redirect_to } = await ory.acceptLogout(challenge);
      return res.redirect(redirect_to);
    }),
  );

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const appError = normalizeError(error);
    operationalDiagnostic('oauth consent request failed', { code: appError.code, status: appError.status });
    if (!res.headersSent)
      res.status(appError.status).type('html').send(errorPage(appError.publicMessage, appError.code));
  });

  return app;
}

async function finishApproval(
  res: Response,
  session: ConsentSession,
  scopes: string[],
  store: ConsentStateStore,
  hooks: RowboatHooks,
  ory: OryAdmin,
  cookieOptions: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'lax';
    maxAge: number;
    path: string;
  },
  decisionLeaseMs: number,
): Promise<void> {
  const audit = finalAudit(session, 'consent.granted', scopes, 'approved');
  const claim = await store.prepareDecision(session.id, 'approve', audit, decisionLeaseMs);
  const redirectTo = await executeDecision(claim, store, hooks, ory);
  await drainAuditOutbox(store, hooks);
  res.clearCookie(CONSENT_COOKIE, { ...cookieOptions, maxAge: undefined });
  if (redirectTo) res.redirect(redirectTo);
  else res.status(200).type('html').send(completedPage());
}

function finalAudit(
  session: ConsentSession,
  event: 'consent.granted' | 'consent.denied',
  scopes: string[],
  result: string,
  eventId = `${session.id}:final`,
): AuditRequest {
  return {
    event,
    eventId,
    occurredAt: new Date().toISOString(),
    sessionId: session.id,
    context: session.context,
    scopes,
    result,
  };
}

interface ReconciliationFaults {
  afterHydra?: (claim: DecisionClaim) => Promise<void> | void;
}

export async function reconcileDecisions(
  store: ConsentStateStore,
  ory: OryAdmin,
  hooks: RowboatHooks,
  limit = 25,
  leaseMs = 30_000,
  faults: ReconciliationFaults = {},
): Promise<number> {
  const claims = await store.claimDecisions(limit, leaseMs);
  for (const claim of claims) {
    try {
      await executeDecision(claim, store, hooks, ory, faults);
    } catch {
      // The durable retry state is updated by executeDecision. One failed item
      // must not starve unrelated decisions claimed in the same batch.
    }
  }
  if (claims.length) await drainAuditOutbox(store, hooks);
  return claims.length;
}

async function executeDecision(
  initialClaim: DecisionClaim,
  store: ConsentStateStore,
  hooks: RowboatHooks,
  ory: OryAdmin,
  faults: ReconciliationFaults = {},
): Promise<string | undefined> {
  let claim = initialClaim;
  if (claim.session.hydraOutcomePhase === 'accept_pending' || claim.session.hydraOutcomePhase === 'reject_pending') {
    let probe: ConsentDecisionProbe;
    try {
      probe = await ory.probeConsentDecision(decisionBinding(claim.session));
    } catch (error) {
      await store.retryDecision(claim, errorMessage(error));
      throw error;
    }
    if (probe.state === 'pending') claim = await store.resetHydraPending(claim);
    else if (probe.state === 'committed') claim = await store.recordHydraOutcome(claim, probe.proof);
    else await markIndeterminate(claim, store, probe);
  }

  if (claim.session.hydraOutcomePhase === 'accepted') return convergeAcceptedDecision(claim, store, hooks);
  if (claim.session.hydraOutcomePhase === 'rejected') {
    await store.finalizeDecision(claim, claim.session.hydraRedirectTo);
    return claim.session.hydraRedirectTo;
  }

  if (claim.session.decision === 'approve') {
    try {
      await revalidateApproval(claim.session, claim.session.selectedScopes ?? [], hooks);
    } catch (error) {
      if (error instanceof AppError && error.status < 500) {
        const denial = finalAudit(
          claim.session,
          'consent.denied',
          claim.session.context.scopes.map((scope) => scope.name),
          'authorization_context_changed',
        );
        claim = await store.replaceClaimedDecision(claim, 'deny', denial);
      } else {
        await store.retryDecision(claim, errorMessage(error));
        throw error;
      }
    }
  }

  claim = await store.markHydraPending(claim);
  try {
    const completion =
      claim.session.decision === 'approve'
        ? await ory.acceptConsent(claim.session.challenge, {
            grantScope: ['offline_access', ...(claim.session.selectedScopes ?? [])],
            grantAudience: [claim.session.context.connector.audience],
            workosUserId: claim.session.subject,
          })
        : await ory.rejectConsent(claim.session.challenge, 'The user denied the connector authorization request.');
    await faults.afterHydra?.(claim);
    claim = await store.recordHydraOutcome(claim, submissionOutcomeProof(claim.session, completion.redirect_to));
  } catch (error) {
    if (error instanceof InjectedPostHydraCrash) throw error;
    let probe: ConsentDecisionProbe;
    try {
      probe = await ory.probeConsentDecision(decisionBinding(claim.session));
    } catch (probeError) {
      await store.retryDecision(claim, errorMessage(probeError));
      throw probeError;
    }
    if (probe.state === 'committed') {
      claim = await store.recordHydraOutcome(claim, probe.proof);
    } else if (probe.state === 'pending') {
      claim = await store.resetHydraPending(claim);
      await store.retryDecision(claim, errorMessage(error));
      throw error;
    } else await markIndeterminate(claim, store, probe);
  }

  if (claim.session.hydraOutcomePhase === 'accepted') return convergeAcceptedDecision(claim, store, hooks);
  await store.finalizeDecision(claim, claim.session.hydraRedirectTo);
  return claim.session.hydraRedirectTo;
}

function decisionBinding(session: ConsentSession): ConsentDecisionBinding {
  return {
    challenge: session.challenge,
    subject: session.subject,
    clientId: session.hydraClientId,
    requestedAudience: [...session.hydraRequestedAudience],
    requestedScopes: [...session.hydraRequestedScopes],
    decision: session.decision!,
    grantedAudience: session.decision === 'approve' ? [session.context.connector.audience] : [],
    grantedScopes: session.decision === 'approve' ? ['offline_access', ...(session.selectedScopes ?? [])] : [],
  };
}

function submissionOutcomeProof(session: ConsentSession, redirectTo: string): HydraOutcomeProof {
  const binding = decisionBinding(session);
  return {
    outcome: binding.decision === 'approve' ? 'accepted' : 'rejected',
    source: 'submission_response',
    challenge: binding.challenge,
    subject: binding.subject,
    clientId: binding.clientId,
    requestedAudience: binding.requestedAudience,
    requestedScopes: binding.requestedScopes,
    grantedAudience: binding.grantedAudience,
    grantedScopes: binding.grantedScopes,
    redirectTo,
  };
}

async function markIndeterminate(
  claim: DecisionClaim,
  store: ConsentStateStore,
  probe: Extract<ConsentDecisionProbe, { state: 'indeterminate' }>,
): Promise<never> {
  await store.markDecisionIndeterminate(claim, probe.reason, probe.proof);
  throw indeterminateOutcomeError();
}

function indeterminateOutcomeError(): AppError {
  return new AppError(
    503,
    'consent_outcome_indeterminate',
    'The authorization outcome could not be verified. Support must reconcile this request before it is retried.',
  );
}

async function convergeAcceptedDecision(
  initialClaim: DecisionClaim,
  store: ConsentStateStore,
  hooks: RowboatHooks,
): Promise<string | undefined> {
  let claim = await store.recordAcceptedGrant(initialClaim);
  try {
    await revalidateApproval(claim.session, claim.session.selectedScopes ?? [], hooks);
  } catch (error) {
    if (error instanceof AppError && error.status < 500) {
      const invalidation = finalAudit(
        claim.session,
        'consent.denied',
        claim.session.context.scopes.map((scope) => scope.name),
        `post_commit_${error.code}`,
        `${claim.session.id}:invalidated`,
      );
      await store.invalidateAcceptedDecision(claim, invalidation);
      return claim.session.hydraRedirectTo;
    }
    await store.retryDecision(claim, errorMessage(error));
    throw error;
  }
  await store.finalizeDecision(claim, claim.session.hydraRedirectTo);
  return claim.session.hydraRedirectTo;
}

/** Fault-injection sentinel used to model a process death after Hydra commits. */
export class InjectedPostHydraCrash extends Error {}

async function redirectStepUp(
  res: Response,
  claim: StepUpFlowClaim,
  workos: WorkOS,
  cfg: Config,
  cookieOptions: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'lax';
    maxAge: number;
    path: string;
  },
): Promise<void> {
  const replacement = claim.replacement;
  if (!replacement?.state) throw badRequest('step_up_recovery_invalid');
  setSignedCookie(res, STEP_UP_COOKIE, replacement.cookieBinding, cfg.cookieSecret, cookieOptions);
  res.redirect(await workos.authorizeStepUpURL(replacement.state, replacement.nonce));
}

async function revalidateApproval(session: ConsentSession, selected: string[], hooks: RowboatHooks): Promise<void> {
  const fresh = await hooks.context({
    challenge: session.challenge,
    workosUserId: session.subject,
    hydraClientId: session.hydraClientId,
    requestedAudience: [session.context.connector.audience],
    requestedScopes: session.context.scopes.map((scope) => scope.name),
  });
  validateContext(
    fresh,
    session.subject,
    session.hydraClientId,
    [session.context.connector.audience],
    session.context.scopes.map((scope) => scope.name),
  );
  if (!fresh.entitlement.allowed)
    throw new AppError(403, 'entitlement_revoked', 'This connection is no longer available for the current plan.');
  if (
    fresh.connector.id !== session.context.connector.id ||
    securityPolicyFingerprint(fresh) !== securityPolicyFingerprint(session.context)
  ) {
    throw new AppError(403, 'consent_context_drift', 'The authorization policy changed. Review the request again.');
  }
  validateSelectedScopes(fresh, selected);
}

function securityPolicyFingerprint(context: ConsentContext): string {
  return JSON.stringify(
    [...context.scopes]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(({ name, required, tier, requires_step_up }) => ({ name, required, tier, requires_step_up })),
  );
}

function completedPage(message = 'Authorization is complete. You may return to the application.'): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Authorization complete</title></head><body><main><h1>Authorization complete</h1><p>${message}</p></main></body></html>`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'decision_reconciliation_failed';
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address?.startsWith('::ffff:127.') === true;
}

/**
 * Delivers guaranteed semantic authorization audits. Delivery failure never
 * downgrades an outbox record to a log line: retryAudit keeps it durable for a
 * later worker attempt. Request/process logs are best-effort diagnostics only.
 */
export async function drainAuditOutbox(store: ConsentStateStore, hooks: RowboatHooks, limit = 25): Promise<number> {
  const items = await store.claimAudits(limit);
  await Promise.all(
    items.map(async (item) => {
      try {
        await hooks.audit(item.payload as AuditRequest);
        await store.completeAudit(item.id);
      } catch (error) {
        await store.retryAudit(item.id, error instanceof Error ? error.message : 'audit_delivery_failed');
      }
    }),
  );
  return items.length;
}

function operationalDiagnostic(msg: string, fields: Record<string, unknown> = {}): void {
  console.error(
    JSON.stringify({
      record_class: 'operational_diagnostic',
      delivery_guarantee: 'best_effort',
      msg,
      ...fields,
    }),
  );
}

function validateContext(
  context: ConsentContext,
  subject: string,
  clientId: string,
  audiences: string[],
  scopes: string[],
): void {
  if (context.subject !== subject || context.client.id !== clientId) {
    throw new AppError(403, 'consent_identity_mismatch', 'The authorization identities do not match.');
  }
  if (audiences.length !== 1 || audiences[0] !== context.connector.audience) {
    throw new AppError(403, 'consent_audience_mismatch', 'The requested product audience does not match.');
  }
  const catalogScopes = context.scopes.map((scope) => scope.name);
  if (!sameUniqueSet(scopes, catalogScopes)) throw badRequest('unknown_or_missing_scope');
}

function validateSelectedScopes(context: ConsentContext, selected: string[]): void {
  if (new Set(selected).size !== selected.length) throw badRequest('duplicate_selected_scope');
  const known = new Set(context.scopes.map((scope) => scope.name));
  if (selected.some((scope) => !known.has(scope))) throw badRequest('scope_escalation');
  const required = context.scopes.filter((scope) => scope.required).map((scope) => scope.name);
  if (required.some((scope) => !selected.includes(scope))) throw badRequest('required_scope_missing');
}

function selectedScopes(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every((scope) => typeof scope === 'string')) return value;
  return [];
}

function sameUniqueSet(left: string[], right: string[]): boolean {
  return (
    new Set(left).size === left.length &&
    new Set(right).size === right.length &&
    left.length === right.length &&
    left.every((value) => right.includes(value))
  );
}

async function consentSession(req: Request, cfg: Config, store: ConsentStateStore): Promise<ConsentSession> {
  const id = readSignedCookie(req, CONSENT_COOKIE, cfg.cookieSecret);
  if (!id) throw badRequest('consent_cookie_invalid');
  return await store.getConsent(id);
}

function verifyCsrf(session: ConsentSession, supplied: unknown): void {
  if (typeof supplied !== 'string' || !safeEqual(session.csrf, supplied))
    throw new AppError(403, 'csrf_invalid', 'The form has expired or is invalid.');
}

function parseChallenge(value: unknown, name: string): string {
  const result = ChallengeSchema.safeParse(value);
  if (!result.success) throw badRequest(`${name}_invalid`);
  return result.data;
}

function setSignedCookie(
  res: Response,
  name: string,
  value: string,
  secret: string,
  options: { httpOnly: boolean; secure: boolean; sameSite: 'lax'; maxAge: number; path: string },
): void {
  res.cookie(name, signValue(value, secret), options);
}

function readSignedCookie(req: Request, name: string, secret: string): string | undefined {
  return verifySignedValue(readCookie(req, name), secret);
}

function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(value.join('='));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

type AsyncRoute = (req: Request, res: Response) => Promise<unknown>;
function asyncRoute(route: AsyncRoute) {
  return (req: Request, res: Response, next: NextFunction): void => {
    route(req, res).catch(next);
  };
}

function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof z.ZodError) return badRequest('request_validation_failed');
  return new AppError(500, 'internal_error', 'An unexpected error prevented authorization.');
}
