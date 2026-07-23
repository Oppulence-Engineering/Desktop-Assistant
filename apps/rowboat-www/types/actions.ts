// Types for the RFC 023 closed-loop action broker surface. The model proposes a
// typed finance action; an operator approves it here, which issues a single-use
// token; execution runs it against the product and the loop closes when the
// product's return event arrives.

export type ActionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "failed"
  | "executed_unconfirmed"
  | "expired";

export interface ActionProposal {
  id: string;
  target: string;
  kind: string;
  paramsJson?: string;
  financial: boolean;
  rationale?: string;
  status: ActionStatus;
  correlationId?: string;
  entityId?: string;
  originRunId?: string;
  resultRef?: string;
  reason?: string;
  returnEventId?: string;
  approvedAt?: string;
  executedAt?: string;
  resolvedAt?: string;
  createdAt: string;
}

export interface ApproveResult {
  proposal: ActionProposal;
  token: string; // returned exactly once; used immediately to execute
  expiresAt: string;
}

export interface TokenView {
  hashPrefix: string;
  paramsHash: string;
  stepUp: boolean;
  expiresAt: string;
  consumed: boolean;
  consumedAt?: string;
  issuedAt: string;
}

export interface AuditEntry {
  proposal: ActionProposal;
  tokens: TokenView[];
}

export interface AuditChain {
  resourceRef: string;
  entries: AuditEntry[];
}
