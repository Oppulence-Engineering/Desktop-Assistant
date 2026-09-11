package agentregistry

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/revenue"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

var correctableRelationshipValues = map[string]map[string]bool{
	"lifecycle": {
		"prospect": true, "evaluation": true, "contracting": true, "onboarding": true,
		"active_customer": true, "renewal": true, "churned": true, "former_customer": true,
	},
	"engagement": {"unknown": true, "increasing": true, "steady": true, "declining": true, "dormant": true},
	"sentiment":  {"unknown": true, "positive": true, "mixed": true, "negative": true},
	"health":     {"unknown": true, "healthy": true, "needs_attention": true, "critical": true},
}

// RelationshipCreateCapability creates the same internal company record as the Companies UI.
func RelationshipCreateCapability() Capability {
	tool := &relationshipCreateTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("relationship.create", "company creation is not configured on this server")
			}
			return &relationshipCreateTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// RelationshipCorrectCapability records an auditable user correction to account state.
func RelationshipCorrectCapability() Capability {
	tool := &relationshipCorrectTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("relationship.correct", "relationship correction is not configured on this server")
			}
			return &relationshipCorrectTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// RelationshipAssertionRetractCapability withdraws one user correction while
// preserving its provenance and restoring the next valid projected value.
func RelationshipAssertionRetractCapability() Capability {
	tool := &relationshipAssertionRetractTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("relationship.assertion.retract", "relationship assertion retraction is not configured on this server")
			}
			return &relationshipAssertionRetractTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// RelationshipReviewAcknowledgeCapability records review of one exact Mission
// Control state without changing provider data.
func RelationshipReviewAcknowledgeCapability() Capability {
	tool := &relationshipReviewAcknowledgeTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("relationship.review.acknowledge", "relationship review acknowledgement is not configured on this server")
			}
			return &relationshipReviewAcknowledgeTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// RelationshipIdentityDecideCapability applies one explicit, version-bound
// decision to an identity-review candidate.
func RelationshipIdentityDecideCapability() Capability {
	tool := &relationshipIdentityDecideTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("relationship.identity.decide", "relationship identity decisions are not configured on this server")
			}
			return &relationshipIdentityDecideTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// RelationshipAttentionDecideCapability records one explicit, version-bound
// decision on an internal attention item.
func RelationshipAttentionDecideCapability() Capability {
	tool := &relationshipAttentionDecideTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("relationship.attention.decide", "relationship attention decisions are not configured on this server")
			}
			return &relationshipAttentionDecideTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// ConversationDeleteCapability requests governed deletion of server-side
// conversation-derived content for one relationship.
func ConversationDeleteCapability() Capability {
	tool := &conversationDeleteTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierAct, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("conversation.delete", "conversation deletion is not configured on this server")
			}
			return &conversationDeleteTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

type relationshipCreateTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type relationshipCorrectTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type relationshipAssertionRetractTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type relationshipReviewAcknowledgeTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type relationshipIdentityDecideTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type relationshipAttentionDecideTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type conversationDeleteTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

func (*relationshipCreateTool) Name() string { return "relationship.create" }
func (*relationshipCreateTool) Description() string {
	return "Create an internal Oppulence company in one exact accessible workspace. It is retry-safe and never contacts a provider, sends a message, or creates an external record."
}
func (*relationshipCreateTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"workspaceId":{"type":"string","format":"uuid","description":"Exact workspace ID returned by workspace.read with view workspaces."},"displayName":{"type":"string","minLength":1,"maxLength":500,"description":"Company name."},"accountDomain":{"type":"string","maxLength":253,"description":"Optional company domain."},"primaryEmail":{"type":"string","maxLength":320,"description":"Optional primary company email."},"summary":{"type":"string","maxLength":4000,"description":"Optional relationship context."}},"required":["workspaceId","displayName"],"additionalProperties":false}`)
}
func (*relationshipCreateTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "relationship.create"}
}

func (t *relationshipCreateTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("company creation is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("company creator scope does not match workflow owner")
	}
	var input struct {
		WorkspaceID   string `json:"workspaceId"`
		DisplayName   string `json:"displayName"`
		AccountDomain string `json:"accountDomain"`
		PrimaryEmail  string `json:"primaryEmail"`
		Summary       string `json:"summary"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode relationship.create input: %w", err)
	}
	workspaceID, err := uuid.Parse(strings.TrimSpace(input.WorkspaceID))
	if err != nil {
		return nil, errors.New("relationship.create: workspaceId must be a UUID")
	}
	displayName := strings.TrimSpace(input.DisplayName)
	accountDomain := strings.TrimSpace(input.AccountDomain)
	primaryEmail := strings.TrimSpace(input.PrimaryEmail)
	summary := strings.TrimSpace(input.Summary)
	if displayName == "" || len(displayName) > 500 {
		return nil, errors.New("relationship.create: displayName must be between 1 and 500 bytes")
	}
	if len(accountDomain) > 253 || len(primaryEmail) > 320 || len(summary) > 4000 {
		return nil, errors.New("relationship.create: accountDomain, primaryEmail, or summary is too long")
	}
	idempotencyKey, err := durableToolKey(scope, "relationship-create")
	if err != nil {
		return nil, fmt.Errorf("relationship.create: %w", err)
	}
	owner, err := t.client.User.Get(auth.WithInternal(ctx), t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("relationship.create: resolve owner: %w", err)
	}
	rel, err := t.service.CreateRelationship(auth.WithUser(ctx, owner), owner, revenue.RelationshipInput{
		Kind: "company", DisplayName: displayName, AccountDomain: accountDomain,
		PrimaryEmail: primaryEmail, Summary: summary, WorkspaceID: workspaceID,
		IdempotencyKey: idempotencyKey,
	})
	if err != nil {
		return nil, fmt.Errorf("relationship.create: %w", err)
	}
	return json.Marshal(map[string]any{
		"relationshipId": rel.ID.String(), "workspaceId": workspaceID.String(),
		"displayName": rel.DisplayName, "accountDomain": rel.AccountDomain,
		"primaryEmail": rel.PrimaryEmail, "summary": rel.Summary,
		"note": "Internal Oppulence company is present; no provider or external system was changed.",
	})
}

func (*conversationDeleteTool) Name() string { return "conversation.delete" }
func (*conversationDeleteTool) Description() string {
	return "Request legal-hold-aware deletion of server-side conversation-derived data for one Oppulence relationship. Requires human approval, is retry-safe, and returns a receipt that identifies local and provider work still pending."
}
func (*conversationDeleteTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"relationshipId":{"type":"string","format":"uuid","description":"Relationship ID returned by relationship.read with view conversations or mission_control."},"expectedRelationshipName":{"type":"string","minLength":1,"maxLength":500,"description":"Exact relationship name from the latest read; prevents deleting data for a stale or wrong relationship."}},"required":["relationshipId","expectedRelationshipName"],"additionalProperties":false}`)
}
func (*conversationDeleteTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierAct, Connector: "oppulence", Operation: "conversation.delete"}
}

func (t *conversationDeleteTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("conversation deletion is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("conversation deleter scope does not match workflow owner")
	}
	if strings.TrimSpace(scope.ApprovalID) == "" {
		return nil, errors.New("conversation.delete requires human approval")
	}
	var input struct {
		RelationshipID           string `json:"relationshipId"`
		ExpectedRelationshipName string `json:"expectedRelationshipName"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode conversation.delete input: %w", err)
	}
	relationshipID, err := uuid.Parse(strings.TrimSpace(input.RelationshipID))
	if err != nil {
		return nil, errors.New("conversation.delete: relationshipId must be a UUID")
	}
	expectedName := strings.TrimSpace(input.ExpectedRelationshipName)
	if expectedName == "" || len(expectedName) > 500 {
		return nil, errors.New("conversation.delete: expectedRelationshipName must be between 1 and 500 bytes")
	}
	owner, err := t.client.User.Get(auth.WithInternal(ctx), t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("conversation.delete: resolve owner: %w", err)
	}
	userCtx := auth.WithUser(ctx, owner)
	relationship, err := t.service.GetRelationship(userCtx, relationshipID)
	if err != nil {
		return nil, fmt.Errorf("conversation.delete: %w", err)
	}
	if relationship.DisplayName != expectedName {
		return nil, errors.New("conversation.delete: relationship name changed; read it again before deleting conversation data")
	}
	requestID, err := durableToolKey(scope, "conversation-delete")
	if err != nil {
		return nil, fmt.Errorf("conversation.delete: %w", err)
	}
	receipt, err := t.service.RequestConversationDeletion(userCtx, owner, relationshipID, requestID)
	if err != nil {
		return nil, fmt.Errorf("conversation.delete: %w", err)
	}
	return json.Marshal(map[string]any{
		"receiptId": receipt.ReceiptID, "relationshipId": receipt.ScopeRef,
		"requestedAt": receipt.RequestedAt, "completedAt": receipt.CompletedAt,
		"legalHold": receipt.LegalHold, "status": receipt.Status, "targets": receipt.Targets,
		"note": "Oppulence processed the server deletion request. Check target statuses for local or provider work that is still pending; no provider data was deleted.",
	})
}

func (*relationshipCorrectTool) Name() string { return "relationship.correct" }
func (*relationshipCorrectTool) Description() string {
	return "Correct lifecycle, engagement, sentiment, or health on an existing Oppulence relationship. The correction is auditable, overrides derived state, and never contacts anyone."
}
func (*relationshipCorrectTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"relationshipId":{"type":"string","format":"uuid","description":"Existing relationship ID returned by relationship.read."},"dimension":{"type":"string","enum":["lifecycle","engagement","sentiment","health"]},"value":{"type":"string","minLength":1,"maxLength":4096,"description":"A valid value for the selected dimension."},"reason":{"type":"string","minLength":1,"maxLength":4096,"description":"Why the existing model state is wrong."}},"required":["relationshipId","dimension","value","reason"],"additionalProperties":false}`)
}
func (*relationshipCorrectTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "relationship.correct"}
}

func (*relationshipAssertionRetractTool) Name() string { return "relationship.assertion.retract" }
func (*relationshipAssertionRetractTool) Description() string {
	return "Retract one user correction from an internal Oppulence relationship. The correction remains in the audit trail, the relationship is reprojected, and no external system is changed."
}
func (*relationshipAssertionRetractTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"relationshipId":{"type":"string","format":"uuid","description":"Existing relationship ID returned by relationship.read."},"assertionId":{"type":"string","format":"uuid","description":"Active user-correction assertion ID returned by relationship.read with view assertions."},"reason":{"type":"string","minLength":1,"maxLength":4096,"description":"Why this correction should be withdrawn."}},"required":["relationshipId","assertionId","reason"],"additionalProperties":false}`)
}
func (*relationshipAssertionRetractTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "relationship.assertion.retract"}
}

func (t *relationshipAssertionRetractTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("relationship assertion retraction is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("relationship assertion retractor scope does not match workflow owner")
	}
	var input struct {
		RelationshipID string `json:"relationshipId"`
		AssertionID    string `json:"assertionId"`
		Reason         string `json:"reason"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode relationship.assertion.retract input: %w", err)
	}
	relationshipID, err := uuid.Parse(strings.TrimSpace(input.RelationshipID))
	if err != nil {
		return nil, errors.New("relationship.assertion.retract: relationshipId must be a UUID")
	}
	assertionID, err := uuid.Parse(strings.TrimSpace(input.AssertionID))
	if err != nil {
		return nil, errors.New("relationship.assertion.retract: assertionId must be a UUID")
	}
	reason := strings.TrimSpace(input.Reason)
	if reason == "" || len(reason) > 4096 {
		return nil, errors.New("relationship.assertion.retract: reason must be between 1 and 4096 bytes")
	}
	owner, err := t.client.User.Get(auth.WithInternal(ctx), t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("relationship.assertion.retract: resolve owner: %w", err)
	}
	rel, err := t.service.RetractRelationshipAssertion(
		auth.WithUser(ctx, owner), owner, relationshipID, assertionID, reason,
	)
	if err != nil {
		return nil, fmt.Errorf("relationship.assertion.retract: %w", err)
	}
	return json.Marshal(map[string]any{
		"relationshipId": rel.ID.String(), "assertionId": assertionID.String(), "retracted": true,
		"lifecycle": rel.Lifecycle, "engagement": rel.Engagement,
		"sentiment": rel.Sentiment, "health": rel.Health,
		"note": "Internal Oppulence relationship correction retracted; its audit history was preserved and no external action was taken.",
	})
}

func (*relationshipReviewAcknowledgeTool) Name() string { return "relationship.review.acknowledge" }
func (*relationshipReviewAcknowledgeTool) Description() string {
	return "Record that the user reviewed one exact Oppulence relationship state. Stale versions are rejected, retries are safe, and no external system is changed."
}
func (*relationshipReviewAcknowledgeTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"relationshipId":{"type":"string","format":"uuid","description":"Existing relationship ID returned by relationship.read."},"stateVersion":{"type":"integer","minimum":0,"description":"Exact stateVersion returned by relationship.read with view mission_control."},"stateHash":{"type":"string","maxLength":128,"description":"Exact stateHash returned by relationship.read with view mission_control."}},"required":["relationshipId","stateVersion","stateHash"],"additionalProperties":false}`)
}
func (*relationshipReviewAcknowledgeTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "relationship.review.acknowledge"}
}

func (t *relationshipReviewAcknowledgeTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("relationship review acknowledgement is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("relationship review acknowledger scope does not match workflow owner")
	}
	var input struct {
		RelationshipID string `json:"relationshipId"`
		StateVersion   int    `json:"stateVersion"`
		StateHash      string `json:"stateHash"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode relationship.review.acknowledge input: %w", err)
	}
	relationshipID, err := uuid.Parse(strings.TrimSpace(input.RelationshipID))
	if err != nil {
		return nil, errors.New("relationship.review.acknowledge: relationshipId must be a UUID")
	}
	stateHash := strings.TrimSpace(input.StateHash)
	if input.StateVersion < 0 || len(stateHash) > 128 {
		return nil, errors.New("relationship.review.acknowledge: stateVersion or stateHash is invalid")
	}
	owner, err := t.client.User.Get(auth.WithInternal(ctx), t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("relationship.review.acknowledge: resolve owner: %w", err)
	}
	ack, err := t.service.AcknowledgeMissionControl(
		auth.WithUser(ctx, owner), owner, relationshipID, input.StateVersion, stateHash,
	)
	if err != nil {
		return nil, fmt.Errorf("relationship.review.acknowledge: %w", err)
	}
	return json.Marshal(map[string]any{
		"id": ack.ID.String(), "relationshipId": relationshipID.String(),
		"stateVersion": ack.StateVersion, "stateHash": ack.StateHash,
		"acknowledgedAt": ack.AcknowledgedAt.UTC().Format(time.RFC3339),
		"note":           "Internal Oppulence relationship review acknowledged; no external action was taken.",
	})
}

func (*relationshipIdentityDecideTool) Name() string { return "relationship.identity.decide" }
func (*relationshipIdentityDecideTool) Description() string {
	return "Apply an explicit, version-bound decision to an internal Oppulence identity-review candidate. The decision is idempotent and audited; it never changes the source system or contacts anyone."
}
func (*relationshipIdentityDecideTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"candidateId":{"type":"string","format":"uuid","description":"Identity candidate ID returned by relationship.read with view identity_reviews."},"decision":{"type":"string","enum":["merge","keep_separate","move_evidence","split","defer","undo"]},"expectedVersion":{"type":"integer","minimum":1,"description":"Exact candidate version returned by identity_reviews."},"reason":{"type":"string","minLength":1,"maxLength":2000,"description":"Why the user chose this identity decision."}},"required":["candidateId","decision","expectedVersion","reason"],"additionalProperties":false}`)
}
func (*relationshipIdentityDecideTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "relationship.identity.decide"}
}

func (t *relationshipIdentityDecideTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("relationship identity decisions are not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("relationship identity decision scope does not match workflow owner")
	}
	var input struct {
		CandidateID     string `json:"candidateId"`
		Decision        string `json:"decision"`
		ExpectedVersion int    `json:"expectedVersion"`
		Reason          string `json:"reason"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode relationship.identity.decide input: %w", err)
	}
	candidateID, err := uuid.Parse(strings.TrimSpace(input.CandidateID))
	if err != nil {
		return nil, errors.New("relationship.identity.decide: candidateId must be a UUID")
	}
	decision := strings.ToLower(strings.TrimSpace(input.Decision))
	switch decision {
	case "merge", "keep_separate", "move_evidence", "split", "defer", "undo":
	default:
		return nil, errors.New("relationship.identity.decide: unsupported decision")
	}
	reason := strings.TrimSpace(input.Reason)
	if input.ExpectedVersion <= 0 || reason == "" || len(reason) > 2000 {
		return nil, errors.New("relationship.identity.decide: expectedVersion and a reason of at most 2000 bytes are required")
	}
	owner, err := t.client.User.Get(auth.WithInternal(ctx), t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("relationship.identity.decide: resolve owner: %w", err)
	}
	idempotencyKey, err := durableToolKey(scope, "relationship-identity-decision")
	if err != nil {
		return nil, fmt.Errorf("relationship.identity.decide: %w", err)
	}
	candidate, err := t.service.DecideIdentityCandidate(auth.WithUser(ctx, owner), owner, candidateID, revenue.IdentityDecisionInput{
		Decision: decision, Reason: reason, ExpectedVersion: input.ExpectedVersion,
		IdempotencyKey: idempotencyKey + ":" + candidateID.String(),
	})
	if err != nil {
		return nil, fmt.Errorf("relationship.identity.decide: %w", err)
	}
	proposed, proposedErr := candidate.Edges.ProposedRelationshipOrErr()
	existing, existingErr := candidate.Edges.ExistingRelationshipOrErr()
	if proposedErr != nil || existingErr != nil {
		return nil, errors.New("relationship.identity.decide: decided candidate relationships are unavailable")
	}
	impact := map[string]any{}
	_ = json.Unmarshal([]byte(candidate.ImpactJSON), &impact)
	return json.Marshal(map[string]any{
		"candidateId": candidate.ID.String(), "status": candidate.Status, "version": candidate.Version,
		"decision": candidate.Decision, "reason": candidate.DecisionReason,
		"proposedRelationship": map[string]any{"id": proposed.ID.String(), "name": proposed.DisplayName, "status": proposed.Status},
		"existingRelationship": map[string]any{"id": existing.ID.String(), "name": existing.DisplayName, "status": existing.Status},
		"evidenceRefs":         candidate.EvidenceRefs, "impact": impact,
		"note": "Internal Oppulence identity decision recorded; its audit lineage was preserved and no external action was taken.",
	})
}

func (*relationshipAttentionDecideTool) Name() string { return "relationship.attention.decide" }
func (*relationshipAttentionDecideTool) Description() string {
	return "Acknowledge, snooze, or dismiss one versioned Oppulence attention item. The decision is retry-safe, audited, and never changes a provider or governed action."
}
func (*relationshipAttentionDecideTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"attentionId":{"type":"string","format":"uuid","description":"Attention item ID returned by relationship.read with view attention."},"decision":{"type":"string","enum":["acknowledge","snooze","dismiss"]},"expectedVersion":{"type":"integer","minimum":1,"description":"Exact item version returned by the attention view."},"reason":{"type":"string","minLength":1,"maxLength":2000,"description":"Why the user chose this attention decision."},"snoozedUntil":{"type":"string","format":"date-time","description":"Required only for snooze; an RFC 3339 time in the future."}},"required":["attentionId","decision","expectedVersion","reason"],"additionalProperties":false}`)
}
func (*relationshipAttentionDecideTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "relationship.attention.decide"}
}

func (t *relationshipAttentionDecideTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("relationship attention decisions are not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("relationship attention decision scope does not match workflow owner")
	}
	var input struct {
		AttentionID     string `json:"attentionId"`
		Decision        string `json:"decision"`
		ExpectedVersion int    `json:"expectedVersion"`
		Reason          string `json:"reason"`
		SnoozedUntil    string `json:"snoozedUntil"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode relationship.attention.decide input: %w", err)
	}
	id, err := uuid.Parse(strings.TrimSpace(input.AttentionID))
	if err != nil {
		return nil, errors.New("relationship.attention.decide: attentionId must be a UUID")
	}
	decision := strings.ToLower(strings.TrimSpace(input.Decision))
	if decision != "acknowledge" && decision != "snooze" && decision != "dismiss" {
		return nil, errors.New("relationship.attention.decide: unsupported decision")
	}
	reason := strings.TrimSpace(input.Reason)
	if input.ExpectedVersion <= 0 || reason == "" || len(reason) > 2000 {
		return nil, errors.New("relationship.attention.decide: expectedVersion and a reason of at most 2000 bytes are required")
	}
	var snoozedUntil *time.Time
	if raw := strings.TrimSpace(input.SnoozedUntil); decision == "snooze" {
		parsed, parseErr := time.Parse(time.RFC3339, raw)
		if parseErr != nil {
			return nil, errors.New("relationship.attention.decide: snoozedUntil must be an RFC 3339 time for snooze")
		}
		snoozedUntil = &parsed
	} else if raw != "" {
		return nil, errors.New("relationship.attention.decide: snoozedUntil is only valid for snooze")
	}
	owner, err := t.client.User.Get(auth.WithInternal(ctx), t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("relationship.attention.decide: resolve owner: %w", err)
	}
	item, err := t.service.DecideRelationshipAttention(auth.WithUser(ctx, owner), owner, id, revenue.AttentionDecisionInput{
		Decision: decision, Reason: reason, ExpectedVersion: input.ExpectedVersion, SnoozedUntil: snoozedUntil,
	})
	if err != nil {
		return nil, fmt.Errorf("relationship.attention.decide: %w", err)
	}
	relationship, err := item.Edges.RelationshipOrErr()
	if err != nil {
		return nil, errors.New("relationship.attention.decide: relationship is unavailable")
	}
	var until *string
	if item.SnoozedUntil != nil {
		value := item.SnoozedUntil.UTC().Format(time.RFC3339)
		until = &value
	}
	return json.Marshal(map[string]any{
		"attentionId": item.ID.String(), "status": item.Status, "version": item.Version,
		"reason": item.StateReason, "snoozedUntil": until,
		"relationshipId": relationship.ID.String(), "relationshipName": relationship.DisplayName,
		"reasonCode": item.ReasonCode, "evidenceRefs": item.EvidenceRefs,
		"note": "Internal Oppulence attention decision recorded; no provider or governed action was changed.",
	})
}

func (t *relationshipCorrectTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("relationship correction is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("relationship corrector scope does not match workflow owner")
	}
	var input struct {
		RelationshipID string `json:"relationshipId"`
		Dimension      string `json:"dimension"`
		Value          string `json:"value"`
		Reason         string `json:"reason"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode relationship.correct input: %w", err)
	}
	id, err := uuid.Parse(strings.TrimSpace(input.RelationshipID))
	if err != nil {
		return nil, errors.New("relationship.correct: relationshipId must be a UUID")
	}
	dimension := strings.TrimSpace(input.Dimension)
	value := strings.TrimSpace(input.Value)
	reason := strings.TrimSpace(input.Reason)
	allowedValues, ok := correctableRelationshipValues[dimension]
	if !ok {
		return nil, errors.New("relationship.correct: dimension is not correctable")
	}
	if value == "" || len(value) > 4096 {
		return nil, errors.New("relationship.correct: value must be between 1 and 4096 bytes")
	}
	if !allowedValues[value] {
		return nil, errors.New("relationship.correct: value is not valid for the selected dimension")
	}
	if reason == "" || len(reason) > 4096 {
		return nil, errors.New("relationship.correct: reason must be between 1 and 4096 bytes")
	}
	owner, err := t.client.User.Get(auth.WithInternal(ctx), t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("relationship.correct: resolve owner: %w", err)
	}
	idempotencyKey, err := durableToolKey(scope, "relationship-correct")
	if err != nil {
		return nil, fmt.Errorf("relationship.correct: %w", err)
	}
	rel, err := t.service.CorrectRelationship(auth.WithUser(ctx, owner), owner, id, revenue.RelationshipCorrectionInput{
		Dimension: dimension, Value: value, Reason: reason, IdempotencyKey: idempotencyKey,
	})
	if err != nil {
		return nil, fmt.Errorf("relationship.correct: %w", err)
	}
	return json.Marshal(map[string]any{
		"relationshipId": rel.ID.String(), "dimension": dimension, "value": value,
		"lifecycle": rel.Lifecycle, "engagement": rel.Engagement,
		"sentiment": rel.Sentiment, "health": rel.Health,
		"note": "Internal Oppulence relationship corrected; no external action was taken.",
	})
}
