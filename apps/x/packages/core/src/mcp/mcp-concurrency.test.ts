import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const observedHeaders: Array<Record<string, string>> = [];
const clients: Array<{ headers: Record<string, string>; closed: boolean }> = [];

vi.mock("../di/container.js", () => ({
  default: {
    resolve: () => ({
      getConfig: async () => ({
        mcpServers: {
          product: {
            url: "https://product.example/mcp",
            headers: { Authorization: "Bearer ordinary" },
          },
        },
      }),
    }),
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    headers: Record<string, string>;
    constructor(_url: URL, options?: { requestInit?: { headers?: Record<string, string> } }) {
      this.headers = options?.requestInit?.headers ?? {};
    }
    async close() {}
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({ SSEClientTransport: class {} }));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({ StdioClientTransport: class {} }));
vi.mock("@modelcontextprotocol/sdk/client", () => ({
  Client: class {
    headers: Record<string, string> = {};
    closed = false;
    transport?: { close(): Promise<void> };
    constructor() {
      clients.push(this);
    }
    async connect(transport: { headers: Record<string, string>; close(): Promise<void> }) {
      this.transport = transport;
      this.headers = transport.headers;
    }
    async callTool(request: { name: string; arguments: Record<string, unknown> }) {
      observedHeaders.push({ ...this.headers });
      if (request.name === "release" && !this.headers["X-Approval-Token"]) {
        throw {
          status: 428,
          body: '{"approvalRequired":true,"approvalChallengeUrl":"https://product.example/approve"}',
        };
      }
      return { headers: { ...this.headers }, arguments: request.arguments };
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

describe("MCP approval transport isolation", () => {
  let opened: URL;
  beforeEach(() => {
    observedHeaders.length = 0;
    clients.length = 0;
    configureMcpApprovalUrlOpener(async (url) => {
      opened = new URL(url);
    });
  });
  afterEach(async () => {
    await cleanup();
  });

  it("keeps a privileged retry request-local while concurrent ordinary calls use the shared client", async () => {
    const input = { amount: 1200, nested: { account: "acct_7" } };
    const privileged = executeTool("product", "release", input);
    await vi.waitFor(() => expect(opened).toBeDefined());
    input.amount = 9999;
    input.nested.account = "attacker";

    expect(
      registerMcpApprovalResult({
        challengeId: opened.searchParams.get("desktop_challenge_id")!,
        serverName: "product",
        toolName: "release",
        argumentsDigest: opened.searchParams.get("desktop_arguments_digest")!,
        status: "approved",
        token: "one-time-secret",
      }),
    ).toBe(true);

    const ordinary = await executeTool("product", "read", { id: "invoice_1" });
    const approved = await privileged;
    expect(ordinary).toMatchObject({ headers: { Authorization: "Bearer ordinary" } });
    expect(
      (ordinary as { headers: Record<string, string> }).headers["X-Approval-Token"],
    ).toBeUndefined();
    expect(approved).toMatchObject({
      headers: { Authorization: "Bearer ordinary", "X-Approval-Token": "one-time-secret" },
      arguments: { amount: 1200, nested: { account: "acct_7" } },
    });
    expect(observedHeaders.filter((headers) => headers["X-Approval-Token"])).toHaveLength(1);
    expect(clients).toHaveLength(2);
    expect(clients.find((client) => client.headers["X-Approval-Token"])?.closed).toBe(true);
    expect(clients.find((client) => !client.headers["X-Approval-Token"])?.closed).toBe(false);
  });
});
