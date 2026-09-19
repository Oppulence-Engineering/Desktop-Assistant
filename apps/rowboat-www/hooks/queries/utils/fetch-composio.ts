import { z } from "zod";

import { DashboardRequestError, requestJson, type RequestJsonFn } from "@/lib/api/request-json";

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

export type ComposioToolkit = z.infer<typeof ToolkitSchema>;
export type ComposioConnection = z.infer<typeof ConnectionSchema>;

export class ComposioUnconfiguredError extends Error {
  constructor() {
    super("Composio is not configured on this server");
    this.name = "ComposioUnconfiguredError";
  }
}

function asComposioError(error: unknown): never {
  if (error instanceof DashboardRequestError && error.status === 503) {
    throw new ComposioUnconfiguredError();
  }
  throw error;
}

export async function loadComposioToolkits(
  request: RequestJsonFn,
  signal?: AbortSignal,
): Promise<ComposioToolkit[]> {
  try {
    const data = await request({
      path: "/composio/toolkits",
      schema: ToolkitsResponseSchema,
      signal,
    });
    return data.toolkits.filter((toolkit) => toolkit.managedAuth);
  } catch (error) {
    asComposioError(error);
  }
}

export async function loadComposioConnections(
  request: RequestJsonFn,
  signal?: AbortSignal,
): Promise<ComposioConnection[]> {
  try {
    const data = await request({
      path: "/composio/connections",
      schema: ConnectionsResponseSchema,
      signal,
    });
    return data.connections;
  } catch (error) {
    asComposioError(error);
  }
}

export function fetchComposioToolkits(signal?: AbortSignal): Promise<ComposioToolkit[]> {
  return loadComposioToolkits(requestJson, signal);
}

export function fetchComposioConnections(signal?: AbortSignal): Promise<ComposioConnection[]> {
  return loadComposioConnections(requestJson, signal);
}
