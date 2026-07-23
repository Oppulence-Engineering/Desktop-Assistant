// Package backgroundtaskworkflow contains the Temporal workflow used for
// API-native background task executions.
package backgroundtaskworkflow

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
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
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/faculties"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/llm"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/slackclient"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/websearch"
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
	// WorkflowName is the Temporal workflow type for API-native background task runs.
	WorkflowName = "rowboat.background_tasks.api.v1"

	// ActivityMarkRunRunning is the Temporal activity type that marks a run as running.
	ActivityMarkRunRunning = "rowboat.background_tasks.mark_run_running.v1"
	// ActivityExecuteAPITask is the Temporal activity type that executes the API task.
	ActivityExecuteAPITask = "rowboat.background_tasks.execute_api_task.v1"
	// ActivityMarkRunDone is the Temporal activity type that marks a run as completed.
	ActivityMarkRunDone = "rowboat.background_tasks.mark_run_done.v1"
	// ActivityMarkRunFailed is the Temporal activity type that marks a run as failed.
	ActivityMarkRunFailed = "rowboat.background_tasks.mark_run_failed.v1"

	// SignalControl is the Temporal signal used to control an in-flight API task run.
	SignalControl = "rowboat.background_tasks.control.v1"

	executeAPITaskStartToCloseTimeout = 30 * time.Minute
	shortActivityStartToCloseTimeout  = 5 * time.Minute
)

// StartInput is persisted in Temporal history and is intentionally small.
type StartInput struct {
	UserID           string `json:"userId"`
	TaskID           string `json:"taskId"`
	Slug             string `json:"slug"`
	RunID            string `json:"runId"`
	Trigger          string `json:"trigger"`
	RequestedContext string `json:"requestedContext,omitempty"`
	PriorityKey      int    `json:"priorityKey,omitempty"`
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
	priorityKey := in.PriorityKey
	if priorityKey <= 0 {
		priorityKey = PriorityDefault
	}
	run, err := s.client.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:                    workflowID,
		TaskQueue:             s.taskQueue,
		WorkflowIDReusePolicy: enums.WORKFLOW_ID_REUSE_POLICY_ALLOW_DUPLICATE_FAILED_ONLY,
		Priority: temporal.Priority{
			PriorityKey:    priorityKey,
			FairnessKey:    in.UserID,
			FairnessWeight: 1,
		},
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

// Register installs the workflow and activities on a Temporal worker. The
// test environment is not a worker.Worker, so newWorkflowTestEnv
// (workflow_integration_test.go) mirrors these registrations by name — keep
// the two lists in lockstep.
func Register(w worker.Worker, activities *Activities) {
	w.RegisterWorkflowWithOptions(BackgroundTaskWorkflow, workflow.RegisterOptions{Name: WorkflowName})
	w.RegisterActivityWithOptions(activities.MarkRunRunning, activity.RegisterOptions{Name: ActivityMarkRunRunning})
	w.RegisterActivityWithOptions(activities.ExecuteAPITask, activity.RegisterOptions{Name: ActivityExecuteAPITask})
	w.RegisterActivityWithOptions(activities.MarkRunDone, activity.RegisterOptions{Name: ActivityMarkRunDone})
	w.RegisterActivityWithOptions(activities.MarkRunFailed, activity.RegisterOptions{Name: ActivityMarkRunFailed})
}

// BackgroundTaskWorkflow coordinates an API-native background task run.
func BackgroundTaskWorkflow(ctx workflow.Context, in StartInput) error {
	shortCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: shortActivityStartToCloseTimeout,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    3,
		},
	})
	executeCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: executeAPITaskStartToCloseTimeout,
		HeartbeatTimeout:    time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    3,
		},
	})

	// Drain SignalControl so control signals are received from workflow history
	// instead of buffering unboundedly. The HTTP layer also persists each signal
	// as a run event; ExecuteAPITask polls those durable rows at safe runtime
	// checkpoints to honor pause/resume/update_context cooperatively.
	workflow.Go(shortCtx, func(gctx workflow.Context) {
		ch := workflow.GetSignalChannel(gctx, SignalControl)
		for {
			var msg map[string]any
			if !ch.Receive(gctx, &msg) {
				return
			}
			workflow.GetLogger(gctx).Info("background task control signal received (not yet honored)",
				"signal", msg["signal"], "runId", in.RunID)
		}
	})

	if err := workflow.ExecuteActivity(shortCtx, ActivityMarkRunRunning, in).Get(shortCtx, nil); err != nil {
		// Best-effort terminal write: without it the run row stays "queued"
		// forever when the claim exhausts its retry budget (the scheduler's
		// stale-heartbeat sweep is the backstop when this write fails too).
		// MarkRunFailed's status guard makes this a no-op for runs that are
		// already terminal (e.g. RunNotClaimable on a stopped run).
		code, details := ClassifyRunError(err)
		fail := CompleteInput{StartInput: in, Error: err.Error(), ErrorCode: code, ErrorDetails: details}
		_ = workflow.ExecuteActivity(shortCtx, ActivityMarkRunFailed, fail).Get(shortCtx, nil)
		return err
	}

	var output RunOutput
	if err := workflow.ExecuteActivity(executeCtx, ActivityExecuteAPITask, in).Get(executeCtx, &output); err != nil {
		// On cancellation ctx is already canceled, so MarkRunFailed is skipped and
		// the run keeps the `stopped` status the cancel handler set. Genuine
		// failures run on the live ctx and record a granular error code.
		code, details := ClassifyRunError(err)
		fail := CompleteInput{StartInput: in, Error: err.Error(), ErrorCode: code, ErrorDetails: details}
		_ = workflow.ExecuteActivity(shortCtx, ActivityMarkRunFailed, fail).Get(shortCtx, nil)
		return err
	}

	done := CompleteInput{StartInput: in, Summary: output.Summary}
	return workflow.ExecuteActivity(shortCtx, ActivityMarkRunDone, done).Get(shortCtx, nil)
}

// Activities mutates the Rowboat database from worker executions.
type Activities struct {
	Client *ent.Client
	Log    *zap.Logger

	// Runtime executes the run body (RFC 004). Always non-nil: the worker
	// wires backgroundtaskruntime.NewNoop() (today's deterministic artifact)
	// when CLOUD_RUNTIME_ENABLED=false, NewDefault() otherwise.
	Runtime       backgroundtaskruntime.Runtime
	RuntimeLimits backgroundtaskruntime.Limits
	Sandbox       backgroundtaskruntime.SandboxExecutor
	SandboxTool   backgroundtaskruntime.SandboxToolConfig

	// DefaultRuntime dependencies (nil/zero on the Noop path): the LLM
	// gateway, payload sealer, vendor secrets, Google API client, and the
	// model used when the task carries none.
	LLM           *llm.Handler
	Sealer        *crypto.Sealer
	Secrets       *secrets.Store
	Google        *googleapi.Client
	SlackTokens   backgroundtaskruntime.SlackTeamTokenResolver
	Slack         *slackclient.Client
	MCPResolver   backgroundtaskruntime.MCPConnectorResolver
	MCP           backgroundtaskruntime.MCPConnectorClient
	MCPConnectors []string
	MCPPolicies   []backgroundtaskruntime.MCPConnectorPolicy
	Web           *websearch.Client
	Conduit       *faculties.Client
	Eigen         *faculties.Client
	DefaultModel  string

	// ActionProposer records closed-loop finance-action proposals for human
	// approval (RFC 023). Non-nil only when ACTIONS_ENABLED: it adds the
	// propose-only action.propose tool to a run's registry. There is
	// deliberately no execute tool — execution is brokered behind a token.
	ActionProposer backgroundtaskruntime.ActionProposer
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
		// Refuse to claim a run the user cancelled (stopped) or one already
		// succeeded. A "failed" row is deliberately still claimable: this
		// activity only ever runs for a LIVE workflow, so a failed row here
		// means the scheduler's orphan reaper prematurely failed a run whose
		// workflow is in fact running — claiming it lets the run self-heal and
		// complete rather than being stuck failed. Re-claiming a still-"running"
		// run (activity retry) stays idempotent.
		Where(
			backgroundtaskrun.RunIDEQ(in.RunID),
			backgroundtaskrun.HasTaskWith(backgroundtask.IDEQ(taskID)),
			backgroundtaskrun.StatusNotIn("succeeded", "stopped"),
			// A failed row may self-heal only while it is still the sole execution
			// for this attempt. Once a retry row exists, resurrecting the original
			// would run the same task twice. Keep this anti-join in the UPDATE so
			// an already-committed retry cannot race between a separate check and
			// the status transition.
			backgroundtaskrun.Or(
				backgroundtaskrun.StatusNEQ("failed"),
				func(s *entsql.Selector) {
					retry := entsql.Table(backgroundtaskrun.Table).As("retry")
					s.Where(entsql.NotExists(
						entsql.Select(retry.C(backgroundtaskrun.FieldID)).From(retry).Where(entsql.And(
							entsql.EQ(retry.C(backgroundtaskrun.FieldRetryOfRunID), in.RunID),
							entsql.ColumnsEQ(retry.C(backgroundtaskrun.UserColumn), s.C(backgroundtaskrun.UserColumn)),
						)),
					))
				},
			),
		).
		SetExecutor("api").
		SetStatus("running").
		SetTemporalStatus("Running").
		SetTemporalStartedAt(now).
		SetStartedAt(now).
		SetLastHeartbeatAt(now).
		SetProgressPercent(5).
		SetProgressMessage("API worker claimed the run.").
		// Clear any terminal residue: if the orphan reaper prematurely failed
		// this run (then it self-heals here), the stale completed_at/closed_at
		// and error fields would otherwise contradict status=running and leak
		// onto the eventual succeeded row. No-op for a normal queued run.
		ClearError().
		ClearErrorCode().
		ClearErrorDetails().
		ClearCompletedAt().
		ClearTemporalClosedAt().
		AddRevision(1).
		Save(ctx)
	if err != nil {
		return err
	}
	if n == 0 {
		// Cancelled/succeeded/missing/superseded run: it will never become claimable, so
		// fail the workflow fast instead of burning the activity retry budget.
		return temporal.NewNonRetryableApplicationError(
			fmt.Sprintf("background task run %s not claimable (cancelled, completed, superseded, or missing)", in.RunID),
			"RunNotClaimable", nil)
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

// ExecuteAPITask is the thin durable adapter around the cloud agent runtime
// (RFC 004): it binds the run's artifact store, event sink, scoped tool
// registry, and gateway LLM client, then delegates the body to
// Activities.Runtime (DefaultRuntime when CLOUD_RUNTIME_ENABLED, NoopRuntime
// — today's deterministic artifact — as the rollback).
func (a *Activities) ExecuteAPITask(ctx context.Context, in StartInput) (RunOutput, error) {
	ctx = auth.WithInternal(ctx)
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
	run, err := a.Client.BackgroundTaskRun.Query().
		Where(backgroundtaskrun.RunIDEQ(in.RunID), backgroundtaskrun.HasTaskWith(backgroundtask.IDEQ(taskID))).
		Only(ctx)
	if err != nil {
		return RunOutput{}, taggedError(ErrCodeDBError, "load background task run", err)
	}

	limits := a.RuntimeLimits
	if limits.MaxLLMCalls == 0 {
		limits = backgroundtaskruntime.DefaultLimits()
	}
	model := task.Model
	if model == "" {
		model = a.DefaultModel
	}
	var llmClient backgroundtaskruntime.LLMClient
	if a.LLM != nil && task.Edges.User != nil {
		// Seed the LLM idempotency anchor with the activity attempt so a
		// Temporal retry reserves fresh instead of dying on replay of the
		// prior attempt's settled charges.
		attempt := 1
		if activity.IsActivity(ctx) {
			attempt = int(activity.GetInfo(ctx).Attempt)
		}
		llmClient = backgroundtaskruntime.NewGatewayLLM(a.LLM, task.Edges.User, model, in.Slug, in.RunID, attempt)
	}

	out, err := a.Runtime.Execute(ctx, backgroundtaskruntime.RunInput{
		UserID: in.UserID, TaskID: in.TaskID, Slug: in.Slug, RunID: in.RunID,
		TaskName:         task.Name,
		Trigger:          in.Trigger,
		RequestedContext: in.RequestedContext,
		Instructions:     task.Instructions,
		Model:            model,
		Provider:         task.Provider,
		Artifacts:        &artifactStore{a: a, task: task, runID: in.RunID},
		Events:           &eventSink{a: a, in: in, taskID: taskID},
		Controls:         newRunControlSource(a, run),
		Tools:            a.toolRegistry(ctx, task, run),
		LLM:              llmClient,
		Limits:           limits,
	})
	if err != nil {
		return RunOutput{}, mapRuntimeError(err)
	}
	return RunOutput{Summary: out.Summary}, nil
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
		// Guard the terminal transition: never overwrite a run the user already
		// stopped, and skip a run already marked succeeded. This makes the
		// activity idempotent under Temporal retry (a retry finds n==0 and does
		// NOT re-increment metrics or re-emit the completed event) and prevents a
		// late MarkRunDone from resurrecting a `stopped` run.
		Where(
			backgroundtaskrun.RunIDEQ(in.RunID),
			backgroundtaskrun.HasTaskWith(backgroundtask.IDEQ(taskID)),
			backgroundtaskrun.StatusNotIn("succeeded", "stopped"),
		).
		SetStatus("succeeded").
		SetTemporalStatus("Completed").
		SetTemporalClosedAt(now).
		SetCompletedAt(now).
		SetLastHeartbeatAt(now).
		SetProgressPercent(100).
		SetProgressMessage("Completed.").
		SetSummary(in.Summary).
		ClearError().
		ClearErrorCode().
		ClearErrorDetails().
		AddRevision(1).
		Save(ctx)
	if err != nil {
		return err
	}
	if n == 0 {
		// Already terminal (idempotent retry) or stopped (user cancel) → succeed
		// without double-counting; only a genuinely missing run is an error.
		run, qerr := a.Client.BackgroundTaskRun.Query().
			Where(backgroundtaskrun.RunIDEQ(in.RunID), backgroundtaskrun.HasTaskWith(backgroundtask.IDEQ(taskID))).
			Only(ctx)
		if qerr != nil {
			if ent.IsNotFound(qerr) {
				return fmt.Errorf("background task run %s not found", in.RunID)
			}
			return qerr
		}
		// If the FIRST attempt updated the status but failed on the event append,
		// this retry must still deliver the terminal event (skip for stopped runs,
		// which never completed).
		if run.Status == "succeeded" {
			return a.appendEventIfMissing(ctx, in.StartInput, EventCompleted, map[string]any{
				"type":     EventCompleted,
				"message":  "Completed.",
				"progress": 100,
				"summary":  in.Summary,
			})
		}
		return nil
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
	if !IsKnownErrorCode(code) {
		// Guard the Prometheus label below: an unknown/empty code would otherwise
		// add unbounded cardinality to cloud_runs_failed_total.
		code = ErrCodeActivityFailed
	}
	details := in.ErrorDetails
	if details == "" {
		details = in.Error
	}
	n, err := a.Client.BackgroundTaskRun.Update().
		// Guard the terminal transition: don't override a succeeded/stopped run,
		// and don't re-fail an already-failed run. This makes the activity
		// idempotent under retry (n==0 → no double Failed metric / duplicate
		// failed event). A failed run that the worker later self-heals is set
		// back to "running" by MarkRunRunning first, so a genuine re-failure still
		// passes this guard.
		Where(
			backgroundtaskrun.RunIDEQ(in.RunID),
			backgroundtaskrun.HasTaskWith(backgroundtask.IDEQ(taskID)),
			backgroundtaskrun.StatusNotIn("succeeded", "stopped", "failed"),
		).
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
		// Already terminal (idempotent retry) or stopped → succeed without
		// double-counting; only a genuinely missing run is an error.
		run, qerr := a.Client.BackgroundTaskRun.Query().
			Where(backgroundtaskrun.RunIDEQ(in.RunID), backgroundtaskrun.HasTaskWith(backgroundtask.IDEQ(taskID))).
			Only(ctx)
		if qerr != nil {
			if ent.IsNotFound(qerr) {
				return fmt.Errorf("background task run %s not found", in.RunID)
			}
			return qerr
		}
		// Deliver the terminal event the first attempt may have failed to append
		// (see MarkRunDone's retry path for rationale).
		if run.Status == "failed" {
			return a.appendEventIfMissing(ctx, in.StartInput, EventFailed, map[string]any{
				"type":      EventFailed,
				"message":   "Failed.",
				"error":     in.Error,
				"errorCode": code,
			})
		}
		return nil
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

func (a *Activities) upsertArtifact(ctx context.Context, task *ent.BackgroundTask, runID, body, contentType string) error {
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
			SetContentType(contentType).
			Exec(ctx)
	}
	return a.Client.BackgroundTaskArtifact.UpdateOneID(artifact.ID).
		SetBody(body).
		SetUpdatedByRunID(runID).
		SetContentType(contentType).
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
	raw, err := json.Marshal(event)
	if err != nil {
		return err
	}
	// Seq assignment is a non-transactional read-max-then-insert against the
	// unique (run, seq) index, so a concurrent writer (HTTP system event, a
	// peer activity) can claim the same seq. Re-read and retry on the
	// constraint collision instead of dropping the event.
	for attempt := 0; ; attempt++ {
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
		err = a.Client.BackgroundTaskRunEvent.Create().
			SetUserID(userID).
			SetTask(task).
			SetRun(run).
			SetSeq(seq).
			SetEventType(eventType).
			SetEventJSON(string(raw)).
			Exec(ctx)
		if err == nil || !ent.IsConstraintError(err) || attempt >= 3 {
			return err
		}
	}
}

// appendEventIfMissing appends a terminal lifecycle event only when no event of
// that type exists for the run yet. Used on the idempotent-retry path of
// MarkRunDone/MarkRunFailed: when the FIRST attempt updated the status but
// failed appending the event, the retry takes the n==0 early-return and would
// otherwise never re-attempt it, leaving the terminal event permanently missing
// from the stream the desktop polls.
func (a *Activities) appendEventIfMissing(ctx context.Context, in StartInput, eventType string, event map[string]any) error {
	taskID, err := uuid.Parse(in.TaskID)
	if err != nil {
		return err
	}
	exists, err := a.Client.BackgroundTaskRunEvent.Query().
		Where(
			backgroundtaskrunevent.EventTypeEQ(eventType),
			backgroundtaskrunevent.HasRunWith(
				backgroundtaskrun.RunIDEQ(in.RunID),
				backgroundtaskrun.HasTaskWith(backgroundtask.IDEQ(taskID)),
			),
		).
		Exist(ctx)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}
	return a.appendEvent(ctx, in, eventType, event)
}

// buildSummary/buildArtifact/truncate moved verbatim to
// backgroundtaskruntime.NoopRuntime (the deterministic rollback path).
