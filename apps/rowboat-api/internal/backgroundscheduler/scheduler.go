package backgroundscheduler

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtask"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrun"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruns"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskworkflow"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const (
	// defaultPageSize bounds how many tasks are loaded per query so the tick
	// does not load an unbounded result set as the task count grows.
	defaultPageSize = 500
	// defaultInterval / defaultLeaseTTL back the Config zero-value contract.
	defaultInterval = 15 * time.Second
	defaultLeaseTTL = 90 * time.Second
	// orphanGrace is how long a run may sit in status=queued/temporal_status=
	// Starting before it is treated as abandoned (the process died between the
	// run insert and confirming the Temporal start). A live workflow flips
	// temporal_status to Started within milliseconds (or Running once the worker
	// claims it), so a Starting run this old never started.
	orphanGrace = 5 * time.Minute
)

// RunStarter creates an executor=api run and starts its Temporal workflow. It
// is the subset of *backgroundtaskruns.Starter the scheduler depends on, named
// as an interface so tests can substitute a fake.
type RunStarter interface {
	Start(ctx context.Context, p backgroundtaskruns.Params) (*ent.BackgroundTaskRun, error)
}

// Config tunes the scheduler loop. Zero values fall back to safe defaults
// (Interval=15s, LeaseTTL=90s, Location=UTC, PageSize=500, Clock=time.Now).
type Config struct {
	Interval time.Duration    // tick cadence (CLOUD_SCHEDULER_INTERVAL)
	LeaseTTL time.Duration    // lease lifetime handed to Leases.Acquire
	Owner    string           // lease owner identity (pod name)
	Location *time.Location   // timezone for cron/window math; nil → UTC
	PageSize int              // task page size; <= 0 → defaultPageSize
	Clock    func() time.Time // injectable clock for tests; nil → time.Now
}

// Scheduler evaluates cron/window triggers for executionTarget=api tasks and
// starts their cloud runs through the shared run starter while the desktop is
// offline. It is a trusted cross-tenant component: every query runs under
// auth.WithInternal so it sees all users' tasks.
type Scheduler struct {
	client  *ent.Client
	starter RunStarter
	leases  Leases
	cfg     Config
	log     *zap.Logger
	now     func() time.Time
}

// New builds a Scheduler, applying defaults for any unset Config field.
func New(client *ent.Client, starter RunStarter, leases Leases, cfg Config, log *zap.Logger) *Scheduler {
	if leases == nil {
		leases = NoopLeases{}
	}
	if cfg.Interval <= 0 {
		cfg.Interval = defaultInterval
	}
	if cfg.LeaseTTL <= 0 {
		cfg.LeaseTTL = defaultLeaseTTL
	}
	if cfg.Location == nil {
		cfg.Location = time.UTC
	}
	if cfg.PageSize <= 0 {
		cfg.PageSize = defaultPageSize
	}
	if log == nil {
		log = zap.NewNop()
	}
	clock := cfg.Clock
	if clock == nil {
		clock = time.Now
	}
	return &Scheduler{client: client, starter: starter, leases: leases, cfg: cfg, log: log, now: clock}
}

// Run drives the loop until the context is cancelled. It ticks once immediately
// (matching the desktop scheduler's eager first pass) and then every interval.
// A failed tick is logged and the loop continues — at-least-once tick semantics,
// with at-most-once-per-cycle run creation provided by the fire-time runtime
// stamp (and the lease once RFC 002 lands).
func (s *Scheduler) Run(ctx context.Context) error {
	s.log.Info("cloud scheduler starting",
		zap.Duration("interval", s.cfg.Interval),
		zap.Duration("lease_ttl", s.cfg.LeaseTTL),
		zap.String("owner", s.cfg.Owner),
		zap.String("timezone", s.cfg.Location.String()),
	)
	s.runTick(ctx)

	ticker := time.NewTicker(s.cfg.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			s.log.Info("cloud scheduler stopping")
			return nil
		case <-ticker.C:
			s.runTick(ctx)
		}
	}
}

func (s *Scheduler) runTick(ctx context.Context) {
	if err := s.tick(ctx); err != nil {
		s.log.Error("scheduler tick failed", zap.Error(err))
	}
}

// tick scans active API-target tasks with triggers and evaluates each. It runs
// under an internal context so the per-user ent interceptors are bypassed (the
// scheduler is cross-tenant by design). Returns an error only for a query
// failure that aborts the tick; per-task failures are isolated.
func (s *Scheduler) tick(ctx context.Context) error {
	metrics.Ticks.Inc()
	started := s.now()
	defer func() { metrics.TickDuration.Observe(s.now().Sub(started).Seconds()) }()

	ctx = auth.WithInternal(ctx)
	now := s.now().In(s.cfg.Location)

	s.reapStuckStartingRuns(ctx, now)

	// Keyset pagination by id (ascending): each page fetches ids strictly
	// greater than the last seen, so concurrent inserts/deletes can't shift a
	// row across the page boundary the way Offset/Limit would (double-evaluate
	// or skip). BackgroundTask ids are uuids and define a stable total order.
	var afterID *uuid.UUID
	for {
		q := s.client.BackgroundTask.Query().
			Where(
				backgroundtask.ActiveEQ(true),
				backgroundtask.ExecutionTargetEQ("api"),
				backgroundtask.TriggersJSONNotNil(),
			)
		if afterID != nil {
			q = q.Where(backgroundtask.IDGT(*afterID))
		}
		tasks, err := q.WithUser().Order(backgroundtask.ByID()).Limit(s.cfg.PageSize).All(ctx)
		if err != nil {
			metrics.Errors.WithLabelValues("query").Inc()
			return fmt.Errorf("scan api tasks: %w", err)
		}
		if len(tasks) == 0 {
			break
		}
		metrics.TasksScanned.Add(float64(len(tasks)))
		for _, task := range tasks {
			s.evaluateTask(ctx, task, now)
		}
		last := tasks[len(tasks)-1].ID
		afterID = &last
		if len(tasks) < s.cfg.PageSize {
			break
		}
	}
	return s.leases.CleanupExpired(ctx)
}

// evaluateTask decides whether a single task's cycle should fire now and, if so,
// acquires the lease, starts the run, and stamps the task runtime so the cycle
// is not re-evaluated before the worker reports terminal state. The decision
// order mirrors the desktop scheduler exactly (scheduler.ts): user edge → parse
// → in-flight backstop → due → backoff → lease → start → stamp.
func (s *Scheduler) evaluateTask(ctx context.Context, task *ent.BackgroundTask, now time.Time) {
	user := task.Edges.User
	if user == nil {
		// A run cannot be created without an owner; this should be impossible
		// (the user edge is required) but guard rather than panic.
		metrics.Errors.WithLabelValues("user_edge").Inc()
		s.log.Warn("scheduler skip: task has no user edge", zap.String("taskSlug", task.Slug))
		return
	}

	tr, err := ParseTriggers(task.TriggersJSON)
	if err != nil {
		metrics.Errors.WithLabelValues("parse").Inc()
		s.log.Warn("scheduler skip: bad triggers_json",
			zap.String("taskSlug", task.Slug), zap.String("userId", user.ID.String()), zap.Error(err))
		return
	}
	// Surface invalid sub-triggers but keep evaluating: a bad cron or a bad
	// window must not suppress the task's valid sub-triggers (desktop parity).
	// Count at most one parse error per task evaluation so the metric maps 1:1
	// to bad tasks rather than to bad sub-triggers.
	parseIssue := false
	if tr.HasCron() && !tr.HasValidCron() {
		parseIssue = true
		s.log.Warn("scheduler: invalid cron expression, evaluating windows only",
			zap.String("taskSlug", task.Slug), zap.String("cronExpr", tr.CronExpr))
	}
	if bad := tr.InvalidWindows(); len(bad) > 0 {
		parseIssue = true
		s.log.Warn("scheduler: malformed window time(s), ignoring those windows",
			zap.String("taskSlug", task.Slug), zap.Int("count", len(bad)))
	}
	if parseIssue {
		metrics.Errors.WithLabelValues("parse").Inc()
	}

	// In-flight backstop: a last attempt newer than the last success that is
	// still inside the backoff window means a prior run never completed.
	if inFlight(task) && backoffRemaining(task.LastAttemptAt, now) > 0 {
		metrics.InFlightSuppressed.Inc()
		s.logDecision(task, user, "", "skip_inflight", "", time.Time{}, backoffRemaining(task.LastAttemptAt, now))
		return
	}

	due := evaluateDue(tr, task.LastRunAt, now)
	if due.source == "" {
		return // not due — common case, not logged per-task to avoid noise
	}
	metrics.DueTasks.WithLabelValues(due.source).Inc()

	if d := backoffRemaining(task.LastAttemptAt, now); d > 0 {
		metrics.BackoffSuppressed.Inc()
		s.logDecision(task, user, due.source, "skip_backoff", "", time.Time{}, d)
		return
	}

	key, requestedContext := provenance(due, tr, now)

	lease, ok, err := s.leases.Acquire(ctx, task, due.source, key, s.cfg.Owner, s.cfg.LeaseTTL)
	if err != nil {
		metrics.Errors.WithLabelValues("lease").Inc()
		s.log.Error("scheduler lease acquire failed",
			zap.String("taskSlug", task.Slug), zap.String("scheduleKey", key), zap.Error(err))
		return
	}
	if !ok {
		metrics.DuplicateSuppressed.Inc()
		s.logDecision(task, user, due.source, "skip_duplicate", key, due.occurrence, 0)
		return
	}

	run, err := s.starter.Start(ctx, backgroundtaskruns.Params{
		User:             user,
		Task:             task,
		Trigger:          due.source,
		RequestedContext: requestedContext,
		RunIDPrefix:      runIDPrefix(due.source),
		Source:           backgroundtaskruns.SourceScheduler,
	})
	if err != nil {
		// A PersistIDsError means the Temporal workflow IS already running and
		// only persisting its ids failed — so this is a fire, not a retryable
		// failure. Advancing the cycle (rather than backing off and re-firing)
		// avoids starting a second workflow for the same occurrence; the worker
		// reconciles the run row by run id. It is still counted as an error so
		// the partial-success state is alertable.
		var persistErr *backgroundtaskruns.PersistIDsError
		if errors.As(err, &persistErr) {
			s.recordFire(ctx, lease, task, due.source, now, run.RunID)
			metrics.Errors.WithLabelValues("persist").Inc()
			s.log.Warn("scheduler run started but temporal ids not persisted",
				zap.String("taskSlug", task.Slug), zap.String("runId", run.RunID), zap.Error(err))
			return
		}
		metrics.Errors.WithLabelValues("start").Inc()
		// Release the lease. Stamp last_attempt_at so a persistent start failure
		// backs off (retryBackoff) instead of re-firing every tick within the
		// grace window; last_run_at stays unadvanced so the cycle retries.
		_ = s.leases.Release(ctx, lease, err)
		s.stampAttempt(ctx, task, now)
		s.log.Error("scheduler start run failed",
			zap.String("taskSlug", task.Slug), zap.String("trigger", due.source),
			zap.String("scheduleKey", key), zap.Error(err))
		return
	}
	s.recordFire(ctx, lease, task, due.source, now, run.RunID)
	s.logDecision(task, user, due.source, "fired", key, due.occurrence, 0, zap.String("runId", run.RunID))
}

// recordFire performs the bookkeeping shared by the success and PersistIDsError
// fire paths: complete the lease, advance the task cycle, and count the run.
// Keeping it in one place stops the two paths from drifting.
func (s *Scheduler) recordFire(ctx context.Context, lease Lease, task *ent.BackgroundTask, trigger string, now time.Time, runID string) {
	_ = s.leases.Complete(ctx, lease, runID)
	s.stampFired(ctx, task, now, runID)
	metrics.RunsTriggered.WithLabelValues(trigger).Inc()
}

// stampFired advances the task's cycle anchor and attempt/run markers at fire
// time, exactly like the desktop does (cloud-sync.ts triggerCloudRun):
// last_run_at (the cron/window cycle anchor) + last_attempt_at + last_run_id, so
// the next tick does not re-fire the same occurrence before the worker reports
// terminal state. This is what makes single-replica at-most-once hold without
// depending on the worker's async MarkRunRunning.
//
// Tradeoffs accepted for v1 (both resolved by the RFC 002 durable lease):
//   - A run that starts then FAILS leaves last_run_at advanced, so that cycle is
//     not auto-retried (the next cron occurrence / next day's window fires
//     normally; a failed run can be retried explicitly). Matches the desktop.
//   - A crash between Start returning and this stamp committing can re-fire the
//     occurrence once on restart.
func (s *Scheduler) stampFired(ctx context.Context, task *ent.BackgroundTask, now time.Time, runID string) {
	if err := s.client.BackgroundTask.UpdateOneID(task.ID).
		SetLastAttemptAt(now).
		SetLastRunID(runID).
		SetLastRunAt(now).
		AddRevision(1).
		Exec(ctx); err != nil {
		metrics.Errors.WithLabelValues("stamp").Inc()
		s.log.Error("scheduler stamp fired task failed", zap.String("taskSlug", task.Slug), zap.Error(err))
	}
}

// stampAttempt records only last_attempt_at, used on a start failure to engage
// the retry backoff without advancing the cycle anchor.
func (s *Scheduler) stampAttempt(ctx context.Context, task *ent.BackgroundTask, now time.Time) {
	if err := s.client.BackgroundTask.UpdateOneID(task.ID).
		SetLastAttemptAt(now).
		AddRevision(1).
		Exec(ctx); err != nil {
		metrics.Errors.WithLabelValues("stamp").Inc()
		s.log.Error("scheduler stamp attempt task failed", zap.String("taskSlug", task.Slug), zap.Error(err))
	}
}

// reapStuckStartingRuns fails any executor=api run abandoned in
// queued/temporal_status=Starting beyond orphanGrace — the residue of a process
// that died between inserting the run and confirming the Temporal start. Cleans
// up rows that would otherwise sit "queued" forever with no workflow behind them.
func (s *Scheduler) reapStuckStartingRuns(ctx context.Context, now time.Time) {
	cutoff := now.Add(-orphanGrace)
	n, err := s.client.BackgroundTaskRun.Update().
		Where(
			backgroundtaskrun.ExecutorEQ("api"),
			backgroundtaskrun.StatusEQ("queued"),
			backgroundtaskrun.TemporalStatusEQ("Starting"),
			backgroundtaskrun.CreatedAtLT(cutoff),
		).
		SetStatus("failed").
		SetTemporalStatus("StartFailed").
		SetErrorCode(backgroundtaskworkflow.ErrCodeTemporalStartFailed).
		SetError("run abandoned before Temporal workflow start was confirmed").
		SetErrorDetails("scheduler reaped a run stuck in temporal_status=Starting").
		SetProgressMessage("Abandoned before Temporal start confirmation.").
		SetCompletedAt(now).
		AddRevision(1).
		Save(ctx)
	if err != nil {
		metrics.Errors.WithLabelValues("reap").Inc()
		s.log.Error("scheduler reap stuck runs failed", zap.Error(err))
		return
	}
	if n > 0 {
		metrics.OrphansReaped.Add(float64(n))
		s.log.Warn("scheduler reaped abandoned runs", zap.Int("count", n))
	}
}

// provenance builds the run provenance for a due cycle: the lease/schedule key
// and the short requested_context inserted verbatim into the run (kept brief —
// it becomes part of the LLM context in RFC 004). It consumes the already-
// matched occurrence/window from evaluateDue rather than re-deriving them.
func provenance(due dueResult, tr Triggers, now time.Time) (key, requestedContext string) {
	switch due.source {
	case "cron":
		key = CronKey(tr.CronExpr, due.occurrence)
		requestedContext = fmt.Sprintf(
			"Scheduled cron trigger fired at %s for expression %q. Occurrence: %s.",
			now.Format(time.RFC3339), tr.CronExpr, due.occurrence.Format(time.RFC3339),
		)
	case "window":
		key = WindowKey(due.window.StartTime, due.window.EndTime, now)
		requestedContext = fmt.Sprintf(
			"Scheduled window trigger fired at %s inside %s-%s window. Cycle date: %s.",
			now.Format(time.RFC3339), due.window.StartTime, due.window.EndTime, now.Format("2006-01-02"),
		)
	}
	return key, requestedContext
}

// logDecision emits one structured line per scheduler decision, mirroring the
// HTTP handler's runLogFields shape plus scheduling-specific fields.
func (s *Scheduler) logDecision(task *ent.BackgroundTask, user *ent.User, trigger, decision, key string, occurrence time.Time, graceRemaining time.Duration, extra ...zap.Field) {
	fields := []zap.Field{
		zap.String("taskSlug", task.Slug),
		zap.String("userId", user.ID.String()),
		zap.String("decision", decision),
	}
	if trigger != "" {
		fields = append(fields, zap.String("trigger", trigger))
	}
	if key != "" {
		fields = append(fields, zap.String("scheduleKey", key))
	}
	if !occurrence.IsZero() {
		fields = append(fields, zap.String("occurrenceAt", occurrence.UTC().Format(time.RFC3339)))
	}
	if graceRemaining > 0 {
		fields = append(fields, zap.Int64("graceRemainingMs", graceRemaining.Milliseconds()))
	}
	fields = append(fields, extra...)
	s.log.Info("scheduler decision", fields...)
}

// inFlight reports whether a prior attempt started more recently than the last
// successful completion. Mirrors scheduler.ts:38-48.
func inFlight(task *ent.BackgroundTask) bool {
	if task.LastAttemptAt == nil {
		return false
	}
	return task.LastRunAt == nil || task.LastAttemptAt.After(*task.LastRunAt)
}

// runIDPrefix returns the provenance prefix for a scheduler-created run id,
// mirroring the api-trigger-/retry-/remote-trigger- prefixes in the HTTP handler.
func runIDPrefix(source string) string {
	switch source {
	case "cron":
		return "sched-cron-"
	case "window":
		return "sched-window-"
	default:
		return "sched-"
	}
}
