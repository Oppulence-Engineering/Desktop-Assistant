import "client-only";

import { z } from "zod";

import {
  ComposioUnconfiguredError,
  fetchComposioConnections,
  fetchComposioToolkits,
  type ComposioConnection,
  type ComposioToolkit,
} from "@/hooks/queries/utils/fetch-composio";
import { dashboardFetch, toDashboardAPIPath } from "@/lib/auth/client";

export { ComposioUnconfiguredError, type ComposioConnection, type ComposioToolkit };

/**
 * The hosted Composio connect flow.
 *
 * Oppulence holds one Composio project key server-side; a user links their own
 * product accounts inside it. The browser never sees a Composio credential, and
 * it never names a user: rowboat-api reads that from the session, because the
 * project key can reach every connection in the project.
 */

const ConnectLinkSchema = z.object({
  connectionId: z.string().optional().default(""),
  redirectUrl: z.url(),
  expiresAt: z.string().optional().default(""),
});

export type ComposioConnectLink = z.infer<typeof ConnectLinkSchema>;

async function call<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await dashboardFetch(toDashboardAPIPath(path), {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(20_000),
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (response.status === 503) throw new ComposioUnconfiguredError();
  if (!response.ok) throw new Error(`Composio request failed (${String(response.status)})`);
  if (response.status === 204) return schema.parse({});
  return schema.parse(await response.json());
}

export async function listComposioToolkits(signal?: AbortSignal): Promise<ComposioToolkit[]> {
  return fetchComposioToolkits(signal);
}

export async function listComposioConnections(signal?: AbortSignal): Promise<ComposioConnection[]> {
  return fetchComposioConnections(signal);
}

export function startComposioConnection(toolkit: string): Promise<ComposioConnectLink> {
  return call("/composio/connections", ConnectLinkSchema, {
    method: "POST",
    body: JSON.stringify({ toolkit }),
  });
}

export async function disconnectComposio(connectionId: string): Promise<void> {
  await call(`/composio/connections/${encodeURIComponent(connectionId)}`, z.object({}), {
    method: "DELETE",
  });
}
