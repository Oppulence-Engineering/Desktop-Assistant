import container from "../di/container.js";
import { Client } from "@modelcontextprotocol/sdk/client";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import z from "zod";
import { IMcpConfigRepo } from "./repo.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { connectionState, ListToolsResponse, McpServerList } from "@x/shared/mcp";
import { awaitApprovalAndRetry, cancelPendingMcpApprovals } from "./product-approval.js";

type mcpState = {
  state: z.infer<typeof connectionState>;
  client: Client | null;
  error: string | null;
};
const clients: Record<string, mcpState> = {};

async function getClient(serverName: string, approvalToken?: string): Promise<Client> {
  if (!approvalToken && clients[serverName] && clients[serverName].state === "connected") {
    return clients[serverName].client!;
  }
  const repo = container.resolve<IMcpConfigRepo>("mcpConfigRepo");
  const { mcpServers } = await repo.getConfig();
  const config = mcpServers[serverName];
  if (!config) {
    throw new Error(`MCP server ${serverName} not found`);
  }
  let transport: Transport | undefined = undefined;
  try {
    // create client
    const client = new Client({
      name: "rowboatx",
      version: "1.0.0",
    });

    if ("command" in config) {
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
      });
      await client.connect(transport);
    } else {
      const headers = {
        ...(config.headers ?? {}),
        ...(approvalToken ? { "X-Approval-Token": approvalToken } : {}),
      };
      const requestInit = Object.keys(headers).length ? { headers } : undefined;
      // Try Streamable HTTP first; if the *connection* fails (e.g. the
      // server only speaks the older SSE transport), fall back to SSE.
      // The fallback must wrap client.connect, not just the transport
      // constructor (which only throws on a malformed URL). See ERRORS.md E41.
      try {
        transport = new StreamableHTTPClientTransport(
          new URL(config.url),
          requestInit ? { requestInit } : undefined,
        );
        await client.connect(transport);
      } catch {
        try {
          await transport?.close();
        } catch {
          // ignore close errors on the failed HTTP transport
        }
        transport = new SSEClientTransport(
          new URL(config.url),
          requestInit ? { requestInit } : undefined,
        );
        await client.connect(transport);
      }
    }

    // store
    clients[serverName] = {
      state: "connected",
      client,
      error: null,
    };
    return client;
  } catch (error) {
    clients[serverName] = {
      state: "error",
      client: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
    transport?.close();
    throw error;
  }
}

export async function cleanup() {
  cancelPendingMcpApprovals("MCP connections were closed before approval completed.");
  for (const [serverName, { client }] of Object.entries(clients)) {
    await client?.transport?.close();
    await client?.close();
    delete clients[serverName];
  }
}

/**
 * Force-close all MCP client connections.
 * Used during force abort to immediately reject any pending MCP tool calls.
 * Clients will be lazily reconnected on next use.
 */
export async function forceCloseAllMcpClients(): Promise<void> {
  cancelPendingMcpApprovals("The product action was cancelled.");
  for (const [serverName, { client }] of Object.entries(clients)) {
    try {
      await client?.close();
    } catch {
      // Ignore errors during force close
    }
    delete clients[serverName];
  }
}

export async function closeMcpClient(serverName: string): Promise<void> {
  const state = clients[serverName];
  if (!state) return;
  try {
    await state.client?.close();
  } finally {
    delete clients[serverName];
  }
}

export async function listServers(): Promise<z.infer<typeof McpServerList>> {
  const repo = container.resolve<IMcpConfigRepo>("mcpConfigRepo");
  const { mcpServers } = await repo.getConfig();
  const result: z.infer<typeof McpServerList> = {
    mcpServers: {},
  };
  for (const [serverName, config] of Object.entries(mcpServers)) {
    const state = clients[serverName];
    result.mcpServers[serverName] = {
      config,
      state: state ? state.state : "disconnected",
      error: state ? state.error : null,
    };
  }
  return result;
}

export async function listTools(
  serverName: string,
  cursor?: string,
): Promise<z.infer<typeof ListToolsResponse>> {
  const client = await getClient(serverName);
  const { tools, nextCursor } = await client.listTools({
    cursor,
  });
  return {
    tools,
    nextCursor,
  };
}

export async function executeTool(
  serverName: string,
  toolName: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  return executeToolAttempt(serverName, toolName, input);
}

async function executeToolAttempt(
  serverName: string,
  toolName: string,
  input: Record<string, unknown>,
  approvalToken?: string,
): Promise<unknown> {
  if (approvalToken) await closeMcpClient(serverName);
  const client = await getClient(serverName, approvalToken);
  try {
    return await client.callTool({ name: toolName, arguments: input });
  } catch (error) {
    if (approvalToken) throw error;
    return await awaitApprovalAndRetry(serverName, toolName, input, error, (token) =>
      executeToolAttempt(serverName, toolName, input, token),
    );
  } finally {
    // One-time approval credentials must never remain on a pooled transport.
    if (approvalToken) await closeMcpClient(serverName);
  }
}
