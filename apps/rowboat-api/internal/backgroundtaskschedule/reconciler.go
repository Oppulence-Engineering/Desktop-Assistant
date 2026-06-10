package backgroundtaskschedule

import (
	"context"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtask"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundscheduler"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskmetrics"
	"go.uber.org/zap"
)

// Reconciler periodically converges Temporal Schedules with the task table:
// a handler upsert that failed, a schedule for a deleted task, a paused
// schedule for a now-active task — every drift is repaired within one
// interval and counted in temporal_schedule_drift_total. It is the authority
// for schedule_sync_state: stuck "syncing" and "failed" tasks are re-synced
// here. Runs inside the scheduler binary (RFC 001's loop is the co-resident
// fallback).
type Reconciler struct {
	Client   *ent.Client
	Manager  Manager
	Syncer   *Syncer
	Interval time.Duration
	Log      *zap.Logger
}

// Run drives the reconcile loop until the context is cancelled: one eager
// pass, then every Interval.
func (r *Reconciler) Run(ctx context.Context) error {
	r.ReconcileOnce(ctx)
	ticker := time.NewTicker(r.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			r.ReconcileOnce(ctx)
		}
	}
}

// ReconcileOnce runs a single full pass. Errors are logged and counted, never
// fatal — the next pass retries.
func (r *Reconciler) ReconcileOnce(ctx context.Context) {
	ctx = auth.WithInternal(ctx)
	log := r.log()

	// Every task that may need schedule work: api-target tasks (the managed
	// population) plus anything with a non-default sync state left behind by a
	// target flip or disable.
	tasks, err := r.Client.BackgroundTask.Query().
		Where(backgroundtask.Or(
			backgroundtask.ExecutionTargetEQ("api"),
			backgroundtask.ScheduleSyncStateNEQ("paused"),
		)).
		WithUser().
		All(ctx)
	if err != nil {
		backgroundtaskmetrics.ScheduleSyncFailures.WithLabelValues("list").Inc()
		log.Error("reconcile: query tasks", zap.Error(err))
		return
	}

	// Schedules that legitimately exist after this pass, for the orphan sweep.
	keep := make(map[string]struct{}, len(tasks))
	for _, task := range tasks {
		if id := r.reconcileTask(ctx, task, log); id != "" {
			keep[id] = struct{}{}
		}
	}

	r.sweepOrphans(ctx, keep, log)
}

// reconcileTask converges one task and returns the schedule id it should keep
// ("" when the task must not have a schedule).
func (r *Reconciler) reconcileTask(ctx context.Context, task *ent.BackgroundTask, log *zap.Logger) string {
	user := task.Edges.User
	if user == nil {
		return ""
	}
	userID := user.ID.String()
	log = log.With(zap.String("taskSlug", task.Slug), zap.String("userId", userID),
		zap.Int("taskRevision", task.Revision), zap.String("oldState", task.ScheduleSyncState))

	tr, parseErr := backgroundscheduler.ParseTriggers(task.TriggersJSON)
	hasCron := parseErr == nil && tr.HasCron()
	isAPI := task.ExecutionTarget == "api"

	switch {
	case isAPI && hasCron && !tr.HasValidCron():
		// The expression can never fire; a leftover schedule would fire a
		// stale one. Remove it and surface failed.
		if err := r.Manager.DeleteTaskCron(ctx, userID, task.Slug); err != nil {
			log.Warn("reconcile: delete schedule for invalid cron", zap.Error(err))
		}
		if task.ScheduleSyncState != "failed" {
			r.Syncer.markFailed(ctx, task, "invalid cron expression "+tr.CronExpr, log)
			log.Info("reconcile: invalid cron marked failed", zap.String("newState", "failed"))
		}
		return ""

	case isAPI && hasCron && task.Active:
		desired := Desired(userID, task, tr.CronExpr, r.Syncer.Cfg, false)
		desc, err := r.Manager.DescribeTaskCron(ctx, userID, task.Slug)
		if err != nil {
			log.Warn("reconcile: describe", zap.Error(err))
			if task.ScheduleSyncState != "failed" {
				r.Syncer.markFailed(ctx, task, err.Error(), log)
			}
			return desired.ScheduleID()
		}
		drift := ""
		switch {
		case !desc.Exists:
			drift = "missing"
		case !SpecMatches(desc.Memo, desired):
			drift = "stale"
		case desc.Paused:
			drift = "pause" // paused while the task is active
		}
		if drift != "" {
			if _, err := r.Manager.UpsertTaskCron(ctx, desired); err != nil {
				log.Warn("reconcile: upsert", zap.String("drift", drift), zap.Error(err))
				if task.ScheduleSyncState != "failed" {
					r.Syncer.markFailed(ctx, task, err.Error(), log)
				}
				return desired.ScheduleID()
			}
			backgroundtaskmetrics.ScheduleDrift.WithLabelValues(drift).Inc()
			log.Info("reconcile: schedule repaired", zap.String("drift", drift), zap.String("newState", "current"))
		}
		if task.ScheduleSyncState != "current" {
			r.Syncer.markCurrent(ctx, task, log)
		}
		return desired.ScheduleID()

	case isAPI && hasCron && !task.Active:
		// Ensure exists-but-paused for fast unpause.
		desired := Desired(userID, task, tr.CronExpr, r.Syncer.Cfg, true)
		action, err := r.Manager.UpsertTaskCron(ctx, desired)
		if err != nil {
			log.Warn("reconcile: ensure paused", zap.Error(err))
			return desired.ScheduleID()
		}
		if action != "noop" {
			kind := "pause"
			if action == "create" {
				kind = "missing"
			}
			backgroundtaskmetrics.ScheduleDrift.WithLabelValues(kind).Inc()
			log.Info("reconcile: inactive schedule converged", zap.String("action", action))
		}
		if task.ScheduleSyncState != "paused" {
			r.Syncer.markPaused(ctx, task, nil, log)
		}
		return desired.ScheduleID()

	default:
		// No cron, unparseable triggers, or non-api target: there must be no
		// schedule and the state must read paused.
		if err := r.Manager.DeleteTaskCron(ctx, userID, task.Slug); err != nil {
			log.Warn("reconcile: delete unmanaged schedule", zap.Error(err))
			return ""
		}
		if task.ScheduleSyncState != "paused" {
			r.Syncer.markPaused(ctx, task, nil, log)
			log.Info("reconcile: unmanaged task paused", zap.String("newState", "paused"))
		}
		return ""
	}
}

// sweepOrphans deletes schedules whose owning task is gone or no longer keeps
// a schedule (fail-safe for deletes that raced or failed).
func (r *Reconciler) sweepOrphans(ctx context.Context, keep map[string]struct{}, log *zap.Logger) {
	listed, err := r.Manager.ListTaskSchedules(ctx)
	if err != nil {
		log.Error("reconcile: list schedules", zap.Error(err))
		return
	}
	for _, entry := range listed {
		if _, ok := keep[entry.ID]; ok {
			continue
		}
		userID, slug, ok := parseScheduleID(entry.ID)
		if !ok {
			log.Warn("reconcile: unparseable schedule id", zap.String("scheduleId", entry.ID))
			continue
		}
		if err := r.Manager.DeleteTaskCron(ctx, userID, slug); err != nil {
			log.Warn("reconcile: delete orphan schedule", zap.String("scheduleId", entry.ID), zap.Error(err))
			continue
		}
		backgroundtaskmetrics.ScheduleDrift.WithLabelValues("orphan").Inc()
		log.Info("reconcile: orphan schedule deleted",
			zap.String("scheduleId", entry.ID), zap.String("taskSlug", slug), zap.String("userId", userID))
	}
}

// parseScheduleID inverts backgroundtaskworkflow.ScheduleID:
// background-task-schedule/{userID}/{slug}/cron.
func parseScheduleID(id string) (userID, slug string, ok bool) {
	rest, found := strings.CutPrefix(id, schedulePrefix)
	if !found {
		return "", "", false
	}
	parts := strings.Split(rest, "/")
	if len(parts) != 3 || parts[2] != "cron" || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	return parts[0], parts[1], true
}

func (r *Reconciler) log() *zap.Logger {
	if r.Log == nil {
		return zap.NewNop()
	}
	return r.Log
}
