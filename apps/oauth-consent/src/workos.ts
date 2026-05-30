/** WorkOS AuthKit OIDC federation: discovery, authorize URL, code exchange,
 * and id_token verification. */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import type { Config } from './config.js';

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
});

export type FederatedUser = z.infer<typeof FederatedUserSchema>;

export class WorkOS {
  private discovery?: OIDCDiscovery;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly cfg: Config['workos']) {}

  private async discover(): Promise<OIDCDiscovery> {
    if (this.discovery) return this.discovery;
    const res = await fetch(`${this.cfg.issuer}/.well-known/openid-configuration`);
    if (!res.ok) throw new Error(`workos discovery failed: ${res.status}`);
    this.discovery = OIDCDiscoverySchema.parse(await res.json());
    this.jwks = createRemoteJWKSet(new URL(this.discovery.jwks_uri));
    return this.discovery;
  }

  async authorizeURL(state: string): Promise<string> {
    const d = await this.discover();
    const q = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
    });
    return `${d.authorization_endpoint}?${q.toString()}`;
  }

  async exchange(code: string): Promise<FederatedUser> {
    const d = await this.discover();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: this.cfg.clientId,
      client_secret: this.cfg.apiKey,
      redirect_uri: this.cfg.redirectUri,
    });
    const res = await fetch(d.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`workos token exchange failed: ${res.status}`);
    const tok = TokenResponseSchema.parse(await res.json());
    if (!tok.id_token) throw new Error('workos response missing id_token');

    if (!this.jwks) await this.discover();
    const { payload } = await jwtVerify(tok.id_token, this.jwks!, {
      issuer: d.issuer,
      audience: this.cfg.clientId,
    });
    return {
      workosUserId: String(payload.sub ?? ''),
      email: typeof payload.email === 'string' ? payload.email : undefined,
    };
  }
}
