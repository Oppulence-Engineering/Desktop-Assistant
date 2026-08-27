import { createHash, randomBytes } from "node:crypto";

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
  serverName: string;
  toolName: string;
  argumentsDigest: string;
  actor?: string;
  action?: string;
  status: "approved" | "denied" | "cancelled" | "expired";
  token?: string;
}

type PendingApproval = {
  challengeId: string;
  serverName: string;
  toolName: string;
  argumentsDigest: string;
  actor?: string;
  action?: string;
  expiresAt: number;
  retry: (token: string) => Promise<unknown>;
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
  const matches =
    completion.serverName === pending.serverName &&
    completion.toolName === pending.toolName &&
    completion.argumentsDigest === pending.argumentsDigest &&
    completion.actor === pending.actor &&
    completion.action === pending.action;
  if (!matches) {
    rejectPending(pending, "Approval completion did not match the pending product action.");
    return false;
  }
  if (Date.now() >= pending.expiresAt || completion.status === "expired") {
    rejectPending(pending, "Approval expired before the product action could resume.");
    return false;
  }
  if (completion.status !== "approved" || !completion.token || completion.token.length > 8192) {
    rejectPending(pending, `Approval was ${completion.status}.`);
    return false;
  }

  // Remove before retrying. A replayed deep link cannot observe or reuse the token.
  finishPending(pending);
  void pending.retry(completion.token).then(pending.resolve, pending.reject);
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
  retry: (token: string) => Promise<unknown>,
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
  if (!openApprovalUrl) throw new Error("Approval cannot be opened on this device.");
  if (pendingApprovals.size >= MAX_PENDING_APPROVALS)
    throw new Error("Too many product approvals are pending.");

  const challengeId = randomBytes(32).toString("base64url");
  const argumentsDigest = canonicalArgumentsDigest(input);
  url.searchParams.set("desktop_challenge_id", challengeId);
  url.searchParams.set("desktop_server", serverName);
  url.searchParams.set("desktop_tool", toolName);
  url.searchParams.set("desktop_arguments_digest", argumentsDigest);
  if (classified.actor) url.searchParams.set("desktop_actor", classified.actor);
  if (classified.action) url.searchParams.set("desktop_action", classified.action);

  return await new Promise<unknown>((resolve, reject) => {
    const expiresAt = Date.now() + APPROVAL_TTL_MS;
    const pending: PendingApproval = {
      challengeId,
      serverName,
      toolName,
      argumentsDigest,
      actor: classified.actor,
      action: classified.action,
      expiresAt,
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
