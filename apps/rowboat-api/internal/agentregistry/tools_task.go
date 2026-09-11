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

// TaskCreateCapability creates an internal Oppulence task through the same
// revenue action service used by the Tasks UI. It never sends externally.
func TaskCreateCapability() Capability {
	tool := &taskCreateTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("task.create", "task creation is not configured on this server")
			}
			return &taskCreateTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// TaskUpdateCapability edits internal Oppulence task metadata. It never sends externally.
func TaskUpdateCapability() Capability {
	tool := &taskUpdateTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("task.update", "task editing is not configured on this server")
			}
			return &taskUpdateTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// TaskCompleteCapability completes an internal Oppulence task through the same
// dismissal lifecycle used by the Tasks UI. It cannot dismiss other actions.
func TaskCompleteCapability() Capability {
	tool := &taskCompleteTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("task.complete", "task completion is not configured on this server")
			}
			return &taskCompleteTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

// TaskSnoozeCapability parks an internal Oppulence task through the same
// bounded snooze lifecycle used by the action queue. It cannot snooze other actions.
func TaskSnoozeCapability() Capability {
	tool := &taskSnoozeTool{}
	return Capability{
		Name: tool.Name(), Description: tool.Description(), Parameters: tool.JSONSchema(),
		TrustTier: TierWrite, Kind: KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			ownerID, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil {
				return newUnavailableTool("task.snooze", "task snoozing is not configured on this server")
			}
			return &taskSnoozeTool{
				client: d.Client, ownerID: ownerID,
				service: revenue.NewService(d.Client, nil, nil, zap.NewNop()),
			}
		},
	}
}

type taskCreateTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type taskCompleteTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type taskUpdateTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

type taskSnoozeTool struct {
	client  *ent.Client
	ownerID uuid.UUID
	service *revenue.Service
}

func (t *taskCreateTool) Name() string { return "task.create" }

func (t *taskCompleteTool) Name() string { return "task.complete" }

func (t *taskUpdateTool) Name() string { return "task.update" }

func (t *taskSnoozeTool) Name() string { return "task.snooze" }

func (t *taskCreateTool) Description() string {
	return "Create an internal Oppulence follow-up task linked to an existing relationship. This never sends a message or creates an external calendar event."
}

func (t *taskCompleteTool) Description() string {
	return "Mark an existing internal Oppulence task complete. This cannot dismiss other action types and never sends anything externally."
}

func (t *taskUpdateTool) Description() string {
	return "Edit the title, due time, or priority of an existing internal Oppulence task. This never sends a message or changes an external calendar event."
}

func (t *taskSnoozeTool) Description() string {
	return "Snooze an existing internal Oppulence task until a future time. This cannot snooze other action types and never sends anything externally."
}

func (t *taskCreateTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"relationshipId":{"type":"string","description":"Existing Oppulence relationship ID."},"title":{"type":"string","minLength":1,"maxLength":1000},"dueAt":{"type":"string","format":"date-time","description":"Optional RFC 3339 due time."},"priority":{"type":"integer","minimum":0,"maximum":100,"description":"Optional priority; defaults to 30."}},"required":["relationshipId","title"],"additionalProperties":false}`)
}

func (t *taskCompleteTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"taskId":{"type":"string","description":"Existing Oppulence task ID."}},"required":["taskId"],"additionalProperties":false}`)
}

func (t *taskUpdateTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"taskId":{"type":"string","description":"Existing Oppulence task ID."},"title":{"type":"string","minLength":1,"maxLength":1000},"dueAt":{"anyOf":[{"type":"string","format":"date-time"},{"type":"null"}],"description":"Replacement RFC 3339 due time, or null to clear it."},"priority":{"type":"integer","minimum":0,"maximum":100}},"required":["taskId"],"additionalProperties":false}`)
}

func (t *taskSnoozeTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"taskId":{"type":"string","description":"Existing Oppulence task ID."},"until":{"type":"string","format":"date-time","description":"RFC 3339 time in the future, up to 90 days away."}},"required":["taskId","until"],"additionalProperties":false}`)
}

func (t *taskCreateTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "task.create"}
}

func (t *taskCompleteTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "task.complete"}
}

func (t *taskUpdateTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "task.update"}
}

func (t *taskSnoozeTool) AuditInfo(json.RawMessage) backgroundtaskruntime.ToolAudit {
	return backgroundtaskruntime.ToolAudit{TrustTier: backgroundtaskruntime.TierWrite, Connector: "oppulence", Operation: "task.snooze"}
}

func (t *taskCreateTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("task creation is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("task creator scope does not match workflow owner")
	}
	var input struct {
		RelationshipID string `json:"relationshipId"`
		Title          string `json:"title"`
		DueAt          string `json:"dueAt"`
		Priority       *int   `json:"priority"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode task.create input: %w", err)
	}
	title := strings.TrimSpace(input.Title)
	if title == "" || len(title) > 1000 {
		return nil, errors.New("task.create: title must be between 1 and 1000 bytes")
	}
	relationshipID, err := uuid.Parse(input.RelationshipID)
	if err != nil {
		return nil, errors.New("task.create: relationshipId must be a UUID")
	}
	var dueAt *time.Time
	if input.DueAt != "" {
		parsed, err := time.Parse(time.RFC3339, input.DueAt)
		if err != nil {
			return nil, errors.New("task.create: dueAt must be RFC 3339")
		}
		dueAt = &parsed
	}
	priority := 30
	if input.Priority != nil {
		priority = *input.Priority
	}
	if priority < 0 || priority > 100 {
		return nil, errors.New("task.create: priority must be between 0 and 100")
	}
	owner, err := t.client.User.Get(auth.WithInternal(ctx), t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("task.create: resolve owner: %w", err)
	}
	dedupeKey, err := durableToolKey(scope, "task")
	if err != nil {
		return nil, fmt.Errorf("task.create: %w", err)
	}
	action, err := t.service.CreateAction(auth.WithUser(ctx, owner), owner, revenue.ActionInput{
		RelationshipID: relationshipID, ActionType: "follow_up_task", Channel: "task",
		DedupeKey: dedupeKey, Reason: title, PriorityScore: priority, DueAt: dueAt,
	})
	if err != nil {
		return nil, fmt.Errorf("task.create: %w", err)
	}
	return json.Marshal(map[string]any{
		"taskId": action.ID.String(), "status": action.QueueStatus,
		"relationshipId": relationshipID.String(), "title": action.Reason,
		"dueAt": optionalTaskTime(action.DueAt), "priority": action.PriorityScore,
		"note": "Internal Oppulence task created; no external action was taken.",
	})
}

func (t *taskCompleteTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("task completion is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("task completer scope does not match workflow owner")
	}
	var input struct {
		TaskID string `json:"taskId"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode task.complete input: %w", err)
	}
	taskID, err := uuid.Parse(input.TaskID)
	if err != nil {
		return nil, errors.New("task.complete: taskId must be a UUID")
	}
	owner, err := t.client.User.Get(auth.WithInternal(ctx), t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("task.complete: resolve owner: %w", err)
	}
	userCtx := auth.WithUser(ctx, owner)
	task, err := t.service.GetAction(userCtx, taskID)
	if err != nil {
		return nil, fmt.Errorf("task.complete: %w", err)
	}
	if task.ActionType != "follow_up_task" || task.Channel != "task" {
		return nil, errors.New("task.complete: taskId must identify an internal Oppulence task")
	}
	if task.QueueStatus == revenue.QueueDismissed && task.DismissReason == "Completed from Assistant" {
		return taskCompleteResult(task)
	}
	if task.QueueStatus != revenue.QueueOpen && task.QueueStatus != revenue.QueueSnoozed {
		return nil, fmt.Errorf("task.complete: task is already %s", task.QueueStatus)
	}
	task, err = t.service.Dismiss(userCtx, owner, taskID, "Completed from Assistant")
	if err != nil {
		return nil, fmt.Errorf("task.complete: %w", err)
	}
	return taskCompleteResult(task)
}

func (t *taskUpdateTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("task editing is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("task editor scope does not match workflow owner")
	}
	var input struct {
		TaskID   string          `json:"taskId"`
		Title    *string         `json:"title"`
		DueAt    json.RawMessage `json:"dueAt"`
		Priority *int            `json:"priority"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode task.update input: %w", err)
	}
	taskID, err := uuid.Parse(input.TaskID)
	if err != nil {
		return nil, errors.New("task.update: taskId must be a UUID")
	}
	if input.Title == nil && input.DueAt == nil && input.Priority == nil {
		return nil, errors.New("task.update: title, dueAt, or priority is required")
	}
	if input.Title != nil {
		title := strings.TrimSpace(*input.Title)
		if title == "" || len(title) > 1000 {
			return nil, errors.New("task.update: title must be between 1 and 1000 bytes")
		}
		input.Title = &title
	}
	if input.Priority != nil && (*input.Priority < 0 || *input.Priority > 100) {
		return nil, errors.New("task.update: priority must be between 0 and 100")
	}
	var dueAt *time.Time
	clearDueAt := string(input.DueAt) == "null"
	if input.DueAt != nil && !clearDueAt {
		var value string
		if err := json.Unmarshal(input.DueAt, &value); err != nil {
			return nil, errors.New("task.update: dueAt must be RFC 3339 or null")
		}
		parsed, err := time.Parse(time.RFC3339, value)
		if err != nil {
			return nil, errors.New("task.update: dueAt must be RFC 3339 or null")
		}
		dueAt = &parsed
	}
	owner, err := t.client.User.Get(auth.WithInternal(ctx), t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("task.update: resolve owner: %w", err)
	}
	userCtx := auth.WithUser(ctx, owner)
	task, err := t.service.GetAction(userCtx, taskID)
	if err != nil {
		return nil, fmt.Errorf("task.update: %w", err)
	}
	if task.ActionType != "follow_up_task" || task.Channel != "task" {
		return nil, errors.New("task.update: taskId must identify an internal Oppulence task")
	}
	if task.QueueStatus != revenue.QueueOpen && task.QueueStatus != revenue.QueueSnoozed {
		return nil, fmt.Errorf("task.update: task is already %s", task.QueueStatus)
	}
	task, err = t.service.EditAction(userCtx, owner, taskID, revenue.EditInput{
		Reason: input.Title, DueAt: dueAt, ClearDueAt: clearDueAt, PriorityScore: input.Priority,
	})
	if err != nil {
		return nil, fmt.Errorf("task.update: %w", err)
	}
	return taskUpdateResult(task)
}

func taskUpdateResult(task *ent.RevenueAction) (json.RawMessage, error) {
	return json.Marshal(map[string]any{
		"taskId": task.ID.String(), "status": task.QueueStatus, "title": task.Reason,
		"dueAt": optionalTaskTime(task.DueAt), "priority": task.PriorityScore,
		"note": "Internal Oppulence task updated; no external action was taken.",
	})
}

func taskCompleteResult(task *ent.RevenueAction) (json.RawMessage, error) {
	return json.Marshal(map[string]any{
		"taskId": task.ID.String(), "status": "completed", "queueStatus": task.QueueStatus,
		"title": task.Reason, "note": "Internal Oppulence task completed; no external action was taken.",
	})
}

func (t *taskSnoozeTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.service == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("task snoozing is not configured")
	}
	if scope.UserID != t.ownerID.String() {
		return nil, errors.New("task snoozer scope does not match workflow owner")
	}
	var input struct {
		TaskID string `json:"taskId"`
		Until  string `json:"until"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode task.snooze input: %w", err)
	}
	taskID, err := uuid.Parse(input.TaskID)
	if err != nil {
		return nil, errors.New("task.snooze: taskId must be a UUID")
	}
	until, err := time.Parse(time.RFC3339, input.Until)
	if err != nil {
		return nil, errors.New("task.snooze: until must be RFC 3339")
	}
	owner, err := t.client.User.Get(auth.WithInternal(ctx), t.ownerID)
	if err != nil {
		return nil, fmt.Errorf("task.snooze: resolve owner: %w", err)
	}
	userCtx := auth.WithUser(ctx, owner)
	task, err := t.service.GetAction(userCtx, taskID)
	if err != nil {
		return nil, fmt.Errorf("task.snooze: %w", err)
	}
	if task.ActionType != "follow_up_task" || task.Channel != "task" {
		return nil, errors.New("task.snooze: taskId must identify an internal Oppulence task")
	}
	if task.QueueStatus == revenue.QueueSnoozed && task.SnoozedUntil != nil && task.SnoozedUntil.Equal(until) {
		return taskSnoozeResult(task)
	}
	if task.QueueStatus != revenue.QueueOpen {
		return nil, fmt.Errorf("task.snooze: task is already %s", task.QueueStatus)
	}
	task, err = t.service.Snooze(userCtx, owner, taskID, until)
	if err != nil {
		return nil, fmt.Errorf("task.snooze: %w", err)
	}
	return taskSnoozeResult(task)
}

func taskSnoozeResult(task *ent.RevenueAction) (json.RawMessage, error) {
	return json.Marshal(map[string]any{
		"taskId": task.ID.String(), "status": task.QueueStatus,
		"title": task.Reason, "until": optionalTaskTime(task.SnoozedUntil),
		"note": "Internal Oppulence task snoozed; no external action was taken.",
	})
}

func durableToolKey(scope backgroundtaskruntime.ToolScope, operation string) (string, error) {
	if strings.TrimSpace(scope.RunID) == "" {
		return "", errors.New("durable invocation identity is missing")
	}
	return fmt.Sprintf("agent-%s:%s:%d:%d", operation, scope.RunID, scope.TurnSeq, scope.ToolCallIndex), nil
}

func optionalTaskTime(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.UTC().Format(time.RFC3339)
	return &formatted
}
