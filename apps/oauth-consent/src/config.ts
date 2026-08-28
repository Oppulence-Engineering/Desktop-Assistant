import { z } from 'zod';

/** Process configuration for the consent UI, from the environment. */
export const ConfigSchema = z.object({
  port: z.number().int().min(1).max(65535),
  cookieSecret: z.string().min(32),
  cookieSecure: z.boolean(),
  sessionTtlMs: z.number().int().min(60_000).max(900_000),
  upstreamTimeoutMs: z.number().int().min(100).max(30_000),
  databaseUrl: z.string().min(1),
  auditRetryIntervalMs: z.number().int().min(1_000).max(300_000),
  decisionLeaseMs: z.number().int().min(1_000).max(300_000),
  shutdownDeadlineMs: z.number().int().min(1_000).max(120_000),
  ory: z.object({ adminUrl: z.string().url() }),
  workos: z.object({
    clientId: z.string().min(1),
    apiKey: z.string().min(1),
    issuer: z.string().url(),
    redirectUri: z.string().url(),
    stepUpRedirectUri: z.string().url(),
    stepUpAcr: z.string().min(1),
    stepUpAmr: z.string().min(1),
  }),
  rowboatApi: z.object({
    baseUrl: z.string().url(),
    hookSecret: z.string().min(32),
    contextPath: z.string().startsWith('/'),
    auditPath: z.string().startsWith('/'),
    signatureMaxAgeMs: z.number().int().min(1_000).max(900_000),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const env = process.env;
  return ConfigSchema.parse({
    port: Number(env.PORT ?? 3000),
    cookieSecret: env.COOKIE_SECRET ?? '',
    cookieSecure: env.COOKIE_SECURE !== 'false',
    sessionTtlMs: Number(env.CONSENT_SESSION_TTL_MS ?? 600_000),
    upstreamTimeoutMs: Number(env.UPSTREAM_TIMEOUT_MS ?? 5_000),
    databaseUrl: env.DATABASE_URL ?? '',
    auditRetryIntervalMs: Number(env.AUDIT_RETRY_INTERVAL_MS ?? 5_000),
    decisionLeaseMs: Number(env.DECISION_LEASE_MS ?? 30_000),
    shutdownDeadlineMs: Number(env.SHUTDOWN_DEADLINE_MS ?? 20_000),
    ory: { adminUrl: env.ORY_ADMIN_URL ?? 'http://hydra-admin.ory.svc.cluster.local:4445' },
    workos: {
      clientId: env.WORKOS_CLIENT_ID ?? '',
      apiKey: env.WORKOS_API_KEY ?? '',
      issuer: env.WORKOS_ISSUER ?? 'https://auth.solomon-ai.co',
      redirectUri: env.WORKOS_REDIRECT_URI ?? 'https://consent.solomon-ai.co/callback',
      stepUpRedirectUri: env.WORKOS_STEP_UP_REDIRECT_URI ?? 'https://consent.solomon-ai.co/step-up/callback',
      stepUpAcr: env.WORKOS_STEP_UP_ACR ?? 'urn:rowboat:loa:money-moving',
      stepUpAmr: env.WORKOS_STEP_UP_AMR ?? 'mfa',
    },
    rowboatApi: {
      baseUrl: env.ROWBOAT_API_URL ?? 'https://api.x.solomon-ai.co',
      hookSecret: env.HOOK_HMAC_SECRET ?? '',
      contextPath: env.CONSENT_CONTEXT_HOOK_PATH ?? '/oauth-hooks/pre-consent',
      auditPath: env.CONSENT_AUDIT_HOOK_PATH ?? '/oauth-hooks/consent-audit',
      signatureMaxAgeMs: Number(env.HOOK_SIGNATURE_MAX_AGE_MS ?? 300_000),
    },
  });
}
