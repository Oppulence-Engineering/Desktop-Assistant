package agentregistry

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/revenue"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// ActionAuditCapability explains one internal action without changing it.
func ActionAuditCapability() Capability {
	tool := &actionAuditTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierRead, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("action.audit", "action audit is not configured on this server")
			}
			return &actionAuditTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// ActionOutcomeRecordCapability records a user-confirmed internal outcome.
func ActionOutcomeRecordCapability() Capability {
	tool := &actionOutcomeRecordTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("action.outcome.record", "action outcome recording is not configured on this server")
			}
			return &actionOutcomeRecordTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// RecommendationCreateCapability queues an internal Oppulence recommendation draft.
func RecommendationCreateCapability() Capability {
	tool := &recommendationCreateTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("recommendation.create", "recommendation creation is not configured on this server")
			}
			return &recommendationCreateTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// RecommendationDismissCapability dismisses an internal Oppulence recommendation.
func RecommendationDismissCapability() Capability {
	tool := &recommendationDismissTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("recommendation.dismiss", "recommendation dismissal is not configured on this server")
			}
			return &recommendationDismissTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// RecommendationSnoozeCapability parks an internal Oppulence recommendation.
func RecommendationSnoozeCapability() Capability {
	tool := &recommendationSnoozeTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("recommendation.snooze", "recommendation snoozing is not configured on this server")
			}
			return &recommendationSnoozeTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// RecommendationUpdateCapability edits the draft content of an internal recommendation.
func RecommendationUpdateCapability() Capability {
	tool := &recommendationUpdateTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("recommendation.update", "recommendation editing is not configured on this server")
			}
			return &recommendationUpdateTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

type recommendationCreateTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type actionAuditTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type actionOutcomeRecordTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

func (*actionOutcomeRecordTool) Name() string { return "action.outcome.record" }
func (*actionOutcomeRecordTool) Description() string {
	return "Record a user-confirmed outcome for an internal Oppulence task or recommendation. This updates Oppulence history and never contacts anyone."
}
func (*actionOutcomeRecordTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"actionId":{"type":"string","format":"uuid","description":"Existing task or recommendation ID returned by relationship.read."},"outcome":{"type":"string","enum":["sent","delivered","bounced","replied","meeting_booked","won","lost","dismissed","bad_recommendation","deal_advanced","onboarding_progressed","renewed","escalated","churned","corrected"]},"occurredAt":{"type":"string","format":"date-time","description":"Optional RFC 3339 time when the outcome happened."}},"required":["actionId","outcome"],"additionalProperties":false}`)
}
func (*actionOutcomeRecordTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "action.outcome.record"}
}

func (t *actionOutcomeRecordTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("action outcome recording is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("action outcome recorder scope does not match workflow owner")
	}
	var input struct {
		ActionID   string `json:"actionId"`
		Outcome    string `json:"outcome"`
		OccurredAt string `json:"occurredAt"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode action.outcome.record input: %w", err)
	}
	id, err := uuid.Parse(strings.TrimSpace(input.ActionID))
	if err != nil {
		return nil, errors.New("action.outcome.record: actionId must be a UUID")
	}
	outcomeKind := strings.TrimSpace(input.Outcome)
	switch outcomeKind {
	case "sent", "delivered", "bounced", "replied", "meeting_booked", "won", "lost", "dismissed", "bad_recommendation", "deal_advanced", "onboarding_progressed", "renewed", "escalated", "churned", "corrected":
	default:
		return nil, errors.New("action.outcome.record: unsupported outcome")
	}
	var occurredAt time.Time
	if strings.TrimSpace(input.OccurredAt) != "" {
		occurredAt, err = time.Parse(time.RFC3339, input.OccurredAt)
		if err != nil {
			return nil, errors.New("action.outcome.record: occurredAt must be RFC 3339")
		}
	}
	internal := auth.WithInternal(ctx)
	if _, err := t.client.RevenueAction.Query().Where(
		revenueaction.IDEQ(id), revenueaction.HasUserWith(user.IDEQ(t.ownerID)),
	).Only(internal); ent.IsNotFound(err) {
		return nil, errors.New("action.outcome.record: action not found")
	} else if err != nil {
		return nil, fmt.Errorf("action.outcome.record: %w", err)
	}
	owner, err := t.client.User.Get(internal, t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("action.outcome.record: resolve owner: %w", err)
	}
	eventID, err := durableToolKey(scope, "action-outcome")
	if err != nil {
		return nil, fmt.Errorf("action.outcome.record: %w", err)
	}
	result, err := t.service.AppendOutcome(auth.WithUser(ctx, owner), owner, id, revenue.OutcomeInput{
		Kind: outcomeKind, Source: "user", SourceEventID: eventID, OccurredAt: occurredAt,
	})
	if err != nil {
		return nil, fmt.Errorf("action.outcome.record: %w", err)
	}
	return json.Marshal(map[string]any{
		"actionId": id.String(), "outcomeId": result.ID.String(), "outcome": result.Kind,
		"source": result.Source, "occurredAt": result.OccurredAt,
		"note": "Internal Oppulence action outcome recorded; no external action was taken.",
	})
}

func (*actionAuditTool) Name() string { return "action.audit" }
func (*actionAuditTool) Description() string {
	return "Read the evidence and full revision, policy, approval, execution, and outcome history for one internal Oppulence action."
}
func (*actionAuditTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"actionId":{"type":"string","format":"uuid","description":"Existing task or recommendation ID returned by relationship.read."}},"required":["actionId"],"additionalProperties":false}`)
}
func (*actionAuditTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierRead, Connector: "oppulence", Operation: "action.audit"}
}

func (t *actionAuditTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("action audit is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("action auditor scope does not match workflow owner")
	}
	var input struct {
		ActionID string `json:"actionId"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode action.audit input: %w", err)
	}
	id, err := uuid.Parse(strings.TrimSpace(input.ActionID))
	if err != nil {
		return nil, errors.New("action.audit: actionId must be a UUID")
	}
	internal := auth.WithInternal(ctx)
	if _, err := t.client.RevenueAction.Query().Where(
		revenueaction.IDEQ(id), revenueaction.HasUserWith(user.IDEQ(t.ownerID)),
	).Only(internal); ent.IsNotFound(err) {
		return nil, errors.New("action.audit: action not found")
	} else if err != nil {
		return nil, fmt.Errorf("action.audit: %w", err)
	}
	owner, err := t.client.User.Get(internal, t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("action.audit: resolve owner: %w", err)
	}
	action, err := t.service.Audit(auth.WithUser(ctx, owner), id)
	if err != nil {
		return nil, fmt.Errorf("action.audit: %w", err)
	}
	relationshipID := ""
	if rel, edgeErr := action.Edges.RelationshipOrErr(); edgeErr == nil {
		relationshipID = rel.ID.String()
	}
	evidence := make([]map[string]any, 0, len(action.Edges.Evidences))
	for _, item := range action.Edges.Evidences {
		evidence = append(evidence, map[string]any{
			"id": item.ID.String(), "source": item.Source, "sourceRecordId": item.SourceRecordID,
			"excerpt": item.Excerpt, "occurredAt": item.OccurredAt, "contentHash": item.ContentHash,
		})
	}
	revisions := make([]map[string]any, 0, len(action.Edges.Revisions))
	for _, item := range action.Edges.Revisions {
		revisions = append(revisions, map[string]any{
			"revision": item.Revision, "revisionHash": item.RevisionHash,
			"actionType": item.ActionType, "channel": item.Channel, "createdAt": item.CreatedAt,
		})
	}
	decisions := make([]map[string]any, 0, len(action.Edges.Decisions))
	for _, item := range action.Edges.Decisions {
		decisions = append(decisions, map[string]any{
			"id": item.ID.String(), "revision": item.ActionRevision, "revisionHash": item.RevisionHash,
			"status": item.Status, "reasonCodes": item.ReasonCodes,
			"evaluatedAt": item.EvaluatedAt, "expiresAt": item.ExpiresAt,
		})
	}
	outcomes := make([]map[string]any, 0, len(action.Edges.Outcomes))
	for _, item := range action.Edges.Outcomes {
		outcomes = append(outcomes, map[string]any{
			"id": item.ID.String(), "kind": item.Kind, "source": item.Source,
			"sourceEventId": item.SourceEventID, "occurredAt": item.OccurredAt,
		})
	}
	return json.Marshal(map[string]any{
		"action": map[string]any{
			"id": action.ID.String(), "relationshipId": relationshipID, "actionType": action.ActionType,
			"channel": action.Channel, "reason": action.Reason, "revision": action.Revision,
			"revisionHash": action.RevisionHash, "recipient": action.RecipientEmail,
			"subject": action.ProposedSubject, "message": action.ProposedMessage,
			"queueStatus": action.QueueStatus, "policyStatus": action.PolicyStatus,
			"approvalStatus": action.ApprovalStatus, "executionStatus": action.ExecutionStatus,
			"executionMode": action.ExecutionMode, "createdAt": action.CreatedAt, "updatedAt": action.UpdatedAt,
		},
		"evidence": evidence, "revisions": revisions, "decisions": decisions, "outcomes": outcomes,
		"note": "Internal Oppulence action audit read; no data or external system was changed.",
	})
}

type recommendationDismissTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

func (*recommendationCreateTool) Name() string { return "recommendation.create" }
func (*recommendationCreateTool) Description() string {
	return "Create an internal Oppulence email recommendation draft for an existing relationship. This only adds it to the review queue and never creates a provider draft or sends anything."
}
func (*recommendationCreateTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"relationshipId":{"type":"string","format":"uuid","description":"Existing relationship ID returned by relationship.read."},"actionType":{"type":"string","enum":["warm_follow_up","proposal_nudge","referral_reconnect","customer_risk","meeting_follow_up"]},"reason":{"type":"string","minLength":1,"description":"Why this recommendation should be created."},"subject":{"type":"string","description":"Optional draft subject."},"message":{"type":"string","description":"Optional draft message."},"priority":{"type":"integer","minimum":0,"maximum":100,"description":"Optional priority; defaults to 30."}},"required":["relationshipId","actionType","reason"],"additionalProperties":false}`)
}
func (*recommendationCreateTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "recommendation.create"}
}

type recommendationSnoozeTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type recommendationUpdateTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

func (*recommendationDismissTool) Name() string { return "recommendation.dismiss" }
func (*recommendationDismissTool) Description() string {
	return "Dismiss an existing internal Oppulence recommendation with a reason. This cannot dismiss tasks and never executes or sends anything."
}
func (*recommendationDismissTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"recommendationId":{"type":"string","format":"uuid","description":"Existing recommendation ID returned by relationship.read."},"reason":{"type":"string","minLength":1,"maxLength":1000,"description":"Why the recommendation should be dismissed."}},"required":["recommendationId","reason"],"additionalProperties":false}`)
}
func (*recommendationDismissTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "recommendation.dismiss"}
}

func (*recommendationSnoozeTool) Name() string { return "recommendation.snooze" }
func (*recommendationSnoozeTool) Description() string {
	return "Snooze an existing internal Oppulence recommendation until a future time. This cannot snooze tasks and never executes or sends anything."
}
func (*recommendationSnoozeTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"recommendationId":{"type":"string","format":"uuid","description":"Existing recommendation ID returned by relationship.read."},"until":{"type":"string","format":"date-time","description":"RFC 3339 time in the future, up to 90 days away."}},"required":["recommendationId","until"],"additionalProperties":false}`)
}
func (*recommendationSnoozeTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "recommendation.snooze"}
}

func (*recommendationUpdateTool) Name() string { return "recommendation.update" }
func (*recommendationUpdateTool) Description() string {
	return "Edit the subject or message of an existing internal Oppulence recommendation. This creates a new revision, invalidates prior approval, and never executes or sends anything."
}
func (*recommendationUpdateTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"recommendationId":{"type":"string","format":"uuid","description":"Existing recommendation ID returned by relationship.read."},"subject":{"type":"string","description":"Replacement subject; use an empty string to clear it."},"message":{"type":"string","description":"Replacement message; use an empty string to clear it."}},"required":["recommendationId"],"additionalProperties":false}`)
}
func (*recommendationUpdateTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "recommendation.update"}
}

func (t *recommendationCreateTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("recommendation creation is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("recommendation creator scope does not match workflow owner")
	}
	var input struct {
		RelationshipID string `json:"relationshipId"`
		ActionType     string `json:"actionType"`
		Reason         string `json:"reason"`
		Subject        string `json:"subject"`
		Message        string `json:"message"`
		Priority       *int   `json:"priority"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode recommendation.create input: %w", err)
	}
	relationshipID, err := uuid.Parse(strings.TrimSpace(input.RelationshipID))
	if err != nil {
		return nil, errors.New("recommendation.create: relationshipId must be a UUID")
	}
	actionType := strings.TrimSpace(input.ActionType)
	switch actionType {
	case "warm_follow_up", "proposal_nudge", "referral_reconnect", "customer_risk", "meeting_follow_up":
	default:
		return nil, errors.New("recommendation.create: unsupported actionType")
	}
	reason := strings.TrimSpace(input.Reason)
	if reason == "" {
		return nil, errors.New("recommendation.create: reason is required")
	}
	priority := 30
	if input.Priority != nil {
		priority = *input.Priority
	}
	if priority < 0 || priority > 100 {
		return nil, errors.New("recommendation.create: priority must be between 0 and 100")
	}
	internal := auth.WithInternal(ctx)
	owner, err := t.client.User.Get(internal, t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("recommendation.create: resolve owner: %w", err)
	}
	rel, err := t.client.Relationship.Query().Where(
		relationship.IDEQ(relationshipID), relationship.HasUserWith(user.IDEQ(t.ownerID)),
	).Only(internal)
	if ent.IsNotFound(err) {
		return nil, errors.New("recommendation.create: relationship not found")
	}
	if err != nil {
		return nil, fmt.Errorf("recommendation.create: %w", err)
	}
	dedupeKey, err := durableToolKey(scope, "recommendation")
	if err != nil {
		return nil, fmt.Errorf("recommendation.create: %w", err)
	}
	action, err := t.service.CreateAction(auth.WithUser(ctx, owner), owner, revenue.ActionInput{
		RelationshipID: relationshipID, ActionType: actionType, Channel: "email",
		DedupeKey: dedupeKey, Reason: reason, RecipientEmail: rel.PrimaryEmail,
		ProposedSubject: input.Subject, ProposedMessage: input.Message,
		ExecutionMode: revenue.ExecModeDraft, PriorityScore: priority,
	})
	if err != nil {
		return nil, fmt.Errorf("recommendation.create: %w", err)
	}
	return json.Marshal(map[string]any{
		"recommendationId": action.ID.String(), "relationshipId": relationshipID.String(),
		"actionType": action.ActionType, "status": action.QueueStatus, "priority": action.PriorityScore,
		"recipient": action.RecipientEmail, "subject": action.ProposedSubject, "message": action.ProposedMessage,
		"note": "Internal Oppulence recommendation created; no external action was taken.",
	})
}

func (t *recommendationDismissTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("recommendation dismissal is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("recommendation dismisser scope does not match workflow owner")
	}
	var input struct {
		RecommendationID string `json:"recommendationId"`
		Reason           string `json:"reason"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode recommendation.dismiss input: %w", err)
	}
	id, err := uuid.Parse(strings.TrimSpace(input.RecommendationID))
	if err != nil {
		return nil, errors.New("recommendation.dismiss: recommendationId must be a UUID")
	}
	reason := strings.TrimSpace(input.Reason)
	if reason == "" || len(reason) > 1000 {
		return nil, errors.New("recommendation.dismiss: reason must be between 1 and 1000 bytes")
	}
	owner, err := t.client.User.Get(auth.WithInternal(ctx), t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("recommendation.dismiss: resolve owner: %w", err)
	}
	userCtx := auth.WithUser(ctx, owner)
	action, err := t.service.GetAction(userCtx, id)
	if err != nil {
		return nil, fmt.Errorf("recommendation.dismiss: %w", err)
	}
	if action.ActionType == "follow_up_task" || action.Channel == "task" {
		return nil, errors.New("recommendation.dismiss: recommendationId must not identify an internal Oppulence task")
	}
	if action.QueueStatus == revenue.QueueDismissed {
		return recommendationDismissResult(action, true)
	}
	if action.QueueStatus != revenue.QueueOpen && action.QueueStatus != revenue.QueueSnoozed {
		return nil, fmt.Errorf("recommendation.dismiss: recommendation is already %s", action.QueueStatus)
	}
	if action.ExecutionStatus != revenue.ExecPending || action.ApprovalStatus == revenue.ApprovalApproved {
		return nil, errors.New("recommendation.dismiss: approved or started recommendations cannot be dismissed")
	}
	action, err = t.service.Dismiss(userCtx, owner, id, reason)
	if err != nil {
		return nil, fmt.Errorf("recommendation.dismiss: %w", err)
	}
	return recommendationDismissResult(action, false)
}

func recommendationDismissResult(action *ent.RevenueAction, alreadyDismissed bool) (json.RawMessage, error) {
	return json.Marshal(map[string]any{
		"recommendationId": action.ID.String(), "status": action.QueueStatus,
		"reason": action.DismissReason, "alreadyDismissed": alreadyDismissed,
		"note": "Internal Oppulence recommendation dismissed; no external action was taken.",
	})
}

func (t *recommendationSnoozeTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("recommendation snoozing is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("recommendation snoozer scope does not match workflow owner")
	}
	var input struct {
		RecommendationID string `json:"recommendationId"`
		Until            string `json:"until"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode recommendation.snooze input: %w", err)
	}
	id, err := uuid.Parse(strings.TrimSpace(input.RecommendationID))
	if err != nil {
		return nil, errors.New("recommendation.snooze: recommendationId must be a UUID")
	}
	until, err := time.Parse(time.RFC3339, input.Until)
	if err != nil {
		return nil, errors.New("recommendation.snooze: until must be RFC 3339")
	}
	owner, err := t.client.User.Get(auth.WithInternal(ctx), t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("recommendation.snooze: resolve owner: %w", err)
	}
	userCtx := auth.WithUser(ctx, owner)
	action, err := t.service.GetAction(userCtx, id)
	if err != nil {
		return nil, fmt.Errorf("recommendation.snooze: %w", err)
	}
	if action.ActionType == "follow_up_task" || action.Channel == "task" {
		return nil, errors.New("recommendation.snooze: recommendationId must not identify an internal Oppulence task")
	}
	if action.QueueStatus == revenue.QueueSnoozed && action.SnoozedUntil != nil && action.SnoozedUntil.Equal(until) {
		return recommendationSnoozeResult(action, true)
	}
	if action.QueueStatus != revenue.QueueOpen {
		return nil, fmt.Errorf("recommendation.snooze: recommendation is already %s", action.QueueStatus)
	}
	if action.ExecutionStatus != revenue.ExecPending || action.ApprovalStatus == revenue.ApprovalApproved {
		return nil, errors.New("recommendation.snooze: approved or started recommendations cannot be snoozed")
	}
	action, err = t.service.Snooze(userCtx, owner, id, until)
	if err != nil {
		return nil, fmt.Errorf("recommendation.snooze: %w", err)
	}
	return recommendationSnoozeResult(action, false)
}

func recommendationSnoozeResult(action *ent.RevenueAction, alreadySnoozed bool) (json.RawMessage, error) {
	return json.Marshal(map[string]any{
		"recommendationId": action.ID.String(), "status": action.QueueStatus,
		"snoozedUntil": optionalTaskTime(action.SnoozedUntil), "alreadySnoozed": alreadySnoozed,
		"note": "Internal Oppulence recommendation snoozed; no external action was taken.",
	})
}

func (t *recommendationUpdateTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("recommendation editing is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("recommendation editor scope does not match workflow owner")
	}
	var input struct {
		RecommendationID string  `json:"recommendationId"`
		Subject          *string `json:"subject"`
		Message          *string `json:"message"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode recommendation.update input: %w", err)
	}
	id, err := uuid.Parse(strings.TrimSpace(input.RecommendationID))
	if err != nil {
		return nil, errors.New("recommendation.update: recommendationId must be a UUID")
	}
	if input.Subject == nil && input.Message == nil {
		return nil, errors.New("recommendation.update: subject or message is required")
	}
	owner, err := t.client.User.Get(auth.WithInternal(ctx), t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("recommendation.update: resolve owner: %w", err)
	}
	userCtx := auth.WithUser(ctx, owner)
	action, err := t.service.GetAction(userCtx, id)
	if err != nil {
		return nil, fmt.Errorf("recommendation.update: %w", err)
	}
	if action.ActionType == "follow_up_task" || action.Channel == "task" {
		return nil, errors.New("recommendation.update: recommendationId must not identify an internal Oppulence task")
	}
	if action.ExecutionStatus != revenue.ExecPending {
		return nil, errors.New("recommendation.update: started recommendations cannot be edited")
	}
	previousRevision := action.Revision
	action, err = t.service.EditAction(userCtx, owner, id, revenue.EditInput{
		ProposedSubject: input.Subject, ProposedMessage: input.Message,
	})
	if err != nil {
		return nil, fmt.Errorf("recommendation.update: %w", err)
	}
	return recommendationUpdateResult(action, action.Revision != previousRevision)
}

func recommendationUpdateResult(action *ent.RevenueAction, revisionChanged bool) (json.RawMessage, error) {
	return json.Marshal(map[string]any{
		"recommendationId": action.ID.String(), "revision": action.Revision,
		"subject": action.ProposedSubject, "message": action.ProposedMessage,
		"policyStatus": action.PolicyStatus, "approvalStatus": action.ApprovalStatus,
		"revisionChanged": revisionChanged,
		"note":            "Internal Oppulence recommendation updated; no external action was taken.",
	})
}
