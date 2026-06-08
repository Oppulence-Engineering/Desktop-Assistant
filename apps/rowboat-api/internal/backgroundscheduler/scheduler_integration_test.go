package backgroundscheduler

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrunevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruns"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskworkflow"
	"go.uber.org/zap"
)

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
	return Lease{ID: "lease-1"}, true, nil
}
func (r *recordingLease) Complete(_ context.Context, _ string, runID string) error {
	r.completed++
	r.completedRunID = runID
	return nil
}

// TestSchedulerStartsRealRunAndCompletesLease wires the real
// backgroundtaskruns.Starter into the scheduler and asserts a single tick on a
// due cron task produces a queued executor=api run that is byte-shaped exactly
// like a POST /trigger run (Temporal ids persisted, queued event present) and
// completes the lease with the new run id.
func TestSchedulerStartsRealRunAndCompletesLease(t *testing.T) {
	client := openDB(t)
	ctx := auth.WithInternal(context.Background())
	u := client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(context.Background())

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

	// Temporal was actually started with the cron trigger.
	if len(ctrl.starts) != 1 || ctrl.starts[0].Trigger != "cron" {
		t.Fatalf("expected one cron Temporal start, got %+v", ctrl.starts)
	}

	// Lease lifecycle: acquired once, completed with the new run id.
	if lease.acquired != 1 || lease.completed != 1 || lease.completedRunID != run.RunID {
		t.Fatalf("lease lifecycle = acquired %d completed %d runID %q, want 1/1/%s", lease.acquired, lease.completed, lease.completedRunID, run.RunID)
	}

	// Queued event present and attributed to the scheduler.
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

	// The task cycle anchor is not advanced by the scheduler itself — that
	// happens in the worker's MarkRunDone on success. last_run_at stays at noon.
	task := client.BackgroundTask.Query().FirstX(ctx)
	if task.LastRunAt == nil || !task.LastRunAt.Equal(noon) {
		t.Fatalf("last_run_at = %v, want unchanged (noon)", task.LastRunAt)
	}
}

// TestSchedulerReleasesLeaseOnStartFailure proves that when Temporal start
// fails, the lease is released (not completed) and the cycle stays unfired.
func TestSchedulerReleasesLeaseOnStartFailure(t *testing.T) {
	client := openDB(t)
	u := client.User.Create().SetEmail("b@x.co").SetWorkosUserID("user_2").SaveX(context.Background())
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
	// The run row exists but is marked failed; the task cycle is not advanced.
	ctx := auth.WithInternal(context.Background())
	run := client.BackgroundTaskRun.Query().FirstX(ctx)
	if run.Status != "failed" || run.ErrorCode != backgroundtaskworkflow.ErrCodeTemporalStartFailed {
		t.Fatalf("run = %s/%s, want failed/%s", run.Status, run.ErrorCode, backgroundtaskworkflow.ErrCodeTemporalStartFailed)
	}
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
	return Lease{ID: "lease-1"}, true, nil
}
func (r *releaseTrackingLease) Complete(context.Context, string, string) error {
	r.completed++
	return nil
}
func (r *releaseTrackingLease) Release(context.Context, string, error) error {
	r.released++
	return nil
}
