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
}

const pendingApprovalTokens = new Map<string, string>();
let openApprovalUrl: ((url: string) => Promise<void>) | undefined;

export function configureMcpApprovalUrlOpener(opener: (url: string) => Promise<void>): void {
  openApprovalUrl = opener;
}

export function registerMcpApprovalResult(serverName: string, token: string): void {
  if (!serverName || !token || token.length > 8192) return;
  pendingApprovalTokens.set(serverName, token);
}

export function consumeMcpApprovalToken(serverName: string): string | undefined {
  const token = pendingApprovalTokens.get(serverName);
  pendingApprovalTokens.delete(serverName);
  return token;
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
    };
  }
  if (
    code === "connection_revoked" ||
    code === "connection_invalidated" ||
    code === "policy_invalidated"
  ) {
    return {
      kind: "policy_invalidated",
      status: detectedStatus,
      message: "This connection was invalidated by product or policy.",
    };
  }
  if (
    code === "token_expired" ||
    code === "reauth_required" ||
    /reauth|refresh token/i.test(text)
  ) {
    return {
      kind: "reauth_required",
      status: detectedStatus ?? 401,
      message: "Reconnect this product before retrying.",
    };
  }
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

export async function handleApprovalChallenge(
  serverName: string,
  error: unknown,
): Promise<DirectProductMcpError> {
  const classified = classifyDirectProductMcpError(error);
  if (classified.kind !== "approval_required" || !classified.approvalChallengeUrl)
    return classified;
  const url = new URL(classified.approvalChallengeUrl);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))
  ) {
    return { ...classified, message: "The product returned an unsafe approval URL." };
  }
  if (openApprovalUrl) await openApprovalUrl(url.toString());
  return {
    ...classified,
    message: `Approval opened in your browser. Complete it, then explicitly retry the action for ${serverName}.`,
  };
}
