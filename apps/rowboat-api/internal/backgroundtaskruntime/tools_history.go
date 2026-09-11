package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtask"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrun"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/google/uuid"
)

// historyLimit bounds run_history.read output.
const historyLimit = 10

// NewRunHistoryTool exposes the task's recent run outcomes (read-only,
// task-scoped). Useful for "what changed since last run" style tasks.
func NewRunHistoryTool(client *ent.Client, taskID uuid.UUID, currentRunID string) Tool {
	return &runHistoryTool{client: client, taskID: taskID, currentRunID: currentRunID}
}

// NewUserRunHistoryTool exposes the signed-in user's runs across their tasks.
func NewUserRunHistoryTool(client *ent.Client, ownerID uuid.UUID) Tool {
	return &runHistoryTool{client: client, ownerID: ownerID}
}

type runHistoryTool struct {
	client       *ent.Client
	taskID       uuid.UUID
	ownerID      uuid.UUID
	currentRunID string
}

func (t *runHistoryTool) Name() string { return "run_history.read" }
func (t *runHistoryTool) Description() string {
	return "Read recent workflow runs, including status, summaries, and bounded failure details."
}

func (t *runHistoryTool) AuditInfo(json.RawMessage) ToolAudit {
	return ToolAudit{TrustTier: TierRead, Operation: "run_history.read"}
}

func (t *runHistoryTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"slug":{"type":"string","maxLength":200,"description":"Optional workflow slug."},"status":{"type":"string","enum":["queued","running","succeeded","failed","stopped"]},"limit":{"type":"integer","minimum":1,"maximum":10}},"additionalProperties":false}`)
}

func (t *runHistoryTool) Invoke(ctx context.Context, scope ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || (t.taskID == uuid.Nil && t.ownerID == uuid.Nil) {
		return nil, errors.New("run history reader is not configured")
	}
	if t.ownerID != uuid.Nil && scope.UserID != "" && scope.UserID != t.ownerID.String() {
		return nil, errors.New("run history reader scope does not match workflow owner")
	}
	var in struct {
		Slug   string `json:"slug"`
		Status string `json:"status"`
		Limit  int    `json:"limit"`
	}
	if len(args) > 0 {
		if err := json.Unmarshal(args, &in); err != nil {
			return nil, fmt.Errorf("decode run history input: %w", err)
		}
	}
	limit := in.Limit
	if limit <= 0 || limit > historyLimit {
		limit = historyLimit
	}
	status := strings.ToLower(strings.TrimSpace(in.Status))
	switch status {
	case "", "queued", "running", "succeeded", "failed", "stopped":
	default:
		return nil, errors.New("status must be queued, running, succeeded, failed, or stopped")
	}

	q := t.client.BackgroundTaskRun.Query().WithTask().
		Order(ent.Desc(backgroundtaskrun.FieldCreatedAt), ent.Desc(backgroundtaskrun.FieldID)).
		Limit(limit)
	if t.taskID != uuid.Nil {
		q = q.Where(
			backgroundtaskrun.HasTaskWith(backgroundtask.IDEQ(t.taskID)),
			backgroundtaskrun.RunIDNEQ(t.currentRunID), // exclude the in-flight run
		)
	} else {
		q = q.Where(backgroundtaskrun.HasUserWith(user.IDEQ(t.ownerID)))
	}
	if slug := strings.TrimSpace(in.Slug); slug != "" {
		q = q.Where(backgroundtaskrun.HasTaskWith(backgroundtask.SlugEQ(slug)))
	}
	if status != "" {
		q = q.Where(backgroundtaskrun.StatusEQ(status))
	}
	queryCtx := ctx
	if t.ownerID != uuid.Nil {
		queryCtx = auth.WithInternal(ctx) // Explicit owner filter above is the tenant boundary.
	}
	runs, err := q.All(queryCtx)
	if err != nil {
		return nil, fmt.Errorf("query run history: %w", err)
	}

	type runView struct {
		RunID        string `json:"runId"`
		Slug         string `json:"slug,omitempty"`
		Name         string `json:"name,omitempty"`
		Status       string `json:"status"`
		Trigger      string `json:"trigger"`
		Executor     string `json:"executor"`
		Attempt      int    `json:"attempt"`
		Summary      string `json:"summary,omitempty"`
		Error        string `json:"error,omitempty"`
		ErrorCode    string `json:"errorCode,omitempty"`
		ErrorDetails string `json:"errorDetails,omitempty"`
		Progress     string `json:"progress,omitempty"`
		CreatedAt    string `json:"createdAt"`
		CompletedAt  string `json:"completedAt,omitempty"`
	}
	views := make([]runView, 0, len(runs))
	for _, r := range runs {
		v := runView{
			RunID: r.RunID, Status: r.Status, Trigger: r.Trigger, Executor: r.Executor, Attempt: r.Attempt,
			Summary: truncate(r.Summary, 300), Error: truncate(r.Error, 500), ErrorCode: r.ErrorCode,
			ErrorDetails: truncate(r.ErrorDetails, 500), Progress: truncate(r.ProgressMessage, 300),
			CreatedAt: r.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
		}
		if task, edgeErr := r.Edges.TaskOrErr(); edgeErr == nil {
			v.Slug, v.Name = task.Slug, task.Name
		}
		if r.CompletedAt != nil {
			v.CompletedAt = r.CompletedAt.UTC().Format("2006-01-02T15:04:05Z")
		}
		views = append(views, v)
	}
	return json.Marshal(map[string]any{"runs": views})
}
