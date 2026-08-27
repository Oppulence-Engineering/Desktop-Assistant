import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Config } from './config.js';
import { safeEqual, signValue, verifySignedValue } from './crypto.js';
import { AppError, badRequest } from './errors.js';
import { consentPage, entitlementDeniedPage, errorPage } from './html.js';
import { OryAdmin } from './ory.js';
import { RowboatHooks, type AuditRequest, type ConsentContext } from './rowboat.js';
import type { ConsentStateStore, ConsentSession } from './state.js';
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
}

export function buildApp(cfg: Config, dependencies: Dependencies = {}): Express {
  const app = express();
  const ory = dependencies.ory ?? new OryAdmin(cfg.ory.adminUrl, cfg.upstreamTimeoutMs);
  const workos = dependencies.workos ?? new WorkOS(cfg.workos, cfg.upstreamTimeoutMs);
  const hooks = dependencies.hooks ?? new RowboatHooks(cfg.rowboatApi, cfg.upstreamTimeoutMs);
  const store = dependencies.store;
  if (!store) throw new Error('shared_state_store_required');
  const cookieOptions = {
    httpOnly: true,
    secure: cfg.cookieSecure,
    sameSite: 'lax' as const,
    maxAge: cfg.sessionTtlMs,
    path: '/',
  };

  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
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
      const flow = await store.consumeLoginFlow(state, binding);
      if (!flow.challenge) throw badRequest('login_flow_invalid');
      const identity = await workos.exchangeLogin(code, flow.nonce);
      const { redirect_to } = await ory.acceptLogin(flow.challenge, identity.workosUserId);
      res.clearCookie(LOGIN_COOKIE, { ...cookieOptions, maxAge: undefined });
      return res.redirect(redirect_to);
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
      const session = await store.createConsent({
        challenge,
        subject: consent.subject,
        hydraClientId,
        context,
      });
      await hooks.audit({
        event: 'consent.shown',
        sessionId: session.id,
        context,
        scopes: context.scopes.map((scope) => scope.name),
        result: context.entitlement.allowed ? 'eligible' : context.entitlement.reason,
      });
      await store.transition(session.id, 'created', 'shown');
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
      if (decision === 'deny') {
        await store.transition(session.id, 'shown', 'processing');
        try {
          const { redirect_to } = await ory.rejectConsent(
            session.challenge,
            'The user denied the connector authorization request.',
          );
          await store.transition(session.id, 'processing', 'denied');
          await deliverFinalAudit(store, hooks, {
            event: 'consent.denied',
            sessionId: session.id,
            context: session.context,
            scopes: session.context.scopes.map((scope) => scope.name),
            result: session.context.entitlement.allowed ? 'user_denied' : session.context.entitlement.reason,
          });
          res.clearCookie(CONSENT_COOKIE, { ...cookieOptions, maxAge: undefined });
          return res.redirect(redirect_to);
        } catch (error) {
          await store.failConsent(session.id);
          throw error;
        }
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
      await store.setSelectedScopes(session.id, selected);
      if (selectedDefinitions.some((scope) => scope.requires_step_up)) {
        await store.transition(session.id, 'shown', 'step_up_pending');
        const flow = await store.createStepUpFlow(session.id);
        setSignedCookie(res, STEP_UP_COOKIE, flow.cookieBinding, cfg.cookieSecret, cookieOptions);
        return res.redirect(await workos.authorizeStepUpURL(flow.state, flow.nonce));
      }
      await store.transition(session.id, 'shown', 'processing');
      return finishApproval(res, session, selected, store, hooks, ory, cookieOptions);
    }),
  );

  app.get(
    '/step-up/callback',
    asyncRoute(async (req, res) => {
      const code = ChallengeSchema.parse(req.query.code);
      const state = ChallengeSchema.parse(req.query.state);
      const binding = readSignedCookie(req, STEP_UP_COOKIE, cfg.cookieSecret);
      const flow = await store.consumeStepUpFlow(state, binding);
      if (!flow.consentSessionId) throw badRequest('step_up_flow_invalid');
      const session = await store.getConsent(flow.consentSessionId);
      if (session.status !== 'step_up_pending' || !session.selectedScopes)
        throw new AppError(409, 'step_up_replay', 'This verification has already been used.');
      try {
        await workos.exchangeStepUp(code, flow.nonce, session.subject);
        await store.transition(session.id, 'step_up_pending', 'processing');
        res.clearCookie(STEP_UP_COOKIE, { ...cookieOptions, maxAge: undefined });
        return finishApproval(res, session, session.selectedScopes, store, hooks, ory, cookieOptions);
      } catch (error) {
        await store.failConsent(session.id);
        throw error;
      }
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
    console.error(
      JSON.stringify({
        msg: 'oauth consent request failed',
        code: appError.code,
        status: appError.status,
      }),
    );
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
): Promise<void> {
  try {
    const { redirect_to } = await ory.acceptConsent(session.challenge, {
      grantScope: ['offline_access', ...scopes],
      grantAudience: [session.context.connector.audience],
      workosUserId: session.subject,
    });
    await store.transition(session.id, 'processing', 'approved');
    await deliverFinalAudit(store, hooks, {
      event: 'consent.granted',
      sessionId: session.id,
      context: session.context,
      scopes,
      result: 'approved',
    });
    res.clearCookie(CONSENT_COOKIE, { ...cookieOptions, maxAge: undefined });
    res.redirect(redirect_to);
  } catch (error) {
    await store.failConsent(session.id);
    throw error;
  }
}

async function deliverFinalAudit(store: ConsentStateStore, hooks: RowboatHooks, payload: AuditRequest): Promise<void> {
  const id = `${payload.sessionId}:${payload.event}`;
  const durablePayload = { ...payload, eventId: id };
  await store.enqueueAudit(id, durablePayload);
  try {
    await hooks.audit(durablePayload);
    await store.completeAudit(id);
  } catch (error) {
    await store.retryAudit(id, error instanceof Error ? error.message : 'audit_delivery_failed');
    // Hydra has already committed the decision. The outbox owns retry, so the browser may continue.
  }
}

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
