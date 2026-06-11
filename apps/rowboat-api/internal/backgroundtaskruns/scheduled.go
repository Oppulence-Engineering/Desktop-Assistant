package backgroundtaskruns

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtask"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskworkflow"
	"github.com/adhocore/gronx"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// SourceTemporalSchedule is a run created by a Temporal Schedule fire (RFC 005).
const SourceTemporalSchedule Source = "temporal-schedule"

// scheduledRetryBackoff mirrors the loop's retryBackoff (backgroundscheduler
// due.go): a fire is suppressed while a prior attempt newer than the last
// success is inside this window. Duplicated because backgroundscheduler
// imports this package (the reverse import would cycle); keep the values in
// lockstep.
const scheduledRetryBackoff = 5 * time.Minute

// StartScheduledRun implements backgroundtaskworkflow.ScheduledRunStarter: it
// is the body of the CreateScheduledRun activity, called once per Temporal
// Schedule fire. It re-validates the task at fire time — the schedule is an
// external copy of task state and can lag a delete/deactivate/retarget — and
// skips stale fires rather than failing them (the reconciler repairs the
// schedule itself). On a real fire it mirrors the RFC 001 loop's bookkeeping
// (in-flight suppression, fire-time task stamp, one failed row per failed
// start) so handed-off crons behave identically to loop-fired ones.
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
	if !gronx.IsValid(cronExpr) {
		// The schedule predates an edit that broke the expression; never start
		// runs on the stale cadence. The syncer/reconciler delete the schedule.
		return skipResult("cron expression invalid"), nil
	}

	// Occurrence-coverage check, mirroring the loop's cronDueOccurrence
	// (due.go): if last_run_at already covers the current occurrence, another
	// authority fired it first — the loop during a failed/syncing fallback
	// window, a prior activity attempt whose completion was lost after a
	// worker crash, or this very schedule moments ago. Without this, every
	// dual-authority interleaving double-fires the occurrence.
	now := time.Now().UTC()
	if occurrence, err := gronx.PrevTickBefore(cronExpr, now.Truncate(time.Minute), true); err == nil {
		if task.LastRunAt != nil && !task.LastRunAt.Before(occurrence) {
			return skipResult("occurrence already covered"), nil
		}
	}

	// In-flight backstop, mirroring the loop (scheduler.go evaluateTask): a
	// last attempt newer than the last success that is still inside the
	// backoff window means a prior run never completed — don't stack another.
	// Temporal's SCHEDULE_OVERLAP_POLICY_SKIP cannot provide this: it only
	// spans the seconds-long scheduler workflow, not the actual run.
	if scheduledInFlight(task) && scheduledBackoffRemaining(task.LastAttemptAt, now) > 0 {
		return skipResult("prior run still in flight"), nil
	}

	run, err := s.Start(ctx, Params{
		User:    task.Edges.User,
		Task:    task,
		Trigger: "cron",
		RequestedContext: fmt.Sprintf(
			"Temporal schedule fired at %s for expression %q.",
			now.Format(time.RFC3339), cronExpr,
		),
		RunIDPrefix:   "sched-temporal-",
		QueuedMessage: "Queued by Temporal schedule.",
		Source:        SourceTemporalSchedule,
	})
	var persistErr *PersistIDsError
	var startErr *StartFailedError
	switch {
	case errors.As(err, &persistErr):
		// The run workflow IS already running; only persisting its Temporal
		// ids failed. Surfacing an error would make Temporal retry the
		// activity and double-start the occurrence — report the fire as a
		// success (mirrors the loop's PersistIDsError branch).
		s.Log.Warn("scheduled run started but temporal ids unpersisted",
			zap.String("taskSlug", task.Slug), zap.String("runId", run.RunID), zap.Error(err))
		s.stampScheduledFire(ctx, task, now, run.RunID)
	case errors.As(err, &startErr):
		// Start already created the run row and marked it failed
		// (temporal_start_failed). Propagate WITHOUT stamping the task: the
		// occurrence-coverage check above doesn't trip on an unstamped task,
		// so Temporal's bounded activity retry genuinely re-attempts the
		// occurrence — the schedule-path equivalent of the loop's
		// widened-grace retry after a transient start failure. Each attempt
		// leaves one visible failed row, exactly like the loop's re-fires.
		s.Log.Error("scheduled run temporal start failed",
			zap.String("taskSlug", task.Slug), zap.String("runId", run.RunID), zap.Error(err))
		return backgroundtaskworkflow.ScheduledRunResult{}, err
	case err != nil:
		return backgroundtaskworkflow.ScheduledRunResult{}, err
	default:
		s.stampScheduledFire(ctx, task, now, run.RunID)
	}
	return backgroundtaskworkflow.ScheduledRunResult{RunID: run.RunID, WorkflowID: run.TemporalWorkflowID}, nil
}

// stampScheduledFire mirrors the loop's stampFired: a successful fire advances
// the cycle anchor (last_run_at) + attempt/run markers so the loop (and the
// occurrence-coverage check above) never re-fires the same occurrence and
// same-day window suppression behaves identically to a loop cron fire.
func (s *Starter) stampScheduledFire(ctx context.Context, task *ent.BackgroundTask, now time.Time, runID string) {
	if err := s.Client.BackgroundTask.UpdateOneID(task.ID).
		SetLastAttemptAt(now).
		SetLastRunAt(now).
		SetLastRunID(runID).
		AddRevision(1).
		Exec(ctx); err != nil {
		s.Log.Error("stamp scheduled fire failed",
			zap.String("taskSlug", task.Slug), zap.String("runId", runID), zap.Error(err))
	}
}

// scheduledInFlight mirrors backgroundscheduler's inFlight.
func scheduledInFlight(task *ent.BackgroundTask) bool {
	if task.LastAttemptAt == nil {
		return false
	}
	return task.LastRunAt == nil || task.LastAttemptAt.After(*task.LastRunAt)
}

// scheduledBackoffRemaining mirrors backgroundscheduler's backoffRemaining.
func scheduledBackoffRemaining(lastAttemptAt *time.Time, now time.Time) time.Duration {
	if lastAttemptAt == nil {
		return 0
	}
	since := now.Sub(*lastAttemptAt)
	if since < 0 || since >= scheduledRetryBackoff {
		return 0
	}
	return scheduledRetryBackoff - since
}

func skipResult(reason string) backgroundtaskworkflow.ScheduledRunResult {
	return backgroundtaskworkflow.ScheduledRunResult{Skipped: true, SkipReason: reason}
}

// cronExprFromTriggers extracts triggers.cronExpr with a minimal decode,
// trimmed like backgroundscheduler.ParseTriggers does. This package stays a
// leaf of internal/backgroundscheduler (which owns the full trigger parser),
// so the probe lives here; validity is checked by the caller via gronx — the
// same library the parser uses.
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
	return strings.TrimSpace(t.CronExpr)
}
