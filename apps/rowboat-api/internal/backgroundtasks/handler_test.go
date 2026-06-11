package backgroundtasks

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskworkflow"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

func setupTest(t *testing.T) (*ent.Client, *ent.User, http.Handler) {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })

	u := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(context.Background())
	h := New(d.Client, zap.NewNop())
	return d.Client, u, testRouter(h)
}

func testRouter(h *Handler) http.Handler {
	r := chi.NewRouter()
	r.Get("/v1/background-task-runs", h.ListAllRuns)
	r.Get("/v1/background-tasks", h.List)
	r.Post("/v1/background-tasks", h.Create)
	r.Route("/v1/background-tasks", func(r chi.Router) {
		r.Get("/", h.List)
		r.Post("/", h.Create)
		r.Get("/{slug}", h.Get)
		r.Patch("/{slug}", h.Patch)
		r.Delete("/{slug}", h.Delete)
		r.Get("/{slug}/artifact", h.GetArtifact)
		r.Put("/{slug}/artifact", h.PutArtifact)
		r.Get("/{slug}/runs", h.ListRuns)
		r.Post("/{slug}/runs", h.CreateRun)
		r.Get("/{slug}/runs/{runId}", h.GetRun)
		r.Patch("/{slug}/runs/{runId}", h.PatchRun)
		r.Get("/{slug}/runs/{runId}/status", h.RunStatus)
		r.Post("/{slug}/runs/{runId}/cancel", h.CancelRun)
		r.Post("/{slug}/runs/{runId}/retry", h.RetryRun)
		r.Post("/{slug}/runs/{runId}/signal", h.SignalRun)
		r.Get("/{slug}/runs/{runId}/events", h.ListRunEvents)
		r.Post("/{slug}/runs/{runId}/events", h.AppendRunEvents)
		r.Post("/{slug}/trigger", h.Trigger)
		r.Get("/{slug}/schedule-state", h.GetScheduleState)
	})
	return r
}

type fakeTemporal struct {
	starts   []backgroundtaskworkflow.StartInput
	cancels  []string
	signals  []string
	startErr error // when set, StartBackgroundTaskRun fails
}

func (f *fakeTemporal) StartBackgroundTaskRun(_ context.Context, in backgroundtaskworkflow.StartInput) (backgroundtaskworkflow.StartResult, error) {
	f.starts = append(f.starts, in)
	if f.startErr != nil {
		return backgroundtaskworkflow.StartResult{}, f.startErr
	}
	return backgroundtaskworkflow.StartResult{
		WorkflowID: backgroundtaskworkflow.WorkflowID(in.UserID, in.Slug, in.RunID),
		RunID:      "temporal-" + in.RunID,
	}, nil
}

func (f *fakeTemporal) CancelBackgroundTaskRun(_ context.Context, workflowID, runID string) error {
	f.cancels = append(f.cancels, workflowID+"/"+runID)
	return nil
}

func (f *fakeTemporal) SignalBackgroundTaskRun(_ context.Context, workflowID, runID, signal string, _ map[string]any) error {
	f.signals = append(f.signals, workflowID+"/"+runID+"/"+signal)
	return nil
}

func authedJSON(t *testing.T, h http.Handler, u *ent.User, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, reader).WithContext(auth.WithUser(context.Background(), u))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func decodeBody[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var out T
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode %d body: %v (%s)", rec.Code, err, rec.Body.String())
	}
	return out
}

func TestBackgroundTaskLifecycle(t *testing.T) {
	client, u, router := setupTest(t)

	createRec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/", map[string]any{
		"slug":         "daily-summary",
		"name":         "Daily Summary",
		"instructions": "Summarize important account changes.",
		"active":       true,
		"triggers":     map[string]any{"cronExpr": "0 9 * * *"},
		"model":        "openai/gpt-4.1-mini",
		"provider":     "openai",
		"createdAt":    "2026-06-04T20:38:00Z",
	})
	if createRec.Code != http.StatusCreated {
		t.Fatalf("create: want 201, got %d: %s", createRec.Code, createRec.Body.String())
	}
	task := decodeBody[taskView](t, createRec)
	if task.Revision != 1 || task.Slug != "daily-summary" || task.Triggers == nil || task.ExecutionTarget != "desktop" {
		t.Fatalf("unexpected task response: %+v", task)
	}

	listRec := authedJSON(t, router, u, http.MethodGet, "/v1/background-tasks/", nil)
	if listRec.Code != http.StatusOK {
		t.Fatalf("list: want 200, got %d: %s", listRec.Code, listRec.Body.String())
	}
	listNoSlashRec := authedJSON(t, router, u, http.MethodGet, "/v1/background-tasks", nil)
	if listNoSlashRec.Code != http.StatusOK {
		t.Fatalf("list without trailing slash: want 200, got %d: %s", listNoSlashRec.Code, listNoSlashRec.Body.String())
	}
	list := decodeBody[struct {
		Tasks []taskView `json:"tasks"`
	}](t, listRec)
	if len(list.Tasks) != 1 || list.Tasks[0].Slug != "daily-summary" {
		t.Fatalf("unexpected task list: %+v", list.Tasks)
	}

	stalePatch := authedJSON(t, router, u, http.MethodPatch, "/v1/background-tasks/daily-summary", map[string]any{
		"revision": 99,
		"name":     "Stale",
	})
	if stalePatch.Code != http.StatusConflict || !strings.Contains(stalePatch.Body.String(), `"currentRevision":1`) {
		t.Fatalf("stale patch: want 409/currentRevision=1, got %d: %s", stalePatch.Code, stalePatch.Body.String())
	}

	patchRec := authedJSON(t, router, u, http.MethodPatch, "/v1/background-tasks/daily-summary", map[string]any{
		"revision":       task.Revision,
		"name":           "Daily Account Summary",
		"triggers":       nil,
		"lastRunSummary": "no changes",
		"lastRunAt":      "2026-06-04T21:00:00Z",
	})
	if patchRec.Code != http.StatusOK {
		t.Fatalf("patch: want 200, got %d: %s", patchRec.Code, patchRec.Body.String())
	}
	task = decodeBody[taskView](t, patchRec)
	if task.Revision != 2 || task.Triggers != nil || task.LastRunSummary != "no changes" {
		t.Fatalf("unexpected patched task: %+v", task)
	}

	artifactRec := authedJSON(t, router, u, http.MethodPut, "/v1/background-tasks/daily-summary/artifact", map[string]any{
		"body": "# Daily Summary\n\nMirror this markdown.",
	})
	if artifactRec.Code != http.StatusOK {
		t.Fatalf("create artifact: want 200, got %d: %s", artifactRec.Code, artifactRec.Body.String())
	}
	artifact := decodeBody[artifactView](t, artifactRec)
	if artifact.Revision != 1 || !strings.Contains(artifact.Body, "Mirror") {
		t.Fatalf("unexpected artifact: %+v", artifact)
	}

	staleArtifact := authedJSON(t, router, u, http.MethodPut, "/v1/background-tasks/daily-summary/artifact", map[string]any{
		"revision": 99,
		"body":     "stale",
	})
	if staleArtifact.Code != http.StatusConflict || !strings.Contains(staleArtifact.Body.String(), `"currentRevision":1`) {
		t.Fatalf("stale artifact: want 409/currentRevision=1, got %d: %s", staleArtifact.Code, staleArtifact.Body.String())
	}

	artifactRec = authedJSON(t, router, u, http.MethodPut, "/v1/background-tasks/daily-summary/artifact", map[string]any{
		"revision": artifact.Revision,
		"body":     "# Daily Summary\n\nUpdated.",
	})
	if artifactRec.Code != http.StatusOK {
		t.Fatalf("update artifact: want 200, got %d: %s", artifactRec.Code, artifactRec.Body.String())
	}
	artifact = decodeBody[artifactView](t, artifactRec)
	if artifact.Revision != 2 {
		t.Fatalf("artifact revision = %d, want 2", artifact.Revision)
	}

	runRec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/daily-summary/runs", map[string]any{
		"runId":      "run-1",
		"trigger":    "manual",
		"status":     "running",
		"startedAt":  "2026-06-04T21:01:00Z",
		"model":      "openai/gpt-4.1-mini",
		"provider":   "openai",
		"useCase":    "background-task",
		"subUseCase": "daily-summary",
		"localRunId": "local-run-1",
		"summary":    "started",
		"error":      "",
	})
	if runRec.Code != http.StatusCreated {
		t.Fatalf("create run: want 201, got %d: %s", runRec.Code, runRec.Body.String())
	}
	run := decodeBody[runView](t, runRec)
	if run.Revision != 1 || run.RunID != "run-1" || run.Status != "running" || run.Executor != "desktop" {
		t.Fatalf("unexpected run: %+v", run)
	}

	eventsRec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/daily-summary/runs/run-1/events", map[string]any{
		"events": []any{
			map[string]any{"seq": 0, "event": map[string]any{"type": "started"}},
			map[string]any{"seq": 1, "type": "completed", "event": map[string]any{"type": "completed", "summary": "ok"}},
			map[string]any{"seq": 1, "event": map[string]any{"type": "completed"}},
		},
	})
	if eventsRec.Code != http.StatusOK {
		t.Fatalf("append events: want 200, got %d: %s", eventsRec.Code, eventsRec.Body.String())
	}
	counts := decodeBody[struct {
		Stored  int `json:"stored"`
		Skipped int `json:"skipped"`
	}](t, eventsRec)
	if counts.Stored != 2 || counts.Skipped != 1 {
		t.Fatalf("unexpected event counts: %+v", counts)
	}

	listEventsRec := authedJSON(t, router, u, http.MethodGet, "/v1/background-tasks/daily-summary/runs/run-1/events", nil)
	if listEventsRec.Code != http.StatusOK {
		t.Fatalf("list events: want 200, got %d: %s", listEventsRec.Code, listEventsRec.Body.String())
	}
	eventList := decodeBody[struct {
		Events []eventView `json:"events"`
	}](t, listEventsRec)
	if len(eventList.Events) != 2 || eventList.Events[0].Seq != 0 || eventList.Events[1].Seq != 1 {
		t.Fatalf("unexpected event list: %+v", eventList.Events)
	}
	eventsAfterRec := authedJSON(t, router, u, http.MethodGet, "/v1/background-tasks/daily-summary/runs/run-1/events?afterSeq=0", nil)
	if eventsAfterRec.Code != http.StatusOK {
		t.Fatalf("list events afterSeq: want 200, got %d: %s", eventsAfterRec.Code, eventsAfterRec.Body.String())
	}
	eventsAfter := decodeBody[struct {
		Events []eventView `json:"events"`
	}](t, eventsAfterRec)
	if len(eventsAfter.Events) != 1 || eventsAfter.Events[0].Seq != 1 {
		t.Fatalf("unexpected afterSeq event list: %+v", eventsAfter.Events)
	}

	patchRunRec := authedJSON(t, router, u, http.MethodPatch, "/v1/background-tasks/daily-summary/runs/run-1", map[string]any{
		"revision":    run.Revision,
		"status":      "succeeded",
		"summary":     "ok",
		"completedAt": "2026-06-04T21:02:00Z",
	})
	if patchRunRec.Code != http.StatusOK {
		t.Fatalf("patch run: want 200, got %d: %s", patchRunRec.Code, patchRunRec.Body.String())
	}
	run = decodeBody[runView](t, patchRunRec)
	if run.Revision != 2 || run.Status != "succeeded" || run.CompletedAt == nil {
		t.Fatalf("unexpected patched run: %+v", run)
	}

	triggerRec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/daily-summary/trigger", map[string]any{
		"context": "Run this now.",
	})
	if triggerRec.Code != http.StatusAccepted {
		t.Fatalf("trigger: want 202, got %d: %s", triggerRec.Code, triggerRec.Body.String())
	}
	queued := decodeBody[runView](t, triggerRec)
	if queued.Status != "queued" || queued.Executor != "desktop" || queued.Trigger != "manual" || !strings.HasPrefix(queued.RunID, "remote-trigger-") {
		t.Fatalf("unexpected queued run: %+v", queued)
	}

	queuedRec := authedJSON(t, router, u, http.MethodGet, "/v1/background-tasks/daily-summary/runs?status=queued", nil)
	if queuedRec.Code != http.StatusOK {
		t.Fatalf("list queued runs: want 200, got %d: %s", queuedRec.Code, queuedRec.Body.String())
	}
	queuedList := decodeBody[struct {
		Runs []runView `json:"runs"`
	}](t, queuedRec)
	if len(queuedList.Runs) != 1 || queuedList.Runs[0].RunID != queued.RunID {
		t.Fatalf("unexpected queued list: %+v", queuedList.Runs)
	}
	allRunsRec := authedJSON(t, router, u, http.MethodGet, "/v1/background-task-runs?executor=desktop&limit=10", nil)
	if allRunsRec.Code != http.StatusOK {
		t.Fatalf("list all runs: want 200, got %d: %s", allRunsRec.Code, allRunsRec.Body.String())
	}
	allRuns := decodeBody[struct {
		Runs []runView `json:"runs"`
	}](t, allRunsRec)
	if len(allRuns.Runs) < 2 {
		t.Fatalf("expected account-wide runs, got %+v", allRuns.Runs)
	}

	staleDelete := authedJSON(t, router, u, http.MethodDelete, "/v1/background-tasks/daily-summary?revision=1", nil)
	if staleDelete.Code != http.StatusConflict || !strings.Contains(staleDelete.Body.String(), `"currentRevision":2`) {
		t.Fatalf("stale delete: want 409/currentRevision=2, got %d: %s", staleDelete.Code, staleDelete.Body.String())
	}

	deleteRec := authedJSON(t, router, u, http.MethodDelete, "/v1/background-tasks/daily-summary?revision=2", nil)
	if deleteRec.Code != http.StatusNoContent {
		t.Fatalf("delete: want 204, got %d: %s", deleteRec.Code, deleteRec.Body.String())
	}
	ctx := auth.WithUser(context.Background(), u)
	if n := client.BackgroundTask.Query().CountX(ctx); n != 0 {
		t.Fatalf("tasks after delete = %d, want 0", n)
	}
	if n := client.BackgroundTaskArtifact.Query().CountX(ctx); n != 0 {
		t.Fatalf("artifacts after delete = %d, want 0", n)
	}
	if n := client.BackgroundTaskRun.Query().CountX(ctx); n != 0 {
		t.Fatalf("runs after delete = %d, want 0", n)
	}
	if n := client.BackgroundTaskRunEvent.Query().CountX(ctx); n != 0 {
		t.Fatalf("events after delete = %d, want 0", n)
	}
}

func TestTenantScopedBackgroundTasks(t *testing.T) {
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })

	u1 := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(context.Background())
	u2 := d.Client.User.Create().SetEmail("b@x.co").SetWorkosUserID("user_2").SaveX(context.Background())
	router := testRouter(New(d.Client, zap.NewNop()))

	for _, tc := range []struct {
		user *ent.User
		name string
	}{
		{u1, "User One Task"},
		{u2, "User Two Task"},
	} {
		rec := authedJSON(t, router, tc.user, http.MethodPost, "/v1/background-tasks/", map[string]any{
			"slug":         "shared",
			"name":         tc.name,
			"instructions": "tenant scoped",
		})
		if rec.Code != http.StatusCreated {
			t.Fatalf("create %s: want 201, got %d: %s", tc.name, rec.Code, rec.Body.String())
		}
	}
	hidden := authedJSON(t, router, u2, http.MethodPost, "/v1/background-tasks/", map[string]any{
		"slug":         "hidden",
		"name":         "Hidden Task",
		"instructions": "tenant scoped",
	})
	if hidden.Code != http.StatusCreated {
		t.Fatalf("create hidden: want 201, got %d: %s", hidden.Code, hidden.Body.String())
	}

	userOneGet := authedJSON(t, router, u1, http.MethodGet, "/v1/background-tasks/shared", nil)
	if userOneGet.Code != http.StatusOK {
		t.Fatalf("user1 get shared: want 200, got %d: %s", userOneGet.Code, userOneGet.Body.String())
	}
	if got := decodeBody[taskView](t, userOneGet); got.Name != "User One Task" {
		t.Fatalf("user1 saw wrong task: %+v", got)
	}

	userTwoGet := authedJSON(t, router, u2, http.MethodGet, "/v1/background-tasks/shared", nil)
	if userTwoGet.Code != http.StatusOK {
		t.Fatalf("user2 get shared: want 200, got %d: %s", userTwoGet.Code, userTwoGet.Body.String())
	}
	if got := decodeBody[taskView](t, userTwoGet); got.Name != "User Two Task" {
		t.Fatalf("user2 saw wrong task: %+v", got)
	}

	userOneHidden := authedJSON(t, router, u1, http.MethodGet, "/v1/background-tasks/hidden", nil)
	if userOneHidden.Code != http.StatusNotFound {
		t.Fatalf("user1 get hidden: want 404, got %d: %s", userOneHidden.Code, userOneHidden.Body.String())
	}
}

func TestAPITargetTaskStartsTemporalAndSupportsStatusControl(t *testing.T) {
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })

	u := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(context.Background())
	temporal := &fakeTemporal{}
	h := New(d.Client, zap.NewNop())
	h.SetTemporal(temporal)
	router := testRouter(h)

	createRec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/", map[string]any{
		"slug":            "api-task",
		"name":            "API Task",
		"instructions":    "Run on the server.",
		"executionTarget": "api",
	})
	if createRec.Code != http.StatusCreated {
		t.Fatalf("create api task: want 201, got %d: %s", createRec.Code, createRec.Body.String())
	}
	task := decodeBody[taskView](t, createRec)
	if task.ExecutionTarget != "api" {
		t.Fatalf("execution target = %q, want api", task.ExecutionTarget)
	}

	triggerRec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/api-task/trigger", map[string]any{
		"trigger": "manual",
		"context": "Run now.",
	})
	if triggerRec.Code != http.StatusAccepted {
		t.Fatalf("trigger api task: want 202, got %d: %s", triggerRec.Code, triggerRec.Body.String())
	}
	run := decodeBody[runView](t, triggerRec)
	if run.Executor != "api" || run.Status != "queued" || run.TemporalWorkflowID == "" || run.TemporalRunID == "" {
		t.Fatalf("unexpected api run: %+v", run)
	}
	if len(temporal.starts) != 1 || temporal.starts[0].Slug != "api-task" || temporal.starts[0].RequestedContext != "Run now." {
		t.Fatalf("unexpected temporal starts: %+v", temporal.starts)
	}

	statusRec := authedJSON(t, router, u, http.MethodGet, "/v1/background-tasks/api-task/runs/"+run.RunID+"/status", nil)
	if statusRec.Code != http.StatusOK {
		t.Fatalf("run status: want 200, got %d: %s", statusRec.Code, statusRec.Body.String())
	}
	status := decodeBody[runStatusView](t, statusRec)
	if status.Executor != "api" || status.TemporalWorkflowID == "" || status.ProgressPercent == nil || *status.ProgressPercent != 0 {
		t.Fatalf("unexpected status: %+v", status)
	}

	signalRec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/api-task/runs/"+run.RunID+"/signal", map[string]any{
		"signal":  "pause",
		"payload": map[string]any{"reason": "test"},
	})
	if signalRec.Code != http.StatusAccepted {
		t.Fatalf("signal: want 202, got %d: %s", signalRec.Code, signalRec.Body.String())
	}
	if len(temporal.signals) != 1 || !strings.Contains(temporal.signals[0], "/pause") {
		t.Fatalf("unexpected signals: %+v", temporal.signals)
	}

	cancelRec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/api-task/runs/"+run.RunID+"/cancel", nil)
	if cancelRec.Code != http.StatusAccepted {
		t.Fatalf("cancel: want 202, got %d: %s", cancelRec.Code, cancelRec.Body.String())
	}
	canceled := decodeBody[runView](t, cancelRec)
	if canceled.Status != "stopped" || canceled.TemporalStatus != "Canceled" || len(temporal.cancels) != 1 {
		t.Fatalf("unexpected canceled run: %+v cancels=%+v", canceled, temporal.cancels)
	}

	retryRec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/api-task/runs/"+run.RunID+"/retry", nil)
	if retryRec.Code != http.StatusAccepted {
		t.Fatalf("retry: want 202, got %d: %s", retryRec.Code, retryRec.Body.String())
	}
	retry := decodeBody[runView](t, retryRec)
	if retry.Executor != "api" || retry.PreviousRunID != run.RunID || !strings.HasPrefix(retry.RunID, "retry-") {
		t.Fatalf("unexpected retry run: %+v", retry)
	}
	if len(temporal.starts) != 2 {
		t.Fatalf("starts after retry = %d, want 2", len(temporal.starts))
	}
}

func TestBackgroundTaskCreateValidation(t *testing.T) {
	_, u, router := setupTest(t)

	rec := authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/", map[string]any{
		"name":          "Bad Time",
		"instructions":  "invalid timestamp should be rejected",
		"lastAttemptAt": "not-a-time",
	})
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "invalid lastAttemptAt") {
		t.Fatalf("invalid lastAttemptAt: want 400, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/", map[string]any{
		"name":         "Valid Task",
		"instructions": "create before run validation",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create valid task: want 201, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/valid-task/runs", map[string]any{
		"runId":     "run-bad",
		"trigger":   "invalid",
		"startedAt": "2026-06-04T21:01:00Z",
	})
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "trigger must be one of") {
		t.Fatalf("invalid trigger: want 400, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = authedJSON(t, router, u, http.MethodPost, "/v1/background-tasks/valid-task/runs", map[string]any{
		"runId":     "run-bad-time",
		"startedAt": "not-a-time",
	})
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "invalid startedAt") {
		t.Fatalf("invalid startedAt: want 400, got %d: %s", rec.Code, rec.Body.String())
	}
}
