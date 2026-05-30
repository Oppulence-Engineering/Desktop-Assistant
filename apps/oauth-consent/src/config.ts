import { z } from 'zod';

/** Process configuration for the consent UI, from the environment. */
export const ConfigSchema = z.object({
  port: z.number(),
  cookieSecret: z.string(),
  ory: z.object({ adminUrl: z.string() }),
  workos: z.object({
    clientId: z.string(),
    apiKey: z.string(),
    issuer: z.string(),
    redirectUri: z.string(),
  }),
  rowboatApi: z.object({ baseUrl: z.string(), hookSecret: z.string() }),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const env = process.env;
  return {
    port: Number(env.PORT ?? 3000),
    cookieSecret: env.COOKIE_SECRET ?? 'dev-insecure-cookie-secret',
    ory: { adminUrl: env.ORY_ADMIN_URL ?? 'http://hydra-admin.ory.svc.cluster.local:4445' },
    workos: {
      clientId: env.WORKOS_CLIENT_ID ?? '',
      apiKey: env.WORKOS_API_KEY ?? '',
      issuer: env.WORKOS_ISSUER ?? 'https://auth.solomon-ai.co',
      redirectUri: env.WORKOS_REDIRECT_URI ?? 'https://consent.solomon-ai.co/callback',
    },
    rowboatApi: {
      baseUrl: env.ROWBOAT_API_URL ?? 'https://api.x.solomon-ai.co',
      hookSecret: env.HOOK_HMAC_SECRET ?? '',
    },
  };
}
