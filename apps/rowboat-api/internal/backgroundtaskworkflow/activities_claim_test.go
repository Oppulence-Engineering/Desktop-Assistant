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

// TestMarkRunRunningRefusesCancelledRun: a run the user cancelled (stopped) must
// NOT be claimed back to running.
func TestMarkRunRunningRefusesCancelledRun(t *testing.T) {
	client := claimTestClient(t)
	ctx := auth.WithInternal(context.Background())
	u := client.User.Create().SetEmail("a@x.co").SetWorkosUserID("u1").SaveX(ctx)
	task := client.BackgroundTask.Create().
		SetUser(u).SetSlug("t").SetName("t").SetInstructions("x").SetExecutionTarget("api").SaveX(ctx)
	stopped := client.BackgroundTaskRun.Create().
		SetUser(u).SetTask(task).SetRunID("sched-cron-x").SetTrigger("cron").
		SetStatus("stopped").SetExecutor("api").SetTemporalStatus("Stopped").SaveX(ctx)

	a := &Activities{Client: client, Log: zap.NewNop()}
	if err := a.MarkRunRunning(context.Background(), StartInput{
		UserID: u.ID.String(), TaskID: task.ID.String(), Slug: "t", RunID: "sched-cron-x",
	}); err == nil {
		t.Fatalf("MarkRunRunning should refuse to claim a cancelled run")
	}
	if got := client.BackgroundTaskRun.GetX(ctx, stopped.ID); got.Status != "stopped" {
		t.Fatalf("cancelled run was resurrected to %q", got.Status)
	}
}

// TestMarkRunRunningSelfHealsReaperFailedRun: a run the orphan reaper failed
// while its workflow was actually live IS claimable, so the live run completes
// instead of being stuck failed. (MarkRunRunning only ever runs for a live
// workflow, so a "failed" row here is a false-positive reap, not a real failure.)
func TestMarkRunRunningSelfHealsReaperFailedRun(t *testing.T) {
	client := claimTestClient(t)
	ctx := auth.WithInternal(context.Background())
	u := client.User.Create().SetEmail("c@x.co").SetWorkosUserID("u3").SaveX(ctx)
	task := client.BackgroundTask.Create().
		SetUser(u).SetSlug("t3").SetName("t3").SetInstructions("x").SetExecutionTarget("api").SaveX(ctx)
	reaped := client.BackgroundTaskRun.Create().
		SetUser(u).SetTask(task).SetRunID("sched-cron-z").SetTrigger("cron").
		SetStatus("failed").SetExecutor("api").SetTemporalStatus("StartFailed").
		SetErrorCode(ErrCodeTemporalStartFailed).SaveX(ctx)

	a := &Activities{Client: client, Log: zap.NewNop()}
	if err := a.MarkRunRunning(context.Background(), StartInput{
		UserID: u.ID.String(), TaskID: task.ID.String(), Slug: "t3", RunID: "sched-cron-z",
	}); err != nil {
		t.Fatalf("MarkRunRunning should reclaim a reaper-failed live run: %v", err)
	}
	if got := client.BackgroundTaskRun.GetX(ctx, reaped.ID); got.Status != "running" {
		t.Fatalf("reaper-failed live run did not self-heal, status=%q", got.Status)
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
