import { z } from "zod";

import {
  dashboardRequest,
  redirectBrowserIfUnauthorized,
  toDashboardAPIPath,
} from "@/lib/auth/dashboard-fetch";
import { RowboatAPIErrorSchema } from "@/lib/auth/schemas";

export class DashboardRequestError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "DashboardRequestError";
    this.status = status;
    this.code = code;
  }
}

export type RequestJsonInput<T> = {
  /** Path under `/v1`, for example `/relationship-sources/status`. */
  path: string;
  schema: z.ZodType<T>;
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
};

export type RequestJsonFn = <T>(input: RequestJsonInput<T>) => Promise<T>;

/** 404/502/503 mean the route is missing or the local API is down. */
export function isOptionalRequestFailure(error: unknown): boolean {
  return (
    error instanceof DashboardRequestError &&
    (error.status === 404 || error.status === 502 || error.status === 503)
  );
}

function errorMessage(body: unknown, status: number): { message: string; code?: string } {
  const parsed = RowboatAPIErrorSchema.safeParse(body);
  if (parsed.success) {
    return {
      message:
        parsed.data.message ||
        parsed.data.error ||
        parsed.data.detail ||
        parsed.data.title ||
        parsed.data.code ||
        `Request failed (${String(status)})`,
      code: parsed.data.code,
    };
  }
  if (body && typeof body === "object") {
    const record = body as { detail?: unknown; title?: unknown; code?: unknown };
    const detail = typeof record.detail === "string" ? record.detail : undefined;
    const title = typeof record.title === "string" ? record.title : undefined;
    const code = typeof record.code === "string" ? record.code : undefined;
    return { message: detail || title || `Request failed (${String(status)})`, code };
  }
  return { message: `Request failed (${String(status)})` };
}

async function readJsonBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new DashboardRequestError("Dashboard API returned malformed JSON", response.status);
  }
}

/**
 * Same-origin BFF JSON call with Orval Zod validation.
 * Browser 401s bounce through WorkOS; the server no-ops that redirect.
 */
export async function requestJson<T>(input: RequestJsonInput<T>): Promise<T> {
  const response = await dashboardRequest(toDashboardAPIPath(input.path), {
    method: input.method,
    signal: input.signal,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    headers: {
      Accept: "application/json",
      ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
  });
  redirectBrowserIfUnauthorized(response.status);
  const body = await readJsonBody(response);
  if (!response.ok) {
    const { message, code } = errorMessage(body, response.status);
    throw new DashboardRequestError(message, response.status, code);
  }
  try {
    return input.schema.parse(body);
  } catch (error) {
    console.error(`Unexpected ${input.path} response`, error);
    throw new DashboardRequestError(
      `The ${input.path} response did not match what this app expects. The app and the API are probably running different versions.`,
      0,
      "schema_mismatch",
    );
  }
}
