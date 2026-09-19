import { z } from "zod";

import {
  dashboardRequest,
  redirectBrowserIfUnauthorized,
  toDashboardAPIPath,
} from "@/lib/auth/dashboard-fetch";

const ErrorResponseSchema = z.union([
  z.string(),
  z
    .object({
      message: z.string().optional(),
      error: z.string().optional(),
    })
    .passthrough(),
]);

type DashboardJsonOptions = RequestInit & {
  allow404?: boolean;
  /** When true, missing or temporarily unavailable backends return null instead of throwing. */
  softFail?: boolean;
};

/** Backend features that may be absent (404) or unreachable during local dev (502/503). */
export function isOptionalDashboardFailure(status: number): boolean {
  return status === 404 || status === 502 || status === 503;
}

export async function requestDashboardJson<T>(
  url: string,
  schema: z.ZodType<T>,
  options: DashboardJsonOptions & ({ allow404: true } | { softFail: true }),
): Promise<T | null>;
export async function requestDashboardJson<T>(
  url: string,
  schema: z.ZodType<T>,
  options?: DashboardJsonOptions,
): Promise<T>;
/**
 * Performs an authenticated dashboard request and validates the response
 * before it reaches feature state. Callers supply the endpoint-specific schema
 * so this transport cannot silently turn untrusted JSON into `any`.
 */
export async function requestDashboardJson<T>(
  url: string,
  schema: z.ZodType<T>,
  options: DashboardJsonOptions = {},
): Promise<T | null> {
  const { allow404, softFail, ...requestInit } = options;
  const optionalFailure = allow404 || softFail;
  const response = await dashboardRequest(toDashboardAPIPath(url), {
    ...requestInit,
    headers: {
      "Content-Type": "application/json",
      ...(requestInit.headers ?? {}),
    },
  });
  redirectBrowserIfUnauthorized(response.status);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const text = await response.text();

  if (!response.ok) {
    if (optionalFailure && isOptionalDashboardFailure(response.status)) return null;
    if (contentType.includes("application/json") && text) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      const errorBody = ErrorResponseSchema.safeParse(parsed);
      if (errorBody.success) {
        const detail =
          typeof errorBody.data === "string"
            ? errorBody.data
            : (errorBody.data.message ?? errorBody.data.error);
        if (detail) throw new Error(detail);
      }
    }
    if (response.status === 404) {
      throw new Error("Resource not found on the CLI backend (404)");
    }
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  let body: unknown = null;
  if (text && contentType.includes("application/json")) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error("Dashboard API returned malformed JSON");
    }
  }
  return schema.parse(body);
}
