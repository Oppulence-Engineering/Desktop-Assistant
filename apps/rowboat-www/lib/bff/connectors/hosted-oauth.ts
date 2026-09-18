import "server-only";

import {
  getClaimConnectionUrl,
  getStartConnectionUrl,
  type claimConnectionResponse,
  type startConnectionResponse,
} from "@/lib/api/generated/client/connectors/connectors";
import type {
  ConnectionClaimRequest,
  ConnectionStartRequest,
} from "@/lib/api/generated/client/model";
import { rowboatApiURL } from "@/lib/auth/config";
import type { DashboardSessionCookie } from "@/lib/auth/schemas";

function authorizationHeaders(session: DashboardSessionCookie): HeadersInit {
  return {
    Accept: "application/json",
    Authorization: `${session.tokenType} ${session.accessToken}`,
    "Content-Type": "application/json",
  };
}

function parseUpstreamJSON<T>(body: string | null): T {
  if (!body) return {} as T;
  try {
    return JSON.parse(body) as T;
  } catch {
    return {} as T;
  }
}

export async function startHostedConnector(
  name: string,
  request: ConnectionStartRequest,
  session: DashboardSessionCookie,
  signal?: AbortSignal,
): Promise<startConnectionResponse> {
  const response = await fetch(rowboatApiURL(getStartConnectionUrl(name)), {
    method: "POST",
    headers: authorizationHeaders(session),
    body: JSON.stringify(request),
    cache: "no-store",
    signal,
  });
  const body = [204, 205, 304].includes(response.status) ? null : await response.text();
  const data = parseUpstreamJSON<startConnectionResponse["data"]>(body);
  return {
    data,
    status: response.status,
    headers: response.headers,
  } as startConnectionResponse;
}

export async function claimHostedConnector(
  name: string,
  request: ConnectionClaimRequest,
  session: DashboardSessionCookie,
  signal?: AbortSignal,
): Promise<claimConnectionResponse> {
  const response = await fetch(rowboatApiURL(getClaimConnectionUrl(name)), {
    method: "POST",
    headers: authorizationHeaders(session),
    body: JSON.stringify(request),
    cache: "no-store",
    signal,
  });
  const body = [204, 205, 304].includes(response.status) ? null : await response.text();
  const data = parseUpstreamJSON<claimConnectionResponse["data"]>(body);
  return {
    data,
    status: response.status,
    headers: response.headers,
  } as claimConnectionResponse;
}
