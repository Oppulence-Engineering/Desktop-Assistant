package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtask"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrun"
	"github.com/google/uuid"
)

// historyLimit bounds run_history.read output.
const historyLimit = 10

// NewRunHistoryTool exposes the task's recent run outcomes (read-only,
// task-scoped). Useful for "what changed since last run" style tasks.
func NewRunHistoryTool(client *ent.Client, taskID uuid.UUID, currentRunID string) Tool {
	return &runHistoryTool{client: client, taskID: taskID, currentRunID: currentRunID}
}

type runHistoryTool struct {
	client       *ent.Client
	taskID       uuid.UUID
	currentRunID string
}

func (t *runHistoryTool) Name() string { return "run_history.read" }
func (t *runHistoryTool) Description() string {
	return "Read this task's recent run history (status, summary, errors)."
}

func (t *runHistoryTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"limit":{"type":"integer","description":"Max runs to return (1-10)."}}}`)
}

func (t *runHistoryTool) Invoke(ctx context.Context, _ ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		Limit int `json:"limit"`
	}
	_ = json.Unmarshal(args, &in)
	limit := in.Limit
	if limit <= 0 || limit > historyLimit {
		limit = historyLimit
	}

	runs, err := t.client.BackgroundTaskRun.Query().
		Where(
			backgroundtaskrun.HasTaskWith(backgroundtask.IDEQ(t.taskID)),
			backgroundtaskrun.RunIDNEQ(t.currentRunID), // exclude the in-flight run
		).
		Order(ent.Desc(backgroundtaskrun.FieldCreatedAt)).
		Limit(limit).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("query run history: %w", err)
	}

	type runView struct {
		RunID       string `json:"runId"`
		Status      string `json:"status"`
		Trigger     string `json:"trigger"`
		Summary     string `json:"summary,omitempty"`
		ErrorCode   string `json:"errorCode,omitempty"`
		CreatedAt   string `json:"createdAt"`
		CompletedAt string `json:"completedAt,omitempty"`
	}
	views := make([]runView, 0, len(runs))
	for _, r := range runs {
		v := runView{
			RunID:     r.RunID,
			Status:    r.Status,
			Trigger:   r.Trigger,
			Summary:   truncate(r.Summary, 300),
			ErrorCode: r.ErrorCode,
			CreatedAt: r.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
		}
		if r.CompletedAt != nil {
			v.CompletedAt = r.CompletedAt.UTC().Format("2006-01-02T15:04:05Z")
		}
		views = append(views, v)
	}
	return json.Marshal(map[string]any{"runs": views})
}
