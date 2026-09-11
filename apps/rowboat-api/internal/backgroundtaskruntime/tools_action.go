package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/actionproposal"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/google/uuid"
)

// ActionProposal is the result of a propose-action call: a pending, human-gated
// finance action (RFC 023). The runtime never executes it — an operator
// approves it in the cockpit, and execution is brokered behind a single-use,
// params-bound approval token.
type ActionProposal struct {
	ProposalID    string
	CorrelationID string
	Status        string
}

// ActionProposalRequest is the typed action the model proposes.
type ActionProposalRequest struct {
	UserID     uuid.UUID
	RunID      string
	Target     string
	Kind       string
	ParamsJSON string
	Financial  bool
	Rationale  string
	EntityID   string
}

// ActionProposer records a pending ActionProposal on the model's behalf. It is
// the narrow seam the propose-action tool needs; the concrete broker lives in
// internal/actions and is adapted in at wiring time, keeping this package free
// of a dependency on the broker (and of any execute capability).
type ActionProposer interface {
	ProposeAction(ctx context.Context, req ActionProposalRequest) (ActionProposal, error)
}

// NewActionProposalReadTool exposes the signed-in user's closed-loop finance
// action queue without exposing approval tokens or changing proposal state.
func NewActionProposalReadTool(client *ent.Client, ownerID uuid.UUID) Tool {
	return &actionProposalReadTool{client: client, ownerID: ownerID}
}

type actionProposalReadTool struct {
	client  *ent.Client
	ownerID uuid.UUID
}

func (*actionProposalReadTool) Name() string { return "action_proposal.read" }

func (*actionProposalReadTool) Description() string {
	return "Read closed-loop finance action proposals for the signed-in user, including pending, approved, executed, failed, rejected, and expired state. This never approves, rejects, or executes an action and returns no approval tokens."
}

func (*actionProposalReadTool) AuditInfo(json.RawMessage) ToolAudit {
	return ToolAudit{TrustTier: TierRead, Connector: "actions", Operation: "action_proposal.read"}
}

func (*actionProposalReadTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"proposalId":{"type":"string","format":"uuid","description":"Optional exact proposal ID."},"status":{"type":"string","enum":["pending","approved","rejected","executed","failed","executed_unconfirmed","expired"],"description":"Optional lifecycle status. Defaults to pending unless proposalId is provided."},"limit":{"type":"integer","minimum":1,"maximum":50,"description":"Maximum proposals to return; defaults to 20."}},"additionalProperties":false}`)
}

func (t *actionProposalReadTool) Invoke(ctx context.Context, scope ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("action proposal reading is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("action proposal reader scope does not match workflow owner")
	}
	var in struct {
		ProposalID string `json:"proposalId"`
		Status     string `json:"status"`
		Limit      int    `json:"limit"`
	}
	if len(args) > 0 {
		if err := json.Unmarshal(args, &in); err != nil {
			return nil, fmt.Errorf("action_proposal.read: invalid arguments: %w", err)
		}
	}
	if in.Limit == 0 {
		in.Limit = 20
	}
	if in.Limit < 1 || in.Limit > 50 {
		return nil, errors.New("action_proposal.read: limit must be between 1 and 50")
	}
	var proposalID uuid.UUID
	if raw := strings.TrimSpace(in.ProposalID); raw != "" {
		var err error
		proposalID, err = uuid.Parse(raw)
		if err != nil {
			return nil, errors.New("action_proposal.read: proposalId must be a UUID")
		}
	}
	status := strings.TrimSpace(in.Status)
	if status == "" && proposalID == uuid.Nil {
		status = "pending"
	}
	switch status {
	case "", "pending", "approved", "rejected", "executed", "failed", "executed_unconfirmed", "expired":
	default:
		return nil, errors.New("action_proposal.read: unsupported status")
	}

	q := t.client.ActionProposal.Query().Where(actionproposal.HasUserWith(user.IDEQ(t.ownerID)))
	if proposalID != uuid.Nil {
		q = q.Where(actionproposal.IDEQ(proposalID))
	}
	if status != "" {
		q = q.Where(actionproposal.StatusEQ(status))
	}
	// ponytail: 50 newest records are enough for the cockpit; add cursor
	// pagination only when a real queue outgrows this bound.
	list, err := q.Order(ent.Desc(actionproposal.FieldCreatedAt), ent.Desc(actionproposal.FieldID)).Limit(in.Limit).All(auth.WithInternal(ctx))
	if err != nil {
		return nil, fmt.Errorf("action_proposal.read: %w", err)
	}
	proposals := make([]map[string]any, 0, len(list))
	for _, p := range list {
		proposals = append(proposals, map[string]any{
			"id": p.ID.String(), "target": p.Target, "kind": p.Kind,
			"paramsJson": truncate(p.ParamsJSON, 4000), "financial": p.Financial,
			"rationale": truncate(p.Rationale, 1000), "status": p.Status,
			"correlationId": p.CorrelationID, "entityId": p.EntityID, "originRunId": p.OriginRunID,
			"resultRef": p.ResultRef, "reason": truncate(p.Reason, 1000), "returnEventId": p.ReturnEventID,
			"expiresAt": p.ExpiresAt, "approvedAt": p.ApprovedAt, "executedAt": p.ExecutedAt,
			"resolvedAt": p.ResolvedAt, "createdAt": p.CreatedAt, "updatedAt": p.UpdatedAt,
		})
	}
	return json.Marshal(map[string]any{
		"proposals": proposals, "count": len(proposals),
		"note": "Finance action proposals read; no approval token was returned and no action was changed.",
	})
}

// NewProposeActionTool exposes the allowlisted, propose-ONLY action tool. The
// model can record a typed finance action for human approval but can never
// execute one: there is deliberately no execute tool in the registry (RFC 023
// "the model proposes; it never executes").
func NewProposeActionTool(proposer ActionProposer) Tool {
	return &proposeActionTool{proposer: proposer}
}

type proposeActionTool struct {
	proposer ActionProposer
}

func (t *proposeActionTool) Name() string { return "action.propose" }

func (t *proposeActionTool) Description() string {
	return "Propose a typed, closed-loop finance action (e.g. advance a dunning step, mark a dispute) for human approval. " +
		"This ONLY records a pending proposal — it never executes. An operator approves it in the cockpit, and execution " +
		"is brokered behind a single-use approval token. Use for actions that operate a finance object, not for drafting email."
}

func (t *proposeActionTool) AuditInfo(json.RawMessage) ToolAudit {
	// Proposing is a write, not an externally visible act: it creates a pending
	// row for human approval and moves no money, so it does not pause for HITL.
	return ToolAudit{TrustTier: TierWrite, Connector: "actions", Operation: "action.propose"}
}

func (t *proposeActionTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{
  "type": "object",
  "properties": {
    "target": {"type": "string", "description": "resourceRef of the object to operate, e.g. \"conduit:invoice:inv_456\""},
    "kind": {"type": "string", "description": "product action kind, e.g. \"conduit.dunning.advance\""},
    "params": {"type": "object", "description": "product-defined action parameters"},
    "financial": {"type": "boolean", "description": "true if the action moves money; requires step-up approval"},
    "rationale": {"type": "string", "description": "why this action is proposed; shown on the approval card"},
    "entityId": {"type": "string", "description": "optional entity/relationship this concerns"}
  },
  "required": ["target", "kind"]
}`)
}

func (t *proposeActionTool) Invoke(ctx context.Context, scope ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		Target    string          `json:"target"`
		Kind      string          `json:"kind"`
		Params    json.RawMessage `json:"params"`
		Financial bool            `json:"financial"`
		Rationale string          `json:"rationale"`
		EntityID  string          `json:"entityId"`
	}
	if len(args) > 0 {
		if err := json.Unmarshal(args, &in); err != nil {
			return nil, fmt.Errorf("action.propose: invalid arguments: %w", err)
		}
	}
	if strings.TrimSpace(in.Target) == "" || strings.TrimSpace(in.Kind) == "" {
		return nil, errors.New("action.propose: target and kind are required")
	}
	uid, err := uuid.Parse(scope.UserID)
	if err != nil {
		return nil, fmt.Errorf("action.propose: invalid run owner: %w", err)
	}
	var paramsJSON string
	if len(in.Params) > 0 && !isJSONNull(in.Params) {
		paramsJSON = string(in.Params)
	}
	proposal, err := t.proposer.ProposeAction(ctx, ActionProposalRequest{
		UserID:     uid,
		RunID:      scope.RunID,
		Target:     strings.TrimSpace(in.Target),
		Kind:       strings.TrimSpace(in.Kind),
		ParamsJSON: paramsJSON,
		Financial:  in.Financial,
		Rationale:  strings.TrimSpace(in.Rationale),
		EntityID:   strings.TrimSpace(in.EntityID),
	})
	if err != nil {
		return nil, fmt.Errorf("action.propose: %w", err)
	}
	return json.Marshal(map[string]any{
		"proposalId":    proposal.ProposalID,
		"correlationId": proposal.CorrelationID,
		"status":        proposal.Status,
		"note":          "Pending human approval. This action will not execute until an operator approves it.",
	})
}

// isJSONNull reports whether the raw JSON is the literal null.
func isJSONNull(raw json.RawMessage) bool {
	return strings.TrimSpace(string(raw)) == "null"
}
