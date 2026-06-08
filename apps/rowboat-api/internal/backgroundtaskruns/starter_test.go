package backgroundtaskruns_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrunevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskmetrics"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruns"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskworkflow"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"go.uber.org/zap"
)

// fakeController records StartBackgroundTaskRun calls and can be made to fail,
// standing in for the Temporal SDK without importing it.
type fakeController struct {
	starts   []backgroundtaskworkflow.StartInput
	startErr error
}

func (f *fakeController) StartBackgroundTaskRun(_ context.Context, in backgroundtaskworkflow.StartInput) (backgroundtaskworkflow.StartResult, error) {
	f.starts = append(f.starts, in)
	if f.startErr != nil {
		return backgroundtaskworkflow.StartResult{}, f.startErr
	}
	// Mirror the real Starter, which returns the deterministic workflow id it
	// was handed (run.GetID()), plus a Temporal-assigned run id.
	return backgroundtaskworkflow.StartResult{
		WorkflowID: backgroundtaskworkflow.WorkflowID(in.UserID, in.Slug, in.RunID),
		RunID:      "trun-" + in.RunID,
	}, nil
}

func (f *fakeController) CancelBackgroundTaskRun(context.Context, string, string) error { return nil }
func (f *fakeController) SignalBackgroundTaskRun(context.Context, string, string, string, map[string]any) error {
	return nil
}

func setup(t *testing.T) (*ent.Client, *ent.User, *ent.BackgroundTask) {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	ctx := context.Background()
	u := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(ctx)
	task := d.Client.BackgroundTask.Create().
		SetUser(u).SetSlug("api-task").SetName("API Task").
		SetInstructions("Run on the server.").SetExecutionTarget("api").
		SaveX(ctx)
	return d.Client, u, task
}

// TestStartCreatesQueuedAPIRunWithInternalContext is the scheduler-shaped call:
// the context carries no user (only the internal flag), yet the run, its
// Temporal ids, and the queued event must all be created.
func TestStartCreatesQueuedAPIRunWithInternalContext(t *testing.T) {
	client, u, task := setup(t)
	ctrl := &fakeController{}
	starter := backgroundtaskruns.New(client, ctrl, zap.NewNop())

	ctx := auth.WithInternal(context.Background()) // no user in context, like the scheduler
	run, err := starter.Start(ctx, backgroundtaskruns.Params{
		User:        u,
		Task:        task,
		Trigger:     "cron",
		RunIDPrefix: "sched-cron-",
		Source:      backgroundtaskruns.SourceScheduler,
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if run.Status != "queued" || run.Executor != "api" {
		t.Fatalf("run status=%q executor=%q, want queued/api", run.Status, run.Executor)
	}
	if run.Trigger != "cron" {
		t.Fatalf("run trigger=%q, want cron", run.Trigger)
	}
	if run.TemporalWorkflowID == "" || run.TemporalRunID == "" || run.TemporalStatus != "Started" {
		t.Fatalf("temporal ids not persisted: wf=%q run=%q status=%q", run.TemporalWorkflowID, run.TemporalRunID, run.TemporalStatus)
	}
	if len(ctrl.starts) != 1 || ctrl.starts[0].Trigger != "cron" {
		t.Fatalf("expected one cron start, got %+v", ctrl.starts)
	}

	// The queued event must exist and record the scheduler as the requester —
	// the proof that runs are distinguishable in the event log.
	ev := client.BackgroundTaskRunEvent.Query().
		Where(backgroundtaskrunevent.EventTypeEQ(backgroundtaskworkflow.EventQueued)).
		FirstX(ctx)
	var payload map[string]any
	if err := json.Unmarshal([]byte(ev.EventJSON), &payload); err != nil {
		t.Fatalf("event json: %v", err)
	}
	if payload["requestedBy"] != "scheduler" || payload["trigger"] != "cron" {
		t.Fatalf("queued event payload = %+v, want requestedBy=scheduler trigger=cron", payload)
	}
}

// TestStartFailureMarksRunFailed mirrors the HTTP handler's start-failure path:
// the run is marked failed with the temporal_start_failed code and the task's
// cycle anchor (last_run_at) is left unset.
func TestStartFailureMarksRunFailed(t *testing.T) {
	client, u, task := setup(t)
	ctrl := &fakeController{startErr: errors.New("temporal unreachable")}
	starter := backgroundtaskruns.New(client, ctrl, zap.NewNop())

	run, err := starter.Start(context.Background(), backgroundtaskruns.Params{
		User: u, Task: task, Trigger: "manual", RunIDPrefix: "api-trigger-",
	})
	var startFailed *backgroundtaskruns.StartFailedError
	if !errors.As(err, &startFailed) {
		t.Fatalf("want *StartFailedError, got %v", err)
	}
	if run == nil || run.Status != "failed" || run.ErrorCode != backgroundtaskworkflow.ErrCodeTemporalStartFailed {
		t.Fatalf("run = %+v, want failed/%s", run, backgroundtaskworkflow.ErrCodeTemporalStartFailed)
	}

	reloaded := client.BackgroundTask.GetX(auth.WithInternal(context.Background()), task.ID)
	if reloaded.LastRunAt != nil {
		t.Fatalf("task last_run_at should stay nil after start failure, got %v", reloaded.LastRunAt)
	}
}

// TestStartWithoutTemporalReturnsSentinel covers the 503 mapping precondition.
func TestStartWithoutTemporalReturnsSentinel(t *testing.T) {
	client, u, task := setup(t)
	starter := backgroundtaskruns.New(client, nil, zap.NewNop())
	if _, err := starter.Start(context.Background(), backgroundtaskruns.Params{User: u, Task: task, Trigger: "manual"}); !errors.Is(err, backgroundtaskruns.ErrTemporalNotConfigured) {
		t.Fatalf("want ErrTemporalNotConfigured, got %v", err)
	}
}

// TestStartRetryLineageAndEvent covers the retry path: lineage fields, attempt,
// the retry trigger, and the retry_requested event (not the queued event).
func TestStartRetryLineageAndEvent(t *testing.T) {
	client, u, task := setup(t)
	ctrl := &fakeController{}
	starter := backgroundtaskruns.New(client, ctrl, zap.NewNop())
	ctx := auth.WithInternal(context.Background())

	attempt := 2
	run, err := starter.Start(ctx, backgroundtaskruns.Params{
		User:          u,
		Task:          task,
		Trigger:       "retry",
		RunIDPrefix:   "retry-",
		QueuedMessage: "Queued retry for API worker.",
		PreviousRunID: "api-trigger-prev",
		RetryOfRunID:  "api-trigger-prev",
		Attempt:       &attempt,
	})
	if err != nil {
		t.Fatalf("Start retry: %v", err)
	}
	if run.Trigger != "retry" || run.Attempt != 2 || run.RetryOfRunID != "api-trigger-prev" || run.PreviousRunID != "api-trigger-prev" {
		t.Fatalf("retry lineage wrong: trigger=%q attempt=%d retryOf=%q prev=%q", run.Trigger, run.Attempt, run.RetryOfRunID, run.PreviousRunID)
	}
	if !strings.HasPrefix(run.RunID, "retry-") {
		t.Fatalf("retry run id %q missing retry- prefix", run.RunID)
	}
	if run.ProgressMessage != "Queued retry for API worker." {
		t.Fatalf("retry progress message = %q", run.ProgressMessage)
	}

	ev := client.BackgroundTaskRunEvent.Query().
		Where(backgroundtaskrunevent.EventTypeEQ(backgroundtaskworkflow.EventRetryRequested)).
		OnlyX(ctx)
	var payload map[string]any
	if err := json.Unmarshal([]byte(ev.EventJSON), &payload); err != nil {
		t.Fatalf("event json: %v", err)
	}
	if payload["retryOfRunId"] != "api-trigger-prev" {
		t.Fatalf("retry event = %+v, want retryOfRunId set", payload)
	}
	if n := client.BackgroundTaskRunEvent.Query().Where(backgroundtaskrunevent.EventTypeEQ(backgroundtaskworkflow.EventQueued)).CountX(ctx); n != 0 {
		t.Fatalf("retry should not emit a queued event, found %d", n)
	}
}

// TestStartDefaults: empty Source defaults to http, empty QueuedMessage to the
// canonical string, empty Trigger to manual.
func TestStartDefaults(t *testing.T) {
	client, u, task := setup(t)
	starter := backgroundtaskruns.New(client, &fakeController{}, zap.NewNop())
	ctx := auth.WithInternal(context.Background())

	run, err := starter.Start(ctx, backgroundtaskruns.Params{User: u, Task: task, RunIDPrefix: "api-trigger-"})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if run.Trigger != "manual" {
		t.Fatalf("default trigger = %q, want manual", run.Trigger)
	}
	if run.ProgressMessage != "Queued for API worker." {
		t.Fatalf("default progress message = %q", run.ProgressMessage)
	}
	ev := client.BackgroundTaskRunEvent.Query().Where(backgroundtaskrunevent.EventTypeEQ(backgroundtaskworkflow.EventQueued)).OnlyX(ctx)
	var payload map[string]any
	_ = json.Unmarshal([]byte(ev.EventJSON), &payload)
	if payload["requestedBy"] != "http" {
		t.Fatalf("default requestedBy = %v, want http", payload["requestedBy"])
	}
}

// TestStartWorkflowIDShape asserts the precomputed workflow id matches the
// shared WorkflowID format so viewRun shows it immediately.
func TestStartWorkflowIDShape(t *testing.T) {
	client, u, task := setup(t)
	ctrl := &fakeController{}
	starter := backgroundtaskruns.New(client, ctrl, zap.NewNop())

	run, err := starter.Start(auth.WithInternal(context.Background()), backgroundtaskruns.Params{
		User: u, Task: task, Trigger: "cron", RunIDPrefix: "sched-cron-", Source: backgroundtaskruns.SourceScheduler,
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	want := backgroundtaskworkflow.WorkflowID(u.ID.String(), task.Slug, run.RunID)
	if run.TemporalWorkflowID != want {
		t.Fatalf("workflow id = %q, want %q", run.TemporalWorkflowID, want)
	}
	if len(ctrl.starts) != 1 || ctrl.starts[0].RunID != run.RunID || ctrl.starts[0].Trigger != "cron" {
		t.Fatalf("start input = %+v", ctrl.starts)
	}
}

func TestStartInvalidTrigger(t *testing.T) {
	client, u, task := setup(t)
	starter := backgroundtaskruns.New(client, &fakeController{}, zap.NewNop())
	_, err := starter.Start(auth.WithInternal(context.Background()), backgroundtaskruns.Params{User: u, Task: task, Trigger: "bogus"})
	var invalid *backgroundtaskruns.InvalidParamsError
	if !errors.As(err, &invalid) {
		t.Fatalf("want InvalidParamsError, got %v", err)
	}
}

func TestStartInvalidAttempt(t *testing.T) {
	client, u, task := setup(t)
	starter := backgroundtaskruns.New(client, &fakeController{}, zap.NewNop())
	zero := 0
	_, err := starter.Start(auth.WithInternal(context.Background()), backgroundtaskruns.Params{
		User: u, Task: task, Trigger: "retry", RetryOfRunID: "x", Attempt: &zero,
	})
	var invalid *backgroundtaskruns.InvalidParamsError
	if !errors.As(err, &invalid) {
		t.Fatalf("want InvalidParamsError for attempt < 1, got %v", err)
	}
}

func TestStartMissingUserOrTask(t *testing.T) {
	client, u, task := setup(t)
	starter := backgroundtaskruns.New(client, &fakeController{}, zap.NewNop())
	if _, err := starter.Start(context.Background(), backgroundtaskruns.Params{Task: task}); err == nil {
		t.Fatalf("want error for missing user")
	}
	if _, err := starter.Start(context.Background(), backgroundtaskruns.Params{User: u}); err == nil {
		t.Fatalf("want error for missing task")
	}
}

// TestStartTriggeredMetricIncrements asserts the shared cloud_runs_triggered
// counter advances, the same series the scheduler reconciles against.
func TestStartTriggeredMetricIncrements(t *testing.T) {
	client, u, task := setup(t)
	starter := backgroundtaskruns.New(client, &fakeController{}, zap.NewNop())
	before := testutil.ToFloat64(backgroundtaskmetrics.Triggered.WithLabelValues("window"))
	if _, err := starter.Start(auth.WithInternal(context.Background()), backgroundtaskruns.Params{
		User: u, Task: task, Trigger: "window", RunIDPrefix: "sched-window-", Source: backgroundtaskruns.SourceScheduler,
	}); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if got := testutil.ToFloat64(backgroundtaskmetrics.Triggered.WithLabelValues("window")) - before; got != 1 {
		t.Fatalf("cloud_runs_triggered{window} delta = %v, want 1", got)
	}
}
