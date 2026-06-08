package backgroundscheduler

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrunevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruns"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskworkflow"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"go.uber.org/zap"
)

// --- test doubles -----------------------------------------------------------

// fakeStarter records the runs the scheduler intends to start without touching
// Temporal, so a tick can be asserted on intended fires alone.
type fakeStarter struct {
	calls []backgroundtaskruns.Params
}

func (f *fakeStarter) Start(_ context.Context, p backgroundtaskruns.Params) (*ent.BackgroundTaskRun, error) {
	f.calls = append(f.calls, p)
	return &ent.BackgroundTaskRun{RunID: p.RunIDPrefix + "fake", Trigger: p.Trigger}, nil
}

// countingStarter is a thread-safe fake starter for the concurrent Run loop.
type countingStarter struct {
	mu   sync.Mutex
	n    int
	last string
}

func (c *countingStarter) Start(_ context.Context, p backgroundtaskruns.Params) (*ent.BackgroundTaskRun, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.n++
	c.last = p.Task.Slug
	return &ent.BackgroundTaskRun{RunID: p.RunIDPrefix + "x", Trigger: p.Trigger}, nil
}

func (c *countingStarter) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.n
}

// persistErrStarter returns a run plus a PersistIDsError — the workflow started
// but its ids failed to persist.
type persistErrStarter struct{ run *ent.BackgroundTaskRun }

func (p *persistErrStarter) Start(context.Context, backgroundtaskruns.Params) (*ent.BackgroundTaskRun, error) {
	return p.run, &backgroundtaskruns.PersistIDsError{Err: errors.New("db blip")}
}

// denyLeases refuses every lease, simulating another replica owning the cycle.
type denyLeases struct{ NoopLeases }

func (denyLeases) Acquire(context.Context, *ent.BackgroundTask, string, string, string, time.Duration) (Lease, bool, error) {
	return Lease{}, false, nil
}

// fakeTemporal records starts, standing in for the Temporal SDK so the real
// backgroundtaskruns.Starter can run without a Temporal server.
type fakeTemporal struct {
	starts []backgroundtaskworkflow.StartInput
}

func (f *fakeTemporal) StartBackgroundTaskRun(_ context.Context, in backgroundtaskworkflow.StartInput) (backgroundtaskworkflow.StartResult, error) {
	f.starts = append(f.starts, in)
	return backgroundtaskworkflow.StartResult{WorkflowID: "wf-" + in.RunID, RunID: "trun-" + in.RunID}, nil
}
func (f *fakeTemporal) CancelBackgroundTaskRun(context.Context, string, string) error { return nil }
func (f *fakeTemporal) SignalBackgroundTaskRun(context.Context, string, string, string, map[string]any) error {
	return nil
}

// recordingLease grants every lease and records the run id it was completed with.
type recordingLease struct {
	NoopLeases
	acquired       int
	completed      int
	completedRunID string
}

func (r *recordingLease) Acquire(context.Context, *ent.BackgroundTask, string, string, string, time.Duration) (Lease, bool, error) {
	r.acquired++
	return Lease{}, true, nil
}
func (r *recordingLease) Complete(_ context.Context, _ Lease, runID string) error {
	r.completed++
	r.completedRunID = runID
	return nil
}

type failingTemporal struct{ fakeTemporal }

func (failingTemporal) StartBackgroundTaskRun(context.Context, backgroundtaskworkflow.StartInput) (backgroundtaskworkflow.StartResult, error) {
	return backgroundtaskworkflow.StartResult{}, errStartFailed
}

var errStartFailed = &startErr{}

type startErr struct{}

func (*startErr) Error() string { return "temporal unreachable" }

type releaseTrackingLease struct {
	NoopLeases
	released  int
	completed int
}

func (r *releaseTrackingLease) Acquire(context.Context, *ent.BackgroundTask, string, string, string, time.Duration) (Lease, bool, error) {
	return Lease{}, true, nil
}
func (r *releaseTrackingLease) Complete(context.Context, Lease, string) error {
	r.completed++
	return nil
}
func (r *releaseTrackingLease) Release(context.Context, Lease, error) error {
	r.released++
	return nil
}

// --- fixtures ---------------------------------------------------------------

func openDB(t *testing.T) *ent.Client {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d.Client
}

func tptr(v time.Time) *time.Time { return &v }

type taskSpec struct {
	slug        string
	target      string
	triggers    string
	active      bool
	lastRun     *time.Time
	lastAttempt *time.Time
}

func seed(t *testing.T, client *ent.Client, u *ent.User, specs []taskSpec) {
	t.Helper()
	ctx := context.Background()
	for _, s := range specs {
		c := client.BackgroundTask.Create().
			SetUser(u).SetSlug(s.slug).SetName(s.slug).
			SetInstructions("do work").SetExecutionTarget(s.target).
			SetActive(s.active)
		if s.triggers != "" {
			c = c.SetTriggersJSON(s.triggers)
		}
		if s.lastRun != nil {
			c = c.SetLastRunAt(*s.lastRun)
		}
		if s.lastAttempt != nil {
			c = c.SetLastAttemptAt(*s.lastAttempt)
		}
		c.SaveX(ctx)
	}
}

func newUser(t *testing.T, client *ent.Client, email, workosID string) *ent.User {
	t.Helper()
	return client.User.Create().SetEmail(email).SetWorkosUserID(workosID).SaveX(context.Background())
}

// --- unit tests (fake starter, no-op lease) ---------------------------------

// TestTickFiresOnlyDueApiTasks scans a population of synthetic tasks and asserts
// the scheduler intends to start exactly the due, active, API-target ones, with
// the right trigger, run-id prefix, and scheduler provenance.
func TestTickFiresOnlyDueApiTasks(t *testing.T) {
	client := openDB(t)
	u := newUser(t, client, "a@x.co", "user_1")

	now := time.Date(2026, 6, 8, 13, 1, 30, 0, time.UTC)
	noon := time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)
	at1300 := time.Date(2026, 6, 8, 13, 0, 0, 0, time.UTC)
	at1301 := time.Date(2026, 6, 8, 13, 1, 0, 0, time.UTC)

	seed(t, client, u, []taskSpec{
		{slug: "cron-due", target: "api", triggers: `{"cronExpr":"0 * * * *"}`, active: true, lastRun: tptr(noon)},
		{slug: "cron-not-due", target: "api", triggers: `{"cronExpr":"0 * * * *"}`, active: true, lastRun: tptr(at1300)},
		{slug: "window-due", target: "api", triggers: `{"windows":[{"startTime":"13:00","endTime":"14:00"}]}`, active: true},
		{slug: "inactive", target: "api", triggers: `{"cronExpr":"0 * * * *"}`, active: false, lastRun: tptr(noon)},
		{slug: "desktop", target: "desktop", triggers: `{"cronExpr":"0 * * * *"}`, active: true, lastRun: tptr(noon)},
		// In-flight: a later attempt than success, still inside backoff → skip.
		{slug: "inflight", target: "api", triggers: `{"cronExpr":"0 * * * *"}`, active: true, lastRun: tptr(noon), lastAttempt: tptr(at1301)},
		// No triggers → excluded by the TriggersJSONNotNil query predicate.
		{slug: "manual-only", target: "api", triggers: "", active: true},
	})

	starter := &fakeStarter{}
	s := New(client, starter, NoopLeases{}, Config{
		Interval: time.Second, Owner: "test", Clock: func() time.Time { return now },
	}, zap.NewNop())

	if err := s.tick(context.Background()); err != nil {
		t.Fatalf("tick: %v", err)
	}

	fired := map[string]backgroundtaskruns.Params{}
	for _, p := range starter.calls {
		fired[p.Task.Slug] = p
	}
	if len(fired) != 2 {
		t.Fatalf("expected 2 fires (cron-due, window-due), got %d: %v", len(fired), keys(fired))
	}

	cron, ok := fired["cron-due"]
	if !ok || cron.Trigger != "cron" || cron.RunIDPrefix != "sched-cron-" || cron.Source != backgroundtaskruns.SourceScheduler {
		t.Fatalf("cron-due fired wrong: %+v", cron)
	}
	if cron.RequestedContext == "" {
		t.Fatalf("cron-due should carry a requested context")
	}
	win, ok := fired["window-due"]
	if !ok || win.Trigger != "window" || win.RunIDPrefix != "sched-window-" {
		t.Fatalf("window-due fired wrong: %+v", win)
	}
}

// TestTickSuppressesWhenLeaseDenied proves the lease gate prevents a fire: a due
// task whose lease cannot be acquired starts no run.
func TestTickSuppressesWhenLeaseDenied(t *testing.T) {
	client := openDB(t)
	u := newUser(t, client, "b@x.co", "user_2")
	now := time.Date(2026, 6, 8, 13, 1, 30, 0, time.UTC)
	noon := time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)
	seed(t, client, u, []taskSpec{
		{slug: "cron-due", target: "api", triggers: `{"cronExpr":"0 * * * *"}`, active: true, lastRun: tptr(noon)},
	})

	starter := &fakeStarter{}
	s := New(client, starter, denyLeases{}, Config{Interval: time.Second, Clock: func() time.Time { return now }}, zap.NewNop())
	if err := s.tick(context.Background()); err != nil {
		t.Fatalf("tick: %v", err)
	}
	if len(starter.calls) != 0 {
		t.Fatalf("expected no fires when lease denied, got %d", len(starter.calls))
	}
}

// TestTickPaginates verifies the loop walks multiple pages.
func TestTickPaginates(t *testing.T) {
	client := openDB(t)
	u := newUser(t, client, "c@x.co", "user_3")
	now := time.Date(2026, 6, 8, 13, 1, 30, 0, time.UTC)

	specs := make([]taskSpec, 0, 7)
	for i := 0; i < 7; i++ {
		specs = append(specs, taskSpec{
			slug:     "win-" + string(rune('a'+i)),
			target:   "api",
			triggers: `{"windows":[{"startTime":"13:00","endTime":"14:00"}]}`,
			active:   true,
		})
	}
	seed(t, client, u, specs)

	starter := &fakeStarter{}
	s := New(client, starter, NoopLeases{}, Config{Interval: time.Second, PageSize: 3, Clock: func() time.Time { return now }}, zap.NewNop())
	if err := s.tick(auth.WithInternal(context.Background())); err != nil {
		t.Fatalf("tick: %v", err)
	}
	if len(starter.calls) != 7 {
		t.Fatalf("expected all 7 tasks across pages to fire, got %d", len(starter.calls))
	}
}

// TestBackoffAfterDueSuppresses constructs the non-in-flight backoff case: the
// cron is due, the last attempt is older than the last success (so not
// in-flight) yet still within the 5-minute backoff → the fire is suppressed.
func TestBackoffAfterDueSuppresses(t *testing.T) {
	client := openDB(t)
	u := newUser(t, client, "a@x.co", "u1")
	now := time.Date(2026, 6, 8, 13, 6, 0, 0, time.UTC)
	lastRun := time.Date(2026, 6, 8, 13, 4, 0, 0, time.UTC)     // < 13:05 occurrence → due
	lastAttempt := time.Date(2026, 6, 8, 13, 3, 0, 0, time.UTC) // <= lastRun (not in-flight), 3m ago (in backoff)
	seed(t, client, u, []taskSpec{
		{slug: "backoff-due", target: "api", triggers: `{"cronExpr":"*/5 * * * *"}`, active: true, lastRun: tptr(lastRun), lastAttempt: tptr(lastAttempt)},
	})

	starter := &fakeStarter{}
	s := New(client, starter, NoopLeases{}, Config{Clock: func() time.Time { return now }}, zap.NewNop())

	before := testutil.ToFloat64(metrics.BackoffSuppressed)
	if err := s.tick(context.Background()); err != nil {
		t.Fatalf("tick: %v", err)
	}
	if len(starter.calls) != 0 {
		t.Fatalf("expected no fire while in backoff, got %d", len(starter.calls))
	}
	if got := testutil.ToFloat64(metrics.BackoffSuppressed) - before; got != 1 {
		t.Fatalf("backoff_suppressed delta = %v, want 1", got)
	}
}

// TestParseErrorIsolatesTask: a task whose triggers_json is valid JSON but the
// wrong shape is skipped, while a sibling due task still fires.
func TestParseErrorIsolatesTask(t *testing.T) {
	client := openDB(t)
	u := newUser(t, client, "a@x.co", "u1")
	now := time.Date(2026, 6, 8, 13, 1, 30, 0, time.UTC)
	noon := time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)
	seed(t, client, u, []taskSpec{
		{slug: "bad-shape", target: "api", triggers: `{"windows":[{"startTime":"9am","endTime":"10am"}]}`, active: true},
		{slug: "good-cron", target: "api", triggers: `{"cronExpr":"0 * * * *"}`, active: true, lastRun: tptr(noon)},
	})

	starter := &fakeStarter{}
	s := New(client, starter, NoopLeases{}, Config{Clock: func() time.Time { return now }}, zap.NewNop())
	if err := s.tick(context.Background()); err != nil {
		t.Fatalf("tick: %v", err)
	}
	if len(starter.calls) != 1 || starter.calls[0].Task.Slug != "good-cron" {
		t.Fatalf("expected only good-cron to fire, got %+v", slugsOf(starter.calls))
	}
}

// TestInvalidCronStillFiresWindow: a task with an invalid cron but a valid,
// in-band window fires the window (desktop parity).
func TestInvalidCronStillFiresWindow(t *testing.T) {
	client := openDB(t)
	u := newUser(t, client, "a@x.co", "u1")
	now := time.Date(2026, 6, 8, 13, 30, 0, 0, time.UTC)
	seed(t, client, u, []taskSpec{
		{slug: "bad-cron-good-window", target: "api", triggers: `{"cronExpr":"not a cron","windows":[{"startTime":"13:00","endTime":"14:00"}]}`, active: true},
	})

	starter := &fakeStarter{}
	s := New(client, starter, NoopLeases{}, Config{Clock: func() time.Time { return now }}, zap.NewNop())
	if err := s.tick(context.Background()); err != nil {
		t.Fatalf("tick: %v", err)
	}
	if len(starter.calls) != 1 || starter.calls[0].Trigger != "window" || starter.calls[0].RunIDPrefix != "sched-window-" {
		t.Fatalf("expected one window fire, got %+v", starter.calls)
	}
}

// TestCronWinsOverWindowEndToEnd: when both a cron occurrence and a window are
// due, the run fires with trigger=cron.
func TestCronWinsOverWindowEndToEnd(t *testing.T) {
	client := openDB(t)
	u := newUser(t, client, "a@x.co", "u1")
	now := time.Date(2026, 6, 8, 13, 1, 30, 0, time.UTC)
	noon := time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)
	seed(t, client, u, []taskSpec{
		{slug: "both", target: "api", triggers: `{"cronExpr":"0 * * * *","windows":[{"startTime":"13:00","endTime":"14:00"}]}`, active: true, lastRun: tptr(noon)},
	})

	starter := &fakeStarter{}
	s := New(client, starter, NoopLeases{}, Config{Clock: func() time.Time { return now }}, zap.NewNop())
	if err := s.tick(context.Background()); err != nil {
		t.Fatalf("tick: %v", err)
	}
	if len(starter.calls) != 1 || starter.calls[0].Trigger != "cron" {
		t.Fatalf("expected cron to win, got %+v", starter.calls)
	}
}

// TestCrossTenantScan: the scheduler sees and fires due tasks across multiple
// users in a single tick (auth.WithInternal bypasses tenant scoping).
func TestCrossTenantScan(t *testing.T) {
	client := openDB(t)
	now := time.Date(2026, 6, 8, 13, 1, 30, 0, time.UTC)
	noon := time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)
	a := newUser(t, client, "a@x.co", "ua")
	b := newUser(t, client, "b@x.co", "ub")
	seed(t, client, a, []taskSpec{{slug: "a-cron", target: "api", triggers: `{"cronExpr":"0 * * * *"}`, active: true, lastRun: tptr(noon)}})
	seed(t, client, b, []taskSpec{{slug: "b-cron", target: "api", triggers: `{"cronExpr":"0 * * * *"}`, active: true, lastRun: tptr(noon)}})

	starter := &fakeStarter{}
	s := New(client, starter, NoopLeases{}, Config{Clock: func() time.Time { return now }}, zap.NewNop())
	if err := s.tick(context.Background()); err != nil {
		t.Fatalf("tick: %v", err)
	}
	got := map[string]string{}
	for _, p := range starter.calls {
		got[p.Task.Slug] = p.User.ID.String()
	}
	if len(got) != 2 || got["a-cron"] != a.ID.String() || got["b-cron"] != b.ID.String() {
		t.Fatalf("cross-tenant scan fired %+v, want both users", got)
	}
}

// TestRunsTriggeredMetricIncrements asserts the scheduler's own fire counter.
func TestRunsTriggeredMetricIncrements(t *testing.T) {
	client := openDB(t)
	u := newUser(t, client, "a@x.co", "u1")
	now := time.Date(2026, 6, 8, 13, 1, 30, 0, time.UTC)
	noon := time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)
	seed(t, client, u, []taskSpec{{slug: "cron", target: "api", triggers: `{"cronExpr":"0 * * * *"}`, active: true, lastRun: tptr(noon)}})

	starter := &fakeStarter{}
	s := New(client, starter, NoopLeases{}, Config{Clock: func() time.Time { return now }}, zap.NewNop())
	before := testutil.ToFloat64(metrics.RunsTriggered.WithLabelValues("cron"))
	if err := s.tick(context.Background()); err != nil {
		t.Fatalf("tick: %v", err)
	}
	if got := testutil.ToFloat64(metrics.RunsTriggered.WithLabelValues("cron")) - before; got != 1 {
		t.Fatalf("runs_triggered{cron} delta = %v, want 1", got)
	}
}

// TestRunLoopTicksAndStops exercises the lifecycle: Run ticks at least once on a
// short interval, then returns nil promptly when the context is cancelled.
func TestRunLoopTicksAndStops(t *testing.T) {
	client := openDB(t)
	u := newUser(t, client, "a@x.co", "u1")
	now := time.Date(2026, 6, 8, 13, 1, 30, 0, time.UTC)
	noon := time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)
	seed(t, client, u, []taskSpec{{slug: "cron", target: "api", triggers: `{"cronExpr":"0 * * * *"}`, active: true, lastRun: tptr(noon)}})

	starter := &countingStarter{}
	s := New(client, starter, NoopLeases{}, Config{Interval: 20 * time.Millisecond, Clock: func() time.Time { return now }}, zap.NewNop())

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- s.Run(ctx) }()

	deadline := time.After(2 * time.Second)
	for starter.count() == 0 {
		select {
		case <-deadline:
			cancel()
			t.Fatalf("Run did not tick within 2s")
		case <-time.After(10 * time.Millisecond):
		}
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Run returned error: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("Run did not stop after context cancel")
	}
	if starter.last != "cron" {
		t.Fatalf("expected the cron task to fire, got %q", starter.last)
	}
}

// --- integration tests (real Starter + lease) -------------------------------

// TestSchedulerStartsRealRunAndCompletesLease wires the real
// backgroundtaskruns.Starter into the scheduler and asserts a single tick on a
// due cron task produces a queued executor=api run that is byte-shaped exactly
// like a POST /trigger run (Temporal ids persisted, queued event present) and
// completes the lease with the new run id.
func TestSchedulerStartsRealRunAndCompletesLease(t *testing.T) {
	client := openDB(t)
	ctx := auth.WithInternal(context.Background())
	u := newUser(t, client, "a@x.co", "user_1")

	now := time.Date(2026, 6, 8, 13, 1, 30, 0, time.UTC)
	noon := time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)
	seed(t, client, u, []taskSpec{
		{slug: "cron-due", target: "api", triggers: `{"cronExpr":"0 * * * *"}`, active: true, lastRun: tptr(noon)},
	})

	ctrl := &fakeTemporal{}
	starter := backgroundtaskruns.New(client, ctrl, zap.NewNop())
	lease := &recordingLease{}
	s := New(client, starter, lease, Config{Owner: "pod-1", Clock: func() time.Time { return now }}, zap.NewNop())

	if err := s.tick(context.Background()); err != nil {
		t.Fatalf("tick: %v", err)
	}

	runs := client.BackgroundTaskRun.Query().AllX(ctx)
	if len(runs) != 1 {
		t.Fatalf("expected exactly one scheduler-created run, got %d", len(runs))
	}
	run := runs[0]
	if run.Executor != "api" || run.Trigger != "cron" || run.Status != "queued" {
		t.Fatalf("run shape = executor %q trigger %q status %q, want api/cron/queued", run.Executor, run.Trigger, run.Status)
	}
	if run.TemporalWorkflowID == "" || run.TemporalRunID == "" || run.TemporalStatus != "Started" {
		t.Fatalf("temporal ids not persisted: wf=%q run=%q status=%q", run.TemporalWorkflowID, run.TemporalRunID, run.TemporalStatus)
	}
	if got := run.RunID[:len("sched-cron-")]; got != "sched-cron-" {
		t.Fatalf("run id %q missing sched-cron- prefix", run.RunID)
	}
	if len(ctrl.starts) != 1 || ctrl.starts[0].Trigger != "cron" {
		t.Fatalf("expected one cron Temporal start, got %+v", ctrl.starts)
	}
	if lease.acquired != 1 || lease.completed != 1 || lease.completedRunID != run.RunID {
		t.Fatalf("lease lifecycle = acquired %d completed %d runID %q, want 1/1/%s", lease.acquired, lease.completed, lease.completedRunID, run.RunID)
	}

	ev := client.BackgroundTaskRunEvent.Query().
		Where(backgroundtaskrunevent.EventTypeEQ(backgroundtaskworkflow.EventQueued)).
		OnlyX(ctx)
	var payload map[string]any
	if err := json.Unmarshal([]byte(ev.EventJSON), &payload); err != nil {
		t.Fatalf("event json: %v", err)
	}
	if payload["requestedBy"] != "scheduler" || payload["trigger"] != "cron" {
		t.Fatalf("queued event = %+v, want requestedBy=scheduler trigger=cron", payload)
	}

	// The scheduler stamps the cycle anchor at fire time (desktop parity) so the
	// same occurrence is not re-evaluated before the worker reports terminal
	// state: last_run_at + last_attempt_at advance to now, last_run_id is set.
	task := client.BackgroundTask.Query().FirstX(ctx)
	if task.LastRunAt == nil || !task.LastRunAt.Equal(now) {
		t.Fatalf("last_run_at = %v, want now (%v)", task.LastRunAt, now)
	}
	if task.LastAttemptAt == nil || !task.LastAttemptAt.Equal(now) {
		t.Fatalf("last_attempt_at = %v, want now (%v)", task.LastAttemptAt, now)
	}
	if task.LastRunID != run.RunID {
		t.Fatalf("last_run_id = %q, want %q", task.LastRunID, run.RunID)
	}
}

// TestTickStampsCycleAndDoesNotRefire is the direct regression for the
// duplicate-fire finding: two ticks at the same instant produce exactly one run
// because the first fire advances last_run_at, so the second sees the cycle
// already satisfied.
func TestTickStampsCycleAndDoesNotRefire(t *testing.T) {
	client := openDB(t)
	u := newUser(t, client, "a@x.co", "u1")
	now := time.Date(2026, 6, 8, 13, 1, 30, 0, time.UTC)
	noon := time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)
	seed(t, client, u, []taskSpec{
		{slug: "cron", target: "api", triggers: `{"cronExpr":"0 * * * *"}`, active: true, lastRun: tptr(noon)},
	})

	ctrl := &fakeTemporal{}
	starter := backgroundtaskruns.New(client, ctrl, zap.NewNop())
	s := New(client, starter, NoopLeases{}, Config{Clock: func() time.Time { return now }}, zap.NewNop())

	if err := s.tick(context.Background()); err != nil {
		t.Fatalf("tick1: %v", err)
	}
	if err := s.tick(context.Background()); err != nil {
		t.Fatalf("tick2: %v", err)
	}

	runs := client.BackgroundTaskRun.Query().AllX(auth.WithInternal(context.Background()))
	if len(runs) != 1 {
		t.Fatalf("expected exactly one run across two ticks, got %d", len(runs))
	}
}

// TestSchedulerReleasesLeaseOnStartFailure proves that when Temporal start
// fails, the lease is released (not completed) and the cycle stays unfired.
func TestSchedulerReleasesLeaseOnStartFailure(t *testing.T) {
	client := openDB(t)
	u := newUser(t, client, "b@x.co", "user_2")
	now := time.Date(2026, 6, 8, 13, 1, 30, 0, time.UTC)
	noon := time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)
	seed(t, client, u, []taskSpec{
		{slug: "cron-due", target: "api", triggers: `{"cronExpr":"0 * * * *"}`, active: true, lastRun: tptr(noon)},
	})

	ctrl := &failingTemporal{}
	starter := backgroundtaskruns.New(client, ctrl, zap.NewNop())
	lease := &releaseTrackingLease{}
	s := New(client, starter, lease, Config{Clock: func() time.Time { return now }}, zap.NewNop())

	if err := s.tick(context.Background()); err != nil {
		t.Fatalf("tick: %v", err)
	}
	if lease.released != 1 || lease.completed != 0 {
		t.Fatalf("lease on start failure = released %d completed %d, want 1/0", lease.released, lease.completed)
	}
	ctx := auth.WithInternal(context.Background())
	run := client.BackgroundTaskRun.Query().FirstX(ctx)
	if run.Status != "failed" || run.ErrorCode != backgroundtaskworkflow.ErrCodeTemporalStartFailed {
		t.Fatalf("run = %s/%s, want failed/%s", run.Status, run.ErrorCode, backgroundtaskworkflow.ErrCodeTemporalStartFailed)
	}
	// A start failure stamps last_attempt_at (so a persistent failure backs off
	// instead of storming) but must NOT advance the cycle anchor last_run_at.
	task := client.BackgroundTask.Query().FirstX(ctx)
	if task.LastAttemptAt == nil || !task.LastAttemptAt.Equal(now) {
		t.Fatalf("start failure should stamp last_attempt_at, got %v", task.LastAttemptAt)
	}
	if task.LastRunAt == nil || !task.LastRunAt.Equal(noon) {
		t.Fatalf("start failure must not advance last_run_at, got %v want noon", task.LastRunAt)
	}
}

// TestSchedulerTreatsPersistIDsErrorAsFired: when the workflow started but its
// ids failed to persist, the scheduler advances the cycle (stampFired) instead
// of backing off and re-firing — so it won't start a second workflow.
func TestSchedulerTreatsPersistIDsErrorAsFired(t *testing.T) {
	client := openDB(t)
	u := newUser(t, client, "a@x.co", "u1")
	now := time.Date(2026, 6, 8, 13, 1, 30, 0, time.UTC)
	noon := time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)
	seed(t, client, u, []taskSpec{
		{slug: "cron", target: "api", triggers: `{"cronExpr":"0 * * * *"}`, active: true, lastRun: tptr(noon)},
	})

	starter := &persistErrStarter{run: &ent.BackgroundTaskRun{RunID: "sched-cron-persist"}}
	s := New(client, starter, NoopLeases{}, Config{Clock: func() time.Time { return now }}, zap.NewNop())
	if err := s.tick(context.Background()); err != nil {
		t.Fatalf("tick: %v", err)
	}

	// stampFired advances last_run_at to now; stampAttempt (the failure path)
	// would have left it at noon.
	task := client.BackgroundTask.Query().FirstX(auth.WithInternal(context.Background()))
	if task.LastRunAt == nil || !task.LastRunAt.Equal(now) {
		t.Fatalf("PersistIDsError should advance the cycle, last_run_at=%v want now", task.LastRunAt)
	}
}

// TestReapStuckStartingRuns: a run abandoned in queued/temporal_status=Starting
// is left alone while recent, then failed once it ages past orphanGrace.
func TestReapStuckStartingRuns(t *testing.T) {
	client := openDB(t)
	ctx := auth.WithInternal(context.Background())
	u := newUser(t, client, "a@x.co", "u1")
	task := client.BackgroundTask.Create().
		SetUser(u).SetSlug("t").SetName("t").SetInstructions("x").SetExecutionTarget("api").
		SaveX(context.Background())
	stuck := client.BackgroundTaskRun.Create().
		SetUser(u).SetTask(task).SetRunID("api-trigger-stuck").
		SetTrigger("manual").SetStatus("queued").SetExecutor("api").
		SetTemporalStatus("Starting").
		SaveX(context.Background())

	realNow := time.Now()
	s := New(client, &fakeStarter{}, NoopLeases{}, Config{Clock: func() time.Time { return realNow }}, zap.NewNop())

	// Recent: created_at is within orphanGrace of now → not reaped.
	s.reapStuckStartingRuns(ctx, realNow)
	if got := client.BackgroundTaskRun.GetX(ctx, stuck.ID); got.Status != "queued" {
		t.Fatalf("recent stuck run should not be reaped, got %q", got.Status)
	}

	// Aged: evaluate as if well past orphanGrace → reaped to failed.
	s.reapStuckStartingRuns(ctx, realNow.Add(time.Hour))
	got := client.BackgroundTaskRun.GetX(ctx, stuck.ID)
	if got.Status != "failed" || got.ErrorCode != backgroundtaskworkflow.ErrCodeTemporalStartFailed {
		t.Fatalf("aged stuck run not reaped: status=%q code=%q", got.Status, got.ErrorCode)
	}
}

// --- helpers ----------------------------------------------------------------

func keys(m map[string]backgroundtaskruns.Params) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func slugsOf(ps []backgroundtaskruns.Params) []string {
	out := make([]string, 0, len(ps))
	for _, p := range ps {
		out = append(out, p.Task.Slug)
	}
	return out
}
