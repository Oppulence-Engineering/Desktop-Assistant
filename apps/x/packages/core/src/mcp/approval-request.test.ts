import { describe, expect, it, vi } from "vitest";
import { canonicalArgumentsDigest } from "./product-approval.js";
import {
  createObservedMcpFetch,
  createOneShotApprovalFetch,
  mcpAuthorizationSessionFingerprint,
  mcpHeadersDigest,
  normalizeMcpEndpoint,
  type McpApprovalRequestBinding,
} from "./approval-request.js";

const endpoint = "https://product.example/mcp";
const headers = {
  Authorization: "Bearer ordinary",
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
  "Mcp-Session-Id": "session-1",
};
const input = { amount: 1200, destination: "acct_7" };

function binding(overrides: Partial<McpApprovalRequestBinding> = {}): McpApprovalRequestBinding {
  return {
    serverName: "product",
    configuredEndpoint: normalizeMcpEndpoint(endpoint),
    connectionId: "connection-1",
    configGeneration: 7,
    configDigest: "config-7",
    configuredHeadersDigest: mcpHeadersDigest({ Authorization: "Bearer ordinary" }),
    credentialFingerprint: mcpAuthorizationSessionFingerprint({
      Authorization: "Bearer ordinary",
    }),
    endpoint: normalizeMcpEndpoint(endpoint),
    headersDigest: mcpHeadersDigest(headers),
    authorizationSessionFingerprint: mcpAuthorizationSessionFingerprint(headers),
    sessionId: "session-1",
    toolName: "release",
    argumentsDigest: canonicalArgumentsDigest(input),
    ...overrides,
  };
}

function rpc(method: string, params: Record<string, unknown> = {}): string {
  return JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
}

function callInit(
  body: string,
  requestHeaders: HeadersInit = headers,
  url = endpoint,
): [string, RequestInit] {
  return [url, { method: "POST", headers: requestHeaders, body }];
}

describe("MCP one-shot approval request binding", () => {
  it("observes the exact tools/call endpoint, headers, session, tool, and arguments", async () => {
    const observed = vi.fn();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    const wrapped = createObservedMcpFetch(fetchImpl, canonicalArgumentsDigest, observed);

    await wrapped(...callInit(rpc("tools/call", { name: "release", arguments: input })));

    expect(observed).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: normalizeMcpEndpoint(endpoint),
        headersDigest: mcpHeadersDigest(headers),
        authorizationSessionFingerprint: mcpAuthorizationSessionFingerprint(headers),
        sessionId: "session-1",
        toolName: "release",
        argumentsDigest: canonicalArgumentsDigest(input),
      }),
    );
  });

  it("applies the token to exactly one exact tools/call request, never initialize or fallback setup", async () => {
    const requests: Array<{ url: string; headers: Headers; redirect?: RequestRedirect }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: url.toString(),
        headers: new Headers(init?.headers),
        redirect: init?.redirect,
      });
      return new Response(null, { status: 202 });
    });
    const wrapped = createOneShotApprovalFetch({
      fetchImpl,
      token: "one-time-secret",
      binding: binding(),
      argumentsDigest: canonicalArgumentsDigest,
      validateCurrent: async () => {},
    });

    await wrapped(...callInit(rpc("initialize", { protocolVersion: "2025-06-18" })));
    await wrapped(endpoint, { method: "GET", headers: { Accept: "text/event-stream" } });
    await wrapped(...callInit(rpc("tools/call", { name: "release", arguments: input })));

    expect(requests[0].headers.get("x-approval-token")).toBeNull();
    expect(requests[1].headers.get("x-approval-token")).toBeNull();
    expect(requests[2].headers.get("x-approval-token")).toBe("one-time-secret");
    expect(requests[2].redirect).toBe("manual");
    await expect(
      wrapped(...callInit(rpc("tools/call", { name: "release", arguments: input }))),
    ).rejects.toThrow(/already applied/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["origin", "https://attacker.example/mcp", headers],
    ["path", "https://product.example/other", headers],
    ["query", "https://product.example/mcp?tenant=other", headers],
    ["authorization", endpoint, { ...headers, Authorization: "Bearer swapped" }],
    ["session", endpoint, { ...headers, "Mcp-Session-Id": "session-2" }],
    ["header", endpoint, { ...headers, "X-Policy": "changed" }],
  ])("fails closed on %s swap before sending", async (_label, url, requestHeaders) => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    const wrapped = createOneShotApprovalFetch({
      fetchImpl,
      token: "one-time-secret",
      binding: binding(),
      argumentsDigest: canonicalArgumentsDigest,
      validateCurrent: async () => {},
    });

    await expect(
      wrapped(
        ...callInit(rpc("tools/call", { name: "release", arguments: input }), requestHeaders, url),
      ),
    ).rejects.toThrow(/changed/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("canonicalizes query ordering while preserving exact query semantics", () => {
    expect(normalizeMcpEndpoint("https://product.example/mcp?tenant=one&action=release")).toEqual(
      normalizeMcpEndpoint("https://product.example/mcp?action=release&tenant=one"),
    );
    expect(
      normalizeMcpEndpoint("https://product.example/mcp?action=release&tenant=one"),
    ).not.toEqual(normalizeMcpEndpoint("https://product.example/mcp?action=refund&tenant=one"));
  });

  it("fails closed on a concurrent config-generation mutation before token injection", async () => {
    let generation = 7;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    const wrapped = createOneShotApprovalFetch({
      fetchImpl,
      token: "one-time-secret",
      binding: binding(),
      argumentsDigest: canonicalArgumentsDigest,
      validateCurrent: async () => {
        if (generation !== 7) throw new Error("config generation changed");
      },
    });
    generation = 8;

    await expect(
      wrapped(...callInit(rpc("tools/call", { name: "release", arguments: input }))),
    ).rejects.toThrow(/generation changed/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses manual redirect mode and never reuses the token after a redirect response", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 307,
          headers: { Location: "https://attacker.example/mcp" },
        }),
    );
    const wrapped = createOneShotApprovalFetch({
      fetchImpl,
      token: "one-time-secret",
      binding: binding(),
      argumentsDigest: canonicalArgumentsDigest,
      validateCurrent: async () => {},
    });

    const response = await wrapped(
      ...callInit(rpc("tools/call", { name: "release", arguments: input })),
    );
    expect(response.status).toBe(307);
    expect(fetchImpl.mock.calls[0]?.[1]?.redirect).toBe("manual");
    await expect(
      wrapped(...callInit(rpc("tools/call", { name: "release", arguments: input }))),
    ).rejects.toThrow(/already applied/);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
