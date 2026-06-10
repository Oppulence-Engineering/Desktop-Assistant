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
// response. It never fails the request: the task row is already committed, so
// schedule problems become a visible failed marker that the reconciler (and
// the loop fallback) absorb.
func (s *Syncer) AfterWrite(ctx context.Context, userID string, task *ent.BackgroundTask) *ent.BackgroundTask {
	if !s.Cfg.TemporalSchedulesEnabled {
		return task
	}
	log := s.log().With(zap.String("taskSlug", task.Slug), zap.String("userId", userID))

	tr, parseErr := backgroundscheduler.ParseTriggers(task.TriggersJSON)
	hasCron := parseErr == nil && tr.HasCron()
	managed := task.ExecutionTarget == "api" && task.Active && hasCron

	switch {
	case managed && !tr.HasValidCron():
		// No Temporal call: the expression can never fire. The loop ignores it
		// for the same reason, so failed (not current) is the honest state.
		s.markFailed(ctx, task, fmt.Sprintf("invalid cron expression %q", tr.CronExpr), log)

	case managed:
		s.markSyncing(ctx, task, log)
		action, err := s.upsert(ctx, Desired(userID, task, tr.CronExpr, s.Cfg, false))
		if err != nil {
			log.Warn("schedule upsert failed; loop remains the cron fallback", zap.Error(err))
			s.markFailed(ctx, task, err.Error(), log)
			break
		}
		log.Info("schedule synced", zap.String("action", action), zap.String("scheduleId", (DesiredCronSchedule{UserID: userID, Slug: task.Slug}).ScheduleID()))
		s.markCurrent(ctx, task, log)

	case task.ExecutionTarget == "api" && hasCron && !task.Active:
		// Keep the schedule, paused, for fast unpause on reactivation.
		err := s.pause(ctx, userID, task.Slug)
		if err != nil {
			log.Warn("schedule pause failed", zap.Error(err))
		}
		s.markPaused(ctx, task, err, log)

	default:
		// Cron removed, target flipped to desktop, or triggers unparseable. If
		// this task never had a schedule (still at the schema-default state),
		// skip the Temporal round-trip entirely — this is every desktop-task
		// write.
		if task.ScheduleSyncState == "paused" && task.ScheduleSyncedAt == nil {
			return task
		}
		err := s.delete(ctx, userID, task.Slug)
		if err != nil {
			log.Warn("schedule delete failed; reconciler will remove the orphan", zap.Error(err))
		}
		s.markPaused(ctx, task, err, log)
	}

	return s.reload(ctx, task)
}

// BeforeDelete best-effort removes the schedule ahead of the task delete. It
// never blocks the delete: an orphaned schedule is repaired by the
// reconciler's sweep, and its fires skip safely once the task row is gone.
func (s *Syncer) BeforeDelete(ctx context.Context, userID string, task *ent.BackgroundTask) {
	if !s.Cfg.TemporalSchedulesEnabled {
		return
	}
	if task.ScheduleSyncState == "paused" && task.ScheduleSyncedAt == nil {
		return // never had a schedule
	}
	if err := s.delete(ctx, userID, task.Slug); err != nil {
		s.log().Warn("schedule delete before task delete failed; reconciler will remove the orphan",
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

// State write rules (RFC 005): syncing clears the old error; current stamps
// schedule_synced_at and clears the error; failed records the error; paused
// records a pause/delete failure but otherwise clears. Every write bumps the
// task revision — sync state is part of the task view.

func (s *Syncer) markSyncing(ctx context.Context, task *ent.BackgroundTask, log *zap.Logger) {
	s.writeState(ctx, task, log, func(u *ent.BackgroundTaskUpdateOne) {
		u.SetScheduleSyncState("syncing").ClearScheduleSyncError()
	})
}

func (s *Syncer) markCurrent(ctx context.Context, task *ent.BackgroundTask, log *zap.Logger) {
	s.writeState(ctx, task, log, func(u *ent.BackgroundTaskUpdateOne) {
		u.SetScheduleSyncState("current").
			SetScheduleSyncedAt(time.Now().UTC()).
			ClearScheduleSyncError()
	})
}

func (s *Syncer) markFailed(ctx context.Context, task *ent.BackgroundTask, msg string, log *zap.Logger) {
	s.writeState(ctx, task, log, func(u *ent.BackgroundTaskUpdateOne) {
		u.SetScheduleSyncState("failed").SetScheduleSyncError(msg)
	})
}

func (s *Syncer) markPaused(ctx context.Context, task *ent.BackgroundTask, opErr error, log *zap.Logger) {
	s.writeState(ctx, task, log, func(u *ent.BackgroundTaskUpdateOne) {
		u.SetScheduleSyncState("paused")
		if opErr != nil {
			u.SetScheduleSyncError(opErr.Error())
		} else {
			u.ClearScheduleSyncError()
		}
	})
}

func (s *Syncer) writeState(ctx context.Context, task *ent.BackgroundTask, log *zap.Logger, mutate func(*ent.BackgroundTaskUpdateOne)) {
	update := s.Client.BackgroundTask.UpdateOneID(task.ID).AddRevision(1)
	mutate(update)
	if err := update.Exec(auth.WithInternal(ctx)); err != nil {
		backgroundtaskmetrics.ScheduleSyncFailures.WithLabelValues("state_write").Inc()
		log.Error("schedule sync state write failed", zap.Error(err))
	}
}

func (s *Syncer) reload(ctx context.Context, task *ent.BackgroundTask) *ent.BackgroundTask {
	fresh, err := s.Client.BackgroundTask.Get(auth.WithInternal(ctx), task.ID)
	if err != nil {
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
