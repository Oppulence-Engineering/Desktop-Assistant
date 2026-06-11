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
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrun"
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
	// dual-authority interleaving double-fires the occurrence. The 30s skew
	// allowance keeps a fire delivered fractionally before its scheduled
	// minute (worker clock behind the Temporal server) from resolving to the
	// PREVIOUS occurrence and skipping itself as covered — but it must never
	// produce a FUTURE occurrence (a fire or retry processed ≥30s past the
	// minute would otherwise compute the NEXT tick, which no last_run_at can
	// cover, disabling the dedup); clamp back to now in that case.
	now := time.Now().UTC()
	if occurrence, err := gronx.PrevTickBefore(cronExpr, now.Add(30*time.Second).Truncate(time.Minute), true); err == nil {
		if occurrence.After(now) {
			occ, clampErr := gronx.PrevTickBefore(cronExpr, now.Truncate(time.Minute), true)
			occurrence, err = occ, clampErr
		}
		if err == nil && task.LastRunAt != nil && !task.LastRunAt.Before(occurrence) {
			return skipResult("occurrence already covered"), nil
		}
	}

	// In-flight backstop, mirroring the loop (scheduler.go evaluateTask): a
	// last attempt newer than the last success that is still inside the
	// backoff window means a prior run never completed — don't stack another.
	// Temporal's SCHEDULE_OVERLAP_POLICY_SKIP cannot provide this: it only
	// spans the scheduler workflow, not the actual run. Retry attempts of
	// THIS fire bypass the guard — but only when the in-flight marker really
	// came from our own failed start (verified against the latest run row),
	// not from another authority's genuinely executing run that happens to
	// overlap a retry of an unrelated transient failure.
	if scheduledInFlight(task) && scheduledBackoffRemaining(task.LastAttemptAt, now) > 0 {
		if !in.RetryAttempt || !s.latestRunIsFailedStart(ctx, task) {
			return skipResult("prior run still in flight"), nil
		}
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
		// (temporal_start_failed). Stamp last_attempt_at (the loop's
		// stampAttempt equivalent) so the loop's backoff suppresses its own
		// fallback fires during a dual-authority window, then propagate so
		// Temporal's bounded activity retry re-attempts the occurrence —
		// retries bypass the in-flight guard above, and the occurrence check
		// stays open because last_run_at is untouched. Each attempt leaves
		// one visible failed row, like the loop's own re-fires.
		s.stampScheduledAttempt(ctx, task, now)
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

// latestRunIsFailedStart reports whether the task's most recent run is a
// Temporal start failure — the only prior state a retry attempt is licensed
// to barge past the in-flight guard for. Queried only on retry attempts.
func (s *Starter) latestRunIsFailedStart(ctx context.Context, task *ent.BackgroundTask) bool {
	latest, err := s.Client.BackgroundTaskRun.Query().
		Where(backgroundtaskrun.HasTaskWith(backgroundtask.IDEQ(task.ID))).
		Order(ent.Desc(backgroundtaskrun.FieldCreatedAt)).
		First(ctx)
	if err != nil {
		return false
	}
	return latest.Status == "failed" && latest.TemporalStatus == "StartFailed"
}

// stampScheduledAttempt mirrors the loop's stampAttempt: record only
// last_attempt_at on a start failure to engage the loop's retry backoff
// without advancing the cycle anchor.
func (s *Starter) stampScheduledAttempt(ctx context.Context, task *ent.BackgroundTask, now time.Time) {
	if err := s.Client.BackgroundTask.UpdateOneID(task.ID).
		SetLastAttemptAt(now).
		AddRevision(1).
		Exec(ctx); err != nil {
		s.Log.Error("stamp scheduled attempt failed", zap.String("taskSlug", task.Slug), zap.Error(err))
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
