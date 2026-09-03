import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  config: {
    url: "https://product.example/mcp",
    connectionId: "connection-1",
    headers: { Authorization: "Bearer ordinary" } as Record<string, string>,
  },
  configGeneration: 1,
  requests: [] as Array<{
    clientNumber: number;
    method: string;
    rpcMethod?: string;
    headers: Record<string, string>;
    redirect?: RequestRedirect;
  }>,
  clients: [] as Array<{ number: number; closed: boolean }>,
  sseConstructed: 0,
  failPrivilegedInitialize: false,
  mutateDuringPrivilegedInitialize: false,
}));

vi.mock("../di/container.js", () => ({
  default: {
    resolve: () => ({
      getConfig: async () => ({ mcpServers: { product: state.config } }),
      getGeneration: () => state.configGeneration,
    }),
  },
}));

interface MockTransportOptions {
  requestInit?: { headers?: Record<string, string> };
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  sessionId?: string;
}

interface MockTransport {
  request(message: Record<string, unknown>): Promise<Response>;
  close(): Promise<void>;
}

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    readonly url: URL;
    readonly options: MockTransportOptions;
    sessionId?: string;

    constructor(url: URL, options: MockTransportOptions = {}) {
      this.url = url;
      this.options = options;
      this.sessionId = options.sessionId;
    }

    async request(message: Record<string, unknown>): Promise<Response> {
      const headers = new Headers(this.options.requestInit?.headers);
      headers.set("accept", "application/json, text/event-stream");
      headers.set("content-type", "application/json");
      if (this.sessionId) headers.set("mcp-session-id", this.sessionId);
      const response = await this.options.fetch!(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
      });
      this.sessionId = response.headers.get("mcp-session-id") ?? this.sessionId;
      return response;
    }

    async close() {}
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class {
    constructor() {
      state.sseConstructed += 1;
    }
    async close() {}
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({ StdioClientTransport: class {} }));
vi.mock("@modelcontextprotocol/sdk/client", () => ({
  Client: class {
    readonly number: number;
    closed = false;
    transport?: MockTransport;

    constructor() {
      this.number = state.clients.length + 1;
      state.clients.push(this);
    }

    async connect(transport: MockTransport) {
      this.transport = transport;
      const response = await transport.request({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: { protocolVersion: "2025-06-18" },
      });
      if (!response.ok) throw new Error(`initialize failed: ${response.status}`);
    }

    async callTool(request: { name: string; arguments: Record<string, unknown> }) {
      const response = await this.transport!.request({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: request,
      });
      if (!response.ok) {
        throw { status: response.status, body: await response.text() };
      }
      return (await response.json()) as unknown;
    }

    async close() {
      this.closed = true;
      await this.transport?.close();
    }

    async listTools() {
      return { tools: [] };
    }
  },
}));

import { cleanup, executeTool } from "./mcp.js";
import { configureMcpApprovalUrlOpener, registerMcpApprovalResult } from "./product-approval.js";

function completion(opened: URL, token = "one-time-secret") {
  return {
    challengeId: opened.searchParams.get("desktop_challenge_id")!,
    status: "approved" as const,
    code: token,
  };
}

describe("MCP approval transport isolation", () => {
  let opened: URL | undefined;

  beforeEach(() => {
    opened = undefined;
    state.config = {
      url: "https://product.example/mcp",
      connectionId: "connection-1",
      headers: { Authorization: "Bearer ordinary" },
    };
    state.configGeneration += 1;
    state.requests.length = 0;
    state.clients.length = 0;
    state.sseConstructed = 0;
    state.failPrivilegedInitialize = false;
    state.mutateDuringPrivilegedInitialize = false;
    configureMcpApprovalUrlOpener(async (url) => {
      opened = new URL(url);
    });
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const requestURL = new URL(input instanceof Request ? input.url : input.toString());
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      const rpcMethod = typeof body?.method === "string" ? body.method : undefined;
      const requestHeaders = new Headers(init?.headers);
      const headers = Object.fromEntries(requestHeaders.entries());
      const clientNumber = state.clients.length;
      state.requests.push({
        clientNumber,
        method: init?.method ?? "GET",
        rpcMethod,
        headers,
        redirect: init?.redirect,
      });

      if (requestURL.pathname === "/v1/approvals/redeem") {
        return Response.json({ approval_token: "one-time-secret" });
      }

      if (rpcMethod === "initialize") {
        if (clientNumber === 2 && state.mutateDuringPrivilegedInitialize) {
          state.config = { ...state.config, headers: { Authorization: "Bearer concurrent" } };
          state.configGeneration += 1;
        }
        if (clientNumber === 2 && state.failPrivilegedInitialize)
          return new Response("failed", { status: 500 });
        return new Response(null, {
          status: 202,
          headers: { "mcp-session-id": "session-1" },
        });
      }
      if (rpcMethod === "tools/call") {
        if (body.params.name === "release" && !requestHeaders.has("x-approval-token")) {
          return new Response(
            JSON.stringify({
              approvalRequired: true,
              approvalChallengeUrl: "https://product.example/approve",
            }),
            { status: 428 },
          );
        }
        return Response.json({
          headers,
          arguments: body.params.arguments,
        });
      }
      return new Response(null, { status: 202 });
    });
  });

  afterEach(async () => {
    await cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps the privileged retry request-local and applies the token to exactly one tools/call", async () => {
    const input = { amount: 1200, nested: { account: "acct_7" } };
    const privileged = executeTool("product", "release", input);
    await vi.waitFor(() => expect(opened).toBeDefined());
    input.amount = 9999;
    input.nested.account = "attacker";

    expect(registerMcpApprovalResult(completion(opened!))).toBe(true);
    const ordinary = await executeTool("product", "read", { id: "invoice_1" });
    const approved = await privileged;

    expect(ordinary).toMatchObject({ headers: { authorization: "Bearer ordinary" } });
    expect(
      (ordinary as { headers: Record<string, string> }).headers["x-approval-token"],
    ).toBeUndefined();
    expect(approved).toMatchObject({
      headers: {
        authorization: "Bearer ordinary",
        "x-approval-token": "one-time-secret",
      },
      arguments: { amount: 1200, nested: { account: "acct_7" } },
    });
    const tokenRequests = state.requests.filter((request) => request.headers["x-approval-token"]);
    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0]).toMatchObject({ rpcMethod: "tools/call", redirect: "manual" });
    expect(
      state.requests.filter(
        (request) => request.rpcMethod === "initialize" && request.headers["x-approval-token"],
      ),
    ).toHaveLength(0);
    expect(state.clients).toHaveLength(2);
    expect(state.clients[0].closed).toBe(false);
    expect(state.clients[1].closed).toBe(true);
  });

  it.each([
    ["endpoint", () => (state.config = { ...state.config, url: "https://attacker.example/mcp" })],
    [
      "authorization",
      () => (state.config = { ...state.config, headers: { Authorization: "Bearer swapped" } }),
    ],
    [
      "headers",
      () =>
        (state.config = {
          ...state.config,
          headers: { ...state.config.headers, "X-Policy": "changed" },
        }),
    ],
    ["connection", () => (state.config = { ...state.config, connectionId: "connection-2" })],
  ])("fails closed when the %s changes while approval is pending", async (_label, mutate) => {
    const result = executeTool("product", "release", { amount: 1200 });
    await vi.waitFor(() => expect(opened).toBeDefined());
    mutate();
    state.configGeneration += 1;

    expect(registerMcpApprovalResult(completion(opened!))).toBe(true);
    await expect(result).rejects.toThrow(/changed after approval/);
    expect(state.requests.some((request) => request.headers["x-approval-token"])).toBe(false);
  });

  it("fails closed when config changes away and back because its generation is immutable", async () => {
    const result = executeTool("product", "release", { amount: 1200 });
    await vi.waitFor(() => expect(opened).toBeDefined());
    const original = state.config;
    state.config = { ...original, url: "https://temporary.example/mcp" };
    state.configGeneration += 1;
    state.config = original;
    state.configGeneration += 1;

    expect(registerMcpApprovalResult(completion(opened!))).toBe(true);
    await expect(result).rejects.toThrow(/changed after approval/);
    expect(state.requests.some((request) => request.headers["x-approval-token"])).toBe(false);
  });

  it("detects a concurrent config mutation after privileged initialization but before tools/call", async () => {
    const result = executeTool("product", "release", { amount: 1200 });
    await vi.waitFor(() => expect(opened).toBeDefined());
    state.mutateDuringPrivilegedInitialize = true;

    expect(registerMcpApprovalResult(completion(opened!))).toBe(true);
    await expect(result).rejects.toThrow(/changed after approval/);
    expect(state.requests.some((request) => request.headers["x-approval-token"])).toBe(false);
  });

  it("never carries the token into SSE fallback when privileged initialization fails", async () => {
    const result = executeTool("product", "release", { amount: 1200 });
    await vi.waitFor(() => expect(opened).toBeDefined());
    state.failPrivilegedInitialize = true;

    expect(registerMcpApprovalResult(completion(opened!))).toBe(true);
    await expect(result).rejects.toThrow(/initialize failed/);
    expect(state.sseConstructed).toBe(0);
    expect(state.requests.some((request) => request.headers["x-approval-token"])).toBe(false);
  });
});
