package backgroundtaskruns

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtask"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskworkflow"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// SourceTemporalSchedule is a run created by a Temporal Schedule fire (RFC 005).
const SourceTemporalSchedule Source = "temporal-schedule"

// StartScheduledRun implements backgroundtaskworkflow.ScheduledRunStarter: it
// is the body of the CreateScheduledRun activity, called once per Temporal
// Schedule fire. It re-validates the task at fire time — the schedule is an
// external copy of task state and can lag a delete/deactivate/retarget — and
// skips stale fires rather than failing them (the reconciler repairs the
// schedule itself).
func (s *Starter) StartScheduledRun(ctx context.Context, in backgroundtaskworkflow.ScheduleFireInput) (backgroundtaskworkflow.ScheduledRunResult, error) {
	ctx = auth.WithInternal(ctx)
	taskID, err := uuid.Parse(in.TaskID)
	if err != nil {
		return backgroundtaskworkflow.ScheduledRunResult{}, &InvalidParamsError{Message: fmt.Sprintf("invalid task id %q", in.TaskID)}
	}
	task, err := s.Client.BackgroundTask.Query().
		Where(backgroundtask.IDEQ(taskID)).
		WithUser().
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return skipResult("task deleted"), nil
		}
		return backgroundtaskworkflow.ScheduledRunResult{}, fmt.Errorf("load task: %w", err)
	}
	if !task.Active {
		return skipResult("task inactive"), nil
	}
	if task.ExecutionTarget != "api" {
		return skipResult("task no longer targets api"), nil
	}
	cronExpr := cronExprFromTriggers(task.TriggersJSON)
	if cronExpr == "" {
		return skipResult("cron trigger removed"), nil
	}

	run, err := s.Start(ctx, Params{
		User:    task.Edges.User,
		Task:    task,
		Trigger: "cron",
		RequestedContext: fmt.Sprintf(
			"Temporal schedule fired at %s for expression %q.",
			time.Now().UTC().Format(time.RFC3339), cronExpr,
		),
		RunIDPrefix:   "sched-temporal-",
		QueuedMessage: "Queued by Temporal schedule.",
		Source:        SourceTemporalSchedule,
	})
	var persistErr *PersistIDsError
	if errors.As(err, &persistErr) {
		// The run workflow IS already running; only persisting its Temporal ids
		// failed. Surfacing an error would make Temporal retry the activity and
		// double-start the occurrence — report the fire as a success instead
		// (mirrors the loop's PersistIDsError branch in evaluateTask).
		s.Log.Warn("scheduled run started but temporal ids unpersisted",
			zap.String("taskSlug", task.Slug), zap.String("runId", run.RunID), zap.Error(err))
		return backgroundtaskworkflow.ScheduledRunResult{RunID: run.RunID, WorkflowID: run.TemporalWorkflowID}, nil
	}
	if err != nil {
		return backgroundtaskworkflow.ScheduledRunResult{}, err
	}
	return backgroundtaskworkflow.ScheduledRunResult{RunID: run.RunID, WorkflowID: run.TemporalWorkflowID}, nil
}

func skipResult(reason string) backgroundtaskworkflow.ScheduledRunResult {
	return backgroundtaskworkflow.ScheduledRunResult{Skipped: true, SkipReason: reason}
}

// cronExprFromTriggers extracts triggers.cronExpr with a minimal decode. This
// package stays a leaf of internal/backgroundscheduler (which owns the full
// trigger parser), so the probe lives here.
func cronExprFromTriggers(triggersJSON string) string {
	if triggersJSON == "" {
		return ""
	}
	var t struct {
		CronExpr string `json:"cronExpr"`
	}
	if err := json.Unmarshal([]byte(triggersJSON), &t); err != nil {
		return ""
	}
	return t.CronExpr
}
