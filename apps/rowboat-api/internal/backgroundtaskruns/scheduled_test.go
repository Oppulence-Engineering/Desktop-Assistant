package backgroundtaskruns_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

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

func TestStartScheduledRunPropagatesStartFailure(t *testing.T) {
	client, u, task := setup(t)
	task = setCron(t, client, task)
	ctrl := &fakeController{startErr: errors.New("temporal unreachable")}
	starter := backgroundtaskruns.New(client, ctrl, zap.NewNop())

	_, err := starter.StartScheduledRun(context.Background(), fireInput(task, u))
	var startFailed *backgroundtaskruns.StartFailedError
	if !errors.As(err, &startFailed) {
		t.Fatalf("want StartFailedError for Temporal retry, got %v", err)
	}
	// The failed run row exists (mirrors the loop's retry semantics: each
	// activity retry leaves a visible failed row).
	ctx := auth.WithInternal(context.Background())
	run := client.BackgroundTaskRun.Query().OnlyX(ctx)
	if run.Status != "failed" || run.ErrorCode != backgroundtaskworkflow.ErrCodeTemporalStartFailed {
		t.Fatalf("run = status=%q code=%q", run.Status, run.ErrorCode)
	}
}
