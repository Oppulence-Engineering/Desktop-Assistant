import { createHash } from "node:crypto";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";

export interface NormalizedMcpEndpoint {
  origin: string;
  path: string;
}

export interface McpConfigApprovalSnapshot {
  serverName: string;
  configuredEndpoint: NormalizedMcpEndpoint;
  connectionId?: string;
  configGeneration: number;
  configDigest: string;
  configuredHeadersDigest: string;
  credentialFingerprint: string;
}

export interface ObservedMcpToolCallRequest {
  endpoint: NormalizedMcpEndpoint;
  headersDigest: string;
  authorizationSessionFingerprint: string;
  sessionId?: string;
  toolName: string;
  argumentsDigest: string;
}

export interface McpApprovalRequestBinding
  extends McpConfigApprovalSnapshot, ObservedMcpToolCallRequest {
  argumentsDigest: string;
  desktopChallengeId?: string;
}

type ToolCallBody = {
  method: "tools/call";
  params: {
    name: string;
    arguments?: Record<string, unknown>;
  };
};

function digest(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function normalizedHeaderEntries(headersInit?: HeadersInit): Array<[string, string]> {
  const headers = new Headers(headersInit);
  return [...headers.entries()]
    .map(([name, value]) => [name.toLowerCase(), value.trim()] as [string, string])
    .sort(([left], [right]) => left.localeCompare(right));
}

export function normalizeMcpEndpoint(value: string | URL): NormalizedMcpEndpoint {
  const url = value instanceof URL ? new URL(value.href) : new URL(value);
  return Object.freeze({ origin: url.origin, path: url.pathname || "/" });
}

export function sameMcpEndpoint(
  left: NormalizedMcpEndpoint,
  right: NormalizedMcpEndpoint,
): boolean {
  return left.origin === right.origin && left.path === right.path;
}

export function mcpHeadersDigest(headersInit?: HeadersInit): string {
  return digest(JSON.stringify(normalizedHeaderEntries(headersInit)));
}

const AUTHORIZATION_SESSION_HEADERS = new Set([
  "authorization",
  "cookie",
  "mcp-session-id",
  "proxy-authorization",
  "x-api-key",
  "x-auth-token",
  "x-connection-id",
  "x-session-id",
]);

export function mcpAuthorizationSessionFingerprint(headersInit?: HeadersInit): string {
  const credentialHeaders = normalizedHeaderEntries(headersInit).filter(
    ([name]) =>
      AUTHORIZATION_SESSION_HEADERS.has(name) ||
      name.includes("credential") ||
      name.includes("session") ||
      name.includes("token"),
  );
  return digest(JSON.stringify(credentialHeaders));
}

function requestUrl(input: Parameters<FetchLike>[0]): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(input.toString());
}

function requestHeaders(input: Parameters<FetchLike>[0], init?: RequestInit): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
  return headers;
}

function requestBody(
  input: Parameters<FetchLike>[0],
  init?: RequestInit,
): BodyInit | null | undefined {
  if (init?.body !== undefined) return init.body;
  return input instanceof Request ? input.body : undefined;
}

function parseToolCallBody(body: BodyInit | null | undefined): ToolCallBody | null {
  if (typeof body !== "string") return null;
  try {
    const value = JSON.parse(body) as Record<string, unknown>;
    if (value.method !== "tools/call" || !value.params || typeof value.params !== "object")
      return null;
    const params = value.params as Record<string, unknown>;
    if (typeof params.name !== "string") return null;
    if (
      params.arguments !== undefined &&
      (!params.arguments || typeof params.arguments !== "object" || Array.isArray(params.arguments))
    )
      return null;
    return {
      method: "tools/call",
      params: {
        name: params.name,
        arguments: (params.arguments ?? {}) as Record<string, unknown>,
      },
    };
  } catch {
    return null;
  }
}

function sessionId(headers: Headers): string | undefined {
  return headers.get("mcp-session-id") ?? undefined;
}

export function createObservedMcpFetch(
  fetchImpl: FetchLike,
  argumentsDigest: (input: Record<string, unknown>) => string,
  observe: (request: ObservedMcpToolCallRequest) => void,
): FetchLike {
  return async (input, init) => {
    const toolCall = parseToolCallBody(requestBody(input, init));
    if (toolCall) {
      const headers = requestHeaders(input, init);
      observe(
        Object.freeze({
          endpoint: normalizeMcpEndpoint(requestUrl(input)),
          headersDigest: mcpHeadersDigest(headers),
          authorizationSessionFingerprint: mcpAuthorizationSessionFingerprint(headers),
          sessionId: sessionId(headers),
          toolName: toolCall.params.name,
          argumentsDigest: argumentsDigest(toolCall.params.arguments ?? {}),
        }),
      );
    }
    return fetchImpl(input, init);
  };
}

export function createOneShotApprovalFetch(options: {
  fetchImpl: FetchLike;
  token: string;
  binding: Readonly<McpApprovalRequestBinding>;
  argumentsDigest: (input: Record<string, unknown>) => string;
  validateCurrent: () => Promise<void>;
}): FetchLike {
  let consumed = false;
  return async (input, init) => {
    const toolCall = parseToolCallBody(requestBody(input, init));
    if (!toolCall) return options.fetchImpl(input, init);
    if (consumed)
      throw new Error("The one-time MCP approval token was already applied to its request.");

    const headers = requestHeaders(input, init);
    const endpoint = normalizeMcpEndpoint(requestUrl(input));
    const actualArgumentsDigest = options.argumentsDigest(toolCall.params.arguments ?? {});
    if (
      (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase() !==
        "POST" ||
      !sameMcpEndpoint(endpoint, options.binding.endpoint) ||
      toolCall.params.name !== options.binding.toolName ||
      actualArgumentsDigest !== options.binding.argumentsDigest ||
      mcpHeadersDigest(headers) !== options.binding.headersDigest ||
      mcpAuthorizationSessionFingerprint(headers) !==
        options.binding.authorizationSessionFingerprint ||
      sessionId(headers) !== options.binding.sessionId
    )
      throw new Error("The approved MCP request changed before the one-time retry.");

    await options.validateCurrent();
    consumed = true;
    headers.set("X-Approval-Token", options.token);
    const response = await options.fetchImpl(input, {
      ...init,
      headers,
      // Never allow fetch to copy the one-time credential onto a redirect.
      redirect: "manual",
    });
    if (
      response.redirected ||
      (response.url && !sameMcpEndpoint(normalizeMcpEndpoint(response.url), endpoint))
    )
      throw new Error("The approved MCP request attempted to change endpoints.");
    return response;
  };
}
