package backgroundtaskruns_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrunevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruns"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskworkflow"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
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
	return backgroundtaskworkflow.StartResult{WorkflowID: "wf-" + in.RunID, RunID: "trun-" + in.RunID}, nil
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
