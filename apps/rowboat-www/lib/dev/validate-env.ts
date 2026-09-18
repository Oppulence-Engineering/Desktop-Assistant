import { z } from "zod";

const DevEnvSchema = z.object({
  sessionSecret: z.string().min(32),
  apiProxyUrl: z.string().url(),
  publicApiBaseUrl: z.string().url(),
  publicAppUrl: z.string().url().optional(),
});

export type DevEnvReport = {
  ok: boolean;
  vars: z.infer<typeof DevEnvSchema>;
  warnings: string[];
  errors: string[];
};

/** Read rowboat-www env the same way runtime auth config does, for dev scripts. */
export function readDevEnvFromProcess(env: NodeJS.ProcessEnv = process.env): DevEnvReport {
  const warnings: string[] = [];
  const errors: string[] = [];

  const sessionSecret =
    env.ROWBOAT_WWW_SESSION_SECRET ||
    env.AUTH_SECRET ||
    "dev-only-rowboat-www-session-secret-change-me";

  if (sessionSecret.startsWith("dev-only")) {
    warnings.push("Using dev session secret — do not use in production.");
  }

  const apiProxyUrl =
    env.ROWBOAT_WWW_API_PROXY_URL ||
    env.ROWBOAT_WWW_PUBLIC_API_BASE_URL ||
    env.ROWBOATX_API_PROXY_URL ||
    "http://localhost:18080";

  const publicApiBaseUrl =
    env.ROWBOAT_WWW_PUBLIC_API_BASE_URL || env.ROWBOATX_PUBLIC_API_BASE_URL || apiProxyUrl;

  const publicAppUrl = env.ROWBOAT_WWW_PUBLIC_APP_URL;

  const parsed = DevEnvSchema.safeParse({
    sessionSecret,
    apiProxyUrl,
    publicApiBaseUrl,
    publicAppUrl,
  });

  if (!parsed.success) {
    errors.push(...parsed.error.issues.map((issue) => issue.message));
    return {
      ok: false,
      vars: {
        sessionSecret,
        apiProxyUrl,
        publicApiBaseUrl,
        publicAppUrl,
      },
      warnings,
      errors,
    };
  }

  return { ok: errors.length === 0, vars: parsed.data, warnings, errors };
}
