package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtask"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrun"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/google/uuid"
)

const workflowReadMax = 50

// NewWorkflowReadTool exposes the signed-in user's workflow configuration.
func NewWorkflowReadTool(client *ent.Client, ownerID uuid.UUID) Tool {
	return &workflowReadTool{client: client, ownerID: ownerID}
}

type workflowReadTool struct {
	client  *ent.Client
	ownerID uuid.UUID
}

func (t *workflowReadTool) Name() string { return "workflow.read" }
func (t *workflowReadTool) Description() string {
	return "Read configured workflows, schedules, sync health, and last-run state without changing or starting them."
}
func (t *workflowReadTool) AuditInfo(json.RawMessage) ToolAudit {
	return ToolAudit{TrustTier: TierRead, Operation: "workflow.read"}
}
func (t *workflowReadTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"slug":{"type":"string","maxLength":200},"active":{"type":"boolean"},"limit":{"type":"integer","minimum":1,"maximum":50}},"additionalProperties":false}`)
}

func (t *workflowReadTool) Invoke(ctx context.Context, scope ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("workflow reader is not configured")
	}
	if scope.UserID != "" && scope.UserID != t.ownerID.String() {
		return nil, errors.New("workflow reader scope does not match workflow owner")
	}
	var input struct {
		Slug   string `json:"slug"`
		Active *bool  `json:"active"`
		Limit  int    `json:"limit"`
	}
	if len(args) > 0 {
		if err := json.Unmarshal(args, &input); err != nil {
			return nil, fmt.Errorf("decode workflow read input: %w", err)
		}
	}
	if input.Limit <= 0 || input.Limit > workflowReadMax {
		input.Limit = 20
	}
	q := t.client.BackgroundTask.Query().
		Where(backgroundtask.HasUserWith(user.IDEQ(t.ownerID))).
		Order(ent.Asc(backgroundtask.FieldSlug)).Limit(input.Limit)
	if slug := strings.TrimSpace(input.Slug); slug != "" {
		q = q.Where(backgroundtask.SlugEQ(slug))
	}
	if input.Active != nil {
		q = q.Where(backgroundtask.ActiveEQ(*input.Active))
	}
	tasks, err := q.All(auth.WithInternal(ctx))
	if err != nil {
		return nil, fmt.Errorf("query workflows: %w", err)
	}

	type workflowView struct {
		Slug              string          `json:"slug"`
		Name              string          `json:"name"`
		Instructions      string          `json:"instructions"`
		Active            bool            `json:"active"`
		Triggers          json.RawMessage `json:"triggers,omitempty"`
		Model             string          `json:"model,omitempty"`
		Provider          string          `json:"provider,omitempty"`
		ExecutionTarget   string          `json:"executionTarget"`
		SystemManaged     bool            `json:"systemManaged"`
		LastRunID         string          `json:"lastRunId,omitempty"`
		LastRunStatus     string          `json:"lastRunStatus,omitempty"`
		LastRunAt         string          `json:"lastRunAt,omitempty"`
		LastRunSummary    string          `json:"lastRunSummary,omitempty"`
		LastRunError      string          `json:"lastRunError,omitempty"`
		LastRunErrorCode  string          `json:"lastRunErrorCode,omitempty"`
		ScheduleSyncState string          `json:"scheduleSyncState"`
		ScheduleSyncError string          `json:"scheduleSyncError,omitempty"`
		ScheduleSyncedAt  string          `json:"scheduleSyncedAt,omitempty"`
	}
	views := make([]workflowView, 0, len(tasks))
	for _, task := range tasks {
		view := workflowView{
			Slug: task.Slug, Name: task.Name, Instructions: truncate(task.Instructions, 1000), Active: task.Active,
			Model: task.Model, Provider: task.Provider, ExecutionTarget: task.ExecutionTarget, SystemManaged: task.SystemManaged,
			ScheduleSyncState: task.ScheduleSyncState, ScheduleSyncError: truncate(task.ScheduleSyncError, 500),
		}
		if json.Valid([]byte(task.TriggersJSON)) {
			view.Triggers = json.RawMessage(task.TriggersJSON)
		}
		// ponytail: at most 50 indexed lookups; replace with a window query only if this becomes measurable.
		latest, runErr := t.client.BackgroundTaskRun.Query().
			Where(backgroundtaskrun.HasTaskWith(backgroundtask.IDEQ(task.ID))).
			Order(ent.Desc(backgroundtaskrun.FieldCreatedAt), ent.Desc(backgroundtaskrun.FieldID)).
			First(auth.WithInternal(ctx))
		if runErr != nil && !ent.IsNotFound(runErr) {
			return nil, fmt.Errorf("query latest run for %s: %w", task.Slug, runErr)
		}
		if runErr == nil {
			view.LastRunID, view.LastRunStatus = latest.RunID, latest.Status
			view.LastRunAt = latest.CreatedAt.UTC().Format(time.RFC3339)
			view.LastRunSummary = truncate(latest.Summary, 300)
			view.LastRunError = truncate(latest.Error, 500)
			view.LastRunErrorCode = latest.ErrorCode
		}
		if task.ScheduleSyncedAt != nil {
			view.ScheduleSyncedAt = task.ScheduleSyncedAt.UTC().Format(time.RFC3339)
		}
		views = append(views, view)
	}
	return json.Marshal(map[string]any{"workflows": views})
}
