package backgroundscheduler

import (
	"context"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruns"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"go.uber.org/zap"
)

// fakeStarter records the runs the scheduler intends to start without touching
// Temporal, so a tick can be asserted on intended fires alone.
type fakeStarter struct {
	calls []backgroundtaskruns.Params
}

func (f *fakeStarter) Start(_ context.Context, p backgroundtaskruns.Params) (*ent.BackgroundTaskRun, error) {
	f.calls = append(f.calls, p)
	return &ent.BackgroundTaskRun{RunID: p.RunIDPrefix + "fake", Trigger: p.Trigger}, nil
}

// denyLeases refuses every lease, simulating another replica owning the cycle.
type denyLeases struct{ NoopLeases }

func (denyLeases) Acquire(context.Context, *ent.BackgroundTask, string, string, string, time.Duration) (Lease, bool, error) {
	return Lease{}, false, nil
}

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

// TestTickFiresOnlyDueApiTasks scans a population of synthetic tasks and asserts
// the scheduler intends to start exactly the due, active, API-target ones, with
// the right trigger, run-id prefix, and scheduler provenance.
func TestTickFiresOnlyDueApiTasks(t *testing.T) {
	client := openDB(t)
	u := client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(context.Background())

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
	u := client.User.Create().SetEmail("b@x.co").SetWorkosUserID("user_2").SaveX(context.Background())
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
	u := client.User.Create().SetEmail("c@x.co").SetWorkosUserID("user_3").SaveX(context.Background())
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

func keys(m map[string]backgroundtaskruns.Params) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
