package backgroundtaskworkflow

import (
	"context"
	"fmt"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskmetrics"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
	"go.uber.org/zap"
)

// RFC 005: Temporal Schedules own exact-cron firing for api-target tasks. A
// Schedule cannot start rowboat.background_tasks.api.v1 directly — every run
// needs a BackgroundTaskRun row to exist first. So the Schedule action starts
// this thin scheduler workflow, whose single activity routes through the shared
// run starter (row first, workflow second, one code path with manual/loop runs).
const (
	// SchedulerWorkflowName is the Schedule action target.
	SchedulerWorkflowName = "rowboat.background_tasks.schedule.v1"
	// ActivityCreateScheduledRun creates the run row + starts the run workflow
	// via the shared starter.
	ActivityCreateScheduledRun = "rowboat.background_tasks.create_scheduled_run.v1"
)

// ScheduleID is the Temporal Schedule id for a task's cron sub-trigger.
func ScheduleID(userID, slug string) string {
	return fmt.Sprintf("background-task-schedule/%s/%s/cron", userID, slug)
}

// ScheduleWorkflowID is the base workflow id for scheduler-workflow executions
// (Temporal appends a unique per-fire suffix). Deliberately distinct from
// WorkflowID(): the scheduler workflow is a controller, not the run itself.
func ScheduleWorkflowID(userID, slug string) string {
	return fmt.Sprintf("background-task-scheduler/%s/%s/cron", userID, slug)
}

// ScheduleFireInput is the Schedule action argument, set at schedule
// upsert time and delivered on every fire.
type ScheduleFireInput struct {
	UserID       string `json:"userId"`
	TaskID       string `json:"taskId"`
	Slug         string `json:"slug"`
	Trigger      string `json:"trigger"` // always "cron" in v1
	TaskRevision int    `json:"taskRevision"`
}

// ScheduledRunResult reports what a scheduled fire did. Skipped fires are
// successes: the task changed underneath the schedule (deleted, deactivated,
// retargeted, cron removed) and the reconciler will repair the schedule.
type ScheduledRunResult struct {
	RunID      string `json:"runId,omitempty"`
	WorkflowID string `json:"workflowId,omitempty"`
	Skipped    bool   `json:"skipped,omitempty"`
	SkipReason string `json:"skipReason,omitempty"`
}

// ScheduledRunStarter starts a run for a schedule fire. Implemented by
// *backgroundtaskruns.Starter (that package imports this one, so the
// dependency is expressed here as a narrow interface in local types).
type ScheduledRunStarter interface {
	StartScheduledRun(ctx context.Context, in ScheduleFireInput) (ScheduledRunResult, error)
}

// ScheduleActivities hosts the scheduler workflow's activity.
type ScheduleActivities struct {
	Runs ScheduledRunStarter
	Log  *zap.Logger
	// Enabled mirrors TEMPORAL_SCHEDULES_ENABLED. The workflow itself is
	// registered unconditionally so in-flight fires don't time out during a
	// backout — but with the flag off the RFC 001 loop owns every cron again
	// (its skip-gate is off too), so executing fires here would double-run
	// each occurrence. Disabled fires skip until the schedules are cleaned up.
	Enabled bool
}

// CreateScheduledRun creates the run row and starts the run workflow through
// the shared starter. Errors propagate so Temporal's activity retry policy
// applies; the starter itself absorbs the started-but-ids-unpersisted case
// (retrying that would double-start the run workflow).
func (a *ScheduleActivities) CreateScheduledRun(ctx context.Context, in ScheduleFireInput) (ScheduledRunResult, error) {
	if !activity.IsActivity(ctx) || activity.GetInfo(ctx).Attempt == 1 {
		backgroundtaskmetrics.ScheduleFires.Inc()
	}
	if !a.Enabled {
		a.Log.Info("scheduled fire skipped: temporal schedules disabled (backout)",
			zap.String("taskSlug", in.Slug), zap.String("userId", in.UserID))
		return ScheduledRunResult{Skipped: true, SkipReason: "temporal schedules disabled"}, nil
	}
	out, err := a.Runs.StartScheduledRun(ctx, in)
	if err != nil {
		a.Log.Warn("scheduled run start failed",
			zap.String("taskSlug", in.Slug), zap.String("userId", in.UserID), zap.Error(err))
		return ScheduledRunResult{}, err
	}
	if out.Skipped {
		a.Log.Info("scheduled fire skipped",
			zap.String("taskSlug", in.Slug), zap.String("userId", in.UserID),
			zap.String("reason", out.SkipReason))
	}
	return out, nil
}

// SchedulerWorkflow is the thin Schedule action: one activity, no children.
func SchedulerWorkflow(ctx workflow.Context, in ScheduleFireInput) error {
	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    5,
		},
	})
	var out ScheduledRunResult
	return workflow.ExecuteActivity(ctx, ActivityCreateScheduledRun, in).Get(ctx, &out)
}

// RegisterScheduler installs the scheduler workflow and its activity on a
// Temporal worker. Mirrors Register; tests re-register by these names.
func RegisterScheduler(w worker.Worker, a *ScheduleActivities) {
	w.RegisterWorkflowWithOptions(SchedulerWorkflow, workflow.RegisterOptions{Name: SchedulerWorkflowName})
	w.RegisterActivityWithOptions(a.CreateScheduledRun, activity.RegisterOptions{Name: ActivityCreateScheduledRun})
}
