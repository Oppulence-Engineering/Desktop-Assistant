package agentregistry

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitment"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/revenue"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// CommitmentExportCapability returns an internal commitment record without
// sharing it or changing source data.
func CommitmentExportCapability() Capability {
	tool := &commitmentExportTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierRead, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("commitment.export", "commitment export is not configured on this server")
			}
			return &commitmentExportTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// CommitmentCompleteCapability marks an internal Oppulence commitment fulfilled.
func CommitmentCompleteCapability() Capability {
	tool := &commitmentCompleteTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("commitment.complete", "commitment completion is not configured on this server")
			}
			return &commitmentCompleteTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// CommitmentCorrectCapability corrects an internal Oppulence commitment through
// the same append-only transition used by the Commitment Queue UI.
func CommitmentCorrectCapability() Capability {
	tool := &commitmentCorrectTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("commitment.correct", "commitment correction is not configured on this server")
			}
			return &commitmentCorrectTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// CommitmentConfirmCapability confirms a candidate commitment through the same
// append-only transition used by the Commitment Queue UI.
func CommitmentConfirmCapability() Capability {
	tool := &commitmentConfirmTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("commitment.confirm", "commitment confirmation is not configured on this server")
			}
			return &commitmentConfirmTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// CommitmentAcceptCapability records acceptance through the same append-only
// transition used by the Commitment Queue UI.
func CommitmentAcceptCapability() Capability {
	tool := &commitmentAcceptTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("commitment.accept", "commitment acceptance is not configured on this server")
			}
			return &commitmentAcceptTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// CommitmentBlockCapability records a blocker through the same append-only
// transition used by the Commitment Queue UI.
func CommitmentBlockCapability() Capability {
	tool := &commitmentBlockTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("commitment.block", "commitment blocking is not configured on this server")
			}
			return &commitmentBlockTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// CommitmentUnblockCapability clears a blocker through the same append-only
// transition used by the Commitment Queue UI.
func CommitmentUnblockCapability() Capability {
	tool := &commitmentUnblockTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("commitment.unblock", "commitment unblocking is not configured on this server")
			}
			return &commitmentUnblockTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// CommitmentDisputeCapability records a dispute through the same append-only
// transition used by the Commitment Queue UI.
func CommitmentDisputeCapability() Capability {
	tool := &commitmentDisputeTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("commitment.dispute", "commitment dispute recording is not configured on this server")
			}
			return &commitmentDisputeTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

type commitmentCompleteTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type commitmentExportTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type commitmentCorrectTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type commitmentConfirmTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type commitmentAcceptTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type commitmentBlockTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type commitmentUnblockTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type commitmentDisputeTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

func (*commitmentCompleteTool) Name() string { return "commitment.complete" }
func (*commitmentCorrectTool) Name() string  { return "commitment.correct" }
func (*commitmentConfirmTool) Name() string  { return "commitment.confirm" }
func (*commitmentAcceptTool) Name() string   { return "commitment.accept" }
func (*commitmentBlockTool) Name() string    { return "commitment.block" }
func (*commitmentUnblockTool) Name() string  { return "commitment.unblock" }
func (*commitmentDisputeTool) Name() string  { return "commitment.dispute" }
func (*commitmentExportTool) Name() string   { return "commitment.export" }
func (*commitmentExportTool) Description() string {
	return "Export one internal Oppulence commitment as JSON and Markdown with its evidence and history. This reads Oppulence only and never shares the record."
}
func (*commitmentExportTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"commitmentId":{"type":"string","format":"uuid","description":"Existing commitment ID returned by relationship.read."}},"required":["commitmentId"],"additionalProperties":false}`)
}
func (*commitmentCompleteTool) Description() string {
	return "Mark an existing internal Oppulence commitment fulfilled. This records completion in Oppulence and never contacts anyone."
}
func (*commitmentCompleteTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"commitmentId":{"type":"string","format":"uuid","description":"Existing commitment ID returned by relationship.read."},"reason":{"type":"string","maxLength":1000,"description":"Optional reason or completion note."}},"required":["commitmentId"],"additionalProperties":false}`)
}
func (*commitmentCorrectTool) Description() string {
	return "Correct the text and optional due time of an existing internal Oppulence commitment. This preserves its source evidence and never contacts anyone."
}
func (*commitmentCorrectTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"commitmentId":{"type":"string","format":"uuid","description":"Existing commitment ID returned by relationship.read."},"action":{"type":"string","minLength":1,"maxLength":10000,"description":"Corrected commitment text."},"dueAt":{"type":"string","format":"date-time","description":"Optional corrected RFC 3339 due time."}},"required":["commitmentId","action"],"additionalProperties":false}`)
}
func (*commitmentConfirmTool) Description() string {
	return "Confirm that an extracted internal Oppulence commitment is accurate. This preserves its source evidence and never contacts anyone."
}
func (*commitmentConfirmTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"commitmentId":{"type":"string","format":"uuid","description":"Candidate commitment ID returned by relationship.read."}},"required":["commitmentId"],"additionalProperties":false}`)
}
func (*commitmentAcceptTool) Description() string {
	return "Record that an existing internal Oppulence commitment was accepted. This preserves its history and never contacts anyone."
}
func (*commitmentAcceptTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"commitmentId":{"type":"string","format":"uuid","description":"Eligible commitment ID returned by relationship.read."}},"required":["commitmentId"],"additionalProperties":false}`)
}
func (*commitmentBlockTool) Description() string {
	return "Record what is blocking an accepted internal Oppulence commitment. This updates only Oppulence and never contacts anyone."
}
func (*commitmentBlockTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"commitmentId":{"type":"string","format":"uuid","description":"Accepted commitment ID returned by relationship.read."},"blocker":{"type":"string","minLength":1,"maxLength":10000,"description":"Concrete reason the commitment cannot proceed."}},"required":["commitmentId","blocker"],"additionalProperties":false}`)
}
func (*commitmentUnblockTool) Description() string {
	return "Clear the blocker from an existing internal Oppulence commitment. This updates only Oppulence and never contacts anyone."
}
func (*commitmentUnblockTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"commitmentId":{"type":"string","format":"uuid","description":"Blocked commitment ID returned by relationship.read."}},"required":["commitmentId"],"additionalProperties":false}`)
}
func (*commitmentDisputeTool) Description() string {
	return "Record that an accepted or offered internal Oppulence commitment is disputed. This preserves its history and never contacts anyone."
}
func (*commitmentDisputeTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"commitmentId":{"type":"string","format":"uuid","description":"Accepted or offered commitment ID returned by relationship.read."},"reason":{"type":"string","minLength":1,"maxLength":1000,"description":"Why the commitment is disputed."}},"required":["commitmentId","reason"],"additionalProperties":false}`)
}
func (*commitmentCompleteTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "commitment.complete"}
}
func (*commitmentCorrectTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "commitment.correct"}
}
func (*commitmentConfirmTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "commitment.confirm"}
}
func (*commitmentAcceptTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "commitment.accept"}
}
func (*commitmentBlockTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "commitment.block"}
}
func (*commitmentUnblockTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "commitment.unblock"}
}
func (*commitmentDisputeTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "commitment.dispute"}
}
func (*commitmentExportTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierRead, Connector: "oppulence", Operation: "commitment.export"}
}

func (t *commitmentExportTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("commitment export is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("commitment exporter scope does not match workflow owner")
	}
	var input struct {
		CommitmentID string `json:"commitmentId"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode commitment.export input: %w", err)
	}
	id, err := uuid.Parse(strings.TrimSpace(input.CommitmentID))
	if err != nil {
		return nil, errors.New("commitment.export: commitmentId must be a UUID")
	}
	owner, err := t.client.User.Get(auth.WithInternal(ctx), t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("commitment.export: resolve owner: %w", err)
	}
	record, err := t.service.ExportCommitment(auth.WithUser(ctx, owner), owner, id)
	if err != nil {
		return nil, fmt.Errorf("commitment.export: %w", err)
	}
	return json.Marshal(map[string]any{
		"record": record, "markdown": record.Markdown(),
		"note": "Internal Oppulence commitment exported; the record was not shared or uploaded.",
	})
}

func (t *commitmentDisputeTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("commitment dispute recording is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("commitment disputer scope does not match workflow owner")
	}
	var input struct {
		CommitmentID string `json:"commitmentId"`
		Reason       string `json:"reason"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode commitment.dispute input: %w", err)
	}
	id, err := uuid.Parse(strings.TrimSpace(input.CommitmentID))
	if err != nil {
		return nil, errors.New("commitment.dispute: commitmentId must be a UUID")
	}
	reason := strings.TrimSpace(input.Reason)
	if reason == "" || len(reason) > 1000 {
		return nil, errors.New("commitment.dispute: reason must be between 1 and 1000 bytes")
	}
	internal := auth.WithInternal(ctx)
	row, err := t.client.Commitment.Query().Where(
		commitment.IDEQ(id), commitment.HasUserWith(user.IDEQ(t.ownerID)),
	).WithRelationship().Only(internal)
	if ent.IsNotFound(err) {
		return nil, errors.New("commitment.dispute: commitment not found")
	}
	if err != nil {
		return nil, fmt.Errorf("commitment.dispute: %w", err)
	}
	rel, err := row.Edges.RelationshipOrErr()
	if err != nil {
		return nil, fmt.Errorf("commitment.dispute: relationship unavailable: %w", err)
	}
	if row.Acceptance == "disputed" {
		return commitmentDisputeResult(row, rel.ID, true)
	}
	if row.Status != "open" || strings.TrimSpace(row.Blocker) != "" || (row.Acceptance != "accepted" && row.Acceptance != "offered") {
		return nil, errors.New("commitment.dispute: commitment is not eligible to be disputed")
	}
	owner, err := t.client.User.Get(internal, t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("commitment.dispute: resolve owner: %w", err)
	}
	idempotencyKey, err := durableToolKey(scope, "commitment-dispute")
	if err != nil {
		return nil, fmt.Errorf("commitment.dispute: %w", err)
	}
	row, err = t.service.AppendCommitmentTransition(auth.WithUser(ctx, owner), owner, rel.ID, row.ID, revenue.CommitmentTransitionInput{
		Kind: "disputed", IdempotencyKey: idempotencyKey, ActorType: "user", Reason: reason,
	})
	if err != nil {
		return nil, fmt.Errorf("commitment.dispute: %w", err)
	}
	return commitmentDisputeResult(row, rel.ID, false)
}

func commitmentDisputeResult(row *ent.Commitment, relationshipID uuid.UUID, alreadyDisputed bool) (json.RawMessage, error) {
	return json.Marshal(map[string]any{
		"commitmentId": row.ID.String(), "relationshipId": relationshipID.String(),
		"status": row.Status, "acceptance": row.Acceptance, "eventVersion": row.CurrentEventVersion,
		"alreadyDisputed": alreadyDisputed,
		"note":            "Internal Oppulence commitment marked disputed; no external action was taken.",
	})
}

func (t *commitmentUnblockTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("commitment unblocking is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("commitment unblocker scope does not match workflow owner")
	}
	var input struct {
		CommitmentID string `json:"commitmentId"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode commitment.unblock input: %w", err)
	}
	id, err := uuid.Parse(strings.TrimSpace(input.CommitmentID))
	if err != nil {
		return nil, errors.New("commitment.unblock: commitmentId must be a UUID")
	}
	internal := auth.WithInternal(ctx)
	row, err := t.client.Commitment.Query().Where(
		commitment.IDEQ(id), commitment.HasUserWith(user.IDEQ(t.ownerID)),
	).WithRelationship().Only(internal)
	if ent.IsNotFound(err) {
		return nil, errors.New("commitment.unblock: commitment not found")
	}
	if err != nil {
		return nil, fmt.Errorf("commitment.unblock: %w", err)
	}
	rel, err := row.Edges.RelationshipOrErr()
	if err != nil {
		return nil, fmt.Errorf("commitment.unblock: relationship unavailable: %w", err)
	}
	owner, err := t.client.User.Get(internal, t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("commitment.unblock: resolve owner: %w", err)
	}
	idempotencyKey, err := durableToolKey(scope, "commitment-unblock")
	if err != nil {
		return nil, fmt.Errorf("commitment.unblock: %w", err)
	}
	row, err = t.service.AppendCommitmentTransition(auth.WithUser(ctx, owner), owner, rel.ID, row.ID, revenue.CommitmentTransitionInput{
		Kind: "unblocked", IdempotencyKey: idempotencyKey, ActorType: "user",
		Reason: "User cleared the commitment blocker through Oppulence Assistant.",
	})
	if err != nil {
		return nil, fmt.Errorf("commitment.unblock: %w", err)
	}
	return json.Marshal(map[string]any{
		"commitmentId": row.ID.String(), "relationshipId": rel.ID.String(),
		"status": row.Status, "acceptance": row.Acceptance, "blocker": row.Blocker,
		"eventVersion": row.CurrentEventVersion,
		"note":         "Internal Oppulence commitment unblocked; no external action was taken.",
	})
}

func (t *commitmentBlockTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("commitment blocking is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("commitment blocker scope does not match workflow owner")
	}
	var input struct {
		CommitmentID string `json:"commitmentId"`
		Blocker      string `json:"blocker"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode commitment.block input: %w", err)
	}
	id, err := uuid.Parse(strings.TrimSpace(input.CommitmentID))
	if err != nil {
		return nil, errors.New("commitment.block: commitmentId must be a UUID")
	}
	blocker := strings.TrimSpace(input.Blocker)
	if blocker == "" || len(blocker) > 10000 {
		return nil, errors.New("commitment.block: blocker must be between 1 and 10000 bytes")
	}
	internal := auth.WithInternal(ctx)
	row, err := t.client.Commitment.Query().Where(
		commitment.IDEQ(id), commitment.HasUserWith(user.IDEQ(t.ownerID)),
	).WithRelationship().Only(internal)
	if ent.IsNotFound(err) {
		return nil, errors.New("commitment.block: commitment not found")
	}
	if err != nil {
		return nil, fmt.Errorf("commitment.block: %w", err)
	}
	rel, err := row.Edges.RelationshipOrErr()
	if err != nil {
		return nil, fmt.Errorf("commitment.block: relationship unavailable: %w", err)
	}
	if row.Blocker == blocker {
		return commitmentBlockResult(row, rel.ID, true)
	}
	if row.Status != "open" || row.Acceptance != "accepted" || strings.TrimSpace(row.Blocker) != "" {
		return nil, errors.New("commitment.block: commitment is not eligible to be blocked")
	}
	owner, err := t.client.User.Get(internal, t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("commitment.block: resolve owner: %w", err)
	}
	idempotencyKey, err := durableToolKey(scope, "commitment-block")
	if err != nil {
		return nil, fmt.Errorf("commitment.block: %w", err)
	}
	row, err = t.service.AppendCommitmentTransition(auth.WithUser(ctx, owner), owner, rel.ID, row.ID, revenue.CommitmentTransitionInput{
		Kind: "blocked", IdempotencyKey: idempotencyKey, ActorType: "user", Blocker: blocker,
		Reason: "User recorded a commitment blocker through Oppulence Assistant.",
	})
	if err != nil {
		return nil, fmt.Errorf("commitment.block: %w", err)
	}
	return commitmentBlockResult(row, rel.ID, false)
}

func commitmentBlockResult(row *ent.Commitment, relationshipID uuid.UUID, alreadyBlocked bool) (json.RawMessage, error) {
	return json.Marshal(map[string]any{
		"commitmentId": row.ID.String(), "relationshipId": relationshipID.String(),
		"status": row.Status, "acceptance": row.Acceptance, "blocker": row.Blocker,
		"eventVersion": row.CurrentEventVersion, "alreadyBlocked": alreadyBlocked,
		"note": "Internal Oppulence commitment marked blocked; no external action was taken.",
	})
}

func (t *commitmentAcceptTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("commitment acceptance is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("commitment accepter scope does not match workflow owner")
	}
	var input struct {
		CommitmentID string `json:"commitmentId"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode commitment.accept input: %w", err)
	}
	id, err := uuid.Parse(strings.TrimSpace(input.CommitmentID))
	if err != nil {
		return nil, errors.New("commitment.accept: commitmentId must be a UUID")
	}
	internal := auth.WithInternal(ctx)
	row, err := t.client.Commitment.Query().Where(
		commitment.IDEQ(id), commitment.HasUserWith(user.IDEQ(t.ownerID)),
	).WithRelationship().Only(internal)
	if ent.IsNotFound(err) {
		return nil, errors.New("commitment.accept: commitment not found")
	}
	if err != nil {
		return nil, fmt.Errorf("commitment.accept: %w", err)
	}
	rel, err := row.Edges.RelationshipOrErr()
	if err != nil {
		return nil, fmt.Errorf("commitment.accept: relationship unavailable: %w", err)
	}
	if row.Acceptance == "accepted" {
		return commitmentAcceptResult(row, rel.ID, true)
	}
	if row.Status != "open" || (row.Acceptance != "internally_confirmed" && row.Acceptance != "offered" && row.Acceptance != "disputed") {
		return nil, errors.New("commitment.accept: commitment is not eligible for acceptance")
	}
	owner, err := t.client.User.Get(internal, t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("commitment.accept: resolve owner: %w", err)
	}
	idempotencyKey, err := durableToolKey(scope, "commitment-accept")
	if err != nil {
		return nil, fmt.Errorf("commitment.accept: %w", err)
	}
	row, err = t.service.AppendCommitmentTransition(auth.WithUser(ctx, owner), owner, rel.ID, row.ID, revenue.CommitmentTransitionInput{
		Kind: "accepted", IdempotencyKey: idempotencyKey, ActorType: "user",
		Reason: "User recorded commitment acceptance through Oppulence Assistant.",
	})
	if err != nil {
		return nil, fmt.Errorf("commitment.accept: %w", err)
	}
	return commitmentAcceptResult(row, rel.ID, false)
}

func commitmentAcceptResult(row *ent.Commitment, relationshipID uuid.UUID, alreadyAccepted bool) (json.RawMessage, error) {
	return json.Marshal(map[string]any{
		"commitmentId": row.ID.String(), "relationshipId": relationshipID.String(),
		"status": row.Status, "acceptance": row.Acceptance, "eventVersion": row.CurrentEventVersion,
		"alreadyAccepted": alreadyAccepted,
		"note":            "Internal Oppulence commitment marked accepted; no external action was taken.",
	})
}

func (t *commitmentConfirmTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("commitment confirmation is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("commitment confirmer scope does not match workflow owner")
	}
	var input struct {
		CommitmentID string `json:"commitmentId"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode commitment.confirm input: %w", err)
	}
	id, err := uuid.Parse(strings.TrimSpace(input.CommitmentID))
	if err != nil {
		return nil, errors.New("commitment.confirm: commitmentId must be a UUID")
	}
	internal := auth.WithInternal(ctx)
	row, err := t.client.Commitment.Query().Where(
		commitment.IDEQ(id), commitment.HasUserWith(user.IDEQ(t.ownerID)),
	).WithRelationship().Only(internal)
	if ent.IsNotFound(err) {
		return nil, errors.New("commitment.confirm: commitment not found")
	}
	if err != nil {
		return nil, fmt.Errorf("commitment.confirm: %w", err)
	}
	rel, err := row.Edges.RelationshipOrErr()
	if err != nil {
		return nil, fmt.Errorf("commitment.confirm: relationship unavailable: %w", err)
	}
	if row.Acceptance == "internally_confirmed" {
		return commitmentConfirmResult(row, rel.ID, true)
	}
	if row.Acceptance != "candidate" {
		return nil, errors.New("commitment.confirm: commitment is not awaiting confirmation")
	}
	owner, err := t.client.User.Get(internal, t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("commitment.confirm: resolve owner: %w", err)
	}
	idempotencyKey, err := durableToolKey(scope, "commitment-confirm")
	if err != nil {
		return nil, fmt.Errorf("commitment.confirm: %w", err)
	}
	row, err = t.service.AppendCommitmentTransition(auth.WithUser(ctx, owner), owner, rel.ID, row.ID, revenue.CommitmentTransitionInput{
		Kind: "internally_confirmed", IdempotencyKey: idempotencyKey, ActorType: "user",
		Reason: "User confirmed the extracted commitment through Oppulence Assistant.",
	})
	if err != nil {
		return nil, fmt.Errorf("commitment.confirm: %w", err)
	}
	return commitmentConfirmResult(row, rel.ID, false)
}

func commitmentConfirmResult(row *ent.Commitment, relationshipID uuid.UUID, alreadyConfirmed bool) (json.RawMessage, error) {
	return json.Marshal(map[string]any{
		"commitmentId": row.ID.String(), "relationshipId": relationshipID.String(),
		"status": row.Status, "acceptance": row.Acceptance, "eventVersion": row.CurrentEventVersion,
		"alreadyConfirmed": alreadyConfirmed,
		"note":             "Internal Oppulence commitment confirmed; source evidence was preserved and no external action was taken.",
	})
}

func (t *commitmentCorrectTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("commitment correction is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("commitment corrector scope does not match workflow owner")
	}
	var input struct {
		CommitmentID string `json:"commitmentId"`
		Action       string `json:"action"`
		DueAt        string `json:"dueAt"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode commitment.correct input: %w", err)
	}
	id, err := uuid.Parse(strings.TrimSpace(input.CommitmentID))
	if err != nil {
		return nil, errors.New("commitment.correct: commitmentId must be a UUID")
	}
	action := strings.TrimSpace(input.Action)
	if action == "" || len(action) > 10000 {
		return nil, errors.New("commitment.correct: action must be between 1 and 10000 bytes")
	}
	var dueAt time.Time
	if input.DueAt != "" {
		dueAt, err = time.Parse(time.RFC3339, input.DueAt)
		if err != nil {
			return nil, errors.New("commitment.correct: dueAt must be RFC 3339")
		}
	}
	internal := auth.WithInternal(ctx)
	row, err := t.client.Commitment.Query().Where(
		commitment.IDEQ(id), commitment.HasUserWith(user.IDEQ(t.ownerID)),
	).WithRelationship().Only(internal)
	if ent.IsNotFound(err) {
		return nil, errors.New("commitment.correct: commitment not found")
	}
	if err != nil {
		return nil, fmt.Errorf("commitment.correct: %w", err)
	}
	rel, err := row.Edges.RelationshipOrErr()
	if err != nil {
		return nil, fmt.Errorf("commitment.correct: relationship unavailable: %w", err)
	}
	owner, err := t.client.User.Get(internal, t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("commitment.correct: resolve owner: %w", err)
	}
	idempotencyKey, err := durableToolKey(scope, "commitment-correct")
	if err != nil {
		return nil, fmt.Errorf("commitment.correct: %w", err)
	}
	row, err = t.service.AppendCommitmentTransition(auth.WithUser(ctx, owner), owner, rel.ID, row.ID, revenue.CommitmentTransitionInput{
		Kind: "corrected", IdempotencyKey: idempotencyKey, ActorType: "user", Action: action, DueAt: dueAt,
		Reason: "User corrected the commitment through Oppulence Assistant.",
	})
	if err != nil {
		return nil, fmt.Errorf("commitment.correct: %w", err)
	}
	return json.Marshal(map[string]any{
		"commitmentId": row.ID.String(), "relationshipId": rel.ID.String(),
		"status": row.Status, "acceptance": row.Acceptance, "action": row.Text,
		"dueAt": optionalTaskTime(row.DueAt), "eventVersion": row.CurrentEventVersion,
		"note": "Internal Oppulence commitment corrected; source evidence was preserved and no external action was taken.",
	})
}

func (t *commitmentCompleteTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("commitment completion is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("commitment completer scope does not match workflow owner")
	}
	var input struct {
		CommitmentID string `json:"commitmentId"`
		Reason       string `json:"reason"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode commitment.complete input: %w", err)
	}
	id, err := uuid.Parse(strings.TrimSpace(input.CommitmentID))
	if err != nil {
		return nil, errors.New("commitment.complete: commitmentId must be a UUID")
	}
	if len(input.Reason) > 1000 {
		return nil, errors.New("commitment.complete: reason must be at most 1000 bytes")
	}
	internal := auth.WithInternal(ctx)
	row, err := t.client.Commitment.Query().Where(
		commitment.IDEQ(id), commitment.HasUserWith(user.IDEQ(t.ownerID)),
	).WithRelationship().Only(internal)
	if ent.IsNotFound(err) {
		return nil, errors.New("commitment.complete: commitment not found")
	}
	if err != nil {
		return nil, fmt.Errorf("commitment.complete: %w", err)
	}
	rel, err := row.Edges.RelationshipOrErr()
	if err != nil {
		return nil, fmt.Errorf("commitment.complete: relationship unavailable: %w", err)
	}
	if row.Status == "fulfilled" {
		return commitmentCompleteResult(row, rel.ID, true)
	}
	owner, err := t.client.User.Get(internal, t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("commitment.complete: resolve owner: %w", err)
	}
	idempotencyKey, err := durableToolKey(scope, "commitment-complete")
	if err != nil {
		return nil, fmt.Errorf("commitment.complete: %w", err)
	}
	row, err = t.service.AppendCommitmentTransition(auth.WithUser(ctx, owner), owner, rel.ID, row.ID, revenue.CommitmentTransitionInput{
		Kind: "fulfilled", IdempotencyKey: idempotencyKey, ActorType: "user", Reason: strings.TrimSpace(input.Reason),
	})
	if err != nil {
		return nil, fmt.Errorf("commitment.complete: %w", err)
	}
	return commitmentCompleteResult(row, rel.ID, false)
}

func commitmentCompleteResult(row *ent.Commitment, relationshipID uuid.UUID, alreadyFulfilled bool) (json.RawMessage, error) {
	return json.Marshal(map[string]any{
		"commitmentId": row.ID.String(), "relationshipId": relationshipID.String(),
		"status": row.Status, "completedAt": optionalTaskTime(row.CompletedAt),
		"alreadyFulfilled": alreadyFulfilled,
		"note":             "Internal Oppulence commitment marked fulfilled; no external action was taken.",
	})
}
