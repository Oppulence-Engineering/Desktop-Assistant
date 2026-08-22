import type {
  ConversationDeletionReceipt,
  ConversationGovernanceDecision,
  ConversationPolicyLayer,
  ResolvedConversationPolicy,
} from "@x/shared/relationships";
import { conversationFingerprint } from "./conversation-utils.js";

const CAPTURE_ORDER = ["deny", "require_consent", "allow"] as const;
const ROUTE_ORDER = ["local_only", "region_restricted", "hosted_allowed"] as const;

function stricter<T extends string>(order: readonly T[], left: T, right: T): T {
  return order.indexOf(left) <= order.indexOf(right) ? left : right;
}

/** Resolve every layer monotonically: a child can only make handling stricter. */
export function resolveConversationPolicy(
  layers: ConversationPolicyLayer[],
  resolvedAt: string,
): ResolvedConversationPolicy {
  if (layers.length === 0) throw new Error("at least one policy layer is required");
  const scopeOrder = ["organization", "workspace", "account", "user", "meeting"];
  const ordered = [...layers].sort(
    (left, right) => scopeOrder.indexOf(left.scope) - scopeOrder.indexOf(right.scope),
  );
  const first = ordered[0];
  const resolved = ordered.slice(1).reduce(
    (current, layer) => ({
      capture: stricter(CAPTURE_ORDER, current.capture, layer.capture),
      modelRoute: stricter(ROUTE_ORDER, current.modelRoute, layer.modelRoute),
      publishEvidence: current.publishEvidence && layer.publishEvidence,
      externalShare: current.externalShare && layer.externalShare,
      retentionDays: Math.min(current.retentionDays, layer.retentionDays),
      redactionClasses: [...new Set([...current.redactionClasses, ...layer.redactionClasses])],
      legalHold: current.legalHold || layer.legalHold,
    }),
    {
      capture: first.capture,
      modelRoute: first.modelRoute,
      publishEvidence: first.publishEvidence,
      externalShare: first.externalShare,
      retentionDays: first.retentionDays,
      redactionClasses: [...first.redactionClasses],
      legalHold: first.legalHold,
    },
  );
  return {
    ...resolved,
    policyVersion: `policy:${conversationFingerprint(
      JSON.stringify(ordered.map((layer) => [layer.layerId, layer])),
    )}`,
    sourceLayerIds: ordered.map((layer) => layer.layerId),
    resolvedAt,
  };
}

export function evaluateConversationPolicy(args: {
  policy: ResolvedConversationPolicy;
  checkpoint: ConversationGovernanceDecision["checkpoint"];
  participantConsent: "confirmed" | "not_required" | "missing" | "unknown";
  requestedRoute?: "device" | "cloud";
  decidedAt: string;
}): ConversationGovernanceDecision {
  let allowed = true;
  let reason = "effective policy permits this operation";
  let route: ConversationGovernanceDecision["route"] = args.requestedRoute ?? "none";
  if (args.checkpoint === "capture" && args.policy.capture === "deny") {
    allowed = false;
    reason = "capture is denied by effective policy";
  } else if (
    args.checkpoint === "capture" &&
    args.policy.capture === "require_consent" &&
    !["confirmed", "not_required"].includes(args.participantConsent)
  ) {
    allowed = false;
    reason = "required participant consent is not confirmed";
  } else if (
    args.requestedRoute === "cloud" &&
    args.policy.modelRoute === "local_only" &&
    ["transcription", "semantic_enrichment", "evidence_publication"].includes(args.checkpoint)
  ) {
    allowed = false;
    reason = "local-only policy prohibits a cloud route";
    route = "none";
  } else if (args.checkpoint === "evidence_publication" && !args.policy.publishEvidence) {
    allowed = false;
    reason = "shared evidence publication is disabled";
  } else if (args.checkpoint === "external_share" && !args.policy.externalShare) {
    allowed = false;
    reason = "external sharing is disabled";
  }
  return {
    decisionId: `governance:${conversationFingerprint(
      `${args.policy.policyVersion}:${args.checkpoint}:${args.decidedAt}:${args.requestedRoute ?? "none"}`,
    )}`,
    checkpoint: args.checkpoint,
    policyVersion: args.policy.policyVersion,
    allowed,
    route,
    reason,
    redactionClasses: args.policy.redactionClasses,
    decidedAt: args.decidedAt,
  };
}

export function redactConversationText(
  text: string,
  classes: ResolvedConversationPolicy["redactionClasses"],
  workspaceTerms: string[] = [],
): { text: string; replacements: number } {
  let output = text;
  let replacements = 0;
  const replace = (pattern: RegExp, label: string) => {
    output = output.replace(pattern, () => {
      replacements += 1;
      return `[REDACTED_${label}]`;
    });
  };
  if (classes.includes("credentials"))
    replace(/\b(?:api[_ -]?key|password|secret|token)\s*[:=]\s*\S+/gi, "CREDENTIAL");
  if (classes.includes("financial")) replace(/\b(?:\d[ -]*?){13,19}\b/g, "FINANCIAL");
  if (classes.includes("personal_identifier"))
    replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "IDENTIFIER");
  if (classes.includes("health"))
    replace(/\b(?:diagnosis|patient|medical record|prescription)\b[^.!?]*/gi, "HEALTH");
  if (classes.includes("workspace_term")) {
    for (const term of workspaceTerms.filter(Boolean)) {
      replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "WORKSPACE_TERM");
    }
  }
  return { text: output, replacements };
}

export function finalizeDeletionReceipt(
  receipt: ConversationDeletionReceipt,
  completedAt: string,
): ConversationDeletionReceipt {
  if (receipt.legalHold) return { ...receipt, status: "blocked" };
  const pending = receipt.targets.some((target) => ["pending", "failed"].includes(target.status));
  const blocked = receipt.targets.some((target) => target.status === "blocked");
  if (blocked) return { ...receipt, status: "blocked" };
  if (pending) return { ...receipt, status: "partial" };
  return { ...receipt, status: "verified", completedAt };
}
