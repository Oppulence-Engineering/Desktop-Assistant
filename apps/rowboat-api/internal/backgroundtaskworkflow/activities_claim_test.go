package backgroundtaskworkflow

import (
	"context"
	"testing"
	"time"

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
	reapedAt := time.Now().UTC()
	reaped := client.BackgroundTaskRun.Create().
		SetUser(u).SetTask(task).SetRunID("sched-cron-z").SetTrigger("cron").
		SetStatus("failed").SetExecutor("api").SetTemporalStatus("StartFailed").
		SetErrorCode(ErrCodeTemporalStartFailed).SetError("reaped").SetErrorDetails("reaped").
		SetCompletedAt(reapedAt).SetTemporalClosedAt(reapedAt).SaveX(ctx)

	a := &Activities{Client: client, Log: zap.NewNop()}
	if err := a.MarkRunRunning(context.Background(), StartInput{
		UserID: u.ID.String(), TaskID: task.ID.String(), Slug: "t3", RunID: "sched-cron-z",
	}); err != nil {
		t.Fatalf("MarkRunRunning should reclaim a reaper-failed live run: %v", err)
	}
	got := client.BackgroundTaskRun.GetX(ctx, reaped.ID)
	if got.Status != "running" {
		t.Fatalf("reaper-failed live run did not self-heal, status=%q", got.Status)
	}
	// The reaper's terminal residue must be cleared so the row isn't a
	// contradictory running+completed_at+error_code, and doesn't leak onto the
	// eventual succeeded row.
	if got.ErrorCode != "" || got.Error != "" || got.ErrorDetails != "" || got.CompletedAt != nil || got.TemporalClosedAt != nil {
		t.Fatalf("terminal residue not cleared on claim: code=%q err=%q details=%q completed=%v closed=%v",
			got.ErrorCode, got.Error, got.ErrorDetails, got.CompletedAt, got.TemporalClosedAt)
	}
}

func TestMarkRunRunningRefusesFailedRunWithRetry(t *testing.T) {
	client := claimTestClient(t)
	ctx := auth.WithInternal(context.Background())
	u := client.User.Create().SetEmail("retry@x.co").SetWorkosUserID("u-retry").SaveX(ctx)
	task := client.BackgroundTask.Create().
		SetUser(u).SetSlug("retry-task").SetName("retry-task").SetInstructions("x").SetExecutionTarget("api").SaveX(ctx)
	original := client.BackgroundTaskRun.Create().
		SetUser(u).SetTask(task).SetRunID("api-trigger-original").SetTrigger("manual").
		SetStatus("failed").SetExecutor("api").SetTemporalStatus("StartFailed").SaveX(ctx)
	client.BackgroundTaskRun.Create().
		SetUser(u).SetTask(task).SetRunID("retry-child").SetTrigger("retry").
		SetRetryOfRunID(original.RunID).SetStatus("queued").SetExecutor("api").SaveX(ctx)

	a := &Activities{Client: client, Log: zap.NewNop()}
	if err := a.MarkRunRunning(context.Background(), StartInput{
		UserID: u.ID.String(), TaskID: task.ID.String(), Slug: task.Slug, RunID: original.RunID,
	}); err == nil {
		t.Fatal("superseded original run must not be reclaimed")
	}
	if got := client.BackgroundTaskRun.GetX(ctx, original.ID); got.Status != "failed" {
		t.Fatalf("superseded original was resurrected to %q", got.Status)
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
