package backgroundtaskruns_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrun"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrunevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruns"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskworkflow"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

func fireInput(task *ent.BackgroundTask, u *ent.User) backgroundtaskworkflow.ScheduleFireInput {
	return backgroundtaskworkflow.ScheduleFireInput{
		UserID: u.ID.String(), TaskID: task.ID.String(), Slug: task.Slug,
		Trigger: "cron", TaskRevision: task.Revision,
	}
}

func setCron(t *testing.T, _ *ent.Client, task *ent.BackgroundTask) *ent.BackgroundTask {
	t.Helper()
	return task.Update().SetTriggersJSON(`{"cronExpr":"0 9 * * *"}`).SaveX(context.Background())
}

func TestStartScheduledRunCreatesRun(t *testing.T) {
	client, u, task := setup(t)
	task = setCron(t, client, task)
	ctrl := &fakeController{}
	starter := backgroundtaskruns.New(client, ctrl, zap.NewNop())

	out, err := starter.StartScheduledRun(context.Background(), fireInput(task, u))
	if err != nil {
		t.Fatalf("StartScheduledRun: %v", err)
	}
	if out.Skipped || out.RunID == "" || out.WorkflowID == "" {
		t.Fatalf("result = %+v", out)
	}
	if !strings.HasPrefix(out.RunID, "sched-temporal-") {
		t.Fatalf("run id %q must carry the sched-temporal- prefix", out.RunID)
	}

	ctx := auth.WithInternal(context.Background())
	run := client.BackgroundTaskRun.Query().Where(backgroundtaskrun.RunIDEQ(out.RunID)).OnlyX(ctx)
	if run.Trigger != "cron" || run.Executor != "api" || run.Status != "queued" {
		t.Fatalf("run = trigger=%q executor=%q status=%q", run.Trigger, run.Executor, run.Status)
	}
	if !strings.Contains(run.RequestedContext, `"0 9 * * *"`) {
		t.Fatalf("requested context missing cron expression: %q", run.RequestedContext)
	}

	ev := client.BackgroundTaskRunEvent.Query().
		Where(backgroundtaskrunevent.EventTypeEQ(backgroundtaskworkflow.EventQueued)).
		FirstX(ctx)
	var payload map[string]any
	if err := json.Unmarshal([]byte(ev.EventJSON), &payload); err != nil {
		t.Fatalf("event json: %v", err)
	}
	if payload["requestedBy"] != "temporal-schedule" {
		t.Fatalf("queued event requestedBy = %v, want temporal-schedule", payload["requestedBy"])
	}
}

func TestStartScheduledRunSkipsStaleFires(t *testing.T) {
	client, u, task := setup(t)
	task = setCron(t, client, task)
	ctrl := &fakeController{}
	starter := backgroundtaskruns.New(client, ctrl, zap.NewNop())
	bg := context.Background()

	cases := []struct {
		name   string
		mutate func() backgroundtaskworkflow.ScheduleFireInput
		reason string
	}{
		{
			name: "task deleted",
			mutate: func() backgroundtaskworkflow.ScheduleFireInput {
				in := fireInput(task, u)
				in.TaskID = uuid.NewString()
				return in
			},
			reason: "task deleted",
		},
		{
			name: "task inactive",
			mutate: func() backgroundtaskworkflow.ScheduleFireInput {
				task = task.Update().SetActive(false).SaveX(bg)
				return fireInput(task, u)
			},
			reason: "task inactive",
		},
		{
			name: "target flipped to desktop",
			mutate: func() backgroundtaskworkflow.ScheduleFireInput {
				task = task.Update().SetActive(true).SetExecutionTarget("desktop").SaveX(bg)
				return fireInput(task, u)
			},
			reason: "task no longer targets api",
		},
		{
			name: "cron removed",
			mutate: func() backgroundtaskworkflow.ScheduleFireInput {
				task = task.Update().SetExecutionTarget("api").SetTriggersJSON(`{"windows":[{"startTime":"09:00","endTime":"12:00"}]}`).SaveX(bg)
				return fireInput(task, u)
			},
			reason: "cron trigger removed",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out, err := starter.StartScheduledRun(bg, tc.mutate())
			if err != nil {
				t.Fatalf("StartScheduledRun: %v", err)
			}
			if !out.Skipped || out.SkipReason != tc.reason {
				t.Fatalf("result = %+v, want skipped %q", out, tc.reason)
			}
		})
	}
	if len(ctrl.starts) != 0 {
		t.Fatalf("skipped fires must not start workflows, got %d", len(ctrl.starts))
	}
	n := client.BackgroundTaskRun.Query().CountX(auth.WithInternal(bg))
	if n != 0 {
		t.Fatalf("skipped fires must not create run rows, got %d", n)
	}
}

// TestStartScheduledRunPropagatesStartFailureUnstamped: a Temporal start
// failure propagates so the activity's bounded retry re-attempts the
// occurrence (the schedule-path equivalent of the loop's widened-grace
// retry), and the task is NOT stamped — a stamp would make the
// occurrence-coverage / in-flight guards suppress the legitimate retry.
func TestStartScheduledRunPropagatesStartFailureUnstamped(t *testing.T) {
	client, u, task := setup(t)
	task = setCron(t, client, task)
	ctrl := &fakeController{startErr: errors.New("temporal unreachable")}
	starter := backgroundtaskruns.New(client, ctrl, zap.NewNop())

	_, err := starter.StartScheduledRun(context.Background(), fireInput(task, u))
	var startFailed *backgroundtaskruns.StartFailedError
	if !errors.As(err, &startFailed) {
		t.Fatalf("want StartFailedError to drive activity retry, got %v", err)
	}
	ctx := auth.WithInternal(context.Background())
	run := client.BackgroundTaskRun.Query().OnlyX(ctx)
	if run.Status != "failed" || run.ErrorCode != backgroundtaskworkflow.ErrCodeTemporalStartFailed {
		t.Fatalf("run = status=%q code=%q", run.Status, run.ErrorCode)
	}
	got := client.BackgroundTask.GetX(ctx, task.ID)
	if got.LastAttemptAt == nil {
		t.Fatal("failed start must stamp last_attempt_at so the loop backs off")
	}
	if got.LastRunAt != nil {
		t.Fatal("failed start must not advance the cycle anchor")
	}

	// A NON-retry fire is now suppressed by the in-flight guard (loop
	// parity: backoff after a failed attempt)…
	ctrl.startErr = nil
	out, err := starter.StartScheduledRun(context.Background(), fireInput(task, u))
	if err != nil || !out.Skipped {
		t.Fatalf("fresh fire inside backoff must skip: %+v err=%v", out, err)
	}
	// …but the activity RETRY of the same fire bypasses it and succeeds.
	in := fireInput(task, u)
	in.RetryAttempt = true
	out, err = starter.StartScheduledRun(context.Background(), in)
	if err != nil || out.Skipped {
		t.Fatalf("retry attempt must fire once the blip clears: %+v err=%v", out, err)
	}
}

// TestStartScheduledRunSkipsCoveredOccurrence: when last_run_at already covers
// the current cron occurrence (another authority fired it first — the loop
// during a fallback window, or a prior activity attempt whose completion was
// lost), the fire must skip rather than double-run the occurrence.
func TestStartScheduledRunSkipsCoveredOccurrence(t *testing.T) {
	client, u, task := setup(t)
	task = setCron(t, client, task)
	ctrl := &fakeController{}
	starter := backgroundtaskruns.New(client, ctrl, zap.NewNop())

	now := time.Now().UTC()
	task = task.Update().SetLastRunAt(now).SetLastAttemptAt(now).SaveX(context.Background())

	out, err := starter.StartScheduledRun(context.Background(), fireInput(task, u))
	if err != nil {
		t.Fatalf("StartScheduledRun: %v", err)
	}
	if !out.Skipped || out.SkipReason != "occurrence already covered" {
		t.Fatalf("result = %+v, want covered-occurrence skip", out)
	}
	if len(ctrl.starts) != 0 {
		t.Fatal("covered occurrence must not start a run")
	}
}

// TestStartScheduledRunStampsFire: a successful fire mirrors the loop's
// stampFired (cycle anchor + attempt + run id) so the loop never re-fires the
// occurrence after a handoff-back and window suppression behaves identically.
func TestStartScheduledRunStampsFire(t *testing.T) {
	client, u, task := setup(t)
	task = setCron(t, client, task)
	starter := backgroundtaskruns.New(client, &fakeController{}, zap.NewNop())

	out, err := starter.StartScheduledRun(context.Background(), fireInput(task, u))
	if err != nil {
		t.Fatalf("StartScheduledRun: %v", err)
	}
	got := client.BackgroundTask.GetX(auth.WithInternal(context.Background()), task.ID)
	if got.LastRunAt == nil || got.LastAttemptAt == nil || got.LastRunID != out.RunID {
		t.Fatalf("fire stamp missing: lastRunAt=%v lastAttemptAt=%v lastRunID=%q",
			got.LastRunAt, got.LastAttemptAt, got.LastRunID)
	}
}

// TestStartScheduledRunSkipsWhileInFlight: a prior attempt newer than the last
// success inside the backoff window suppresses the fire — Temporal's overlap
// policy can't do this (it only spans the thin scheduler workflow).
func TestStartScheduledRunSkipsWhileInFlight(t *testing.T) {
	client, u, task := setup(t)
	task = setCron(t, client, task)
	ctrl := &fakeController{}
	starter := backgroundtaskruns.New(client, ctrl, zap.NewNop())

	attempt := time.Now().UTC().Add(-time.Minute)
	task = task.Update().SetLastAttemptAt(attempt).SaveX(context.Background())

	out, err := starter.StartScheduledRun(context.Background(), fireInput(task, u))
	if err != nil {
		t.Fatalf("StartScheduledRun: %v", err)
	}
	if !out.Skipped || out.SkipReason != "prior run still in flight" {
		t.Fatalf("result = %+v, want in-flight skip", out)
	}
	if len(ctrl.starts) != 0 {
		t.Fatalf("in-flight fire must not start a run")
	}

	// A prior cycle that completed long ago (before the current occurrence)
	// neither reads as in-flight nor covers the occurrence — the fire fires.
	yesterday := time.Now().UTC().Add(-26 * time.Hour)
	task = task.Update().SetLastAttemptAt(yesterday).SetLastRunAt(yesterday).SaveX(context.Background())
	out, err = starter.StartScheduledRun(context.Background(), fireInput(task, u))
	if err != nil || out.Skipped {
		t.Fatalf("completed prior cycle must not suppress: %+v err=%v", out, err)
	}
}

// TestStartScheduledRunCoversEveryMinuteCron: with a just-stamped last_run_at
// an every-minute cron must read as covered at ANY wall-clock second — when
// this test runs ≥30s past the minute it exercises the future-occurrence
// clamp (the raw +30s skew allowance would resolve to the NEXT minute, which
// no last_run_at can cover, silently disabling the dedup).
func TestStartScheduledRunCoversEveryMinuteCron(t *testing.T) {
	client, u, task := setup(t)
	task = task.Update().SetTriggersJSON(`{"cronExpr":"* * * * *"}`).SaveX(context.Background())
	ctrl := &fakeController{}
	starter := backgroundtaskruns.New(client, ctrl, zap.NewNop())

	now := time.Now().UTC()
	task = task.Update().SetLastRunAt(now).SetLastAttemptAt(now).SaveX(context.Background())

	out, err := starter.StartScheduledRun(context.Background(), fireInput(task, u))
	if err != nil {
		t.Fatalf("StartScheduledRun: %v", err)
	}
	if !out.Skipped || out.SkipReason != "occurrence already covered" {
		t.Fatalf("result = %+v, want covered-occurrence skip (clamp case)", out)
	}
	if len(ctrl.starts) != 0 {
		t.Fatal("covered occurrence must not start a run")
	}
}

// TestStartScheduledRunSkipsInvalidCron: an expression broken by an edit must
// never start runs on the stale schedule cadence.
func TestStartScheduledRunSkipsInvalidCron(t *testing.T) {
	client, u, task := setup(t)
	task = task.Update().SetTriggersJSON(`{"cronExpr":"not a cron"}`).SaveX(context.Background())
	ctrl := &fakeController{}
	starter := backgroundtaskruns.New(client, ctrl, zap.NewNop())

	out, err := starter.StartScheduledRun(context.Background(), fireInput(task, u))
	if err != nil {
		t.Fatalf("StartScheduledRun: %v", err)
	}
	if !out.Skipped || out.SkipReason != "cron expression invalid" {
		t.Fatalf("result = %+v, want invalid-cron skip", out)
	}
	// Whitespace-only matches ParseTriggers' TrimSpace semantics (no cron).
	task = task.Update().SetTriggersJSON(`{"cronExpr":"   "}`).SaveX(context.Background())
	out, _ = starter.StartScheduledRun(context.Background(), fireInput(task, u))
	if !out.Skipped || out.SkipReason != "cron trigger removed" {
		t.Fatalf("whitespace cron = %+v, want removed skip", out)
	}
}
