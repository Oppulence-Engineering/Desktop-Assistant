// Package backgroundtasks serves the cloud control plane mirror for desktop
// background tasks. The API stores server-readable task specs, task artifacts,
// run metadata, and run JSONL events; execution still happens in the desktop.
package backgroundtasks

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"

	entsql "entgo.io/ent/dialect/sql"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtask"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskartifact"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrun"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrunevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskschedulestate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskmetrics"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruns"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskschedule"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskworkflow"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

const maxBody = 8 << 20 // mirrored task/run payloads can include JSONL batches
const runEventStreamPage = 500

type badRequestError struct{ message string }

func (e badRequestError) Error() string { return e.message }

func badRequest(message string) error { return badRequestError{message: message} }

// Handler serves /v1/background-tasks.
type Handler struct {
	client     *ent.Client
	log        *zap.Logger
	temporal   backgroundtaskworkflow.Controller
	runStarter *backgroundtaskruns.Starter
	admission  backgroundtaskruns.AdmissionConfig
	schedules  *backgroundtaskschedule.Syncer // nil ⇒ Temporal Schedules disabled
}

// New builds a background task mirror handler. The run starter is created with
// no Temporal controller, so triggering an api-target task before SetTemporal
// returns 503 (temporal_unavailable) rather than panicking; SetTemporal swaps
// in a Temporal-backed starter.
func New(client *ent.Client, log *zap.Logger) *Handler {
	return &Handler{client: client, log: log, runStarter: backgroundtaskruns.New(client, nil, log)}
}

// SetTemporal enables API-native Temporal execution for api-target tasks. It
// also wires the shared run starter so HTTP- and scheduler-initiated runs go
// through one creation path (see internal/backgroundtaskruns).
func (h *Handler) SetTemporal(temporal backgroundtaskworkflow.Controller) {
	h.temporal = temporal
	h.runStarter = backgroundtaskruns.New(h.client, temporal, h.log)
	h.runStarter.SetAdmission(h.admission)
}

// SetAdmission enables run-start admission guardrails on the shared starter.
func (h *Handler) SetAdmission(cfg backgroundtaskruns.AdmissionConfig) {
	h.admission = cfg
	h.runStarter.SetAdmission(cfg)
}

// SetSchedules enables Temporal Schedule sync for cron tasks (RFC 005). Left
// nil, every task write skips schedule handling and schedule_sync_state stays
// at its schema default.
func (h *Handler) SetSchedules(s *backgroundtaskschedule.Syncer) {
	h.schedules = s
}

type taskView struct {
	ID              string          `json:"id"`
	Slug            string          `json:"slug"`
	Name            string          `json:"name"`
	Instructions    string          `json:"instructions"`
	Active          bool            `json:"active"`
	Triggers        json.RawMessage `json:"triggers,omitempty"`
	Model           string          `json:"model,omitempty"`
	Provider        string          `json:"provider,omitempty"`
	ExecutionTarget string          `json:"executionTarget"`
	CreatedAt       string          `json:"createdAt"`
	UpdatedAt       string          `json:"updatedAt"`
	LastAttemptAt   *string         `json:"lastAttemptAt,omitempty"`
	LastRunID       string          `json:"lastRunId,omitempty"`
	LastRunAt       *string         `json:"lastRunAt,omitempty"`
	LastRunSummary  string          `json:"lastRunSummary,omitempty"`
	LastRunError    string          `json:"lastRunError,omitempty"`
	// Temporal Schedule sync health (RFC 005). Server-owned: absent from the
	// create/patch request types so user writes can never force "current".
	ScheduleSyncState string  `json:"scheduleSyncState"`
	ScheduleSyncError string  `json:"scheduleSyncError,omitempty"`
	ScheduleSyncedAt  *string `json:"scheduleSyncedAt,omitempty"`
	Revision          int     `json:"revision"`
}

type artifactView struct {
	Slug           string `json:"slug"`
	Body           string `json:"body"`
	Revision       int    `json:"revision"`
	UpdatedAt      string `json:"updatedAt"`
	UpdatedByRunID string `json:"updatedByRunId,omitempty"`
	ContentType    string `json:"contentType,omitempty"`
}

type runView struct {
	ID                 string  `json:"id"`
	RunID              string  `json:"runId"`
	PreviousRunID      string  `json:"previousRunId,omitempty"`
	RetryOfRunID       string  `json:"retryOfRunId,omitempty"`
	LocalRunID         string  `json:"localRunId,omitempty"`
	Slug               string  `json:"slug"`
	Trigger            string  `json:"trigger"`
	Status             string  `json:"status"`
	Executor           string  `json:"executor"`
	Attempt            int     `json:"attempt"`
	Model              string  `json:"model,omitempty"`
	Provider           string  `json:"provider,omitempty"`
	UseCase            string  `json:"useCase,omitempty"`
	SubUseCase         string  `json:"subUseCase,omitempty"`
	RequestedContext   string  `json:"requestedContext,omitempty"`
	Summary            string  `json:"summary,omitempty"`
	Error              string  `json:"error,omitempty"`
	ErrorCode          string  `json:"errorCode,omitempty"`
	ErrorDetails       string  `json:"errorDetails,omitempty"`
	TemporalWorkflowID string  `json:"temporalWorkflowId,omitempty"`
	TemporalRunID      string  `json:"temporalRunId,omitempty"`
	TemporalStatus     string  `json:"temporalStatus,omitempty"`
	TemporalStartedAt  *string `json:"temporalStartedAt,omitempty"`
	TemporalClosedAt   *string `json:"temporalClosedAt,omitempty"`
	CancelRequestedAt  *string `json:"cancelRequestedAt,omitempty"`
	ProgressPercent    *int    `json:"progressPercent,omitempty"`
	ProgressMessage    string  `json:"progressMessage,omitempty"`
	LastHeartbeatAt    *string `json:"lastHeartbeatAt,omitempty"`
	StartedAt          *string `json:"startedAt,omitempty"`
	CompletedAt        *string `json:"completedAt,omitempty"`
	CreatedAt          string  `json:"createdAt"`
	UpdatedAt          string  `json:"updatedAt"`
	Revision           int     `json:"revision"`
	// SourceEvent is the originating cloud event (RFC 003 linkage), attached
	// only on the single-run GET — safe display fields only, never the
	// payload/routing internals.
	SourceEvent *sourceEventView `json:"sourceEvent,omitempty"`
}

type sourceEventView struct {
	ID         string  `json:"id"`
	Source     string  `json:"source"`
	EventType  string  `json:"eventType,omitempty"`
	Subject    string  `json:"subject,omitempty"`
	OccurredAt *string `json:"occurredAt,omitempty"`
}

type runStatusView struct {
	RunID              string  `json:"runId"`
	Slug               string  `json:"slug"`
	Status             string  `json:"status"`
	Executor           string  `json:"executor"`
	Attempt            int     `json:"attempt"`
	TemporalWorkflowID string  `json:"temporalWorkflowId,omitempty"`
	TemporalRunID      string  `json:"temporalRunId,omitempty"`
	TemporalStatus     string  `json:"temporalStatus,omitempty"`
	ProgressPercent    *int    `json:"progressPercent,omitempty"`
	ProgressMessage    string  `json:"progressMessage,omitempty"`
	LastHeartbeatAt    *string `json:"lastHeartbeatAt,omitempty"`
	StartedAt          *string `json:"startedAt,omitempty"`
	CompletedAt        *string `json:"completedAt,omitempty"`
	CancelRequestedAt  *string `json:"cancelRequestedAt,omitempty"`
	Error              string  `json:"error,omitempty"`
	ErrorCode          string  `json:"errorCode,omitempty"`
	ErrorDetails       string  `json:"errorDetails,omitempty"`
	Revision           int     `json:"revision"`
}

type eventView struct {
	ID         string          `json:"id"`
	Seq        int             `json:"seq"`
	Type       string          `json:"type,omitempty"`
	Event      json.RawMessage `json:"event"`
	ReceivedAt string          `json:"receivedAt"`
}

type createTaskRequest struct {
	Slug            string          `json:"slug"`
	Name            string          `json:"name"`
	Instructions    string          `json:"instructions"`
	Active          *bool           `json:"active"`
	Triggers        json.RawMessage `json:"triggers"`
	Model           string          `json:"model"`
	Provider        string          `json:"provider"`
	ExecutionTarget string          `json:"executionTarget"`
	CreatedAt       string          `json:"createdAt"`
	LastAttemptAt   string          `json:"lastAttemptAt"`
	LastRunID       string          `json:"lastRunId"`
	LastRunAt       string          `json:"lastRunAt"`
	LastRunSummary  string          `json:"lastRunSummary"`
	LastRunError    string          `json:"lastRunError"`
}

type patchTaskRequest struct {
	Revision        *int            `json:"revision"`
	Name            *string         `json:"name"`
	Instructions    *string         `json:"instructions"`
	Active          *bool           `json:"active"`
	Triggers        json.RawMessage `json:"triggers"`
	Model           *string         `json:"model"`
	Provider        *string         `json:"provider"`
	ExecutionTarget *string         `json:"executionTarget"`
	CreatedAt       *string         `json:"createdAt"`
	LastAttemptAt   *string         `json:"lastAttemptAt"`
	LastRunID       *string         `json:"lastRunId"`
	LastRunAt       *string         `json:"lastRunAt"`
	LastRunSummary  *string         `json:"lastRunSummary"`
	LastRunError    *string         `json:"lastRunError"`
}

type putArtifactRequest struct {
	Revision    *int   `json:"revision"`
	Body        string `json:"body"`
	ContentType string `json:"contentType"`
}

type createRunRequest struct {
	RunID              string `json:"runId"`
	PreviousRunID      string `json:"previousRunId"`
	RetryOfRunID       string `json:"retryOfRunId"`
	LocalRunID         string `json:"localRunId"`
	Trigger            string `json:"trigger"`
	Status             string `json:"status"`
	Executor           string `json:"executor"`
	Attempt            *int   `json:"attempt"`
	Model              string `json:"model"`
	Provider           string `json:"provider"`
	UseCase            string `json:"useCase"`
	SubUseCase         string `json:"subUseCase"`
	RequestedContext   string `json:"requestedContext"`
	Summary            string `json:"summary"`
	Error              string `json:"error"`
	ErrorCode          string `json:"errorCode"`
	ErrorDetails       string `json:"errorDetails"`
	TemporalWorkflowID string `json:"temporalWorkflowId"`
	TemporalRunID      string `json:"temporalRunId"`
	TemporalStatus     string `json:"temporalStatus"`
	TemporalStartedAt  string `json:"temporalStartedAt"`
	TemporalClosedAt   string `json:"temporalClosedAt"`
	CancelRequestedAt  string `json:"cancelRequestedAt"`
	ProgressPercent    *int   `json:"progressPercent"`
	ProgressMessage    string `json:"progressMessage"`
	LastHeartbeatAt    string `json:"lastHeartbeatAt"`
	StartedAt          string `json:"startedAt"`
	CompletedAt        string `json:"completedAt"`
}

type patchRunRequest struct {
	Revision           *int    `json:"revision"`
	PreviousRunID      *string `json:"previousRunId"`
	RetryOfRunID       *string `json:"retryOfRunId"`
	LocalRunID         *string `json:"localRunId"`
	Trigger            *string `json:"trigger"`
	Status             *string `json:"status"`
	Executor           *string `json:"executor"`
	Attempt            *int    `json:"attempt"`
	Model              *string `json:"model"`
	Provider           *string `json:"provider"`
	UseCase            *string `json:"useCase"`
	SubUseCase         *string `json:"subUseCase"`
	RequestedContext   *string `json:"requestedContext"`
	Summary            *string `json:"summary"`
	Error              *string `json:"error"`
	ErrorCode          *string `json:"errorCode"`
	ErrorDetails       *string `json:"errorDetails"`
	TemporalWorkflowID *string `json:"temporalWorkflowId"`
	TemporalRunID      *string `json:"temporalRunId"`
	TemporalStatus     *string `json:"temporalStatus"`
	TemporalStartedAt  *string `json:"temporalStartedAt"`
	TemporalClosedAt   *string `json:"temporalClosedAt"`
	CancelRequestedAt  *string `json:"cancelRequestedAt"`
	ProgressPercent    *int    `json:"progressPercent"`
	ProgressMessage    *string `json:"progressMessage"`
	LastHeartbeatAt    *string `json:"lastHeartbeatAt"`
	StartedAt          *string `json:"startedAt"`
	CompletedAt        *string `json:"completedAt"`
}

type triggerRequest struct {
	Trigger string `json:"trigger"`
	Context string `json:"context"`
}

type signalRunRequest struct {
	Signal  string         `json:"signal"`
	Payload map[string]any `json:"payload"`
}

type runEventInput struct {
	Seq   int             `json:"seq"`
	Type  string          `json:"type"`
	Event json.RawMessage `json:"event"`
}

type appendEventsRequest struct {
	Events []runEventInput `json:"events"`
}

// List handles GET /v1/background-tasks.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserFromCtx(r.Context()); !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	tasks, err := h.client.BackgroundTask.Query().
		Order(backgroundtask.BySlug()).
		All(r.Context())
	if err != nil {
		h.log.Error("list background tasks", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not list background tasks", "internal_error")
		return
	}
	views := make([]taskView, 0, len(tasks))
	for _, t := range tasks {
		views = append(views, viewTask(t))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"tasks": views})
}

// Create handles POST /v1/background-tasks.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	var req createTaskRequest
	if !readJSON(w, r, &req) {
		return
	}
	task, err := h.createTaskFromRequest(r.Context(), u, req)
	if err != nil {
		h.writeTaskCreateError(w, err, "create background task")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, viewTask(task))
}

func (h *Handler) createTaskFromRequest(ctx context.Context, u *ent.User, req createTaskRequest) (*ent.BackgroundTask, error) {
	req.Name = strings.TrimSpace(req.Name)
	req.Instructions = strings.TrimSpace(req.Instructions)
	if req.Name == "" || req.Instructions == "" {
		return nil, badRequest("missing name or instructions")
	}
	slug := strings.TrimSpace(req.Slug)
	if slug == "" {
		slug = slugify(req.Name)
	}
	if slug == "" {
		return nil, badRequest("missing slug")
	}
	if strings.Contains(slug, "/") {
		// Slugs are path segments in the REST routes and embed verbatim into
		// the Temporal schedule/workflow id format
		// background-task-schedule/{userID}/{slug}/cron — a slash would make
		// those ids unparseable for the reconciler's orphan sweep.
		return nil, badRequest("slug must not contain '/'")
	}
	active := true
	if req.Active != nil {
		active = *req.Active
	}
	create := h.client.BackgroundTask.Create().
		SetUser(u).
		SetSlug(slug).
		SetName(req.Name).
		SetInstructions(req.Instructions).
		SetActive(active)
	if raw, present, clearValue, err := normalizeRawJSON(req.Triggers); err != nil {
		return nil, badRequest("triggers must be valid JSON")
	} else if present && !clearValue {
		create = create.SetTriggersJSON(raw)
	}
	if req.Model != "" {
		create = create.SetModel(req.Model)
	}
	if req.Provider != "" {
		create = create.SetProvider(req.Provider)
	}
	executionTarget := req.ExecutionTarget
	if executionTarget == "" {
		executionTarget = "desktop"
	}
	if err := validateExecutionTarget(executionTarget); err != nil {
		return nil, badRequest(err.Error())
	}
	create = create.SetExecutionTarget(executionTarget)
	if ts, ok, err := parseOptionalTime(req.CreatedAt); err != nil {
		return nil, badRequest("invalid createdAt")
	} else if ok {
		create = create.SetTaskCreatedAt(ts)
	}
	if err := applyCreateRuntimeFields(create, req); err != nil {
		return nil, err
	}

	task, err := create.Save(ctx)
	if err != nil {
		return nil, err
	}
	if h.schedules != nil {
		// Converge the Temporal Schedule (RFC 005) and respond with the
		// post-sync state + revision. Never fails the request.
		task = h.schedules.AfterWrite(ctx, u.ID.String(), nil, task)
	}
	return task, nil
}

func (h *Handler) writeTaskCreateError(w http.ResponseWriter, err error, logMsg string) {
	var bad badRequestError
	if errors.As(err, &bad) {
		httpx.Error(w, http.StatusBadRequest, bad.Error(), "bad_request")
		return
	}
	if ent.IsConstraintError(err) {
		httpx.Error(w, http.StatusConflict, "background task already exists", "conflict")
		return
	}
	h.log.Error(logMsg, zap.Error(err))
	httpx.Error(w, http.StatusInternalServerError, "could not create background task", "internal_error")
}

// Get handles GET /v1/background-tasks/{slug}.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	task, ok := h.lookupTask(w, r)
	if !ok {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, viewTask(task))
}

// Patch handles PATCH /v1/background-tasks/{slug}.
func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	task, ok := h.lookupTask(w, r)
	if !ok {
		return
	}
	var req patchTaskRequest
	if !readJSON(w, r, &req) {
		return
	}
	if req.Revision == nil {
		httpx.Error(w, http.StatusBadRequest, "missing revision", "bad_request")
		return
	}
	update := h.client.BackgroundTask.Update().
		Where(backgroundtask.IDEQ(task.ID), backgroundtask.RevisionEQ(*req.Revision)).
		AddRevision(1)
	if req.Name != nil {
		if strings.TrimSpace(*req.Name) == "" {
			httpx.Error(w, http.StatusBadRequest, "name cannot be empty", "bad_request")
			return
		}
		update = update.SetName(strings.TrimSpace(*req.Name))
	}
	if req.Instructions != nil {
		if strings.TrimSpace(*req.Instructions) == "" {
			httpx.Error(w, http.StatusBadRequest, "instructions cannot be empty", "bad_request")
			return
		}
		update = update.SetInstructions(strings.TrimSpace(*req.Instructions))
	}
	if req.Active != nil {
		update = update.SetActive(*req.Active)
	}
	if raw, present, clearValue, err := normalizeRawJSON(req.Triggers); err != nil {
		httpx.Error(w, http.StatusBadRequest, "triggers must be valid JSON", "bad_request")
		return
	} else if present && clearValue {
		update = update.ClearTriggersJSON()
	} else if present {
		update = update.SetTriggersJSON(raw)
	}
	if req.Model != nil {
		update = update.SetModel(*req.Model)
	}
	if req.Provider != nil {
		update = update.SetProvider(*req.Provider)
	}
	if req.ExecutionTarget != nil {
		if err := validateExecutionTarget(*req.ExecutionTarget); err != nil {
			httpx.Error(w, http.StatusBadRequest, err.Error(), "bad_request")
			return
		}
		update = update.SetExecutionTarget(*req.ExecutionTarget)
	}
	if err := applyPatchRuntimeFields(update, req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "bad_request")
		return
	}
	n, err := update.Save(r.Context())
	if err != nil {
		h.log.Error("patch background task", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not patch background task", "internal_error")
		return
	}
	if n == 0 {
		h.conflict(w, task.Revision)
		return
	}
	prev := task
	task, err = h.client.BackgroundTask.Query().Where(backgroundtask.IDEQ(task.ID)).Only(r.Context())
	if err != nil {
		h.log.Error("reload background task after patch", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not load updated task", "internal_error")
		return
	}
	if h.schedules != nil {
		if u, ok := auth.UserFromCtx(r.Context()); ok {
			// Converge the Temporal Schedule (RFC 005) for whatever this patch
			// changed (cron/active/target) and respond with the post-sync
			// state + revision. The pre-patch row lets unrelated patches skip
			// the Temporal round-trip entirely. Never fails the request.
			task = h.schedules.AfterWrite(r.Context(), u.ID.String(), prev, task)
		}
	}
	httpx.WriteJSON(w, http.StatusOK, viewTask(task))
}

// Delete handles DELETE /v1/background-tasks/{slug}?revision=N.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	task, ok := h.lookupTask(w, r)
	if !ok {
		return
	}
	revision, ok := revisionQuery(w, r)
	if !ok {
		return
	}
	tx, err := h.client.Tx(r.Context())
	if err != nil {
		h.log.Error("start background task delete transaction", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not delete background task", "internal_error")
		return
	}
	current, err := tx.BackgroundTask.Query().
		Where(backgroundtask.IDEQ(task.ID)).
		Only(r.Context())
	if err != nil {
		_ = tx.Rollback()
		if ent.IsNotFound(err) {
			httpx.Error(w, http.StatusNotFound, "background task not found", "not_found")
			return
		}
		h.log.Error("load background task for delete", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not delete background task", "internal_error")
		return
	}
	if current.Revision != revision {
		_ = tx.Rollback()
		h.conflict(w, current.Revision)
		return
	}
	if _, err := tx.BackgroundTaskRunEvent.Delete().
		Where(backgroundtaskrunevent.HasTaskWith(backgroundtask.IDEQ(task.ID))).
		Exec(r.Context()); err != nil {
		_ = tx.Rollback()
		h.log.Error("delete background task events", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not delete background task", "internal_error")
		return
	}
	if _, err := tx.BackgroundTaskRun.Delete().
		Where(backgroundtaskrun.HasTaskWith(backgroundtask.IDEQ(task.ID))).
		Exec(r.Context()); err != nil {
		_ = tx.Rollback()
		h.log.Error("delete background task runs", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not delete background task", "internal_error")
		return
	}
	if _, err := tx.BackgroundTaskArtifact.Delete().
		Where(backgroundtaskartifact.HasTaskWith(backgroundtask.IDEQ(task.ID))).
		Exec(r.Context()); err != nil {
		_ = tx.Rollback()
		h.log.Error("delete background task artifact", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not delete background task", "internal_error")
		return
	}
	// Schedule-state rows FK the task with ON DELETE NO ACTION (RFC 002), so
	// they must be removed inside this transaction before the task delete.
	if _, err := tx.BackgroundTaskScheduleState.Delete().
		Where(backgroundtaskschedulestate.HasTaskWith(backgroundtask.IDEQ(task.ID))).
		Exec(r.Context()); err != nil {
		_ = tx.Rollback()
		h.log.Error("delete background task schedule states", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not delete background task", "internal_error")
		return
	}
	n, err := tx.BackgroundTask.Delete().
		Where(backgroundtask.IDEQ(task.ID), backgroundtask.RevisionEQ(revision)).
		Exec(r.Context())
	if err != nil {
		_ = tx.Rollback()
		h.log.Error("delete background task", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not delete background task", "internal_error")
		return
	}
	if n == 0 {
		_ = tx.Rollback()
		h.conflict(w, current.Revision)
		return
	}
	if err := tx.Commit(); err != nil {
		h.log.Error("commit background task delete", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not delete background task", "internal_error")
		return
	}
	if h.schedules != nil {
		if u, ok := auth.UserFromCtx(r.Context()); ok {
			// Remove the Temporal Schedule only AFTER the commit: deleting it
			// earlier would strand a stale-revision (409) delete with no
			// schedule but state=current, silencing the cron until the
			// reconciler repairs it. Post-commit, a fire in the gap skips
			// safely (the task row is gone) and a failed delete is just an
			// orphan for the reconciler's sweep.
			h.schedules.AfterDelete(r.Context(), u.ID.String(), task)
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetArtifact handles GET /v1/background-tasks/{slug}/artifact.
func (h *Handler) GetArtifact(w http.ResponseWriter, r *http.Request) {
	task, ok := h.lookupTask(w, r)
	if !ok {
		return
	}
	artifact, err := h.client.BackgroundTaskArtifact.Query().
		Where(backgroundtaskartifact.HasTaskWith(backgroundtask.IDEQ(task.ID))).
		Only(r.Context())
	if err != nil {
		if ent.IsNotFound(err) {
			httpx.WriteJSON(w, http.StatusOK, artifactView{
				Slug:      task.Slug,
				Body:      "",
				Revision:  0,
				UpdatedAt: task.UpdatedAt.UTC().Format(time.RFC3339),
			})
			return
		}
		h.log.Error("get background task artifact", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not load artifact", "internal_error")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, viewArtifact(task, artifact))
}

// PutArtifact handles PUT /v1/background-tasks/{slug}/artifact.
func (h *Handler) PutArtifact(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	task, ok := h.lookupTask(w, r)
	if !ok {
		return
	}
	var req putArtifactRequest
	if !readJSON(w, r, &req) {
		return
	}
	artifact, err := h.client.BackgroundTaskArtifact.Query().
		Where(backgroundtaskartifact.HasTaskWith(backgroundtask.IDEQ(task.ID))).
		Only(r.Context())
	if err != nil && !ent.IsNotFound(err) {
		h.log.Error("load background task artifact", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not load artifact", "internal_error")
		return
	}
	if ent.IsNotFound(err) {
		if req.Revision != nil && *req.Revision != 0 {
			h.conflict(w, 0)
			return
		}
		create := h.client.BackgroundTaskArtifact.Create().
			SetUser(u).
			SetTask(task).
			SetBody(req.Body)
		if req.ContentType != "" {
			create = create.SetContentType(req.ContentType)
		}
		artifact, err = create.Save(r.Context())
		if err != nil {
			// One artifact per task (unique index): a concurrent first-write race
			// is a revision conflict, not a 500.
			if ent.IsConstraintError(err) {
				h.conflict(w, 0)
				return
			}
			h.log.Error("create background task artifact", zap.Error(err))
			httpx.Error(w, http.StatusInternalServerError, "could not save artifact", "internal_error")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, viewArtifact(task, artifact))
		return
	}
	if req.Revision == nil {
		httpx.Error(w, http.StatusBadRequest, "missing revision", "bad_request")
		return
	}
	update := h.client.BackgroundTaskArtifact.Update().
		Where(backgroundtaskartifact.IDEQ(artifact.ID), backgroundtaskartifact.RevisionEQ(*req.Revision)).
		SetBody(req.Body).
		AddRevision(1)
	if req.ContentType != "" {
		update = update.SetContentType(req.ContentType)
	}
	n, err := update.Save(r.Context())
	if err != nil {
		h.log.Error("update background task artifact", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not save artifact", "internal_error")
		return
	}
	if n == 0 {
		h.conflict(w, artifact.Revision)
		return
	}
	artifact, err = h.client.BackgroundTaskArtifact.Query().Where(backgroundtaskartifact.IDEQ(artifact.ID)).Only(r.Context())
	if err != nil {
		h.log.Error("reload artifact after update", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not load updated artifact", "internal_error")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, viewArtifact(task, artifact))
}

// ListRuns handles GET /v1/background-tasks/{slug}/runs.
func (h *Handler) ListRuns(w http.ResponseWriter, r *http.Request) {
	task, ok := h.lookupTask(w, r)
	if !ok {
		return
	}
	q := h.client.BackgroundTaskRun.Query().
		Where(backgroundtaskrun.HasTaskWith(backgroundtask.IDEQ(task.ID))).
		Order(backgroundtaskrun.ByCreatedAt(entsql.OrderDesc()), backgroundtaskrun.ByID(entsql.OrderDesc()))
	q, limit, ok := h.applyRunFilters(w, r, q, false)
	if !ok {
		return
	}
	runs, err := q.All(r.Context())
	if err != nil {
		h.log.Error("list background task runs", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not list runs", "internal_error")
		return
	}
	views := make([]runView, 0, len(runs))
	for _, run := range runs {
		views = append(views, viewRun(task, run))
	}
	resp := map[string]any{"runs": views}
	if next := nextCursor(runs, limit); next != "" {
		resp["nextCursor"] = next
	}
	httpx.WriteJSON(w, http.StatusOK, resp)
}

// ListAllRuns handles GET /v1/background-task-runs.
func (h *Handler) ListAllRuns(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserFromCtx(r.Context()); !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	q := h.client.BackgroundTaskRun.Query().
		WithTask().
		Order(backgroundtaskrun.ByCreatedAt(entsql.OrderDesc()), backgroundtaskrun.ByID(entsql.OrderDesc()))
	q, limit, ok := h.applyRunFilters(w, r, q, true)
	if !ok {
		return
	}
	runs, err := q.All(r.Context())
	if err != nil {
		h.log.Error("list all background task runs", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not list runs", "internal_error")
		return
	}
	views := make([]runView, 0, len(runs))
	for _, run := range runs {
		task := run.Edges.Task
		if task == nil {
			continue
		}
		views = append(views, viewRun(task, run))
	}
	resp := map[string]any{"runs": views}
	if next := nextCursor(runs, limit); next != "" {
		resp["nextCursor"] = next
	}
	httpx.WriteJSON(w, http.StatusOK, resp)
}

// CreateRun handles POST /v1/background-tasks/{slug}/runs.
func (h *Handler) CreateRun(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	task, ok := h.lookupTask(w, r)
	if !ok {
		return
	}
	var req createRunRequest
	if !readJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.RunID) == "" {
		httpx.Error(w, http.StatusBadRequest, "missing runId", "bad_request")
		return
	}
	run, err := h.createRun(r, u, task, req)
	if err != nil {
		var bad badRequestError
		if errors.As(err, &bad) {
			httpx.Error(w, http.StatusBadRequest, bad.Error(), "bad_request")
			return
		}
		if ent.IsConstraintError(err) {
			httpx.Error(w, http.StatusConflict, "run already exists", "conflict")
			return
		}
		h.log.Error("create background task run", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not create run", "internal_error")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, viewRun(task, run))
}

// PatchRun handles PATCH /v1/background-tasks/{slug}/runs/{runId}.
func (h *Handler) PatchRun(w http.ResponseWriter, r *http.Request) {
	task, run, ok := h.lookupRun(w, r)
	if !ok {
		return
	}
	var req patchRunRequest
	if !readJSON(w, r, &req) {
		return
	}
	if req.Revision == nil {
		httpx.Error(w, http.StatusBadRequest, "missing revision", "bad_request")
		return
	}
	update := h.client.BackgroundTaskRun.Update().
		Where(backgroundtaskrun.IDEQ(run.ID), backgroundtaskrun.RevisionEQ(*req.Revision)).
		AddRevision(1)
	if req.PreviousRunID != nil {
		update = update.SetPreviousRunID(*req.PreviousRunID)
	}
	if req.RetryOfRunID != nil {
		update = update.SetRetryOfRunID(*req.RetryOfRunID)
	}
	if req.Attempt != nil {
		if *req.Attempt < 1 {
			httpx.Error(w, http.StatusBadRequest, "attempt must be >= 1", "bad_request")
			return
		}
		update = update.SetAttempt(*req.Attempt)
	}
	if req.LocalRunID != nil {
		update = update.SetLocalRunID(*req.LocalRunID)
	}
	if req.Trigger != nil {
		if err := validateRunTrigger(*req.Trigger); err != nil {
			httpx.Error(w, http.StatusBadRequest, err.Error(), "bad_request")
			return
		}
		update = update.SetTrigger(*req.Trigger)
	}
	if req.Status != nil {
		if err := validateRunStatus(*req.Status); err != nil {
			httpx.Error(w, http.StatusBadRequest, err.Error(), "bad_request")
			return
		}
		update = update.SetStatus(*req.Status)
	}
	if req.Executor != nil {
		if err := validateExecutor(*req.Executor); err != nil {
			httpx.Error(w, http.StatusBadRequest, err.Error(), "bad_request")
			return
		}
		update = update.SetExecutor(*req.Executor)
	}
	if req.Model != nil {
		update = update.SetModel(*req.Model)
	}
	if req.Provider != nil {
		update = update.SetProvider(*req.Provider)
	}
	if req.UseCase != nil {
		update = update.SetUseCase(*req.UseCase)
	}
	if req.SubUseCase != nil {
		update = update.SetSubUseCase(*req.SubUseCase)
	}
	if req.RequestedContext != nil {
		update = update.SetRequestedContext(*req.RequestedContext)
	}
	if req.Summary != nil {
		update = update.SetSummary(*req.Summary)
	}
	if req.Error != nil {
		update = update.SetError(*req.Error)
	}
	if req.ErrorCode != nil {
		update = update.SetErrorCode(*req.ErrorCode)
	}
	if req.ErrorDetails != nil {
		update = update.SetErrorDetails(*req.ErrorDetails)
	}
	if req.CancelRequestedAt != nil {
		ts, ok, err := parseOptionalTime(*req.CancelRequestedAt)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid cancelRequestedAt", "bad_request")
			return
		}
		if ok {
			update = update.SetCancelRequestedAt(ts)
		}
	}
	if err := applyTemporalPatchFields(update, req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "bad_request")
		return
	}
	if err := applyRunTimes(update, req.StartedAt, req.CompletedAt); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "bad_request")
		return
	}
	n, err := update.Save(r.Context())
	if err != nil {
		h.log.Error("patch background task run", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not patch run", "internal_error")
		return
	}
	if n == 0 {
		h.conflict(w, run.Revision)
		return
	}
	run, err = h.client.BackgroundTaskRun.Query().Where(backgroundtaskrun.IDEQ(run.ID)).Only(r.Context())
	if err != nil {
		h.log.Error("reload run after patch", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not load updated run", "internal_error")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, viewRun(task, run))
}

// GetRun handles GET /v1/background-tasks/{slug}/runs/{runId}. The single-run
// detail is the one place the originating cloud event (RFC 003 linkage) is
// attached — list and status responses stay slim.
func (h *Handler) GetRun(w http.ResponseWriter, r *http.Request) {
	task, run, ok := h.lookupRun(w, r, func(q *ent.BackgroundTaskRunQuery) { q.WithCloudEvent() })
	if !ok {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, viewRun(task, run))
}

// RunStatus handles GET /v1/background-tasks/{slug}/runs/{runId}/status.
func (h *Handler) RunStatus(w http.ResponseWriter, r *http.Request) {
	task, run, ok := h.lookupRun(w, r)
	if !ok {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, viewRunStatus(task, run))
}

// CancelRun handles POST /v1/background-tasks/{slug}/runs/{runId}/cancel.
func (h *Handler) CancelRun(w http.ResponseWriter, r *http.Request) {
	task, run, ok := h.lookupRun(w, r)
	if !ok {
		return
	}
	if run.Executor != "api" || run.TemporalWorkflowID == "" {
		httpx.Error(w, http.StatusBadRequest, "run is not temporal-backed", "bad_request")
		return
	}
	if !canonicalTemporalWorkflow(r.Context(), task, run) {
		h.log.Error("refusing to cancel run with non-canonical temporal workflow id",
			zap.String("runId", run.RunID), zap.String("taskSlug", task.Slug))
		httpx.Error(w, http.StatusConflict, "run workflow identity is invalid", "invalid_workflow_identity")
		return
	}
	if isTerminalRunStatus(run.Status) {
		httpx.WriteJSON(w, http.StatusAccepted, viewRun(task, run))
		return
	}
	if h.temporal == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "temporal is not configured", "temporal_unavailable")
		return
	}
	if err := h.temporal.CancelBackgroundTaskRun(r.Context(), run.TemporalWorkflowID, run.TemporalRunID); err != nil {
		h.log.Error("cancel temporal background task workflow", zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "could not cancel temporal workflow", "temporal_cancel_failed")
		return
	}
	// The Temporal cancel above already happened, and the canceled workflow
	// deliberately skips MarkRunFailed on cancellation assuming THIS update set
	// the run to stopped. Run it on a detached context: if the client
	// disconnects right after the cancel RPC, an r.Context()-derived write would
	// abort and strand the run as "running" forever.
	cancelCtx, cancelDone := context.WithTimeout(auth.WithInternal(context.WithoutCancel(r.Context())), 10*time.Second)
	defer cancelDone()
	now := time.Now().UTC()
	n, err := h.client.BackgroundTaskRun.Update().
		// Guard the transition: a run that already reached a terminal state
		// cannot be stopped, and we must not overwrite a succeeded/failed row.
		Where(
			backgroundtaskrun.IDEQ(run.ID),
			backgroundtaskrun.StatusNotIn("succeeded", "failed", "stopped"),
		).
		SetStatus("stopped").
		SetTemporalStatus("Canceled").
		SetTemporalClosedAt(now).
		SetCancelRequestedAt(now).
		SetCompletedAt(now).
		SetProgressMessage("Cancellation requested.").
		AddRevision(1).
		Save(cancelCtx)
	if err != nil {
		h.log.Error("mark canceled background task run", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not update run", "internal_error")
		return
	}
	if n == 0 {
		// Already terminal: the Temporal cancel above is harmless, so report the
		// run's current state rather than double-recording a stop.
		httpx.WriteJSON(w, http.StatusAccepted, viewRun(task, run))
		return
	}
	if err := h.appendSystemEvent(cancelCtx, task, run, backgroundtaskworkflow.EventCancelRequested, map[string]any{
		"type":    backgroundtaskworkflow.EventCancelRequested,
		"message": "Cancellation requested.",
	}); err != nil {
		h.log.Warn("append cancel-requested event failed", zap.String("runId", run.RunID), zap.Error(err))
	}
	if err := h.appendSystemEvent(cancelCtx, task, run, backgroundtaskworkflow.EventStopped, map[string]any{
		"type":    backgroundtaskworkflow.EventStopped,
		"message": "Run stopped.",
	}); err != nil {
		h.log.Warn("append stopped event failed", zap.String("runId", run.RunID), zap.Error(err))
	}
	backgroundtaskmetrics.CancelRequested.Inc()
	backgroundtaskmetrics.Stopped.Inc()
	h.log.Info("cloud run stopped", runLogFields(r.Context(), task, run)...)
	run, err = h.client.BackgroundTaskRun.Query().Where(backgroundtaskrun.IDEQ(run.ID)).Only(r.Context())
	if err != nil {
		h.log.Error("reload run after cancel", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not load updated run", "internal_error")
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, viewRun(task, run))
}

// RetryRun handles POST /v1/background-tasks/{slug}/runs/{runId}/retry.
func (h *Handler) RetryRun(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	task, run, ok := h.lookupRun(w, r)
	if !ok {
		return
	}
	// The retry creates an executor=api Temporal run, so it only makes sense for
	// api-target tasks. The previous `task != "api" && run != "api"` allowed a
	// desktop-target task (whose original run happened to be executor=api) to
	// spin up an API workflow — contradicting this very error message.
	if task.ExecutionTarget != "api" {
		httpx.Error(w, http.StatusBadRequest, "only api-target runs can be retried by the API worker", "bad_request")
		return
	}
	if run.Status != "failed" && run.Status != "stopped" {
		httpx.Error(w, http.StatusBadRequest, "only failed or stopped runs can be retried", "bad_request")
		return
	}
	// Don't start a second retry while one is already in flight: each retry spins
	// up a fresh Temporal workflow + execution, so a double-submit would
	// duplicate the run (and the cost). (A small TOCTOU window remains between
	// this check and the insert; a deterministic retry run-id or a partial unique
	// index would close it fully.)
	inFlight, err := h.client.BackgroundTaskRun.Query().
		Where(
			backgroundtaskrun.RetryOfRunIDEQ(run.RunID),
			backgroundtaskrun.StatusIn("queued", "running"),
		).
		Exist(r.Context())
	if err != nil {
		h.log.Error("check in-flight retry", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not check retry state", "internal_error")
		return
	}
	if inFlight {
		httpx.Error(w, http.StatusConflict, "a retry for this run is already in progress", "retry_in_progress")
		return
	}
	h.startRetryRun(w, r, u, task, run)
}

// SignalRun handles POST /v1/background-tasks/{slug}/runs/{runId}/signal.
func (h *Handler) SignalRun(w http.ResponseWriter, r *http.Request) {
	task, run, ok := h.lookupRun(w, r)
	if !ok {
		return
	}
	if run.Executor != "api" || run.TemporalWorkflowID == "" {
		httpx.Error(w, http.StatusBadRequest, "run is not temporal-backed", "bad_request")
		return
	}
	if !canonicalTemporalWorkflow(r.Context(), task, run) {
		h.log.Error("refusing to signal run with non-canonical temporal workflow id",
			zap.String("runId", run.RunID), zap.String("taskSlug", task.Slug))
		httpx.Error(w, http.StatusConflict, "run workflow identity is invalid", "invalid_workflow_identity")
		return
	}
	if isTerminalRunStatus(run.Status) {
		httpx.Error(w, http.StatusBadRequest, "only queued or running runs can be signaled", "bad_request")
		return
	}
	if h.temporal == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "temporal is not configured", "temporal_unavailable")
		return
	}
	var req signalRunRequest
	if !readJSON(w, r, &req) {
		return
	}
	if err := validateSignal(req.Signal); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "bad_request")
		return
	}
	if req.Payload == nil {
		req.Payload = map[string]any{}
	}
	if err := h.temporal.SignalBackgroundTaskRun(r.Context(), run.TemporalWorkflowID, run.TemporalRunID, req.Signal, req.Payload); err != nil {
		h.log.Error("signal temporal background task workflow", zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "could not signal temporal workflow", "temporal_signal_failed")
		return
	}
	_ = h.appendSystemEvent(r.Context(), task, run, backgroundtaskworkflow.EventSignal, map[string]any{
		"type":    backgroundtaskworkflow.EventSignal,
		"signal":  req.Signal,
		"payload": req.Payload,
	})
	httpx.WriteJSON(w, http.StatusAccepted, viewRun(task, run))
}

// AppendRunEvents handles POST /v1/background-tasks/{slug}/runs/{runId}/events.
func (h *Handler) AppendRunEvents(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	task, run, ok := h.lookupRun(w, r)
	if !ok {
		return
	}
	var req appendEventsRequest
	if !readJSON(w, r, &req) {
		return
	}
	if len(req.Events) == 0 {
		httpx.Error(w, http.StatusBadRequest, "missing events", "bad_request")
		return
	}
	stored, skipped := 0, 0
	for _, ev := range req.Events {
		if len(ev.Event) == 0 || !json.Valid(ev.Event) {
			httpx.Error(w, http.StatusBadRequest, "event must be valid JSON", "bad_request")
			return
		}
		// seq is client-supplied and orders the run's event stream; a negative
		// value would sort ahead of the canonical seq-0 queued event and corrupt
		// ordering for afterSeq consumers.
		if ev.Seq < 0 {
			httpx.Error(w, http.StatusBadRequest, "event seq must be non-negative", "bad_request")
			return
		}
		eventType := ev.Type
		if eventType == "" {
			eventType = eventTypeFrom(ev.Event)
		}
		// The column stays free-form for forward-compat; we only warn so newer
		// desktops emitting types this build doesn't know about still sync.
		if eventType != "" && !backgroundtaskworkflow.IsKnownEventType(eventType) {
			h.log.Warn("unknown background task event type",
				zap.String("eventType", eventType),
				zap.String("runId", run.RunID))
		}
		err := h.client.BackgroundTaskRunEvent.Create().
			SetUser(u).
			SetTask(task).
			SetRun(run).
			SetSeq(ev.Seq).
			SetEventJSON(string(ev.Event)).
			SetNillableEventType(emptyAsNil(eventType)).
			Exec(r.Context())
		if err != nil {
			if ent.IsConstraintError(err) {
				// An existing row at this seq is normally an idempotent client
				// retry — but it can also be a DIFFERENT payload (desktop seq
				// counter reset). Surface the divergence in logs instead of
				// silently discarding it with a 200.
				h.log.Warn("background task run event seq collision; event skipped",
					zap.String("runId", run.RunID),
					zap.Int("seq", ev.Seq),
					zap.String("eventType", eventType))
				skipped++
				continue
			}
			h.log.Error("append background task run event", zap.Error(err))
			httpx.Error(w, http.StatusInternalServerError, "could not append event", "internal_error")
			return
		}
		stored++
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]int{"stored": stored, "skipped": skipped})
}

// ListRunEvents handles GET /v1/background-tasks/{slug}/runs/{runId}/events.
func (h *Handler) ListRunEvents(w http.ResponseWriter, r *http.Request) {
	_, run, ok := h.lookupRun(w, r)
	if !ok {
		return
	}
	q := h.client.BackgroundTaskRunEvent.Query().
		Where(backgroundtaskrunevent.HasRunWith(backgroundtaskrun.IDEQ(run.ID))).
		Order(backgroundtaskrunevent.BySeq())
	if raw := r.URL.Query().Get("afterSeq"); raw != "" {
		seq, err := strconv.Atoi(raw)
		if err != nil || seq < 0 {
			httpx.Error(w, http.StatusBadRequest, "invalid afterSeq", "bad_request")
			return
		}
		q = q.Where(backgroundtaskrunevent.SeqGT(seq))
	}
	// Bound the response: a long-running task can accumulate thousands of events,
	// and an unlimited query would materialize/serialize the entire stream.
	// Clients page forward with ?afterSeq=<nextSeq>.
	const (
		defaultEventLimit = 500
		maxEventLimit     = 1000
	)
	limit := defaultEventLimit
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > maxEventLimit {
		limit = maxEventLimit
	}
	events, err := q.Limit(limit).All(r.Context())
	if err != nil {
		h.log.Error("list background task run events", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not list events", "internal_error")
		return
	}
	views := make([]eventView, 0, len(events))
	for _, ev := range events {
		views = append(views, viewEvent(ev))
	}
	resp := map[string]any{"events": views}
	if len(events) == limit {
		resp["nextSeq"] = events[len(events)-1].Seq
	}
	httpx.WriteJSON(w, http.StatusOK, resp)
}

// StreamRunEvents handles GET /v1/background-tasks/{slug}/runs/{runId}/events/stream.
func (h *Handler) StreamRunEvents(w http.ResponseWriter, r *http.Request) {
	_, run, ok := h.lookupRun(w, r)
	if !ok {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpx.Error(w, http.StatusInternalServerError, "streaming unsupported", "internal_error")
		return
	}
	afterSeq := -1
	if raw := r.URL.Query().Get("afterSeq"); raw != "" {
		seq, err := strconv.Atoi(raw)
		if err != nil || seq < 0 {
			httpx.Error(w, http.StatusBadRequest, "invalid afterSeq", "bad_request")
			return
		}
		afterSeq = seq
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	ctx := r.Context()
	lastSeq, terminal := h.flushRunEventStream(ctx, w, flusher, run, afterSeq)
	if terminal {
		return
	}
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			lastSeq, terminal = h.flushRunEventStream(ctx, w, flusher, run, lastSeq)
			if terminal {
				return
			}
		}
	}
}

// Trigger handles POST /v1/background-tasks/{slug}/trigger.
func (h *Handler) Trigger(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	task, ok := h.lookupTask(w, r)
	if !ok {
		return
	}
	var req triggerRequest
	if r.Body != nil && r.ContentLength != 0 {
		if !readJSON(w, r, &req) {
			return
		}
	}
	trigger := req.Trigger
	if trigger == "" {
		trigger = "manual"
	}
	if err := validateRunTrigger(trigger); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "bad_request")
		return
	}
	if task.ExecutionTarget == "api" {
		h.triggerAPIRun(w, r, u, task, trigger, req.Context)
		return
	}
	runID := "remote-trigger-" + uuid.NewString()
	run, err := h.createRun(r, u, task, createRunRequest{
		RunID:            runID,
		Trigger:          trigger,
		Status:           "queued",
		Executor:         "desktop",
		RequestedContext: req.Context,
	})
	if err != nil {
		var bad badRequestError
		if errors.As(err, &bad) {
			httpx.Error(w, http.StatusBadRequest, bad.Error(), "bad_request")
			return
		}
		h.log.Error("create background task trigger", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not trigger task", "internal_error")
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, viewRun(task, run))
}

func (h *Handler) triggerAPIRun(w http.ResponseWriter, r *http.Request, u *ent.User, task *ent.BackgroundTask, trigger, requestedContext string) {
	run, err := h.runStarter.Start(r.Context(), backgroundtaskruns.Params{
		User:             u,
		Task:             task,
		Trigger:          trigger,
		RequestedContext: requestedContext,
		RunIDPrefix:      "api-trigger-",
		QueuedMessage:    "Queued for API worker.",
		Source:           backgroundtaskruns.SourceHTTP,
	})
	h.writeStartedRun(w, task, run, err, "create api background task run")
}

// writeStartedRun maps a backgroundtaskruns.Starter result to the HTTP response
// the cloud run endpoints have always returned: 503 when Temporal is not
// configured, 400 on invalid params, 502 (with the failed run code recorded) on
// a Temporal start failure, and 202 with the run view on success.
func (h *Handler) writeStartedRun(w http.ResponseWriter, task *ent.BackgroundTask, run *ent.BackgroundTaskRun, err error, logMsg string) {
	var invalidParams *backgroundtaskruns.InvalidParamsError
	var admissionRejected *backgroundtaskruns.AdmissionRejectedError
	var startFailed *backgroundtaskruns.StartFailedError
	var persistIDs *backgroundtaskruns.PersistIDsError
	switch {
	case err == nil:
		httpx.WriteJSON(w, http.StatusAccepted, viewRun(task, run))
	case errors.Is(err, backgroundtaskruns.ErrTemporalNotConfigured):
		httpx.Error(w, http.StatusServiceUnavailable, "temporal is not configured", "temporal_unavailable")
	case errors.As(err, &invalidParams):
		httpx.Error(w, http.StatusBadRequest, err.Error(), "bad_request")
	case errors.As(err, &admissionRejected):
		switch admissionRejected.Code {
		case backgroundtaskworkflow.ErrCodeInsufficientCredits:
			httpx.Error(w, http.StatusPaymentRequired, admissionRejected.Message, admissionRejected.Code)
		case backgroundtaskworkflow.ErrCodeSubscriptionNotActive:
			httpx.Error(w, http.StatusPaymentRequired, admissionRejected.Message, admissionRejected.Code)
		case backgroundtaskworkflow.ErrCodeDailyCreditLimit, backgroundtaskworkflow.ErrCodeMonthlyCreditLimit,
			backgroundtaskworkflow.ErrCodeAdmissionRateLimited, backgroundtaskworkflow.ErrCodeAdmissionBackpressure:
			httpx.Error(w, http.StatusTooManyRequests, admissionRejected.Message, admissionRejected.Code)
		default:
			httpx.Error(w, http.StatusServiceUnavailable, admissionRejected.Message, admissionRejected.Code)
		}
	case errors.As(err, &startFailed):
		httpx.Error(w, http.StatusBadGateway, "could not start temporal workflow", "temporal_start_failed")
	case errors.As(err, &persistIDs):
		// The workflow IS running but its ids were not persisted; keep the
		// distinct message so this partial-success state is triageable.
		h.log.Error(logMsg, zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not store temporal workflow ids", "internal_error")
	default:
		h.log.Error(logMsg, zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not trigger task", "internal_error")
	}
}

func (h *Handler) startRetryRun(w http.ResponseWriter, r *http.Request, u *ent.User, task *ent.BackgroundTask, previous *ent.BackgroundTaskRun) {
	run, err := h.runStarter.Start(r.Context(), backgroundtaskruns.Params{
		User:             u,
		Task:             task,
		Trigger:          "retry",
		RequestedContext: previous.RequestedContext,
		RunIDPrefix:      "retry-",
		QueuedMessage:    "Queued retry for API worker.",
		Source:           backgroundtaskruns.SourceHTTP,
		PreviousRunID:    previous.RunID,
		RetryOfRunID:     previous.RunID,
		Attempt:          intPtr(previous.Attempt + 1),
	})
	h.writeStartedRun(w, task, run, err, "create retry background task run")
}

func (h *Handler) createRun(r *http.Request, u *ent.User, task *ent.BackgroundTask, req createRunRequest) (*ent.BackgroundTaskRun, error) {
	trigger := req.Trigger
	if trigger == "" {
		trigger = "manual"
	}
	if err := validateRunTrigger(trigger); err != nil {
		return nil, err
	}
	status := req.Status
	if status == "" {
		status = "running"
	}
	if err := validateRunStatus(status); err != nil {
		return nil, err
	}
	executor := req.Executor
	if executor == "" {
		executor = task.ExecutionTarget
	}
	if executor == "" {
		executor = "desktop"
	}
	if err := validateExecutor(executor); err != nil {
		return nil, err
	}
	create := h.client.BackgroundTaskRun.Create().
		SetUser(u).
		SetTask(task).
		SetRunID(req.RunID).
		SetTrigger(trigger).
		SetStatus(status).
		SetExecutor(executor)
	if req.PreviousRunID != "" {
		create = create.SetPreviousRunID(req.PreviousRunID)
	}
	if req.RetryOfRunID != "" {
		create = create.SetRetryOfRunID(req.RetryOfRunID)
	}
	if req.Attempt != nil {
		if *req.Attempt < 1 {
			return nil, badRequest("attempt must be >= 1")
		}
		create = create.SetAttempt(*req.Attempt)
	}
	if req.LocalRunID != "" {
		create = create.SetLocalRunID(req.LocalRunID)
	}
	if req.Model != "" {
		create = create.SetModel(req.Model)
	}
	if req.Provider != "" {
		create = create.SetProvider(req.Provider)
	}
	if req.UseCase != "" {
		create = create.SetUseCase(req.UseCase)
	}
	if req.SubUseCase != "" {
		create = create.SetSubUseCase(req.SubUseCase)
	}
	if req.RequestedContext != "" {
		create = create.SetRequestedContext(req.RequestedContext)
	}
	if req.Summary != "" {
		create = create.SetSummary(req.Summary)
	}
	if req.Error != "" {
		create = create.SetError(req.Error)
	}
	if req.ErrorCode != "" {
		create = create.SetErrorCode(req.ErrorCode)
	}
	if req.ErrorDetails != "" {
		create = create.SetErrorDetails(req.ErrorDetails)
	}
	if ts, ok, err := parseOptionalTime(req.CancelRequestedAt); err != nil {
		return nil, badRequest("invalid cancelRequestedAt")
	} else if ok {
		create = create.SetCancelRequestedAt(ts)
	}
	if err := applyTemporalCreateFields(create, req); err != nil {
		return nil, err
	}
	if ts, ok, err := parseOptionalTime(req.StartedAt); err != nil {
		return nil, badRequest("invalid startedAt")
	} else if ok {
		create = create.SetStartedAt(ts)
	}
	if ts, ok, err := parseOptionalTime(req.CompletedAt); err != nil {
		return nil, badRequest("invalid completedAt")
	} else if ok {
		create = create.SetCompletedAt(ts)
	}
	return create.Save(r.Context())
}

func (h *Handler) lookupTask(w http.ResponseWriter, r *http.Request) (*ent.BackgroundTask, bool) {
	if _, ok := auth.UserFromCtx(r.Context()); !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return nil, false
	}
	slug := chi.URLParam(r, "slug")
	task, err := h.client.BackgroundTask.Query().
		Where(backgroundtask.SlugEQ(slug)).
		Only(r.Context())
	if err != nil {
		if ent.IsNotFound(err) {
			httpx.Error(w, http.StatusNotFound, "background task not found", "not_found")
			return nil, false
		}
		h.log.Error("lookup background task", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not load background task", "internal_error")
		return nil, false
	}
	return task, true
}

// lookupRun resolves the {slug}/{runId} pair. Optional query modifiers let a
// caller opt into preloads (e.g. GetRun's WithCloudEvent) without every
// mutation/status handler paying for — or leaking — them.
func (h *Handler) lookupRun(w http.ResponseWriter, r *http.Request, mods ...func(*ent.BackgroundTaskRunQuery)) (*ent.BackgroundTask, *ent.BackgroundTaskRun, bool) {
	task, ok := h.lookupTask(w, r)
	if !ok {
		return nil, nil, false
	}
	runID := chi.URLParam(r, "runId")
	query := h.client.BackgroundTaskRun.Query().
		Where(
			backgroundtaskrun.RunIDEQ(runID),
			backgroundtaskrun.HasTaskWith(backgroundtask.IDEQ(task.ID)),
		)
	for _, mod := range mods {
		mod(query)
	}
	run, err := query.Only(r.Context())
	if err != nil {
		if ent.IsNotFound(err) {
			httpx.Error(w, http.StatusNotFound, "background task run not found", "not_found")
			return nil, nil, false
		}
		h.log.Error("lookup background task run", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not load run", "internal_error")
		return nil, nil, false
	}
	return task, run, true
}

func (h *Handler) conflict(w http.ResponseWriter, currentRevision int) {
	httpx.ErrorWith(w, http.StatusConflict, "revision conflict", "conflict", map[string]any{
		"currentRevision": currentRevision,
	})
}

// readJSON decodes exactly one JSON document from the request body. On failure
// it has ALREADY written the appropriate problem response (malformed JSON →
// 400, over-limit → 413) via DecodeJSON and returns false; callers must simply
// `return` without writing a second response.
func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	return httpx.DecodeJSON(w, r, maxBody, v)
}

func normalizeRawJSON(raw json.RawMessage) (string, bool, bool, error) {
	if len(raw) == 0 {
		return "", false, false, nil
	}
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return "", true, true, nil
	}
	if !json.Valid([]byte(trimmed)) {
		return "", true, false, badRequest("must be valid JSON")
	}
	return trimmed, true, false, nil
}

func viewTask(t *ent.BackgroundTask) taskView {
	createdAt := t.CreatedAt
	if !t.TaskCreatedAt.IsZero() {
		createdAt = t.TaskCreatedAt
	}
	return taskView{
		ID:              t.ID.String(),
		Slug:            t.Slug,
		Name:            t.Name,
		Instructions:    t.Instructions,
		Active:          t.Active,
		Triggers:        rawOrNil(t.TriggersJSON),
		Model:           t.Model,
		Provider:        t.Provider,
		ExecutionTarget: t.ExecutionTarget,
		CreatedAt:       createdAt.UTC().Format(time.RFC3339),
		UpdatedAt:       t.UpdatedAt.UTC().Format(time.RFC3339),
		LastAttemptAt:   formatOptionalTime(t.LastAttemptAt),
		LastRunID:       t.LastRunID,
		LastRunAt:       formatOptionalTime(t.LastRunAt),
		LastRunSummary:  t.LastRunSummary,
		LastRunError:    t.LastRunError,

		ScheduleSyncState: t.ScheduleSyncState,
		ScheduleSyncError: t.ScheduleSyncError,
		ScheduleSyncedAt:  formatOptionalTime(t.ScheduleSyncedAt),

		Revision: t.Revision,
	}
}

func viewArtifact(task *ent.BackgroundTask, a *ent.BackgroundTaskArtifact) artifactView {
	return artifactView{
		Slug:           task.Slug,
		Body:           a.Body,
		Revision:       a.Revision,
		UpdatedAt:      a.UpdatedAt.UTC().Format(time.RFC3339),
		UpdatedByRunID: a.UpdatedByRunID,
		ContentType:    a.ContentType,
	}
}

func viewRun(task *ent.BackgroundTask, run *ent.BackgroundTaskRun) runView {
	return runView{
		ID:                 run.ID.String(),
		RunID:              run.RunID,
		PreviousRunID:      run.PreviousRunID,
		RetryOfRunID:       run.RetryOfRunID,
		LocalRunID:         run.LocalRunID,
		Slug:               task.Slug,
		Trigger:            run.Trigger,
		Status:             run.Status,
		Executor:           run.Executor,
		Attempt:            run.Attempt,
		Model:              run.Model,
		Provider:           run.Provider,
		UseCase:            run.UseCase,
		SubUseCase:         run.SubUseCase,
		RequestedContext:   run.RequestedContext,
		Summary:            run.Summary,
		Error:              run.Error,
		ErrorCode:          run.ErrorCode,
		ErrorDetails:       run.ErrorDetails,
		TemporalWorkflowID: run.TemporalWorkflowID,
		TemporalRunID:      run.TemporalRunID,
		TemporalStatus:     run.TemporalStatus,
		TemporalStartedAt:  formatOptionalTime(run.TemporalStartedAt),
		TemporalClosedAt:   formatOptionalTime(run.TemporalClosedAt),
		CancelRequestedAt:  formatOptionalTime(run.CancelRequestedAt),
		ProgressPercent:    run.ProgressPercent,
		ProgressMessage:    run.ProgressMessage,
		LastHeartbeatAt:    formatOptionalTime(run.LastHeartbeatAt),
		StartedAt:          formatOptionalTime(run.StartedAt),
		CompletedAt:        formatOptionalTime(run.CompletedAt),
		CreatedAt:          run.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:          run.UpdatedAt.UTC().Format(time.RFC3339),
		Revision:           run.Revision,
		SourceEvent:        viewSourceEvent(run),
	}
}

// viewSourceEvent maps the preloaded cloud-event edge. The edge is nil unless
// the caller opted into WithCloudEvent (GetRun only), so list/status/mutation
// responses omit sourceEvent with zero extra queries — never use
// run.QueryCloudEvent here, which would issue a query per row.
func viewSourceEvent(run *ent.BackgroundTaskRun) *sourceEventView {
	ev := run.Edges.CloudEvent
	if ev == nil {
		return nil
	}
	return &sourceEventView{
		ID:         ev.ID.String(),
		Source:     ev.Source,
		EventType:  ev.EventType,
		Subject:    ev.Subject,
		OccurredAt: formatOptionalTime(ev.OccurredAt),
	}
}

func viewRunStatus(task *ent.BackgroundTask, run *ent.BackgroundTaskRun) runStatusView {
	return runStatusView{
		RunID:              run.RunID,
		Slug:               task.Slug,
		Status:             run.Status,
		Executor:           run.Executor,
		Attempt:            run.Attempt,
		TemporalWorkflowID: run.TemporalWorkflowID,
		TemporalRunID:      run.TemporalRunID,
		TemporalStatus:     run.TemporalStatus,
		ProgressPercent:    run.ProgressPercent,
		ProgressMessage:    run.ProgressMessage,
		LastHeartbeatAt:    formatOptionalTime(run.LastHeartbeatAt),
		StartedAt:          formatOptionalTime(run.StartedAt),
		CompletedAt:        formatOptionalTime(run.CompletedAt),
		CancelRequestedAt:  formatOptionalTime(run.CancelRequestedAt),
		Error:              run.Error,
		ErrorCode:          run.ErrorCode,
		ErrorDetails:       run.ErrorDetails,
		Revision:           run.Revision,
	}
}

func viewEvent(ev *ent.BackgroundTaskRunEvent) eventView {
	return eventView{
		ID:         ev.ID.String(),
		Seq:        ev.Seq,
		Type:       ev.EventType,
		Event:      rawOrNil(ev.EventJSON),
		ReceivedAt: ev.ReceivedAt.UTC().Format(time.RFC3339),
	}
}

func (h *Handler) flushRunEventStream(ctx context.Context, w http.ResponseWriter, flusher http.Flusher, run *ent.BackgroundTaskRun, afterSeq int) (int, bool) {
	enc := json.NewEncoder(w)
	last := afterSeq
	for {
		events, err := h.client.BackgroundTaskRunEvent.Query().
			Where(
				backgroundtaskrunevent.HasRunWith(backgroundtaskrun.IDEQ(run.ID)),
				backgroundtaskrunevent.SeqGT(last),
			).
			Order(backgroundtaskrunevent.BySeq()).
			Limit(runEventStreamPage).
			All(ctx)
		if err != nil {
			if ctx.Err() == nil {
				h.log.Warn("stream background task run events", zap.String("runId", run.RunID), zap.Error(err))
			}
			return last, false
		}
		if len(events) == 0 {
			return last, false
		}
		for _, ev := range events {
			if err := enc.Encode(viewEvent(ev)); err != nil {
				return last, true
			}
			last = ev.Seq
			if isTerminalRunEventType(ev.EventType) {
				flusher.Flush()
				return last, true
			}
		}
		flusher.Flush()
		if len(events) < runEventStreamPage {
			return last, false
		}
	}
}

func rawOrNil(s string) json.RawMessage {
	if s == "" {
		return nil
	}
	return json.RawMessage(s)
}

func formatOptionalTime(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}

func parseOptionalTime(s string) (time.Time, bool, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, false, nil
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		// Return a controlled message rather than leaking Go's time-layout parse
		// error (e.g. `parsing time "x" as "2006-01-02T15:04:05Z07:00"...`) to
		// clients, matching how the other time fields validate.
		return time.Time{}, false, badRequest("invalid timestamp, expected RFC3339")
	}
	return t, true, nil
}

func applyCreateRuntimeFields(create *ent.BackgroundTaskCreate, req createTaskRequest) error {
	if ts, ok, err := parseOptionalTime(req.LastAttemptAt); err != nil {
		return badRequest("invalid lastAttemptAt")
	} else if ok {
		create.SetLastAttemptAt(ts)
	}
	if req.LastRunID != "" {
		create.SetLastRunID(req.LastRunID)
	}
	if ts, ok, err := parseOptionalTime(req.LastRunAt); err != nil {
		return badRequest("invalid lastRunAt")
	} else if ok {
		create.SetLastRunAt(ts)
	}
	if req.LastRunSummary != "" {
		create.SetLastRunSummary(req.LastRunSummary)
	}
	if req.LastRunError != "" {
		create.SetLastRunError(req.LastRunError)
	}
	return nil
}

func applyPatchRuntimeFields(update *ent.BackgroundTaskUpdate, req patchTaskRequest) error {
	if req.CreatedAt != nil {
		ts, ok, err := parseOptionalTime(*req.CreatedAt)
		if err != nil {
			return err
		}
		if ok {
			update.SetTaskCreatedAt(ts)
		}
	}
	if req.LastAttemptAt != nil {
		ts, ok, err := parseOptionalTime(*req.LastAttemptAt)
		if err != nil {
			return err
		}
		if ok {
			update.SetLastAttemptAt(ts)
		}
	}
	if req.LastRunID != nil {
		update.SetLastRunID(*req.LastRunID)
	}
	if req.LastRunAt != nil {
		ts, ok, err := parseOptionalTime(*req.LastRunAt)
		if err != nil {
			return err
		}
		if ok {
			update.SetLastRunAt(ts)
		}
	}
	if req.LastRunSummary != nil {
		update.SetLastRunSummary(*req.LastRunSummary)
	}
	if req.LastRunError != nil {
		update.SetLastRunError(*req.LastRunError)
	}
	return nil
}

func applyRunTimes(update *ent.BackgroundTaskRunUpdate, startedAt, completedAt *string) error {
	if startedAt != nil {
		ts, ok, err := parseOptionalTime(*startedAt)
		if err != nil {
			return err
		}
		if ok {
			update.SetStartedAt(ts)
		}
	}
	if completedAt != nil {
		ts, ok, err := parseOptionalTime(*completedAt)
		if err != nil {
			return err
		}
		if ok {
			update.SetCompletedAt(ts)
		}
	}
	return nil
}

func (h *Handler) applyRunFilters(w http.ResponseWriter, r *http.Request, q *ent.BackgroundTaskRunQuery, allowSlug bool) (*ent.BackgroundTaskRunQuery, int, bool) {
	if status := r.URL.Query().Get("status"); status != "" {
		if err := validateRunStatus(status); err != nil {
			httpx.Error(w, http.StatusBadRequest, err.Error(), "bad_request")
			return nil, 0, false
		}
		q = q.Where(backgroundtaskrun.StatusEQ(status))
	}
	if trigger := r.URL.Query().Get("trigger"); trigger != "" {
		if err := validateRunTrigger(trigger); err != nil {
			httpx.Error(w, http.StatusBadRequest, err.Error(), "bad_request")
			return nil, 0, false
		}
		q = q.Where(backgroundtaskrun.TriggerEQ(trigger))
	}
	if executor := r.URL.Query().Get("executor"); executor != "" {
		if err := validateExecutor(executor); err != nil {
			httpx.Error(w, http.StatusBadRequest, err.Error(), "bad_request")
			return nil, 0, false
		}
		q = q.Where(backgroundtaskrun.ExecutorEQ(executor))
	}
	if raw := r.URL.Query().Get("since"); raw != "" {
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid since", "bad_request")
			return nil, 0, false
		}
		q = q.Where(backgroundtaskrun.CreatedAtGTE(t))
	}
	if raw := r.URL.Query().Get("until"); raw != "" {
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid until", "bad_request")
			return nil, 0, false
		}
		q = q.Where(backgroundtaskrun.CreatedAtLTE(t))
	}
	if allowSlug {
		if slug := strings.TrimSpace(r.URL.Query().Get("slug")); slug != "" {
			q = q.Where(backgroundtaskrun.HasTaskWith(backgroundtask.SlugEQ(slug)))
		}
	}
	if raw := r.URL.Query().Get("cursor"); raw != "" {
		ct, cid, perr := parseRunCursor(raw)
		if perr != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid cursor", "bad_request")
			return nil, 0, false
		}
		if cid == uuid.Nil {
			// Legacy timestamp-only cursor (no id component).
			q = q.Where(backgroundtaskrun.CreatedAtLT(ct))
		} else {
			// Composite (created_at, id) keyset matching the ORDER BY
			// (created_at DESC, id DESC): resume strictly after the cursor row.
			// created_at alone isn't unique, so a timestamp-only `<` would drop
			// every run that shares the boundary timestamp.
			q = q.Where(backgroundtaskrun.Or(
				backgroundtaskrun.CreatedAtLT(ct),
				backgroundtaskrun.And(
					backgroundtaskrun.CreatedAtEQ(ct),
					backgroundtaskrun.IDLT(cid),
				),
			))
		}
	}
	limit := 100
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 || n > 500 {
			httpx.Error(w, http.StatusBadRequest, "limit must be between 1 and 500", "bad_request")
			return nil, 0, false
		}
		limit = n
	}
	return q.Limit(limit), limit, true
}

// runCursorSep separates the timestamp and id components of a run cursor.
// Neither RFC3339Nano timestamps nor UUIDs contain it.
const runCursorSep = "|"

func nextCursor(runs []*ent.BackgroundTaskRun, limit int) string {
	if limit <= 0 || len(runs) < limit {
		return ""
	}
	last := runs[len(runs)-1]
	// Composite (created_at, id) cursor. RFC3339Nano preserves the stored
	// sub-second precision, and the id disambiguates rows sharing a timestamp so
	// the next page can resume exactly after this row (see parseRunCursor and the
	// keyset predicate in applyRunFilters) instead of dropping its timestamp ties.
	return last.CreatedAt.UTC().Format(time.RFC3339Nano) + runCursorSep + last.ID.String()
}

// parseRunCursor decodes a run pagination cursor into its (created_at, id)
// components. A cursor without an id component (legacy timestamp-only) returns
// uuid.Nil for the id.
func parseRunCursor(raw string) (time.Time, uuid.UUID, error) {
	tsStr, idStr, hasID := strings.Cut(raw, runCursorSep)
	t, err := time.Parse(time.RFC3339, tsStr)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	if !hasID {
		return t, uuid.Nil, nil
	}
	id, err := uuid.Parse(idStr)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	return t, id, nil
}

func applyTemporalCreateFields(create *ent.BackgroundTaskRunCreate, req createRunRequest) error {
	if req.TemporalWorkflowID != "" || req.TemporalRunID != "" || req.TemporalStatus != "" ||
		req.TemporalStartedAt != "" || req.TemporalClosedAt != "" {
		return badRequest("temporal fields are server-managed")
	}
	if req.ProgressPercent != nil {
		if *req.ProgressPercent < 0 || *req.ProgressPercent > 100 {
			return badRequest("progressPercent must be between 0 and 100")
		}
		create.SetProgressPercent(*req.ProgressPercent)
	}
	if req.ProgressMessage != "" {
		create.SetProgressMessage(req.ProgressMessage)
	}
	if ts, ok, err := parseOptionalTime(req.LastHeartbeatAt); err != nil {
		return badRequest("invalid lastHeartbeatAt")
	} else if ok {
		create.SetLastHeartbeatAt(ts)
	}
	return nil
}

func applyTemporalPatchFields(update *ent.BackgroundTaskRunUpdate, req patchRunRequest) error {
	if req.TemporalWorkflowID != nil || req.TemporalRunID != nil || req.TemporalStatus != nil ||
		req.TemporalStartedAt != nil || req.TemporalClosedAt != nil {
		return badRequest("temporal fields are server-managed")
	}
	if req.ProgressPercent != nil {
		if *req.ProgressPercent < 0 || *req.ProgressPercent > 100 {
			return badRequest("progressPercent must be between 0 and 100")
		}
		update.SetProgressPercent(*req.ProgressPercent)
	}
	if req.ProgressMessage != nil {
		update.SetProgressMessage(*req.ProgressMessage)
	}
	if req.LastHeartbeatAt != nil {
		ts, ok, err := parseOptionalTime(*req.LastHeartbeatAt)
		if err != nil {
			return badRequest("invalid lastHeartbeatAt")
		}
		if ok {
			update.SetLastHeartbeatAt(ts)
		}
	}
	return nil
}

func canonicalTemporalWorkflow(ctx context.Context, task *ent.BackgroundTask, run *ent.BackgroundTaskRun) bool {
	u, ok := auth.UserFromCtx(ctx)
	if !ok || task == nil || run == nil {
		return false
	}
	return run.TemporalWorkflowID == backgroundtaskworkflow.WorkflowID(u.ID.String(), task.Slug, run.RunID)
}

// runLogFields returns the consistent structured-logging field set for a cloud
// run lifecycle transition. traceId is filled best-effort from the active OTel
// span so logs correlate with traces; the rest come from the run/task rows.
func runLogFields(ctx context.Context, task *ent.BackgroundTask, run *ent.BackgroundTaskRun) []zap.Field {
	fields := []zap.Field{
		zap.String("runId", run.RunID),
		zap.String("taskSlug", task.Slug),
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
	if u, ok := auth.UserFromCtx(ctx); ok {
		fields = append(fields, zap.String("userId", u.ID.String()))
	}
	if sc := trace.SpanContextFromContext(ctx); sc.HasTraceID() {
		fields = append(fields, zap.String("traceId", sc.TraceID().String()))
	}
	return fields
}

func (h *Handler) appendSystemEvent(ctx context.Context, task *ent.BackgroundTask, run *ent.BackgroundTaskRun, eventType string, event map[string]any) error {
	u, ok := auth.UserFromCtx(ctx)
	if !ok {
		return nil
	}
	raw, err := json.Marshal(event)
	if err != nil {
		return err
	}
	// Seq assignment is a non-transactional read-max-then-insert against the
	// unique (run, seq) index; a concurrent writer (worker activity, another
	// system event) can claim the same seq. Re-read and retry on the constraint
	// collision instead of dropping the lifecycle event.
	for attempt := 0; ; attempt++ {
		last, err := h.client.BackgroundTaskRunEvent.Query().
			Where(backgroundtaskrunevent.HasRunWith(backgroundtaskrun.IDEQ(run.ID))).
			Order(backgroundtaskrunevent.BySeq(entsql.OrderDesc())).
			First(ctx)
		seq := 0
		if err == nil {
			seq = last.Seq + 1
		} else if !ent.IsNotFound(err) {
			return err
		}
		err = h.client.BackgroundTaskRunEvent.Create().
			SetUser(u).
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

func revisionQuery(w http.ResponseWriter, r *http.Request) (int, bool) {
	raw := r.URL.Query().Get("revision")
	if raw == "" {
		httpx.Error(w, http.StatusBadRequest, "missing revision", "bad_request")
		return 0, false
	}
	revision, err := strconv.Atoi(raw)
	if err != nil || revision <= 0 {
		httpx.Error(w, http.StatusBadRequest, "invalid revision", "bad_request")
		return 0, false
	}
	return revision, true
}

func eventTypeFrom(raw json.RawMessage) string {
	var body struct {
		Type string `json:"type"`
	}
	_ = json.Unmarshal(raw, &body)
	return body.Type
}

func emptyAsNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func validateRunTrigger(trigger string) error {
	switch trigger {
	case "manual", "cron", "window", "event", "retry":
		return nil
	default:
		return badRequest("trigger must be one of manual, cron, window, event, retry")
	}
}

func validateRunStatus(status string) error {
	switch status {
	case "queued", "running", "succeeded", "failed", "stopped":
		return nil
	default:
		return badRequest("status must be one of queued, running, succeeded, failed, stopped")
	}
}

func isTerminalRunStatus(status string) bool {
	switch status {
	case "succeeded", "failed", "stopped":
		return true
	default:
		return false
	}
}

func isTerminalRunEventType(eventType string) bool {
	switch eventType {
	case backgroundtaskworkflow.EventCompleted, backgroundtaskworkflow.EventFailed, backgroundtaskworkflow.EventStopped, backgroundtaskworkflow.EventDesktopStopped:
		return true
	default:
		return false
	}
}

func validateExecutionTarget(target string) error {
	switch target {
	case "desktop", "api":
		return nil
	default:
		return badRequest("executionTarget must be one of desktop, api")
	}
}

func validateExecutor(executor string) error {
	switch executor {
	case "desktop", "api":
		return nil
	default:
		return badRequest("executor must be one of desktop, api")
	}
}

func validateSignal(signal string) error {
	switch signal {
	case "pause", "resume", "update_context", "approve_tool", "deny_tool":
		return nil
	default:
		return badRequest("signal must be one of pause, resume, update_context, approve_tool, deny_tool")
	}
}

func intPtr(v int) *int {
	return &v
}

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	lastDash := false
	for _, r := range s {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			lastDash = false
		case !lastDash:
			b.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(b.String(), "-")
}
