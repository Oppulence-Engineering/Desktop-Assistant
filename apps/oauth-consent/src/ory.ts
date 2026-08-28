/** Thin client for the Ory Hydra Admin API (login/consent/logout flows). */
import { z } from 'zod';
import { AppError, upstream } from './errors.js';

const LoginRequestSchema = z.object({
  skip: z.boolean(),
  subject: z.string().default(''),
  challenge: z.string(),
});
type LoginRequest = z.infer<typeof LoginRequestSchema>;

const ConsentRequestSchema = z.object({
  skip: z.boolean(),
  subject: z.string(),
  challenge: z.string(),
  requested_scope: z.array(z.string()),
  requested_access_token_audience: z.array(z.string()),
  client: z.object({ client_id: z.string().optional() }).optional(),
});
export type ConsentRequest = z.infer<typeof ConsentRequestSchema>;

const CompletionSchema = z.object({
  redirect_to: z.string(),
});
type Completion = z.infer<typeof CompletionSchema>;

const ConsentSessionRequestSchema = ConsentRequestSchema.partial().extend({ challenge: z.string() });
type ConsentSessionRequest = z.infer<typeof ConsentSessionRequestSchema>;

const ConsentSessionSchema = z.object({
  consent_request_id: z.string().optional(),
  consent_request: ConsentSessionRequestSchema,
  grant_access_token_audience: z.array(z.string()).default([]),
  grant_scope: z.array(z.string()).default([]),
  handled_at: z.string().nullish(),
});
const ConsentSessionsSchema = z.array(ConsentSessionSchema);

export interface ConsentDecisionBinding {
  challenge: string;
  subject: string;
  clientId: string;
  requestedAudience: string[];
  requestedScopes: string[];
  decision: 'approve' | 'deny';
  grantedAudience: string[];
  grantedScopes: string[];
}

export interface HydraOutcomeProof {
  outcome: 'accepted' | 'rejected';
  source: 'submission_response' | 'consent_session' | 'terminal_redirect';
  challenge: string;
  subject: string;
  clientId: string;
  requestedAudience: string[];
  requestedScopes: string[];
  grantedAudience: string[];
  grantedScopes: string[];
  redirectTo?: string;
  consentRequestId?: string;
  handledAt?: string;
}

export type ConsentDecisionProbe =
  | { state: 'pending' }
  | { state: 'committed'; proof: HydraOutcomeProof }
  | { state: 'indeterminate'; reason: string; proof?: HydraOutcomeProof };

const AcceptConsentOptsSchema = z.object({
  grantScope: z.array(z.string()),
  grantAudience: z.array(z.string()),
  workosUserId: z.string(),
  email: z.string().optional(),
});
type AcceptConsentOpts = z.infer<typeof AcceptConsentOptsSchema>;

export class OryRequestError extends AppError {
  constructor(readonly upstreamStatus: number) {
    super(502, `ory_upstream_${upstreamStatus}`, 'The authorization service is temporarily unavailable.');
  }
}

export class OryAdmin {
  constructor(
    private readonly adminUrl: string,
    private readonly timeoutMs: number,
  ) {}

  private async raw(method: string, path: string, body?: unknown): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(new URL(path, this.adminUrl).toString(), {
        method,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw upstream('ory');
    }
    return res;
  }

  private async parse<T>(res: Response, schema: z.ZodType<T>): Promise<T> {
    try {
      return schema.parse(await res.json());
    } catch {
      throw upstream('ory');
    }
  }

  private async req<T>(schema: z.ZodType<T>, method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.raw(method, path, body);
    if (!res.ok) throw new OryRequestError(res.status);
    return this.parse(res, schema);
  }

  getLoginRequest(challenge: string): Promise<LoginRequest> {
    return this.req(
      LoginRequestSchema,
      'GET',
      `/admin/oauth2/auth/requests/login?login_challenge=${encodeURIComponent(challenge)}`,
    );
  }

  async loginRequestPending(challenge: string): Promise<boolean> {
    try {
      await this.getLoginRequest(challenge);
      return true;
    } catch (error) {
      if (error instanceof OryRequestError && [404, 409, 410].includes(error.upstreamStatus)) return false;
      throw error;
    }
  }

  acceptLogin(challenge: string, subject: string, remember = true): Promise<Completion> {
    return this.req(
      CompletionSchema,
      'PUT',
      `/admin/oauth2/auth/requests/login/accept?login_challenge=${encodeURIComponent(challenge)}`,
      {
        subject,
        remember,
        remember_for: 3600,
      },
    );
  }

  getConsentRequest(challenge: string): Promise<ConsentRequest> {
    return this.req(
      ConsentRequestSchema,
      'GET',
      `/admin/oauth2/auth/requests/consent?consent_challenge=${encodeURIComponent(challenge)}`,
    );
  }

  async consentRequestPending(challenge: string): Promise<boolean> {
    try {
      await this.getConsentRequest(challenge);
      return true;
    } catch (error) {
      if (error instanceof OryRequestError && [404, 409, 410].includes(error.upstreamStatus)) return false;
      throw error;
    }
  }

  async probeConsentDecision(binding: ConsentDecisionBinding): Promise<ConsentDecisionProbe> {
    const res = await this.raw(
      'GET',
      `/admin/oauth2/auth/requests/consent?consent_challenge=${encodeURIComponent(binding.challenge)}`,
    );
    let terminalRedirect: string | undefined;
    if (res.ok) {
      const request = await this.parse(res, ConsentRequestSchema);
      return consentRequestMatches(request, binding)
        ? { state: 'pending' }
        : { state: 'indeterminate', reason: 'hydra_pending_request_binding_mismatch' };
    }
    if (![404, 409, 410].includes(res.status)) throw new OryRequestError(res.status);
    if (res.status === 410) {
      const parsed = CompletionSchema.safeParse(await res.json().catch(() => undefined));
      if (parsed.success) terminalRedirect = parsed.data.redirect_to;
    }

    const sessions = await this.listConsentSessions(binding.subject);
    const sameChallenge = sessions.filter((session) => session.consent_request.challenge === binding.challenge);
    const accepted = sameChallenge.find(
      (session) =>
        consentRequestMatches(session.consent_request, binding) &&
        sameUniqueSet(session.grant_access_token_audience, binding.grantedAudience) &&
        sameUniqueSet(session.grant_scope, binding.grantedScopes),
    );
    if (accepted) {
      const proof: HydraOutcomeProof = {
        outcome: 'accepted',
        source: 'consent_session',
        challenge: binding.challenge,
        subject: binding.subject,
        clientId: binding.clientId,
        requestedAudience: [...binding.requestedAudience],
        requestedScopes: [...binding.requestedScopes],
        grantedAudience: [...accepted.grant_access_token_audience],
        grantedScopes: [...accepted.grant_scope],
        redirectTo: terminalRedirect,
        consentRequestId: accepted.consent_request_id,
        handledAt: accepted.handled_at ?? undefined,
      };
      return binding.decision === 'approve'
        ? { state: 'committed', proof }
        : { state: 'indeterminate', reason: 'hydra_terminal_outcome_conflicts_with_intent', proof };
    }
    if (sameChallenge.length) {
      return { state: 'indeterminate', reason: 'hydra_accepted_session_binding_mismatch' };
    }

    if (terminalRedirect && redirectError(terminalRedirect) === 'access_denied') {
      const proof: HydraOutcomeProof = {
        outcome: 'rejected',
        source: 'terminal_redirect',
        challenge: binding.challenge,
        subject: binding.subject,
        clientId: binding.clientId,
        requestedAudience: [...binding.requestedAudience],
        requestedScopes: [...binding.requestedScopes],
        grantedAudience: [],
        grantedScopes: [],
        redirectTo: terminalRedirect,
      };
      return binding.decision === 'deny'
        ? { state: 'committed', proof }
        : { state: 'indeterminate', reason: 'hydra_terminal_outcome_conflicts_with_intent', proof };
    }
    return { state: 'indeterminate', reason: 'hydra_terminal_outcome_unproven' };
  }

  private async listConsentSessions(subject: string): Promise<z.infer<typeof ConsentSessionsSchema>> {
    const sessions: z.infer<typeof ConsentSessionsSchema> = [];
    let path: string | undefined =
      `/admin/oauth2/auth/sessions/consent?subject=${encodeURIComponent(subject)}&page_size=500`;
    for (let page = 0; path && page < 100; page += 1) {
      const res = await this.raw('GET', path);
      if (!res.ok) throw new OryRequestError(res.status);
      sessions.push(...(await this.parse(res, ConsentSessionsSchema)));
      path = nextPage(res.headers.get('link'));
    }
    return sessions;
  }

  acceptConsent(challenge: string, opts: AcceptConsentOpts): Promise<Completion> {
    return this.req(
      CompletionSchema,
      'PUT',
      `/admin/oauth2/auth/requests/consent/accept?consent_challenge=${encodeURIComponent(challenge)}`,
      {
        grant_scope: opts.grantScope,
        grant_access_token_audience: opts.grantAudience,
        remember: true,
        remember_for: 3600,
        session: {
          // These claims land under `ext` in the access token, which rowboat-api
          // and the product MCPs read (ext.workos_user_id).
          access_token: { ext: { workos_user_id: opts.workosUserId, email: opts.email } },
          id_token: { workos_user_id: opts.workosUserId, email: opts.email },
        },
      },
    );
  }

  rejectConsent(challenge: string, reason: string): Promise<Completion> {
    return this.req(
      CompletionSchema,
      'PUT',
      `/admin/oauth2/auth/requests/consent/reject?consent_challenge=${encodeURIComponent(challenge)}`,
      {
        error: 'access_denied',
        error_description: reason,
      },
    );
  }

  acceptLogout(challenge: string): Promise<Completion> {
    return this.req(
      CompletionSchema,
      'PUT',
      `/admin/oauth2/auth/requests/logout/accept?logout_challenge=${encodeURIComponent(challenge)}`,
    );
  }
}

function consentRequestMatches(
  request: ConsentRequest | ConsentSessionRequest,
  binding: ConsentDecisionBinding,
): boolean {
  return (
    request.challenge === binding.challenge &&
    request.subject === binding.subject &&
    request.client?.client_id === binding.clientId &&
    sameUniqueSet(request.requested_access_token_audience ?? [], binding.requestedAudience) &&
    sameUniqueSet(request.requested_scope ?? [], binding.requestedScopes)
  );
}

function sameUniqueSet(left: string[], right: string[]): boolean {
  return (
    new Set(left).size === left.length &&
    new Set(right).size === right.length &&
    left.length === right.length &&
    left.every((value) => right.includes(value))
  );
}

function redirectError(redirectTo: string): string | undefined {
  try {
    return new URL(redirectTo).searchParams.get('error') ?? undefined;
  } catch {
    return undefined;
  }
}

function nextPage(link: string | null): string | undefined {
  if (!link) return undefined;
  for (const entry of link.split(',')) {
    const match = entry.match(/<([^>]+)>;\s*rel="?next"?/);
    if (match?.[1]) return match[1];
  }
  return undefined;
}
