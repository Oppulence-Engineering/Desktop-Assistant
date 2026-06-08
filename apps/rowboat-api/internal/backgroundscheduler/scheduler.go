package backgroundscheduler

import (
	"context"
	"fmt"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtask"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruns"
	"go.uber.org/zap"
)

// defaultPageSize bounds how many tasks are loaded per query so the tick does
// not load an unbounded result set as the task count grows.
const defaultPageSize = 500

// RunStarter creates an executor=api run and starts its Temporal workflow. It
// is the subset of *backgroundtaskruns.Starter the scheduler depends on, named
// as an interface so tests can substitute a fake.
type RunStarter interface {
	Start(ctx context.Context, p backgroundtaskruns.Params) (*ent.BackgroundTaskRun, error)
}

// Config tunes the scheduler loop. Zero values fall back to safe defaults.
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
// with at-most-once-per-cycle run creation provided by last_run_at + the lease.
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

	for offset := 0; ; offset += s.cfg.PageSize {
		tasks, err := s.client.BackgroundTask.Query().
			Where(
				backgroundtask.ActiveEQ(true),
				backgroundtask.ExecutionTargetEQ("api"),
				backgroundtask.TriggersJSONNotNil(),
			).
			WithUser().
			Order(backgroundtask.ByID()).
			Offset(offset).
			Limit(s.cfg.PageSize).
			All(ctx)
		if err != nil {
			metrics.Errors.WithLabelValues("query").Inc()
			return fmt.Errorf("scan api tasks (offset %d): %w", offset, err)
		}
		metrics.TasksScanned.Add(float64(len(tasks)))
		for _, task := range tasks {
			s.evaluateTask(ctx, task, now)
		}
		if len(tasks) < s.cfg.PageSize {
			break
		}
	}
	return s.leases.CleanupExpired(ctx)
}

// evaluateTask decides whether a single task's cycle should fire now and, if so,
// acquires the lease and starts the run. The decision order mirrors the desktop
// scheduler exactly (scheduler.ts): user edge → parse → in-flight backstop →
// due → backoff → lease → start.
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
	if tr.HasCron() && !tr.HasValidCron() {
		// Surface the invalid cron but keep evaluating: a sibling window may
		// still be due (desktop parity).
		metrics.Errors.WithLabelValues("parse").Inc()
		s.log.Warn("scheduler: invalid cron expression, evaluating windows only",
			zap.String("taskSlug", task.Slug), zap.String("cronExpr", tr.CronExpr))
	}

	// In-flight backstop: a last attempt newer than the last success that is
	// still inside the backoff window means a prior run never completed.
	if inFlight(task) && backoffRemaining(task.LastAttemptAt, now) > 0 {
		metrics.InFlightSuppressed.Inc()
		s.logDecision(task, user, "", "skip_inflight", "", time.Time{}, backoffRemaining(task.LastAttemptAt, now))
		return
	}

	source := dueTimedTrigger(tr, task.LastRunAt, now)
	if source == "" {
		return // not due — common case, not logged per-task to avoid noise
	}
	metrics.DueTasks.WithLabelValues(source).Inc()

	if d := backoffRemaining(task.LastAttemptAt, now); d > 0 {
		metrics.BackoffSuppressed.Inc()
		s.logDecision(task, user, source, "skip_backoff", "", time.Time{}, d)
		return
	}

	occurrence, key, requestedContext := s.describe(source, tr, task.LastRunAt, now)

	lease, ok, err := s.leases.Acquire(ctx, task, source, key, s.cfg.Owner, s.cfg.LeaseTTL)
	if err != nil {
		metrics.Errors.WithLabelValues("lease").Inc()
		s.log.Error("scheduler lease acquire failed",
			zap.String("taskSlug", task.Slug), zap.String("scheduleKey", key), zap.Error(err))
		return
	}
	if !ok {
		metrics.DuplicateSuppressed.Inc()
		s.logDecision(task, user, source, "skip_duplicate", key, occurrence, 0)
		return
	}

	run, err := s.starter.Start(ctx, backgroundtaskruns.Params{
		User:             user,
		Task:             task,
		Trigger:          source,
		RequestedContext: requestedContext,
		RunIDPrefix:      runIDPrefix(source),
		Source:           backgroundtaskruns.SourceScheduler,
	})
	if err != nil {
		metrics.Errors.WithLabelValues("start").Inc()
		// Release the lease and leave last_run_at unadvanced so the cycle
		// retries next tick (within grace). A start failure already marked the
		// run row failed inside the starter.
		_ = s.leases.Release(ctx, lease.ID, err)
		s.log.Error("scheduler start run failed",
			zap.String("taskSlug", task.Slug), zap.String("trigger", source),
			zap.String("scheduleKey", key), zap.Error(err))
		return
	}
	_ = s.leases.Complete(ctx, lease.ID, run.RunID)
	metrics.RunsTriggered.WithLabelValues(source).Inc()
	s.logDecision(task, user, source, "fired", key, occurrence, 0, zap.String("runId", run.RunID))
}

// describe builds the run provenance for a due cycle: the occurrence instant,
// the lease/schedule key, and the short requested_context inserted verbatim
// into the run (kept brief — it becomes part of the LLM context in RFC 004).
func (s *Scheduler) describe(source string, tr Triggers, lastRunAt *time.Time, now time.Time) (occurrence time.Time, key, requestedContext string) {
	switch source {
	case "cron":
		occ, _ := cronOccurrence(tr.CronExpr, now)
		occurrence = occ
		key = fmt.Sprintf("cron:%s", occ.UTC().Format(time.RFC3339))
		requestedContext = fmt.Sprintf(
			"Scheduled cron trigger fired at %s for expression %q. Occurrence: %s.",
			now.Format(time.RFC3339), tr.CronExpr, occ.Format(time.RFC3339),
		)
	case "window":
		w, _ := firstDueWindow(tr, lastRunAt, now) // the band dueTimedTrigger matched
		cycleDate := now.Format("2006-01-02")
		key = fmt.Sprintf("window:%s:%s-%s", cycleDate, w.StartTime, w.EndTime)
		requestedContext = fmt.Sprintf(
			"Scheduled window trigger fired at %s inside %s-%s window. Cycle date: %s.",
			now.Format(time.RFC3339), w.StartTime, w.EndTime, cycleDate,
		)
	}
	return occurrence, key, requestedContext
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
