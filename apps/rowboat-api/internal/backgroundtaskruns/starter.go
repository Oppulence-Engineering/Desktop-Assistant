// Package backgroundtaskruns owns the single canonical way an executor=api
// background-task run is created.
//
// The sequence — create a queued run with a precomputed Temporal workflow id,
// append the queued lifecycle event, start the Temporal workflow, persist the
// returned Temporal ids, and count the trigger metric — used to live inline in
// the HTTP handler (handler.triggerAPIRun / startRetryRun). It is extracted
// here so the HTTP API, the cloud scheduler (RFC 001), and the event router
// (RFC 003) all create runs through one code path. A second insert path would
// drift the assumptions baked into viewRun, the desktop transcript poller, the
// temporal_workflow_id index, and every cloud_runs_* metric series.
//
// This package deliberately does NOT import internal/backgroundtasks (the HTTP
// handler package): the Starter takes the resolved user and task as inputs and
// has no request/response concerns, so a background process can reuse it
// without dragging in HTTP coupling.
package backgroundtaskruns

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskmetrics"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskworkflow"
	"github.com/google/uuid"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

// Source identifies what initiated a run. It is recorded on the queued event so
// HTTP-, scheduler-, and event-initiated runs are distinguishable in the event
// log even though they are otherwise byte-identical downstream.
type Source string

const (
	// SourceHTTP is a run created by an authenticated HTTP trigger/retry.
	SourceHTTP Source = "http"
	// SourceScheduler is a run created by the cloud scheduler loop (RFC 001).
	SourceScheduler Source = "scheduler"
	// SourceEvent is a run created by the cloud event router (RFC 003).
	SourceEvent Source = "event"
)

// ErrTemporalNotConfigured is returned by Start when no Temporal controller is
// wired. The HTTP handler maps it to 503 (service unavailable).
var ErrTemporalNotConfigured = errors.New("temporal is not configured")

// InvalidParamsError indicates the run could not be created because of invalid
// input (e.g. an unknown trigger). The HTTP handler maps it to 400.
type InvalidParamsError struct{ Message string }

func (e *InvalidParamsError) Error() string { return e.Message }

// StartFailedError wraps a Temporal start failure that occurred AFTER the run
// row was created and marked failed. The HTTP handler maps it to 502. Callers
// that need the run row (to render it) get it back from Start alongside the
// error.
type StartFailedError struct{ Err error }

func (e *StartFailedError) Error() string { return e.Err.Error() }
func (e *StartFailedError) Unwrap() error { return e.Err }

// PersistIDsError wraps a failure to persist the Temporal ids AFTER the workflow
// was already started — a partial-success state (the workflow is live but the
// run row still reads queued/Starting). The HTTP handler maps it to 500 with a
// message distinct from a generic trigger failure so the state is triageable.
type PersistIDsError struct{ Err error }

func (e *PersistIDsError) Error() string { return e.Err.Error() }
func (e *PersistIDsError) Unwrap() error { return e.Err }

// Starter creates executor=api runs and launches their Temporal workflows.
type Starter struct {
	Client    *ent.Client
	Temporal  backgroundtaskworkflow.Controller
	Log       *zap.Logger
	Admission AdmissionConfig
}

// New builds a Starter. Temporal may be nil; Start then returns
// ErrTemporalNotConfigured, matching the HTTP handler's pre-extraction guard.
func New(client *ent.Client, temporal backgroundtaskworkflow.Controller, log *zap.Logger) *Starter {
	if log == nil {
		log = zap.NewNop()
	}
	return &Starter{Client: client, Temporal: temporal, Log: log}
}

// Params is the input to Start. User and Task are required; the rest mirror the
// optional shapes the HTTP handler already supports (manual trigger and retry).
type Params struct {
	User             *ent.User
	Task             *ent.BackgroundTask
	Trigger          string // manual | cron | window | event | retry
	RequestedContext string
	RunIDPrefix      string // "api-trigger-", "sched-cron-", "sched-window-", "event-", "retry-"
	QueuedMessage    string // run.progress_message on create; defaults to "Queued for API worker."
	Source           Source // who initiated the run; defaults to SourceHTTP

	// Retry lineage (set only on the retry path).
	PreviousRunID string
	RetryOfRunID  string
	Attempt       *int

	// CloudEventID links an event-triggered run back to the CloudEvent that
	// fired it (RFC 003). Set only by the cloud event router.
	CloudEventID *uuid.UUID
}

// Start performs the canonical queued-run → queued-event → Temporal-start →
// persist-ids → metric sequence and returns the freshly created run.
//
// It mirrors handler.triggerAPIRun / startRetryRun exactly: on a Temporal start
// failure it marks the run failed with ErrCodeTemporalStartFailed (and returns
// the failed run plus a *StartFailedError); on success it stores the Temporal
// ids, increments cloud_runs_triggered_total{trigger}, and logs the same field
// set the HTTP handler used.
func (s *Starter) Start(ctx context.Context, p Params) (*ent.BackgroundTaskRun, error) {
	if s.Temporal == nil {
		return nil, ErrTemporalNotConfigured
	}
	if p.User == nil || p.Task == nil {
		return nil, &InvalidParamsError{Message: "user and task are required"}
	}
	trigger := p.Trigger
	if trigger == "" {
		trigger = "manual"
	}
	if err := validateRunTrigger(trigger); err != nil {
		return nil, err
	}
	if p.Attempt != nil && *p.Attempt < 1 {
		return nil, &InvalidParamsError{Message: "attempt must be >= 1"}
	}
	isRetry := p.RetryOfRunID != ""
	queuedMessage := p.QueuedMessage
	if queuedMessage == "" {
		queuedMessage = "Queued for API worker."
	}
	source := p.sourceOrDefault()
	priorityKey := PriorityFor(trigger, source)

	runID := p.RunIDPrefix + uuid.NewString()
	workflowID := backgroundtaskworkflow.WorkflowID(p.User.ID.String(), p.Task.Slug, runID)

	if rejected, err := s.checkAdmission(ctx, p); err != nil {
		return nil, err
	} else if rejected != nil {
		run, err := s.createDeadLetterRun(ctx, p, runID, trigger, rejected, priorityKey)
		if err != nil {
			return nil, err
		}
		return run, rejected
	}

	run, err := s.createQueuedRun(ctx, p, runID, workflowID, trigger, queuedMessage)
	if err != nil {
		return nil, err
	}

	if err := s.appendQueuedEvent(ctx, p, run, trigger, isRetry); err != nil {
		// Non-fatal — the run is already persisted and the worker will append
		// its own running event. Matches the HTTP handler, which ignored this
		// error (`_ = h.appendSystemEvent(...)`).
		s.Log.Warn("append queued event failed", zap.String("runId", runID), zap.Error(err))
	}

	start, err := s.Temporal.StartBackgroundTaskRun(ctx, backgroundtaskworkflow.StartInput{
		UserID:           p.User.ID.String(),
		TaskID:           p.Task.ID.String(),
		Slug:             p.Task.Slug,
		RunID:            runID,
		Trigger:          trigger,
		RequestedContext: p.RequestedContext,
		PriorityKey:      priorityKey,
	})
	if err != nil {
		return s.markStartFailed(ctx, run, err, isRetry), &StartFailedError{Err: err}
	}

	updated, err := s.Client.BackgroundTaskRun.UpdateOneID(run.ID).
		SetTemporalWorkflowID(start.WorkflowID).
		SetTemporalRunID(start.RunID).
		SetTemporalStatus("Started").
		AddRevision(1).
		Save(auth.WithInternal(ctx))
	if err != nil {
		return run, &PersistIDsError{Err: fmt.Errorf("store temporal workflow ids: %w", err)}
	}

	backgroundtaskmetrics.Triggered.WithLabelValues(trigger).Inc()
	logMessage := "cloud run triggered"
	if isRetry {
		backgroundtaskmetrics.Retried.Inc()
		logMessage = "cloud run retry triggered"
	}
	s.Log.Info(logMessage, runLogFields(ctx, p, updated)...)
	return updated, nil
}

// createQueuedRun inserts the queued executor=api row with the precomputed
// workflow id so viewRun shows it immediately, mirroring handler.createRun's
// api-trigger shape (status=queued, temporal_status=Starting, progress=0).
func (s *Starter) createQueuedRun(ctx context.Context, p Params, runID, workflowID, trigger, queuedMessage string) (*ent.BackgroundTaskRun, error) {
	create := s.Client.BackgroundTaskRun.Create().
		SetUser(p.User).
		SetTask(p.Task).
		SetRunID(runID).
		SetTrigger(trigger).
		SetStatus("queued").
		SetExecutor("api").
		SetTemporalWorkflowID(workflowID).
		SetTemporalStatus("Starting").
		SetProgressPercent(0).
		SetProgressMessage(queuedMessage)
	if p.RequestedContext != "" {
		create = create.SetRequestedContext(p.RequestedContext)
	}
	if p.PreviousRunID != "" {
		create = create.SetPreviousRunID(p.PreviousRunID)
	}
	if p.RetryOfRunID != "" {
		create = create.SetRetryOfRunID(p.RetryOfRunID)
	}
	if p.Attempt != nil {
		create = create.SetAttempt(*p.Attempt)
	}
	if p.CloudEventID != nil {
		create = create.SetCloudEventID(*p.CloudEventID)
	}
	return create.Save(ctx)
}

// appendQueuedEvent appends the queued (or retry-requested) lifecycle event.
// Unlike the HTTP handler's appendSystemEvent, it takes the user from Params
// rather than the context, so it also works for the scheduler's internal
// context, which carries no user.
//
// This event is always the FIRST event on a freshly created run, so its seq is
// 0 — there is no prior event to query for. Inserting at seq 0 directly avoids
// the read-then-write max-seq query (an N+1 and a race) on the run-start path.
func (s *Starter) appendQueuedEvent(ctx context.Context, p Params, run *ent.BackgroundTaskRun, trigger string, isRetry bool) error {
	if p.User == nil {
		return errors.New("backgroundtaskruns: append event requires a user")
	}
	eventType := backgroundtaskworkflow.EventQueued
	event := map[string]any{
		"type":        backgroundtaskworkflow.EventQueued,
		"message":     run.ProgressMessage,
		"trigger":     trigger,
		"runId":       run.RunID,
		"requestedBy": string(p.sourceOrDefault()),
		"priorityKey": PriorityFor(trigger, p.sourceOrDefault()),
	}
	if isRetry {
		eventType = backgroundtaskworkflow.EventRetryRequested
		event = map[string]any{
			"type":         backgroundtaskworkflow.EventRetryRequested,
			"message":      "Retry requested.",
			"retryOfRunId": p.RetryOfRunID,
			"attempt":      run.Attempt,
			"requestedBy":  string(p.sourceOrDefault()),
			"priorityKey":  PriorityFor(trigger, p.sourceOrDefault()),
		}
	}
	raw, err := json.Marshal(event)
	if err != nil {
		return err
	}
	return s.Client.BackgroundTaskRunEvent.Create().
		SetUser(p.User).
		SetTask(p.Task).
		SetRun(run).
		SetSeq(0).
		SetEventType(eventType).
		SetEventJSON(string(raw)).
		Exec(ctx)
}

// markStartFailed records a Temporal start failure on the run row exactly as the
// HTTP handler did: failed / StartFailed / temporal_start_failed, with the
// error captured and a terminal completed_at. The task's last_run_at is left
// untouched so the scheduler cycle stays unfired and retries next tick. The
// progress message preserves the retry-vs-initial distinction the inline
// handler used.
func (s *Starter) markStartFailed(ctx context.Context, run *ent.BackgroundTaskRun, startErr error, isRetry bool) *ent.BackgroundTaskRun {
	now := time.Now().UTC()
	progressMessage := "Temporal start failed."
	if isRetry {
		progressMessage = "Temporal retry start failed."
	}
	updated, err := s.Client.BackgroundTaskRun.UpdateOneID(run.ID).
		SetStatus("failed").
		SetTemporalStatus("StartFailed").
		SetTemporalClosedAt(now).
		SetCompletedAt(now).
		SetError(startErr.Error()).
		SetErrorCode(backgroundtaskworkflow.ErrCodeTemporalStartFailed).
		SetErrorDetails(startErr.Error()).
		SetProgressMessage(progressMessage).
		AddRevision(1).
		Save(auth.WithInternal(ctx))
	s.Log.Error("start temporal background task workflow", zap.String("runId", run.RunID), zap.Error(startErr))
	if err != nil {
		// The run is in a stale-but-queued state; surface the secondary error
		// in logs but return the pre-update row so the caller can still render.
		s.Log.Error("mark run start-failed", zap.String("runId", run.RunID), zap.Error(err))
		return run
	}
	return updated
}

func (p Params) sourceOrDefault() Source {
	if p.Source == "" {
		return SourceHTTP
	}
	return p.Source
}

// runLogFields returns the structured-logging field set for a cloud run start,
// matching handler.runLogFields. The user comes from Params (not the context)
// so scheduler-initiated runs log a userId too.
func runLogFields(ctx context.Context, p Params, run *ent.BackgroundTaskRun) []zap.Field {
	fields := []zap.Field{
		zap.String("runId", run.RunID),
		zap.String("taskSlug", p.Task.Slug),
		zap.String("trigger", run.Trigger),
		zap.String("status", run.Status),
		zap.String("executor", run.Executor),
	}
	if run.TemporalWorkflowID != "" {
		fields = append(fields, zap.String("workflowId", run.TemporalWorkflowID))
	}
	if run.TemporalRunID != "" {
		fields = append(fields, zap.String("temporalRunId", run.TemporalRunID))
	}
	if p.User != nil {
		fields = append(fields, zap.String("userId", p.User.ID.String()))
	}
	if p.CloudEventID != nil {
		fields = append(fields, zap.String("cloudEventId", p.CloudEventID.String()))
	}
	fields = append(fields, zap.String("requestedBy", string(p.sourceOrDefault())))
	fields = append(fields, zap.Int("priorityKey", PriorityFor(run.Trigger, p.sourceOrDefault())))
	if sc := trace.SpanContextFromContext(ctx); sc.HasTraceID() {
		fields = append(fields, zap.String("traceId", sc.TraceID().String()))
	}
	return fields
}

func validateRunTrigger(trigger string) error {
	switch trigger {
	case "manual", "cron", "window", "event", "retry":
		return nil
	default:
		return &InvalidParamsError{Message: "trigger must be one of manual, cron, window, event, retry"}
	}
}
