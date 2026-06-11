package backgroundtaskschedule

import (
	"context"
	"fmt"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundscheduler"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskmetrics"
	"go.uber.org/zap"
)

// temporalCallTimeout bounds every Temporal RPC made on the HTTP write path so
// a Temporal outage degrades to schedule_sync_state=failed instead of hanging
// the request. The RFC 001 loop keeps the cron firing meanwhile.
const temporalCallTimeout = 5 * time.Second

// outcome is the desired schedule/state classification for a task. It is the
// ONE definition of the RFC 005 state machine, shared by the per-write Syncer
// and the sweep Reconciler so the two can never disagree on what a task wants.
type outcome int

const (
	// outcomeManaged: active api task with a valid cron — unpaused schedule,
	// state "current" once Temporal converges.
	outcomeManaged outcome = iota
	// outcomeInvalid: active api task whose cron can never fire — no schedule
	// (a leftover would fire the stale expression), state "failed".
	outcomeInvalid
	// outcomePausedKeep: inactive api task with a valid cron — schedule kept
	// paused for fast unpause, state "paused".
	outcomePausedKeep
	// outcomeUnmanaged: everything else (no cron, invalid cron while
	// inactive, desktop target, unparseable triggers) — no schedule, state
	// "paused".
	outcomeUnmanaged
)

// classify maps a task to its desired outcome and extracted cron expression.
func classify(task *ent.BackgroundTask) (outcome, string) {
	tr, err := backgroundscheduler.ParseTriggers(task.TriggersJSON)
	hasCron := err == nil && tr.HasCron()
	if task.ExecutionTarget != "api" || !hasCron {
		return outcomeUnmanaged, ""
	}
	valid := tr.HasValidCron()
	switch {
	case task.Active && valid:
		return outcomeManaged, tr.CronExpr
	case task.Active:
		return outcomeInvalid, tr.CronExpr
	case valid:
		return outcomePausedKeep, tr.CronExpr
	default:
		return outcomeUnmanaged, ""
	}
}

// expectedState is the sync state a converged task shows for an outcome.
func (o outcome) expectedState() string {
	switch o {
	case outcomeManaged:
		return "current"
	case outcomeInvalid:
		return "failed"
	default:
		return "paused"
	}
}

// Syncer is the single writer of schedule_sync_state (shared by the HTTP
// handler and the reconciler) so the RFC 005 state machine cannot drift
// between callers. "current" is set only after a successful Temporal upsert —
// never merely because the task row was written.
type Syncer struct {
	Client  *ent.Client
	Manager Manager
	Cfg     appconfig.Config
	Log     *zap.Logger
}

// AfterWrite converges the task's Temporal Schedule after a create/patch
// commit and returns the task reloaded with its final sync state for the HTTP
// response. prev is the pre-patch row (nil on create): when nothing
// schedule-relevant changed and the state already matches the outcome, the
// write skips all Temporal and state I/O — the common instructions-only patch
// costs nothing. It never fails the request: the task row is already
// committed, so schedule problems become a visible failed marker that the
// reconciler (and the loop fallback) absorb.
func (s *Syncer) AfterWrite(ctx context.Context, userID string, prev, task *ent.BackgroundTask) *ent.BackgroundTask {
	if !s.Cfg.TemporalSchedulesEnabled {
		return task
	}
	log := s.log().With(zap.String("taskSlug", task.Slug), zap.String("userId", userID))

	o, cronExpr := classify(task)
	if prev != nil &&
		prev.TriggersJSON == task.TriggersJSON &&
		prev.Active == task.Active &&
		prev.ExecutionTarget == task.ExecutionTarget &&
		task.ScheduleSyncState == o.expectedState() {
		// Nothing schedule-relevant changed and the state is already
		// converged (a non-converged state, e.g. "failed", falls through so
		// any patch retries the sync).
		return task
	}

	switch o {
	case outcomeManaged:
		s.writeState(ctx, task, "syncing", "", log)
		action, err := s.upsert(ctx, Desired(userID, task, cronExpr, s.Cfg, false))
		if err != nil {
			log.Warn("schedule upsert failed; loop remains the cron fallback", zap.Error(err))
			s.writeState(ctx, task, "failed", err.Error(), log)
			break
		}
		log.Info("schedule synced", zap.String("action", action))
		s.writeState(ctx, task, "current", "", log)

	case outcomeInvalid:
		// Delete any leftover schedule: it would keep firing the previous
		// expression, and the fire path refuses invalid crons anyway.
		err := s.delete(ctx, userID, task.Slug)
		if err != nil {
			log.Warn("schedule delete for invalid cron failed; reconciler will repair", zap.Error(err))
		}
		s.writeState(ctx, task, "failed", fmt.Sprintf("invalid cron expression %q", cronExpr), log)

	case outcomePausedKeep:
		err := s.pause(ctx, userID, task.Slug)
		if err != nil {
			log.Warn("schedule pause failed", zap.Error(err))
		}
		s.writeStateErr(ctx, task, "paused", err, log)

	case outcomeUnmanaged:
		// If this task never had a schedule (still at the schema-default
		// state), skip the Temporal round-trip entirely — this is every
		// desktop-task write.
		if task.ScheduleSyncState == "paused" && task.ScheduleSyncedAt == nil {
			return task
		}
		err := s.delete(ctx, userID, task.Slug)
		if err != nil {
			log.Warn("schedule delete failed; reconciler will remove the orphan", zap.Error(err))
		}
		s.writeStateErr(ctx, task, "paused", err, log)
	}

	return s.reload(ctx, task)
}

// AfterDelete best-effort removes the schedule once the task delete has
// committed. Running after the commit (not before) means a stale-revision 409
// can never strand a live task without its schedule; a failed delete here is
// just an orphan for the reconciler's sweep, and fires in the gap skip safely
// because the task row is gone.
func (s *Syncer) AfterDelete(ctx context.Context, userID string, task *ent.BackgroundTask) {
	if !s.Cfg.TemporalSchedulesEnabled {
		return
	}
	if task.ScheduleSyncState == "paused" && task.ScheduleSyncedAt == nil {
		return // never had a schedule
	}
	if err := s.delete(ctx, userID, task.Slug); err != nil {
		s.log().Warn("schedule delete after task delete failed; reconciler will remove the orphan",
			zap.String("taskSlug", task.Slug), zap.String("userId", userID), zap.Error(err))
	}
}

func (s *Syncer) upsert(ctx context.Context, d DesiredCronSchedule) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, temporalCallTimeout)
	defer cancel()
	return s.Manager.UpsertTaskCron(ctx, d)
}

func (s *Syncer) pause(ctx context.Context, userID, slug string) error {
	ctx, cancel := context.WithTimeout(ctx, temporalCallTimeout)
	defer cancel()
	return s.Manager.PauseTaskCron(ctx, userID, slug)
}

func (s *Syncer) delete(ctx context.Context, userID, slug string) error {
	ctx, cancel := context.WithTimeout(ctx, temporalCallTimeout)
	defer cancel()
	return s.Manager.DeleteTaskCron(ctx, userID, slug)
}

// writeState persists a sync-state transition (RFC 005 write rules): syncing
// clears the old error, current stamps schedule_synced_at, failed records the
// error. The no-op guard is structural — when the row already shows the
// target state and error, nothing is written and the task revision does not
// churn (the reconciler relies on this to keep converged passes write-free).
func (s *Syncer) writeState(ctx context.Context, task *ent.BackgroundTask, state, errMsg string, log *zap.Logger) {
	if task.ScheduleSyncState == state && task.ScheduleSyncError == errMsg {
		return
	}
	update := s.Client.BackgroundTask.UpdateOneID(task.ID).
		SetScheduleSyncState(state).
		AddRevision(1)
	if errMsg != "" {
		update.SetScheduleSyncError(errMsg)
	} else {
		update.ClearScheduleSyncError()
	}
	if state == "current" {
		update.SetScheduleSyncedAt(time.Now().UTC())
	}
	if err := update.Exec(auth.WithInternal(ctx)); err != nil {
		backgroundtaskmetrics.ScheduleSyncFailures.WithLabelValues("state_write").Inc()
		log.Error("schedule sync state write failed", zap.Error(err))
		return
	}
	// Keep the in-memory row coherent for subsequent guards and the reload
	// fallback (a failed reload must not resurrect the pre-write state).
	task.ScheduleSyncState = state
	task.ScheduleSyncError = errMsg
	task.Revision++
}

// writeStateErr is writeState with an optional operation error as the message.
func (s *Syncer) writeStateErr(ctx context.Context, task *ent.BackgroundTask, state string, opErr error, log *zap.Logger) {
	msg := ""
	if opErr != nil {
		msg = opErr.Error()
	}
	s.writeState(ctx, task, state, msg, log)
}

func (s *Syncer) reload(ctx context.Context, task *ent.BackgroundTask) *ent.BackgroundTask {
	fresh, err := s.Client.BackgroundTask.Get(auth.WithInternal(ctx), task.ID)
	if err != nil {
		// writeState kept the in-memory row's state and revision coherent, so
		// returning it does not hand the client a stale revision.
		return task
	}
	return fresh
}

func (s *Syncer) log() *zap.Logger {
	if s.Log == nil {
		return zap.NewNop()
	}
	return s.Log
}
