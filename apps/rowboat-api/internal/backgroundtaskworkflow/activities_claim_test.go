package backgroundtaskworkflow

import (
	"context"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrun"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"go.uber.org/zap"
)

func claimTestClient(t *testing.T) *ent.Client {
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

// TestMarkRunRunningDoesNotResurrectTerminalRun guards the orphan-reaper
// interaction: a run already in a terminal state (e.g. failed by the scheduler's
// reaper, or stopped by a cancel) must NOT be claimed back to running.
func TestMarkRunRunningDoesNotResurrectTerminalRun(t *testing.T) {
	client := claimTestClient(t)
	ctx := auth.WithInternal(context.Background())
	u := client.User.Create().SetEmail("a@x.co").SetWorkosUserID("u1").SaveX(ctx)
	task := client.BackgroundTask.Create().
		SetUser(u).SetSlug("t").SetName("t").SetInstructions("x").SetExecutionTarget("api").SaveX(ctx)
	failed := client.BackgroundTaskRun.Create().
		SetUser(u).SetTask(task).SetRunID("sched-cron-x").SetTrigger("cron").
		SetStatus("failed").SetExecutor("api").SetTemporalStatus("StartFailed").SaveX(ctx)

	a := &Activities{Client: client, Log: zap.NewNop()}
	if err := a.MarkRunRunning(context.Background(), StartInput{
		UserID: u.ID.String(), TaskID: task.ID.String(), Slug: "t", RunID: "sched-cron-x",
	}); err == nil {
		t.Fatalf("MarkRunRunning should refuse to claim a terminal run")
	}
	if got := client.BackgroundTaskRun.GetX(ctx, failed.ID); got.Status != "failed" {
		t.Fatalf("terminal run was resurrected to %q", got.Status)
	}
}

// TestMarkRunRunningClaimsQueuedRun confirms the happy path is unchanged.
func TestMarkRunRunningClaimsQueuedRun(t *testing.T) {
	client := claimTestClient(t)
	ctx := auth.WithInternal(context.Background())
	u := client.User.Create().SetEmail("b@x.co").SetWorkosUserID("u2").SaveX(ctx)
	task := client.BackgroundTask.Create().
		SetUser(u).SetSlug("t2").SetName("t2").SetInstructions("x").SetExecutionTarget("api").SaveX(ctx)
	client.BackgroundTaskRun.Create().
		SetUser(u).SetTask(task).SetRunID("sched-cron-y").SetTrigger("cron").
		SetStatus("queued").SetExecutor("api").SetTemporalStatus("Starting").SaveX(ctx)

	a := &Activities{Client: client, Log: zap.NewNop()}
	if err := a.MarkRunRunning(context.Background(), StartInput{
		UserID: u.ID.String(), TaskID: task.ID.String(), Slug: "t2", RunID: "sched-cron-y",
	}); err != nil {
		t.Fatalf("MarkRunRunning on a queued run: %v", err)
	}
	got := client.BackgroundTaskRun.Query().Where(backgroundtaskrun.RunIDEQ("sched-cron-y")).OnlyX(ctx)
	if got.Status != "running" {
		t.Fatalf("queued run not claimed, status=%q", got.Status)
	}
}
