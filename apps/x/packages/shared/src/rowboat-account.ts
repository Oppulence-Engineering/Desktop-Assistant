import { z } from 'zod';

export const RowboatApiConfig = z.object({
  appUrl: z.string(),
  websocketApiUrl: z.string(),
  // supabaseUrl is retained for backward compatibility; the backend now emits
  // oidcIssuerUrl (the Ory Hydra issuer) as the canonical value.
  supabaseUrl: z.string().optional().default(''),
  oidcIssuerUrl: z.string().optional().default(''),
  // When set, the desktop uses a static, pre-registered OIDC client instead of
  // dynamic client registration.
  oauthClientId: z.string().optional().default(''),
});
