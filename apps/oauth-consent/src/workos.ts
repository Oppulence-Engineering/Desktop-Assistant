/** WorkOS AuthKit OIDC federation: discovery, authorize URL, code exchange,
 * and id_token verification. */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import type { Config } from './config.js';
import { AppError, upstream } from './errors.js';

const OIDCDiscoverySchema = z.object({
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
  jwks_uri: z.string(),
  issuer: z.string(),
});
type OIDCDiscovery = z.infer<typeof OIDCDiscoverySchema>;

const TokenResponseSchema = z.object({
  id_token: z.string().optional(),
});

export const FederatedUserSchema = z.object({
  workosUserId: z.string(),
  email: z.string().optional(),
  amr: z.array(z.string()),
  acr: z.string().optional(),
});

export type FederatedUser = z.infer<typeof FederatedUserSchema>;

export class WorkOS {
  private discovery?: OIDCDiscovery;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly cfg: Config['workos'],
    private readonly timeoutMs: number,
  ) {}

  private async discover(): Promise<OIDCDiscovery> {
    if (this.discovery) return this.discovery;
    let res: Response;
    try {
      res = await fetch(`${this.cfg.issuer}/.well-known/openid-configuration`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw upstream('workos');
    }
    if (!res.ok) throw upstream('workos', res.status);
    try {
      this.discovery = OIDCDiscoverySchema.parse(await res.json());
      if (this.discovery.issuer !== this.cfg.issuer) throw upstream('workos');
      this.jwks = createRemoteJWKSet(new URL(this.discovery.jwks_uri), {
        timeoutDuration: this.timeoutMs,
      });
      return this.discovery;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw upstream('workos');
    }
  }

  async authorizeLoginURL(state: string, nonce: string): Promise<string> {
    const d = await this.discover();
    const q = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
    });
    return `${d.authorization_endpoint}?${q.toString()}`;
  }

  async authorizeStepUpURL(state: string, nonce: string): Promise<string> {
    const d = await this.discover();
    const q = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.stepUpRedirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      prompt: 'login',
      max_age: '0',
      acr_values: this.cfg.stepUpAcr,
    });
    return `${d.authorization_endpoint}?${q.toString()}`;
  }

  async exchangeLogin(code: string, expectedNonce: string): Promise<FederatedUser> {
    return this.exchange(code, this.cfg.redirectUri, expectedNonce);
  }

  async exchangeStepUp(code: string, expectedNonce: string, expectedSubject: string): Promise<FederatedUser> {
    const identity = await this.exchange(code, this.cfg.stepUpRedirectUri, expectedNonce);
    if (identity.workosUserId !== expectedSubject) {
      throw new AppError(403, 'step_up_identity_mismatch', 'The step-up identity does not match the consenting user.');
    }
    if (!identity.amr.includes(this.cfg.stepUpAmr) || identity.acr !== this.cfg.stepUpAcr) {
      throw new AppError(
        403,
        'step_up_assurance_insufficient',
        'Multi-factor verification did not meet the required assurance level.',
      );
    }
    return identity;
  }

  private async exchange(code: string, redirectUri: string, expectedNonce: string): Promise<FederatedUser> {
    const d = await this.discover();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: this.cfg.clientId,
      client_secret: this.cfg.apiKey,
      redirect_uri: redirectUri,
    });
    let res: Response;
    try {
      res = await fetch(d.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw upstream('workos');
    }
    if (!res.ok) throw upstream('workos', res.status);
    let tok: z.infer<typeof TokenResponseSchema>;
    try {
      tok = TokenResponseSchema.parse(await res.json());
    } catch {
      throw upstream('workos');
    }
    if (!tok.id_token) throw upstream('workos');

    if (!this.jwks) await this.discover();
    let payload: Awaited<ReturnType<typeof jwtVerify>>['payload'];
    try {
      ({ payload } = await jwtVerify(tok.id_token, this.jwks!, {
        issuer: d.issuer,
        audience: this.cfg.clientId,
      }));
    } catch {
      throw new AppError(401, 'workos_token_invalid', 'Identity verification failed.');
    }
    if (payload.nonce !== expectedNonce || typeof payload.sub !== 'string' || !payload.sub) {
      throw new AppError(401, 'workos_token_binding_invalid', 'Identity verification failed.');
    }
    const amr = Array.isArray(payload.amr)
      ? payload.amr.filter((value): value is string => typeof value === 'string')
      : [];
    return {
      workosUserId: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      amr,
      acr: typeof payload.acr === 'string' ? payload.acr : undefined,
    };
  }
}
