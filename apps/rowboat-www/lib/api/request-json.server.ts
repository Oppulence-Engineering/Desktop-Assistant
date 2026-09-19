import "server-only";

import { rowboatApiURL } from "@/lib/auth/config";
import { getOptionalSession } from "@/lib/auth/session";
import {
  DashboardRequestError,
  type RequestJsonFn,
  type RequestJsonInput,
} from "@/lib/api/request-json";
import { RowboatAPIErrorSchema } from "@/lib/auth/schemas";

function errorMessage(body: unknown, status: number): { message: string; code?: string } {
  const parsed = RowboatAPIErrorSchema.safeParse(body);
  if (parsed.success) {
    return {
      message:
        parsed.data.message ||
        parsed.data.error ||
        parsed.data.code ||
        `Request failed (${String(status)})`,
      code: parsed.data.code,
    };
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
 * Server prefetch transport. Uses the sealed session against Go so RSC does
 * not HTTP-loopback through `/api/rowboat`.
 */
export const requestUpstreamJson: RequestJsonFn = async <T>(
  input: RequestJsonInput<T>,
): Promise<T> => {
  const session = await getOptionalSession();
  if (!session) {
    throw new DashboardRequestError("unauthenticated", 401, "unauthorized");
  }
  const path = input.path.startsWith("/") ? input.path : `/${input.path}`;
  const response = await fetch(rowboatApiURL(`/v1${path}`), {
    method: input.method,
    cache: "no-store",
    signal: input.signal ?? AbortSignal.timeout(15_000),
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    headers: {
      Accept: "application/json",
      Authorization: `${session.tokenType} ${session.accessToken}`,
      ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
  });
  const body = await readJsonBody(response);
  if (!response.ok) {
    const { message, code } = errorMessage(body, response.status);
    throw new DashboardRequestError(message, response.status, code);
  }
  try {
    return input.schema.parse(body);
  } catch (error) {
    console.error(`Unexpected ${input.path} upstream response`, error);
    throw new DashboardRequestError(
      `The ${input.path} response did not match what this app expects. The app and the API are probably running different versions.`,
      0,
      "schema_mismatch",
    );
  }
};
