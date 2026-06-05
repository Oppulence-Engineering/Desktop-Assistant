// Package backgroundtaskworkflow contains the Temporal workflow used for
// API-native background task executions.
package backgroundtaskworkflow

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	entsql "entgo.io/ent/dialect/sql"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtask"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskartifact"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrun"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrunevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskmetrics"
	"github.com/google/uuid"
	"go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
	"go.uber.org/zap"
)

const (
	WorkflowName = "rowboat.background_tasks.api.v1"

	ActivityMarkRunRunning = "rowboat.background_tasks.mark_run_running.v1"
	ActivityExecuteAPITask = "rowboat.background_tasks.execute_api_task.v1"
	ActivityMarkRunDone    = "rowboat.background_tasks.mark_run_done.v1"
	ActivityMarkRunFailed  = "rowboat.background_tasks.mark_run_failed.v1"

	SignalControl = "rowboat.background_tasks.control.v1"
)

// StartInput is persisted in Temporal history and is intentionally small.
type StartInput struct {
	UserID           string `json:"userId"`
	TaskID           string `json:"taskId"`
	Slug             string `json:"slug"`
	RunID            string `json:"runId"`
	Trigger          string `json:"trigger"`
	RequestedContext string `json:"requestedContext,omitempty"`
}

// StartResult is returned to the HTTP handler after Temporal accepts the start.
type StartResult struct {
	WorkflowID string
	RunID      string
}

// RunOutput is the API-native activity output mirrored to the run row.
type RunOutput struct {
	Summary string `json:"summary"`
}

// CompleteInput carries the workflow start input plus terminal state details.
type CompleteInput struct {
	StartInput
	Summary      string `json:"summary,omitempty"`
	Error        string `json:"error,omitempty"`
	ErrorCode    string `json:"errorCode,omitempty"`
	ErrorDetails string `json:"errorDetails,omitempty"`
}

// Controller is the Temporal surface used by the HTTP API. It is deliberately
// small so handler tests can use fakes without importing the Temporal SDK.
type Controller interface {
	StartBackgroundTaskRun(context.Context, StartInput) (StartResult, error)
	CancelBackgroundTaskRun(context.Context, string, string) error
	SignalBackgroundTaskRun(context.Context, string, string, string, map[string]any) error
}

// Starter adapts the Temporal SDK client to Controller.
type Starter struct {
	client    client.Client
	taskQueue string
}

// Dial connects to Temporal using rowboat-api configuration. Local kind uses the
// bundled auto-setup server (plaintext, no auth); staging/production connect to
// Temporal Cloud with an API key over TLS.
func Dial(ctx context.Context, cfg appconfig.Config) (client.Client, error) {
	opts := client.Options{
		HostPort:  cfg.TemporalAddress,
		Namespace: cfg.TemporalNamespace,
	}
	if cfg.TemporalAPIKey != "" {
		opts.Credentials = client.NewAPIKeyStaticCredentials(cfg.TemporalAPIKey)
	}
	if cfg.TemporalUseTLS() {
		// Temporal Cloud terminates TLS with a public cert, so the zero-value
		// config (system roots, SNI from HostPort) is sufficient.
		opts.ConnectionOptions.TLS = &tls.Config{}
	}
	return client.DialContext(ctx, opts)
}

// NewStarter builds a Controller for the HTTP API process.
func NewStarter(c client.Client, cfg appconfig.Config) *Starter {
	return &Starter{client: c, taskQueue: cfg.TemporalTaskQueue}
}

// WorkflowID returns the deterministic workflow id for one API run.
func WorkflowID(userID, slug, runID string) string {
	return fmt.Sprintf("background-task/%s/%s/%s", userID, slug, runID)
}

// StartBackgroundTaskRun starts an API-native background task workflow.
func (s *Starter) StartBackgroundTaskRun(ctx context.Context, in StartInput) (StartResult, error) {
	workflowID := WorkflowID(in.UserID, in.Slug, in.RunID)
	run, err := s.client.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:                    workflowID,
		TaskQueue:             s.taskQueue,
		WorkflowIDReusePolicy: enums.WORKFLOW_ID_REUSE_POLICY_ALLOW_DUPLICATE_FAILED_ONLY,
	}, WorkflowName, in)
	if err != nil {
		return StartResult{}, err
	}
	return StartResult{WorkflowID: run.GetID(), RunID: run.GetRunID()}, nil
}

// CancelBackgroundTaskRun requests Temporal cancellation.
func (s *Starter) CancelBackgroundTaskRun(ctx context.Context, workflowID, runID string) error {
	return s.client.CancelWorkflow(ctx, workflowID, runID)
}

// SignalBackgroundTaskRun sends a constrained control signal to the workflow.
func (s *Starter) SignalBackgroundTaskRun(ctx context.Context, workflowID, runID, signal string, payload map[string]any) error {
	body := map[string]any{"signal": signal, "payload": payload}
	return s.client.SignalWorkflow(ctx, workflowID, runID, SignalControl, body)
}

// Register installs the workflow and activities on a Temporal worker.
func Register(w worker.Worker, activities *Activities) {
	w.RegisterWorkflowWithOptions(BackgroundTaskWorkflow, workflow.RegisterOptions{Name: WorkflowName})
	w.RegisterActivityWithOptions(activities.MarkRunRunning, activity.RegisterOptions{Name: ActivityMarkRunRunning})
	w.RegisterActivityWithOptions(activities.ExecuteAPITask, activity.RegisterOptions{Name: ActivityExecuteAPITask})
	w.RegisterActivityWithOptions(activities.MarkRunDone, activity.RegisterOptions{Name: ActivityMarkRunDone})
	w.RegisterActivityWithOptions(activities.MarkRunFailed, activity.RegisterOptions{Name: ActivityMarkRunFailed})
}

// BackgroundTaskWorkflow coordinates an API-native background task run.
func BackgroundTaskWorkflow(ctx workflow.Context, in StartInput) error {
	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    3,
		},
	})

	if err := workflow.ExecuteActivity(ctx, ActivityMarkRunRunning, in).Get(ctx, nil); err != nil {
		return err
	}

	var output RunOutput
	if err := workflow.ExecuteActivity(ctx, ActivityExecuteAPITask, in).Get(ctx, &output); err != nil {
		// On cancellation ctx is already canceled, so MarkRunFailed is skipped and
		// the run keeps the `stopped` status the cancel handler set. Genuine
		// failures run on the live ctx and record a granular error code.
		code, details := ClassifyRunError(err)
		fail := CompleteInput{StartInput: in, Error: err.Error(), ErrorCode: code, ErrorDetails: details}
		_ = workflow.ExecuteActivity(ctx, ActivityMarkRunFailed, fail).Get(ctx, nil)
		return err
	}

	done := CompleteInput{StartInput: in, Summary: output.Summary}
	return workflow.ExecuteActivity(ctx, ActivityMarkRunDone, done).Get(ctx, nil)
}

// Activities mutates the Rowboat database from worker executions.
type Activities struct {
	Client *ent.Client
	Log    *zap.Logger
}

// MarkRunRunning claims a queued API run for execution.
func (a *Activities) MarkRunRunning(ctx context.Context, in StartInput) error {
	ctx = auth.WithInternal(ctx)
	now := time.Now().UTC()
	taskID, err := uuid.Parse(in.TaskID)
	if err != nil {
		return err
	}
	n, err := a.Client.BackgroundTaskRun.Update().
		Where(backgroundtaskrun.RunIDEQ(in.RunID), backgroundtaskrun.HasTaskWith(backgroundtask.IDEQ(taskID))).
		SetExecutor("api").
		SetStatus("running").
		SetTemporalStatus("Running").
		SetTemporalStartedAt(now).
		SetStartedAt(now).
		SetLastHeartbeatAt(now).
		SetProgressPercent(5).
		SetProgressMessage("API worker claimed the run.").
		AddRevision(1).
		Save(ctx)
	if err != nil {
		return err
	}
	if n == 0 {
		return fmt.Errorf("background task run %s not found", in.RunID)
	}
	if err := a.Client.BackgroundTask.UpdateOneID(taskID).
		SetLastAttemptAt(now).
		SetLastRunID(in.RunID).
		AddRevision(1).
		Exec(ctx); err != nil {
		return err
	}
	if run, qerr := a.Client.BackgroundTaskRun.Query().
		Where(backgroundtaskrun.RunIDEQ(in.RunID), backgroundtaskrun.HasTaskWith(backgroundtask.IDEQ(taskID))).
		Only(ctx); qerr == nil {
		backgroundtaskmetrics.ObserveQueueLatency(run.CreatedAt, now)
	}
	return a.appendEvent(ctx, in, EventRunning, map[string]any{
		"type":       EventRunning,
		"message":    "API worker claimed the run.",
		"progress":   5,
		"workflowId": WorkflowID(in.UserID, in.Slug, in.RunID),
	})
}

// ExecuteAPITask runs the v1 server-side job. It deliberately avoids desktop
// filesystem/tool execution; that remains on the desktop path.
func (a *Activities) ExecuteAPITask(ctx context.Context, in StartInput) (RunOutput, error) {
	ctx = auth.WithInternal(ctx)
	now := time.Now().UTC()
	taskID, err := uuid.Parse(in.TaskID)
	if err != nil {
		return RunOutput{}, taggedError(ErrCodeTaskInvalid, "invalid task id", err)
	}
	task, err := a.Client.BackgroundTask.Query().
		Where(backgroundtask.IDEQ(taskID)).
		WithUser().
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return RunOutput{}, taggedError(ErrCodeTaskNotFound, "background task not found", err)
		}
		return RunOutput{}, taggedError(ErrCodeDBError, "load background task", err)
	}

	if _, err := a.Client.BackgroundTaskRun.Update().
		Where(backgroundtaskrun.RunIDEQ(in.RunID), backgroundtaskrun.HasTaskWith(backgroundtask.IDEQ(taskID))).
		SetLastHeartbeatAt(now).
		SetProgressPercent(50).
		SetProgressMessage("Building API-native task artifact.").
		AddRevision(1).
		Save(ctx); err != nil {
		return RunOutput{}, taggedError(ErrCodeDBError, "update run progress", err)
	}
	if err := a.appendEvent(ctx, in, EventProgress, map[string]any{
		"type":     EventProgress,
		"message":  "Building API-native task artifact.",
		"progress": 50,
	}); err != nil {
		return RunOutput{}, taggedError(ErrCodeDBError, "append progress event", err)
	}

	summary := buildSummary(task, in)
	artifact := buildArtifact(task, in, summary, now)
	if err := a.upsertArtifact(ctx, task, in.RunID, artifact); err != nil {
		backgroundtaskmetrics.ArtifactSyncFailures.Inc()
		return RunOutput{}, taggedError(ErrCodeArtifactWriteFailed, "write artifact", err)
	}

	if _, err := a.Client.BackgroundTaskRun.Update().
		Where(backgroundtaskrun.RunIDEQ(in.RunID), backgroundtaskrun.HasTaskWith(backgroundtask.IDEQ(taskID))).
		SetLastHeartbeatAt(time.Now().UTC()).
		SetProgressPercent(90).
		SetProgressMessage("Artifact updated.").
		AddRevision(1).
		Save(ctx); err != nil {
		return RunOutput{}, taggedError(ErrCodeDBError, "update run progress", err)
	}
	if err := a.appendEvent(ctx, in, EventArtifactUpdated, map[string]any{
		"type":     EventArtifactUpdated,
		"message":  "Artifact updated.",
		"progress": 90,
	}); err != nil {
		return RunOutput{}, taggedError(ErrCodeDBError, "append artifact event", err)
	}

	return RunOutput{Summary: summary}, nil
}

// MarkRunDone marks an API run terminal-success.
func (a *Activities) MarkRunDone(ctx context.Context, in CompleteInput) error {
	ctx = auth.WithInternal(ctx)
	now := time.Now().UTC()
	taskID, err := uuid.Parse(in.TaskID)
	if err != nil {
		return err
	}
	n, err := a.Client.BackgroundTaskRun.Update().
		Where(backgroundtaskrun.RunIDEQ(in.RunID), backgroundtaskrun.HasTaskWith(backgroundtask.IDEQ(taskID))).
		SetStatus("succeeded").
		SetTemporalStatus("Completed").
		SetTemporalClosedAt(now).
		SetCompletedAt(now).
		SetLastHeartbeatAt(now).
		SetProgressPercent(100).
		SetProgressMessage("Completed.").
		SetSummary(in.Summary).
		ClearError().
		AddRevision(1).
		Save(ctx)
	if err != nil {
		return err
	}
	if n == 0 {
		return fmt.Errorf("background task run %s not found", in.RunID)
	}
	if err := a.Client.BackgroundTask.UpdateOneID(taskID).
		SetLastRunID(in.RunID).
		SetLastRunAt(now).
		SetLastRunSummary(in.Summary).
		ClearLastRunError().
		AddRevision(1).
		Exec(ctx); err != nil {
		return err
	}
	if run, qerr := a.Client.BackgroundTaskRun.Query().
		Where(backgroundtaskrun.RunIDEQ(in.RunID), backgroundtaskrun.HasTaskWith(backgroundtask.IDEQ(taskID))).
		Only(ctx); qerr == nil {
		backgroundtaskmetrics.ObserveDurationSince(run.StartedAt, now)
	}
	backgroundtaskmetrics.Completed.Inc()
	return a.appendEvent(ctx, in.StartInput, EventCompleted, map[string]any{
		"type":     EventCompleted,
		"message":  "Completed.",
		"progress": 100,
		"summary":  in.Summary,
	})
}

// MarkRunFailed marks an API run terminal-failure.
func (a *Activities) MarkRunFailed(ctx context.Context, in CompleteInput) error {
	ctx = auth.WithInternal(ctx)
	now := time.Now().UTC()
	taskID, err := uuid.Parse(in.TaskID)
	if err != nil {
		return err
	}
	code := in.ErrorCode
	if code == "" {
		code = ErrCodeActivityFailed
	}
	details := in.ErrorDetails
	if details == "" {
		details = in.Error
	}
	n, err := a.Client.BackgroundTaskRun.Update().
		Where(backgroundtaskrun.RunIDEQ(in.RunID), backgroundtaskrun.HasTaskWith(backgroundtask.IDEQ(taskID))).
		SetStatus("failed").
		SetTemporalStatus("Failed").
		SetTemporalClosedAt(now).
		SetCompletedAt(now).
		SetLastHeartbeatAt(now).
		SetProgressMessage("Failed.").
		SetError(in.Error).
		SetErrorCode(code).
		SetErrorDetails(details).
		AddRevision(1).
		Save(ctx)
	if err != nil {
		return err
	}
	if n == 0 {
		return fmt.Errorf("background task run %s not found", in.RunID)
	}
	if err := a.Client.BackgroundTask.UpdateOneID(taskID).
		SetLastRunID(in.RunID).
		SetLastRunError(in.Error).
		AddRevision(1).
		Exec(ctx); err != nil {
		return err
	}
	if run, qerr := a.Client.BackgroundTaskRun.Query().
		Where(backgroundtaskrun.RunIDEQ(in.RunID), backgroundtaskrun.HasTaskWith(backgroundtask.IDEQ(taskID))).
		Only(ctx); qerr == nil {
		backgroundtaskmetrics.ObserveDurationSince(run.StartedAt, now)
	}
	backgroundtaskmetrics.Failed.WithLabelValues(code).Inc()
	return a.appendEvent(ctx, in.StartInput, EventFailed, map[string]any{
		"type":      EventFailed,
		"message":   "Failed.",
		"error":     in.Error,
		"errorCode": code,
	})
}

func (a *Activities) upsertArtifact(ctx context.Context, task *ent.BackgroundTask, runID, body string) error {
	artifact, err := a.Client.BackgroundTaskArtifact.Query().
		Where(backgroundtaskartifact.HasTaskWith(backgroundtask.IDEQ(task.ID))).
		Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return err
	}
	if ent.IsNotFound(err) {
		u := task.Edges.User
		if u == nil {
			var err error
			u, err = a.Client.User.Query().Where(user.HasBackgroundTasksWith(backgroundtask.IDEQ(task.ID))).Only(ctx)
			if err != nil {
				return err
			}
		}
		return a.Client.BackgroundTaskArtifact.Create().
			SetUser(u).
			SetTask(task).
			SetBody(body).
			SetUpdatedByRunID(runID).
			SetContentType("text/markdown").
			Exec(ctx)
	}
	return a.Client.BackgroundTaskArtifact.UpdateOneID(artifact.ID).
		SetBody(body).
		SetUpdatedByRunID(runID).
		SetContentType("text/markdown").
		AddRevision(1).
		Exec(ctx)
}

func (a *Activities) appendEvent(ctx context.Context, in StartInput, eventType string, event map[string]any) error {
	taskID, err := uuid.Parse(in.TaskID)
	if err != nil {
		return err
	}
	userID, err := uuid.Parse(in.UserID)
	if err != nil {
		return err
	}
	task, err := a.Client.BackgroundTask.Query().Where(backgroundtask.IDEQ(taskID)).Only(ctx)
	if err != nil {
		return err
	}
	run, err := a.Client.BackgroundTaskRun.Query().
		Where(backgroundtaskrun.RunIDEQ(in.RunID), backgroundtaskrun.HasTaskWith(backgroundtask.IDEQ(taskID))).
		Only(ctx)
	if err != nil {
		return err
	}
	last, err := a.Client.BackgroundTaskRunEvent.Query().
		Where(backgroundtaskrunevent.HasRunWith(backgroundtaskrun.IDEQ(run.ID))).
		Order(backgroundtaskrunevent.BySeq(entsql.OrderDesc())).
		First(ctx)
	seq := 0
	if err == nil {
		seq = last.Seq + 1
	} else if !ent.IsNotFound(err) {
		return err
	}
	raw, err := json.Marshal(event)
	if err != nil {
		return err
	}
	return a.Client.BackgroundTaskRunEvent.Create().
		SetUserID(userID).
		SetTask(task).
		SetRun(run).
		SetSeq(seq).
		SetEventType(eventType).
		SetEventJSON(string(raw)).
		Exec(ctx)
}

func buildSummary(task *ent.BackgroundTask, in StartInput) string {
	base := fmt.Sprintf("API worker completed %s via %s trigger.", task.Name, in.Trigger)
	if in.RequestedContext != "" {
		return base + " Context: " + truncate(in.RequestedContext, 180)
	}
	return base
}

func buildArtifact(task *ent.BackgroundTask, in StartInput, summary string, ts time.Time) string {
	var b strings.Builder
	b.WriteString("# ")
	b.WriteString(task.Name)
	b.WriteString("\n\n")
	b.WriteString(summary)
	b.WriteString("\n\n")
	b.WriteString("## Execution\n\n")
	b.WriteString("- Executor: api\n")
	b.WriteString("- Trigger: ")
	b.WriteString(in.Trigger)
	b.WriteString("\n- Completed at: ")
	b.WriteString(ts.UTC().Format(time.RFC3339))
	b.WriteString("\n\n")
	b.WriteString("## Instructions\n\n")
	b.WriteString(task.Instructions)
	if in.RequestedContext != "" {
		b.WriteString("\n\n## Requested Context\n\n")
		b.WriteString(in.RequestedContext)
	}
	b.WriteString("\n")
	return b.String()
}

func truncate(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}
