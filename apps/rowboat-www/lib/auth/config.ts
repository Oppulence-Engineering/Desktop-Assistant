import "server-only";

import { z } from "zod";

const URLSchema = z
  .string()
  .url()
  .transform((value) => value.replace(/\/+$/, ""));

const RuntimeConfigSchema = z.object({
  apiBaseUrl: URLSchema,
  authApiBaseUrl: URLSchema,
  publicApiBaseUrl: URLSchema,
  sessionSecret: z.string().min(32),
  workosLogoutBaseUrl: URLSchema,
  isProduction: z.boolean(),
});

export type AuthRuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

/**
 * Loads the rowboat-www auth/runtime configuration once per server request.
 * Production requires ROWBOAT_WWW_SESSION_SECRET so sealed cookies cannot be
 * forged or decrypted. Local development gets a stable insecure fallback to
 * keep onboarding flows easy to test without Kubernetes secrets.
 */
export function getAuthRuntimeConfig(): AuthRuntimeConfig {
  const isProduction = process.env.NODE_ENV === "production";
  const apiBaseUrl =
    process.env.ROWBOAT_WWW_API_PROXY_URL ||
    process.env.ROWBOAT_WWW_PUBLIC_API_BASE_URL ||
    process.env.ROWBOATX_API_PROXY_URL ||
    process.env.ROWBOATX_API_BASE_URL ||
    "http://localhost:8080";
  const publicApiBaseUrl =
    process.env.ROWBOAT_WWW_PUBLIC_API_BASE_URL ||
    process.env.ROWBOATX_PUBLIC_API_BASE_URL ||
    apiBaseUrl;
  const authApiBaseUrl = process.env.ROWBOAT_WWW_AUTH_API_BASE_URL || apiBaseUrl;
  const sessionSecret =
    process.env.ROWBOAT_WWW_SESSION_SECRET ||
    process.env.AUTH_SECRET ||
    (isProduction ? "" : "dev-only-rowboat-www-session-secret-change-me");

  return RuntimeConfigSchema.parse({
    apiBaseUrl,
    authApiBaseUrl,
    publicApiBaseUrl,
    sessionSecret,
    workosLogoutBaseUrl:
      process.env.ROWBOAT_WWW_WORKOS_LOGOUT_BASE_URL ||
      process.env.WORKOS_BASE_URL ||
      "https://api.workos.com",
    isProduction,
  });
}

/**
 * Builds a rowboat-api URL from an absolute API path. Callers pass /v1/... so
 * the proxy cannot be tricked into reaching arbitrary upstream paths.
 */
export function rowboatApiURL(pathname: string, searchParams?: URLSearchParams): URL {
  return apiURL(getAuthRuntimeConfig().apiBaseUrl, pathname, searchParams);
}

export function rowboatAuthApiURL(pathname: string, searchParams?: URLSearchParams): URL {
  return apiURL(getAuthRuntimeConfig().authApiBaseUrl, pathname, searchParams);
}

function apiURL(baseUrl: string, pathname: string, searchParams?: URLSearchParams): URL {
  if (!pathname.startsWith("/")) {
    throw new Error("rowboatApiURL pathname must start with /");
  }
  const url = new URL(pathname, baseUrl + "/");
  if (searchParams) {
    for (const [key, value] of searchParams.entries()) {
      url.searchParams.append(key, value);
    }
  }
  return url;
}

export function rowboatAuthApiBaseURL(): string {
  return getAuthRuntimeConfig().authApiBaseUrl;
}
