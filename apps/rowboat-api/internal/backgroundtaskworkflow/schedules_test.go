package backgroundtaskworkflow

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"
	"go.uber.org/zap"
)

func TestScheduleIDFormats(t *testing.T) {
	if got := ScheduleID("u1", "daily-digest"); got != "background-task-schedule/u1/daily-digest/cron" {
		t.Fatalf("ScheduleID = %q", got)
	}
	if got := ScheduleWorkflowID("u1", "daily-digest"); got != "background-task-scheduler/u1/daily-digest/cron" {
		t.Fatalf("ScheduleWorkflowID = %q", got)
	}
	if ScheduleWorkflowID("u1", "s") == WorkflowID("u1", "s", "cron") {
		t.Fatal("scheduler workflow id must not collide with run workflow ids")
	}
}

// fakeScheduledRunStarter scripts StartScheduledRun for activity/workflow tests.
type fakeScheduledRunStarter struct {
	result ScheduledRunResult
	err    error
	calls  int
	lastIn ScheduleFireInput
}

func (f *fakeScheduledRunStarter) StartScheduledRun(_ context.Context, in ScheduleFireInput) (ScheduledRunResult, error) {
	f.calls++
	f.lastIn = in
	return f.result, f.err
}

func newSchedulerTestEnv(t *testing.T, runs ScheduledRunStarter) *testsuite.TestWorkflowEnvironment {
	t.Helper()
	var ts testsuite.WorkflowTestSuite
	env := ts.NewTestWorkflowEnvironment()
	env.SetTestTimeout(time.Minute)
	a := &ScheduleActivities{Runs: runs, Log: zap.NewNop(), Enabled: true}
	env.RegisterWorkflowWithOptions(SchedulerWorkflow, workflow.RegisterOptions{Name: SchedulerWorkflowName})
	env.RegisterActivityWithOptions(a.CreateScheduledRun, activity.RegisterOptions{Name: ActivityCreateScheduledRun})
	return env
}

func TestSchedulerWorkflowStartsRun(t *testing.T) {
	runs := &fakeScheduledRunStarter{result: ScheduledRunResult{RunID: "sched-temporal-1", WorkflowID: "wf-1"}}
	env := newSchedulerTestEnv(t, runs)
	in := ScheduleFireInput{UserID: "u1", TaskID: "t1", Slug: "daily-digest", Trigger: "cron", TaskRevision: 3}
	env.ExecuteWorkflow(SchedulerWorkflow, in)
	if !env.IsWorkflowCompleted() || env.GetWorkflowError() != nil {
		t.Fatalf("workflow: completed=%v err=%v", env.IsWorkflowCompleted(), env.GetWorkflowError())
	}
	if runs.calls != 1 || runs.lastIn != in {
		t.Fatalf("starter calls=%d lastIn=%+v", runs.calls, runs.lastIn)
	}
}

func TestSchedulerWorkflowSkippedFireSucceeds(t *testing.T) {
	runs := &fakeScheduledRunStarter{result: ScheduledRunResult{Skipped: true, SkipReason: "task inactive"}}
	env := newSchedulerTestEnv(t, runs)
	env.ExecuteWorkflow(SchedulerWorkflow, ScheduleFireInput{UserID: "u1", TaskID: "t1", Slug: "s", Trigger: "cron"})
	if !env.IsWorkflowCompleted() || env.GetWorkflowError() != nil {
		t.Fatalf("skipped fire must complete cleanly: err=%v", env.GetWorkflowError())
	}
}

func TestSchedulerWorkflowRetriesThenFails(t *testing.T) {
	runs := &fakeScheduledRunStarter{err: errors.New("db down")}
	env := newSchedulerTestEnv(t, runs)
	env.ExecuteWorkflow(SchedulerWorkflow, ScheduleFireInput{UserID: "u1", TaskID: "t1", Slug: "s", Trigger: "cron"})
	if !env.IsWorkflowCompleted() {
		t.Fatal("workflow did not complete")
	}
	err := env.GetWorkflowError()
	if err == nil || !strings.Contains(err.Error(), "db down") {
		t.Fatalf("want propagated activity error, got %v", err)
	}
	if runs.calls != 5 {
		t.Fatalf("starter calls = %d, want 5 (retry policy MaximumAttempts)", runs.calls)
	}
}

// TestSchedulerWorkflowDisabledSkips: during a TEMPORAL_SCHEDULES_ENABLED=false
// backout the loop owns every cron again, so executing fires from leftover
// schedules would double-run each occurrence — they must skip instead.
func TestSchedulerWorkflowDisabledSkips(t *testing.T) {
	runs := &fakeScheduledRunStarter{}
	var ts testsuite.WorkflowTestSuite
	env := ts.NewTestWorkflowEnvironment()
	env.SetTestTimeout(time.Minute)
	a := &ScheduleActivities{Runs: runs, Log: zap.NewNop(), Enabled: false}
	env.RegisterWorkflowWithOptions(SchedulerWorkflow, workflow.RegisterOptions{Name: SchedulerWorkflowName})
	env.RegisterActivityWithOptions(a.CreateScheduledRun, activity.RegisterOptions{Name: ActivityCreateScheduledRun})

	env.ExecuteWorkflow(SchedulerWorkflow, ScheduleFireInput{UserID: "u1", TaskID: "t1", Slug: "s", Trigger: "cron"})
	if !env.IsWorkflowCompleted() || env.GetWorkflowError() != nil {
		t.Fatalf("disabled fire must complete cleanly: err=%v", env.GetWorkflowError())
	}
	if runs.calls != 0 {
		t.Fatalf("disabled fire must not start runs, got %d calls", runs.calls)
	}
}
