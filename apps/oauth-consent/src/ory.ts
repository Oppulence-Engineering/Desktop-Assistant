/** Thin client for the Ory Hydra Admin API (login/consent/logout flows). */
import { z } from 'zod';

const LoginRequestSchema = z.object({
  skip: z.boolean(),
  subject: z.string(),
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
type ConsentRequest = z.infer<typeof ConsentRequestSchema>;

const CompletionSchema = z.object({
  redirect_to: z.string(),
});
type Completion = z.infer<typeof CompletionSchema>;

const AcceptConsentOptsSchema = z.object({
  grantScope: z.array(z.string()),
  grantAudience: z.array(z.string()),
  workosUserId: z.string(),
  email: z.string().optional(),
});
type AcceptConsentOpts = z.infer<typeof AcceptConsentOptsSchema>;

export class OryAdmin {
  constructor(private readonly adminUrl: string) {}

  private async req<T>(schema: z.ZodType<T>, method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.adminUrl + path, {
      method,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`ory admin ${method} ${path} -> ${res.status}: ${await res.text()}`);
    }
    return schema.parse(await res.json());
  }

  getLoginRequest(challenge: string): Promise<LoginRequest> {
    return this.req(LoginRequestSchema, 'GET', `/admin/oauth2/auth/requests/login?login_challenge=${encodeURIComponent(challenge)}`);
  }

  acceptLogin(challenge: string, subject: string, remember = true): Promise<Completion> {
    return this.req(CompletionSchema, 'PUT', `/admin/oauth2/auth/requests/login/accept?login_challenge=${encodeURIComponent(challenge)}`, {
      subject,
      remember,
      remember_for: 3600,
    });
  }

  getConsentRequest(challenge: string): Promise<ConsentRequest> {
    return this.req(ConsentRequestSchema, 'GET', `/admin/oauth2/auth/requests/consent?consent_challenge=${encodeURIComponent(challenge)}`);
  }

  acceptConsent(
    challenge: string,
    opts: AcceptConsentOpts,
  ): Promise<Completion> {
    return this.req(CompletionSchema, 'PUT', `/admin/oauth2/auth/requests/consent/accept?consent_challenge=${encodeURIComponent(challenge)}`, {
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
    });
  }

  rejectConsent(challenge: string, reason: string): Promise<Completion> {
    return this.req(CompletionSchema, 'PUT', `/admin/oauth2/auth/requests/consent/reject?consent_challenge=${encodeURIComponent(challenge)}`, {
      error: 'access_denied',
      error_description: reason,
    });
  }

  acceptLogout(challenge: string): Promise<Completion> {
    return this.req(CompletionSchema, 'PUT', `/admin/oauth2/auth/requests/logout/accept?logout_challenge=${encodeURIComponent(challenge)}`);
  }
}
