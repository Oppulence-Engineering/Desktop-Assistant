import { createHash, randomBytes } from "node:crypto";
import {
  DEEP_LINK_SCHEME,
  LEGACY_DEEP_LINK_SCHEME,
  OLDEST_DEEP_LINK_SCHEME,
} from "@x/shared/branding";
import type { McpApprovalRequestBinding } from "./approval-request.js";

export type DirectProductMcpErrorKind =
  | "authentication_required"
  | "forbidden"
  | "approval_required"
  | "reauth_required"
  | "policy_invalidated"
  | "request_failed";

export interface DirectProductMcpError {
  kind: DirectProductMcpErrorKind;
  status?: number;
  message: string;
  approvalChallengeUrl?: string;
  actor?: string;
  action?: string;
}

export interface McpApprovalCompletion {
  challengeId: string;
  status: "approved" | "denied" | "cancelled" | "expired";
  code?: string;
}

export interface McpApprovalRedemption {
  approvalToken: string;
}

const APPROVAL_DEEP_LINK_SCHEMES = [
  DEEP_LINK_SCHEME,
  LEGACY_DEEP_LINK_SCHEME,
  OLDEST_DEEP_LINK_SCHEME,
] as const;

/** Parse the packaged desktop callback for a one-time product approval. */
export function parseMcpApprovalDeepLink(url: string): McpApprovalCompletion | null {
  const scheme = APPROVAL_DEEP_LINK_SCHEMES.find((candidate) => url.startsWith(`${candidate}://`));
  if (!scheme) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "mcp-approval" || (parsed.pathname !== "" && parsed.pathname !== "/"))
    return null;

  const challengeId =
    parsed.searchParams.get("challenge_id") ?? parsed.searchParams.get("desktop_challenge_id");
  const statusValue = parsed.searchParams.get("status") ?? "approved";
  const code = parsed.searchParams.get("code");
  // Bearer-shaped parameters are rejected rather than ignored so legacy or
  // malicious callbacks can never accidentally reintroduce URL token handling.
  if (
    !challengeId ||
    parsed.searchParams.has("approval_token") ||
    parsed.searchParams.has("token") ||
    !["approved", "denied", "cancelled", "expired"].includes(statusValue) ||
    (statusValue === "approved" && !code)
  )
    return null;
  return {
    challengeId,
    status: statusValue as McpApprovalCompletion["status"],
    code: code ?? undefined,
  };
}

type PendingApproval = {
  challengeId: string;
  binding: Readonly<McpApprovalRequestBinding & { actor?: string; action?: string }>;
  expiresAt: number;
  verifier: string;
  productOrigin: string;
  redeem: (
    code: string,
    verifier: string,
    productOrigin: string,
    binding: Readonly<McpApprovalRequestBinding & { actor?: string; action?: string }>,
  ) => Promise<McpApprovalRedemption>;
  retry: (
    token: string,
    binding: Readonly<McpApprovalRequestBinding & { actor?: string; action?: string }>,
  ) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const MAX_PENDING_APPROVALS = 32;
const APPROVAL_TTL_MS = 5 * 60_000;
const pendingApprovals = new Map<string, PendingApproval>();
let openApprovalUrl: ((url: string) => Promise<void>) | undefined;

export function configureMcpApprovalUrlOpener(opener: (url: string) => Promise<void>): void {
  openApprovalUrl = opener;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("MCP tool arguments must be JSON serializable.");
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => (JSON.stringify(item) === undefined ? "null" : canonicalize(item)))
      .join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => JSON.stringify(record[key]) !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/** Capture the exact JSON arguments that were presented to the product for approval. */
export function snapshotMcpArguments(
  input: Record<string, unknown>,
): Readonly<Record<string, unknown>> {
  const canonical = canonicalize(input);
  return deepFreeze(JSON.parse(canonical) as Record<string, unknown>);
}

export function canonicalArgumentsDigest(input: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalize(input)).digest("base64url");
}

function finishPending(pending: PendingApproval): void {
  clearTimeout(pending.timer);
  pendingApprovals.delete(pending.challengeId);
}

function rejectPending(pending: PendingApproval, message: string): void {
  finishPending(pending);
  pending.reject(new Error(message));
}

export function cancelPendingMcpApprovals(reason = "Approval was cancelled."): void {
  for (const pending of [...pendingApprovals.values()]) rejectPending(pending, reason);
}

export function pendingMcpApprovalCount(): number {
  return pendingApprovals.size;
}

export function registerMcpApprovalResult(completion: McpApprovalCompletion): boolean {
  const pending = pendingApprovals.get(completion.challengeId);
  if (!pending) return false;
  if (Date.now() >= pending.expiresAt || completion.status === "expired") {
    rejectPending(pending, "Approval expired before the product action could resume.");
    return false;
  }
  if (completion.status !== "approved" || !completion.code || completion.code.length > 1024) {
    rejectPending(pending, `Approval was ${completion.status}.`);
    return false;
  }

  // Remove before redemption. A replayed protocol invocation cannot trigger a
  // second HTTPS exchange, and the approval bearer never enters this URL path.
  finishPending(pending);
  void pending
    .redeem(completion.code, pending.verifier, pending.productOrigin, pending.binding)
    .then(({ approvalToken }) => {
      if (!approvalToken || approvalToken.length > 8192)
        throw new Error("The product returned an invalid approval redemption response.");
      return pending.retry(approvalToken, pending.binding);
    })
    .then(pending.resolve, pending.reject);
  return true;
}

function errorRecord(error: unknown): Record<string, unknown> {
  return error && typeof error === "object" ? (error as Record<string, unknown>) : {};
}

export function classifyDirectProductMcpError(error: unknown): DirectProductMcpError {
  const record = errorRecord(error);
  const cause = errorRecord(record.cause);
  const response = errorRecord(record.response ?? cause.response);
  const statusValue = record.status ?? cause.status ?? response.status;
  const status = typeof statusValue === "number" ? statusValue : undefined;
  const text = [record.message, cause.message, record.body, cause.body]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  let parsed: Record<string, unknown> = {};
  for (const candidate of text.match(/\{[\s\S]*\}/g) ?? []) {
    try {
      parsed = JSON.parse(candidate) as Record<string, unknown>;
      break;
    } catch {
      /* continue */
    }
  }
  const code = String(parsed.code ?? record.code ?? "").toLowerCase();
  const detectedStatus =
    status ?? [401, 403, 428].find((value) => new RegExp(`\\b${value}\\b`).test(text));
  const challenge =
    parsed.approvalChallengeUrl ?? parsed.approval_challenge_url ?? record.approvalChallengeUrl;
  if (detectedStatus === 428 || parsed.approvalRequired === true || code === "approval_required") {
    return {
      kind: "approval_required",
      status: 428,
      message: "This product action requires one-time approval.",
      approvalChallengeUrl: typeof challenge === "string" ? challenge : undefined,
      actor: typeof parsed.actor === "string" ? parsed.actor : undefined,
      action: typeof parsed.action === "string" ? parsed.action : undefined,
    };
  }
  if (["connection_revoked", "connection_invalidated", "policy_invalidated"].includes(code))
    return {
      kind: "policy_invalidated",
      status: detectedStatus,
      message: "This connection was invalidated by product or policy.",
    };
  if (code === "token_expired" || code === "reauth_required" || /reauth|refresh token/i.test(text))
    return {
      kind: "reauth_required",
      status: detectedStatus ?? 401,
      message: "Reconnect this product before retrying.",
    };
  if (detectedStatus === 401)
    return {
      kind: "authentication_required",
      status: 401,
      message: "The product connection is not authenticated.",
    };
  if (detectedStatus === 403)
    return {
      kind: "forbidden",
      status: 403,
      message:
        "The product denied this action because the grant, scope, or policy does not allow it.",
    };
  return {
    kind: "request_failed",
    status: detectedStatus,
    message: text || "The product MCP request failed.",
  };
}

export async function awaitApprovalAndRetry(
  serverName: string,
  toolName: string,
  input: Record<string, unknown>,
  error: unknown,
  requestBinding: Readonly<McpApprovalRequestBinding> | undefined,
  retry: (
    token: string,
    binding: Readonly<McpApprovalRequestBinding & { actor?: string; action?: string }>,
  ) => Promise<unknown>,
  redeem: PendingApproval["redeem"],
): Promise<unknown> {
  const classified = classifyDirectProductMcpError(error);
  if (classified.kind !== "approval_required" || !classified.approvalChallengeUrl)
    throw new Error(classified.message, { cause: classified });
  let url: URL;
  try {
    url = new URL(classified.approvalChallengeUrl);
  } catch {
    throw new Error("The product returned an invalid approval URL.");
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))
  )
    throw new Error("The product returned an unsafe approval URL.");
  const productOrigin = requestBinding?.endpoint.origin;
  if (!productOrigin) throw new Error("The approval-required MCP request had no product origin.");
  if (url.origin !== productOrigin)
    throw new Error("The approval URL did not match the exact product origin.");
  if (!openApprovalUrl) throw new Error("Approval cannot be opened on this device.");
  if (pendingApprovals.size >= MAX_PENDING_APPROVALS)
    throw new Error("Too many product approvals are pending.");

  const challengeId = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const verifierChallenge = createHash("sha256").update(verifier).digest("base64url");
  const argumentsDigest = canonicalArgumentsDigest(input);
  if (
    !requestBinding ||
    requestBinding.serverName !== serverName ||
    requestBinding.toolName !== toolName ||
    requestBinding.argumentsDigest !== argumentsDigest
  )
    throw new Error("The approval-required MCP request could not be bound to its exact transport.");
  const binding = deepFreeze({
    ...requestBinding,
    endpoint: { ...requestBinding.endpoint },
    configuredEndpoint: { ...requestBinding.configuredEndpoint },
    actor: classified.actor,
    action: classified.action,
    desktopChallengeId: challengeId,
  });
  url.searchParams.set("desktop_challenge_id", challengeId);
  url.searchParams.set("desktop_server", serverName);
  url.searchParams.set("desktop_tool", toolName);
  url.searchParams.set("desktop_arguments_digest", argumentsDigest);
  url.searchParams.set("desktop_connection_id", requestBinding.connectionId ?? "");
  url.searchParams.set("desktop_code_challenge", verifierChallenge);
  url.searchParams.set("desktop_code_challenge_method", "S256");
  if (classified.actor) url.searchParams.set("desktop_actor", classified.actor);
  if (classified.action) url.searchParams.set("desktop_action", classified.action);

  return await new Promise<unknown>((resolve, reject) => {
    const expiresAt = Date.now() + APPROVAL_TTL_MS;
    const pending: PendingApproval = {
      challengeId,
      binding,
      expiresAt,
      verifier,
      productOrigin,
      redeem,
      retry,
      resolve,
      reject,
      timer: setTimeout(() => {
        const current = pendingApprovals.get(challengeId);
        if (current) rejectPending(current, "Approval expired before completion.");
      }, APPROVAL_TTL_MS),
    };
    pendingApprovals.set(challengeId, pending);
    openApprovalUrl!(url.toString()).catch((openError) => {
      if (pendingApprovals.get(challengeId) === pending) {
        finishPending(pending);
        reject(openError instanceof Error ? openError : new Error("Could not open approval."));
      }
    });
  });
}
