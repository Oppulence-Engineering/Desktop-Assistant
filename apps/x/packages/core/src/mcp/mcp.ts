import container from "../di/container.js";
import { Client } from "@modelcontextprotocol/sdk/client";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import z from "zod";
import { IMcpConfigRepo } from "./repo.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { connectionState, ListToolsResponse, McpServerList } from "@x/shared/mcp";
import {
  awaitApprovalAndRetry,
  cancelPendingMcpApprovals,
  canonicalArgumentsDigest,
  snapshotMcpArguments,
} from "./product-approval.js";
import {
  createObservedMcpFetch,
  createOneShotApprovalFetch,
  mcpAuthorizationSessionFingerprint,
  mcpHeadersDigest,
  normalizeMcpEndpoint,
  sameMcpEndpoint,
  type McpApprovalRequestBinding,
  type McpConfigApprovalSnapshot,
  type ObservedMcpToolCallRequest,
} from "./approval-request.js";

type mcpState = {
  state: z.infer<typeof connectionState>;
  client: Client | null;
  error: string | null;
};
const clients: Record<string, mcpState> = {};

type ClientApprovalContext = {
  config: Readonly<McpConfigApprovalSnapshot>;
  observedToolCalls: Map<string, ObservedMcpToolCallRequest[]>;
};

const clientApprovalContexts = new WeakMap<Client, ClientApprovalContext>();
const configGenerations = new Map<string, { digest: string; generation: number }>();
let nextConfigGeneration = 1;

function toolCallKey(toolName: string, argumentsDigest: string): string {
  return `${toolName}\0${argumentsDigest}`;
}

function snapshotRemoteConfig(
  serverName: string,
  config: { url: string; headers?: Record<string, string>; connectionId?: string },
  repositoryGeneration?: number,
): Readonly<McpConfigApprovalSnapshot> {
  const configDigest = canonicalArgumentsDigest(config);
  const previous = configGenerations.get(serverName);
  const generation =
    repositoryGeneration ??
    (previous?.digest === configDigest ? previous.generation : nextConfigGeneration++);
  configGenerations.set(serverName, { digest: configDigest, generation });
  return Object.freeze({
    serverName,
    configuredEndpoint: normalizeMcpEndpoint(config.url),
    connectionId: config.connectionId,
    configGeneration: generation,
    configDigest,
    configuredHeadersDigest: mcpHeadersDigest(config.headers),
    credentialFingerprint: mcpAuthorizationSessionFingerprint(config.headers),
  });
}

function assertSameApprovalConfig(
  expected: Readonly<McpApprovalRequestBinding>,
  actual: Readonly<McpConfigApprovalSnapshot>,
): void {
  if (
    expected.serverName !== actual.serverName ||
    !sameMcpEndpoint(expected.configuredEndpoint, actual.configuredEndpoint) ||
    expected.connectionId !== actual.connectionId ||
    expected.configGeneration !== actual.configGeneration ||
    expected.configDigest !== actual.configDigest ||
    expected.configuredHeadersDigest !== actual.configuredHeadersDigest ||
    expected.credentialFingerprint !== actual.credentialFingerprint
  )
    throw new Error(
      "The MCP endpoint, credential, connection, or configuration changed after approval.",
    );
}

async function assertApprovalConfigCurrent(
  repo: IMcpConfigRepo,
  serverName: string,
  binding: Readonly<McpApprovalRequestBinding>,
): Promise<void> {
  const { mcpServers } = await repo.getConfig();
  const config = mcpServers[serverName];
  if (!config || "command" in config)
    throw new Error("The approved remote MCP connection is no longer configured.");
  assertSameApprovalConfig(
    binding,
    snapshotRemoteConfig(serverName, config, repo.getGeneration?.(serverName, config)),
  );
}

function takeObservedToolCall(
  client: Client,
  toolName: string,
  input: Readonly<Record<string, unknown>>,
): McpApprovalRequestBinding | undefined {
  const context = clientApprovalContexts.get(client);
  if (!context) return undefined;
  const argumentsDigest = canonicalArgumentsDigest(input);
  const key = toolCallKey(toolName, argumentsDigest);
  const requests = context.observedToolCalls.get(key);
  const request = requests?.pop();
  if (!request) return undefined;
  if (!requests?.length) context.observedToolCalls.delete(key);
  return Object.freeze({ ...context.config, ...request });
}

async function createClient(
  serverName: string,
  approval?: { token: string; binding: Readonly<McpApprovalRequestBinding> },
): Promise<Client> {
  const repo = container.resolve<IMcpConfigRepo>("mcpConfigRepo");
  const { mcpServers } = await repo.getConfig();
  const config = mcpServers[serverName];
  if (!config) throw new Error(`MCP server ${serverName} not found`);
  let transport: Transport | undefined;
  try {
    const client = new Client({ name: "rowboatx", version: "1.0.0" });
    if ("command" in config) {
      if (approval) throw new Error("Approval tokens are only supported by remote MCP servers.");
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
      });
      await client.connect(transport);
    } else {
      const headers = { ...(config.headers ?? {}) };
      if (Object.keys(headers).some((name) => name.toLowerCase() === "x-approval-token"))
        throw new Error("X-Approval-Token is reserved for one-time approved MCP requests.");
      const configSnapshot = snapshotRemoteConfig(
        serverName,
        config,
        repo.getGeneration?.(serverName, config),
      );
      if (approval) assertSameApprovalConfig(approval.binding, configSnapshot);
      const observedToolCalls = new Map<string, ObservedMcpToolCallRequest[]>();
      const baseFetch = globalThis.fetch.bind(globalThis);
      const observedFetch = createObservedMcpFetch(
        baseFetch,
        canonicalArgumentsDigest,
        (request) => {
          const key = toolCallKey(request.toolName, request.argumentsDigest);
          const requests = observedToolCalls.get(key) ?? [];
          requests.push(request);
          observedToolCalls.set(key, requests);
        },
      );
      const transportFetch = approval
        ? createOneShotApprovalFetch({
            fetchImpl: baseFetch,
            token: approval.token,
            binding: approval.binding,
            argumentsDigest: canonicalArgumentsDigest,
            validateCurrent: () => assertApprovalConfigCurrent(repo, serverName, approval.binding),
          })
        : observedFetch;
      clientApprovalContexts.set(client, { config: configSnapshot, observedToolCalls });
      const requestInit = Object.keys(headers).length ? { headers } : undefined;
      try {
        transport = new StreamableHTTPClientTransport(new URL(config.url), {
          ...(requestInit ? { requestInit } : {}),
          fetch: transportFetch,
          ...(approval?.binding.sessionId ? { sessionId: approval.binding.sessionId } : {}),
        });
        await client.connect(transport);
      } catch (error) {
        // Approval credentials never enter fallback setup or a second transport.
        if (approval) throw error;
        try {
          await transport?.close();
        } catch {
          // Ignore close errors from the failed HTTP transport.
        }
        transport = new SSEClientTransport(new URL(config.url), {
          ...(requestInit ? { requestInit } : {}),
          fetch: transportFetch,
        });
        await client.connect(transport);
      }
    }
    return client;
  } catch (error) {
    await transport?.close().catch(() => undefined);
    throw error;
  }
}

async function getClient(serverName: string): Promise<Client> {
  if (clients[serverName] && clients[serverName].state === "connected") {
    return clients[serverName].client!;
  }
  try {
    const client = await createClient(serverName);
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
  return executeToolAttempt(serverName, toolName, snapshotMcpArguments(input));
}

async function executeToolAttempt(
  serverName: string,
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  approval?: { token: string; binding: Readonly<McpApprovalRequestBinding> },
): Promise<unknown> {
  const client = approval ? await createClient(serverName, approval) : await getClient(serverName);
  try {
    return await client.callTool({ name: toolName, arguments: input });
  } catch (error) {
    if (approval) throw error;
    const requestBinding = takeObservedToolCall(client, toolName, input);
    return await awaitApprovalAndRetry(
      serverName,
      toolName,
      input,
      error,
      requestBinding,
      (token, binding) =>
        executeToolAttempt(serverName, toolName, input, {
          token,
          binding,
        }),
    );
  } finally {
    // One-time approval credentials must never remain on a pooled transport.
    if (approval) await client.close();
  }
}
