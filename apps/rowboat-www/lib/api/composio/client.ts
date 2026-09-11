import "client-only";

import { z } from "zod";

import { dashboardFetch, toDashboardAPIPath } from "@/lib/auth/client";

/**
 * The hosted Composio connect flow.
 *
 * Oppulence holds one Composio project key server-side; a user links their own
 * product accounts inside it. The browser never sees a Composio credential, and
 * it never names a user: rowboat-api reads that from the session, because the
 * project key can reach every connection in the project.
 */

const ToolkitSchema = z.object({
  slug: z.string(),
  name: z.string().optional().default(""),
  managedAuth: z.boolean().optional().default(false),
});

const ConnectionSchema = z.object({
  id: z.string(),
  toolkit: z.string().optional().default(""),
  status: z.string().optional().default(""),
  createdAt: z.string().optional().default(""),
});

const ToolkitsResponseSchema = z.object({ toolkits: ToolkitSchema.array().default([]) });
const ConnectionsResponseSchema = z.object({ connections: ConnectionSchema.array().default([]) });
const ConnectLinkSchema = z.object({
  connectionId: z.string().optional().default(""),
  redirectUrl: z.url(),
  expiresAt: z.string().optional().default(""),
});

export type ComposioToolkit = z.infer<typeof ToolkitSchema>;
export type ComposioConnection = z.infer<typeof ConnectionSchema>;
export type ComposioConnectLink = z.infer<typeof ConnectLinkSchema>;

/** Raised when this deployment holds no Composio project key. */
export class ComposioUnconfiguredError extends Error {
  constructor() {
    super("Composio is not configured on this server");
    this.name = "ComposioUnconfiguredError";
  }
}

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
  const data = await call("/composio/toolkits", ToolkitsResponseSchema, { signal });
  // Only products Composio can authorize on our behalf can be connected with a
  // single click; the rest would need an OAuth app of our own first.
  return data.toolkits.filter((toolkit) => toolkit.managedAuth);
}

export async function listComposioConnections(signal?: AbortSignal): Promise<ComposioConnection[]> {
  const data = await call("/composio/connections", ConnectionsResponseSchema, { signal });
  return data.connections;
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
