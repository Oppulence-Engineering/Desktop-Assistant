package backgroundtaskschedule

import (
	"context"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtask"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskmetrics"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// Reconciler periodically converges Temporal Schedules with the task table:
// a handler upsert that failed, a schedule for a deleted task, a paused
// schedule for a now-active task — every drift is repaired within one
// interval and counted in temporal_schedule_drift_total. It is the authority
// for schedule_sync_state: stuck "syncing" and "failed" tasks are re-synced
// here. Runs inside the scheduler binary (RFC 001's loop is the co-resident
// fallback). Classification comes from the same classify() the Syncer uses,
// so the two can never disagree on what a task wants.
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
	u := task.Edges.User
	if u == nil {
		// Can't act without an owner; the sweep re-checks the DB before
		// deleting anything, so returning no keep-id here is safe.
		return ""
	}
	userID := u.ID.String()
	log = log.With(zap.String("taskSlug", task.Slug), zap.String("userId", userID),
		zap.Int("taskRevision", task.Revision), zap.String("oldState", task.ScheduleSyncState))

	o, cronExpr := classify(task)
	scheduleID := (DesiredCronSchedule{UserID: userID, Slug: task.Slug}).ScheduleID()

	switch o {
	case outcomeManaged:
		desired := Desired(userID, task, cronExpr, r.Syncer.Cfg, false)
		desc, err := r.Manager.DescribeTaskCron(ctx, userID, task.Slug)
		if err != nil {
			log.Warn("reconcile: describe", zap.Error(err))
			if fresh, fo, _, ok := r.refresh(ctx, task, log); ok && fo == outcomeManaged {
				r.Syncer.writeState(ctx, fresh, "failed", err.Error(), log)
			}
			return scheduleID
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
		if drift == "" {
			// Converged in Temporal. Promote a non-current state only from a
			// fresh read: the snapshot may predate a concurrent handler patch
			// whose own sync failed — blindly stamping "current" would clear
			// that failure and silence the loop fallback.
			if task.ScheduleSyncState != "current" {
				fresh, fo, fcron, ok := r.refresh(ctx, task, log)
				if ok && fo == outcomeManaged &&
					SpecMatches(desc.Memo, Desired(userID, fresh, fcron, r.Syncer.Cfg, false)) {
					r.Syncer.writeState(ctx, fresh, "current", "", log)
				}
			}
			return scheduleID
		}
		// Re-read the row before mutating Temporal: this pass's snapshot may
		// predate a concurrent handler patch, and "repairing" from a stale
		// snapshot would revert the user's fresh schedule to the old cron
		// until the next pass.
		fresh, fo, fcron, ok := r.refresh(ctx, task, log)
		if !ok || fo != outcomeManaged {
			return keepIDFor(fo, scheduleID, ok)
		}
		freshDesired := Desired(userID, fresh, fcron, r.Syncer.Cfg, false)
		if SpecMatches(desc.Memo, freshDesired) && !desc.Paused {
			// The handler already converged the newer spec mid-pass.
			r.Syncer.writeState(ctx, fresh, "current", "", log)
			return scheduleID
		}
		if _, err := r.Manager.UpsertTaskCron(ctx, freshDesired); err != nil {
			log.Warn("reconcile: upsert", zap.String("drift", drift), zap.Error(err))
			r.Syncer.writeState(ctx, fresh, "failed", err.Error(), log)
			return scheduleID
		}
		backgroundtaskmetrics.ScheduleDrift.WithLabelValues(drift).Inc()
		log.Info("reconcile: schedule repaired", zap.String("drift", drift), zap.String("newState", "current"))
		r.Syncer.writeState(ctx, fresh, "current", "", log)
		return scheduleID

	case outcomeInvalid:
		fresh, fo, fcron, ok := r.refresh(ctx, task, log)
		if !ok || fo != outcomeInvalid {
			return keepIDFor(fo, scheduleID, ok)
		}
		// The expression can never fire; a leftover schedule would fire a
		// stale one. Remove it and surface failed.
		if err := r.Manager.DeleteTaskCron(ctx, userID, fresh.Slug); err != nil {
			log.Warn("reconcile: delete schedule for invalid cron", zap.Error(err))
		}
		r.Syncer.writeState(ctx, fresh, "failed", "invalid cron expression "+fcron, log)
		return ""

	case outcomePausedKeep:
		fresh, fo, fcron, ok := r.refresh(ctx, task, log)
		if !ok || fo != outcomePausedKeep {
			return keepIDFor(fo, scheduleID, ok)
		}
		// Ensure exists-but-paused for fast unpause.
		desired := Desired(userID, fresh, fcron, r.Syncer.Cfg, true)
		action, err := r.Manager.UpsertTaskCron(ctx, desired)
		if err != nil {
			log.Warn("reconcile: ensure paused", zap.Error(err))
			return scheduleID
		}
		if action != "noop" {
			kind := "pause"
			if action == "create" {
				kind = "missing"
			}
			backgroundtaskmetrics.ScheduleDrift.WithLabelValues(kind).Inc()
			log.Info("reconcile: inactive schedule converged", zap.String("action", action))
		}
		r.Syncer.writeState(ctx, fresh, "paused", "", log)
		// A schedule now exists behind a paused state; the never-had-one fast
		// paths must not skip its cleanup.
		r.Syncer.stampScheduled(ctx, fresh, log)
		return scheduleID

	default: // outcomeUnmanaged
		if task.ScheduleSyncState == "paused" && task.ScheduleSyncedAt == nil {
			// Never had a schedule and nothing to repair — the common
			// cron-less api task. No Temporal round-trip.
			return ""
		}
		fresh, fo, _, ok := r.refresh(ctx, task, log)
		if !ok || fo != outcomeUnmanaged {
			return keepIDFor(fo, scheduleID, ok)
		}
		if err := r.Manager.DeleteTaskCron(ctx, userID, fresh.Slug); err != nil {
			log.Warn("reconcile: delete unmanaged schedule", zap.Error(err))
			return ""
		}
		r.Syncer.writeState(ctx, fresh, "paused", "", log)
		return ""
	}
}

// keepIDFor decides the sweep keep-id when a refresh shows the task changed
// classification mid-pass: keep the schedule if the fresh outcome retains
// one (this pass leaves it; the next pass converges it), drop otherwise (the
// sweep re-checks the live DB before deleting anything regardless).
func keepIDFor(o outcome, scheduleID string, ok bool) string {
	if ok && (o == outcomeManaged || o == outcomePausedKeep) {
		return scheduleID
	}
	if !ok {
		// Task vanished or unreadable — let the sweep's DB re-check decide.
		return ""
	}
	return ""
}

// refresh re-reads the task immediately before any mutation or state write
// and re-classifies it, so the reconciler never acts on a snapshot a
// concurrent handler write has overtaken. ok=false means the task vanished or
// could not be re-read.
func (r *Reconciler) refresh(ctx context.Context, task *ent.BackgroundTask, log *zap.Logger) (*ent.BackgroundTask, outcome, string, bool) {
	fresh, err := r.Client.BackgroundTask.Query().
		Where(backgroundtask.IDEQ(task.ID)).
		WithUser().
		Only(ctx)
	if err != nil {
		if !ent.IsNotFound(err) {
			log.Warn("reconcile: refresh task", zap.Error(err))
		}
		return nil, outcomeUnmanaged, "", false
	}
	if fresh.Edges.User == nil {
		return nil, outcomeUnmanaged, "", false
	}
	o, cronExpr := classify(fresh)
	return fresh, o, cronExpr, true
}

// sweepOrphans deletes schedules whose owning task is gone or no longer keeps
// a schedule (fail-safe for deletes that raced or failed). Because the keep
// set comes from a snapshot taken before the schedule list, every candidate is
// re-checked against the live DB first — a schedule created by the handler
// mid-pass must not be swept.
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
		if r.taskKeepsSchedule(ctx, userID, slug, log) {
			continue // created or re-validated mid-pass; next pass converges it
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

// taskKeepsSchedule re-checks the live DB for a sweep candidate: true when a
// task exists for this (user, slug) whose classification keeps a schedule.
func (r *Reconciler) taskKeepsSchedule(ctx context.Context, userID, slug string, log *zap.Logger) bool {
	uid, err := uuid.Parse(userID)
	if err != nil {
		return false
	}
	task, err := r.Client.BackgroundTask.Query().
		Where(backgroundtask.SlugEQ(slug), backgroundtask.HasUserWith(user.IDEQ(uid))).
		Only(ctx)
	if err != nil {
		if !ent.IsNotFound(err) {
			// Can't tell — keep the schedule rather than risk deleting a live
			// task's firing authority; the next pass retries.
			log.Warn("reconcile: sweep re-check failed", zap.String("taskSlug", slug), zap.Error(err))
			return true
		}
		return false
	}
	o, _ := classify(task)
	return o == outcomeManaged || o == outcomePausedKeep
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
