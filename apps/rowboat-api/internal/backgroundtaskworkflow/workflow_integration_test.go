package backgroundtaskworkflow

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtask"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskartifact"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrun"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrunevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"
)

// newWorkflowTestEnv builds a Temporal test environment running the REAL
// workflow + activities against the integration harness. Registrations mirror
// Register (workflow.go) by name — the workflow dispatches activities via the
// rowboat.background_tasks.*.v1 string constants, so the two lists must stay
// in lockstep. ExecuteAPITask is injected so tests can count attempts.
func newWorkflowTestEnv(t *testing.T, h *integrationHarness,
	exec func(context.Context, StartInput) (RunOutput, error)) *testsuite.TestWorkflowEnvironment {
	t.Helper()
	var ts testsuite.WorkflowTestSuite
	env := ts.NewTestWorkflowEnvironment()
	// Activities do real httptest round-trips + sqlite writes; the default
	// idle test timeout (~3s) is too tight for slower CI machines.
	env.SetTestTimeout(time.Minute)
	env.RegisterWorkflowWithOptions(BackgroundTaskWorkflow, workflow.RegisterOptions{Name: WorkflowName})
	env.RegisterActivityWithOptions(h.activities.MarkRunRunning, activity.RegisterOptions{Name: ActivityMarkRunRunning})
	env.RegisterActivityWithOptions(exec, activity.RegisterOptions{Name: ActivityExecuteAPITask})
	env.RegisterActivityWithOptions(h.activities.MarkRunDone, activity.RegisterOptions{Name: ActivityMarkRunDone})
	env.RegisterActivityWithOptions(h.activities.MarkRunFailed, activity.RegisterOptions{Name: ActivityMarkRunFailed})
	return env
}

// resetRunToQueued rewinds the harness-seeded run to its pre-claim state so
// MarkRunRunning performs a genuine queued→running claim inside the workflow.
func resetRunToQueued(t *testing.T, h *integrationHarness) {
	t.Helper()
	h.client.BackgroundTaskRun.Update().
		Where(backgroundtaskrun.RunIDEQ(h.in.RunID)).
		SetStatus("queued").
		ClearStartedAt().
		ExecX(auth.WithInternal(context.Background()))
}

// TestWorkflowIntegrationDefaultRuntimeHappyPath runs the FULL Temporal
// workflow (MarkRunRunning → ExecuteAPITask/DefaultRuntime → MarkRunDone)
// through the test environment — the RFC 004 test-plan integration bullet:
// the run claims, the agent loop calls a connector tool and writes the
// artifact, and the event stream carries the canonical
// temporal.{running,progress,artifact_updated,completed} sequence.
func TestWorkflowIntegrationDefaultRuntimeHappyPath(t *testing.T) {
	h := newIntegrationHarness(t, func(call int, w http.ResponseWriter, body []byte) {
		switch call {
		case 1:
			_, _ = io.WriteString(w, chatResponse(`""`,
				`[{"id":"c1","type":"function","function":{"name":"connector.read.gmail","arguments":"{\"query\":\"from:acme.com\",\"limit\":5}"}}]`,
				`{"prompt_tokens":200,"completion_tokens":20,"total_tokens":220}`))
		case 2:
			_, _ = io.WriteString(w, chatResponse(`""`,
				`[{"id":"c2","type":"function","function":{"name":"artifact.write","arguments":"{\"body\":\"# Acme AR Watch\\n\\nInvoice #4821 is disputed (line 3).\"}"}}]`,
				`{"prompt_tokens":300,"completion_tokens":40,"total_tokens":340}`))
		default:
			_, _ = io.WriteString(w, chatResponse(`"Tracked the new Acme dispute on invoice #4821."`, "",
				`{"prompt_tokens":350,"completion_tokens":15,"total_tokens":365}`))
		}
	})
	resetRunToQueued(t, h)

	env := newWorkflowTestEnv(t, h, h.activities.ExecuteAPITask)
	env.ExecuteWorkflow(BackgroundTaskWorkflow, h.in)
	if !env.IsWorkflowCompleted() {
		t.Fatal("workflow did not complete")
	}
	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}

	ctx := auth.WithInternal(context.Background())

	// Run row: terminal success with the runtime's summary.
	run := h.client.BackgroundTaskRun.Query().Where(backgroundtaskrun.RunIDEQ(h.in.RunID)).OnlyX(ctx)
	if run.Status != "succeeded" || run.TemporalStatus != "Completed" {
		t.Fatalf("run state = %s/%s", run.Status, run.TemporalStatus)
	}
	if run.Summary != "Tracked the new Acme dispute on invoice #4821." {
		t.Fatalf("summary = %q", run.Summary)
	}
	if run.ProgressPercent == nil || *run.ProgressPercent != 100 || run.ProgressMessage != "Completed." {
		t.Fatalf("progress = %v %q", run.ProgressPercent, run.ProgressMessage)
	}
	if run.Executor != "api" || run.StartedAt == nil || run.CompletedAt == nil || run.LastHeartbeatAt == nil {
		t.Fatalf("claim fields = executor=%q started=%v completed=%v heartbeat=%v",
			run.Executor, run.StartedAt, run.CompletedAt, run.LastHeartbeatAt)
	}
	if run.Error != "" || run.ErrorCode != "" {
		t.Fatalf("error residue = %q/%q", run.Error, run.ErrorCode)
	}

	// Task row: last-run bookkeeping from MarkRunDone.
	task := h.client.BackgroundTask.Query().Where(backgroundtask.SlugEQ(h.in.Slug)).OnlyX(ctx)
	if task.LastRunID != h.in.RunID || task.LastRunSummary == "" || task.LastRunError != "" {
		t.Fatalf("task bookkeeping = id=%q summary=%q err=%q", task.LastRunID, task.LastRunSummary, task.LastRunError)
	}

	// Artifact: the staged body with provenance, first revision.
	artifact := h.client.BackgroundTaskArtifact.Query().
		Where(backgroundtaskartifact.UpdatedByRunID(h.in.RunID)).
		OnlyX(ctx)
	if !strings.Contains(artifact.Body, "Invoice #4821 is disputed") || artifact.ContentType != "text/markdown" {
		t.Fatalf("artifact = %q (%s)", artifact.Body, artifact.ContentType)
	}
	if artifact.Revision != 1 {
		t.Fatalf("artifact revision = %d, want 1", artifact.Revision)
	}

	// Event stream parity: the canonical temporal.* lifecycle appears as an
	// ordered subsequence, bracketed by running first / completed last, with
	// the runtime transcript events interleaved.
	events := h.client.BackgroundTaskRunEvent.Query().
		Where(backgroundtaskrunevent.HasRunWith(backgroundtaskrun.IDEQ(run.ID))).
		Order(backgroundtaskrunevent.BySeq()).
		AllX(ctx)
	var types []string
	for _, ev := range events {
		types = append(types, ev.EventType)
	}
	if len(types) == 0 || types[0] != EventRunning || types[len(types)-1] != EventCompleted {
		t.Fatalf("event stream must start with %s and end with %s: %v", EventRunning, EventCompleted, types)
	}
	assertOrderedSubsequence(t, types, []string{
		EventRunning, EventProgress, EventArtifactUpdated, EventCompleted,
	})
	for _, want := range []string{
		EventRuntimeLLMCallStarted, EventRuntimeLLMCallCompleted,
		EventRuntimeToolCallStarted, EventRuntimeToolCallCompleted,
		EventRuntimeFinalArtifactReady,
	} {
		if !sliceContains(types, want) {
			t.Fatalf("events missing %s: %v", want, types)
		}
	}

	// Payload spot-checks: the claim event and the terminal event carry the
	// legacy shapes the desktop renders.
	assertEventPayload(t, events[0].EventJSON, EventRunning, "API worker claimed the run.", 5)
	assertEventPayload(t, events[len(events)-1].EventJSON, EventCompleted, "Completed.", 100)
	var first struct {
		WorkflowID string `json:"workflowId"`
	}
	if err := json.Unmarshal([]byte(events[0].EventJSON), &first); err != nil || first.WorkflowID != WorkflowID(h.in.UserID, h.in.Slug, h.in.RunID) {
		t.Fatalf("running event workflowId = %q (%v)", first.WorkflowID, err)
	}
	var last struct {
		Summary string `json:"summary"`
	}
	if err := json.Unmarshal([]byte(events[len(events)-1].EventJSON), &last); err != nil || last.Summary != run.Summary {
		t.Fatalf("completed event summary = %q (%v)", last.Summary, err)
	}
	// The first agent-loop progress tick is present with its step message.
	for _, ev := range events {
		if ev.EventType == EventProgress {
			assertEventPayload(t, ev.EventJSON, EventProgress, "Agent step 1.", 10)
			break
		}
	}
}

// TestWorkflowIntegrationLLMFailureMarksRunFailed drives the failure path end
// to end: a dead LLM upstream fails ExecuteAPITask non-retryably (exactly one
// attempt despite the 3-attempt policy) and MarkRunFailed records the
// classified llm_call_failed code, leaving no artifact behind.
func TestWorkflowIntegrationLLMFailureMarksRunFailed(t *testing.T) {
	h := newIntegrationHarness(t, func(_ int, w http.ResponseWriter, _ []byte) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = io.WriteString(w, `{"error":"upstream down"}`)
	})
	resetRunToQueued(t, h)

	execAttempts := 0
	env := newWorkflowTestEnv(t, h, func(ctx context.Context, in StartInput) (RunOutput, error) {
		execAttempts++
		return h.activities.ExecuteAPITask(ctx, in)
	})
	env.ExecuteWorkflow(BackgroundTaskWorkflow, h.in)
	if !env.IsWorkflowCompleted() {
		t.Fatal("workflow did not complete")
	}
	err := env.GetWorkflowError()
	if err == nil {
		t.Fatal("want workflow error")
	}
	if code, _ := ClassifyRunError(err); code != ErrCodeLLMCallFailed {
		t.Fatalf("classified code = %s, want %s (err: %v)", code, ErrCodeLLMCallFailed, err)
	}
	if execAttempts != 1 {
		t.Fatalf("ExecuteAPITask attempts = %d, want 1 (runtime errors must be non-retryable)", execAttempts)
	}

	ctx := auth.WithInternal(context.Background())

	run := h.client.BackgroundTaskRun.Query().Where(backgroundtaskrun.RunIDEQ(h.in.RunID)).OnlyX(ctx)
	if run.Status != "failed" || run.TemporalStatus != "Failed" || run.ErrorCode != ErrCodeLLMCallFailed {
		t.Fatalf("run state = %s/%s code=%q", run.Status, run.TemporalStatus, run.ErrorCode)
	}
	if run.CompletedAt == nil {
		t.Fatal("completed_at missing on failed run")
	}
	task := h.client.BackgroundTask.Query().Where(backgroundtask.SlugEQ(h.in.Slug)).OnlyX(ctx)
	if task.LastRunError == "" {
		t.Fatal("task last_run_error not recorded")
	}

	events := h.client.BackgroundTaskRunEvent.Query().
		Where(backgroundtaskrunevent.HasRunWith(backgroundtaskrun.IDEQ(run.ID))).
		Order(backgroundtaskrunevent.BySeq()).
		AllX(ctx)
	var types []string
	for _, ev := range events {
		types = append(types, ev.EventType)
	}
	if len(types) == 0 || types[0] != EventRunning || types[len(types)-1] != EventFailed {
		t.Fatalf("event stream must start with %s and end with %s: %v", EventRunning, EventFailed, types)
	}
	for _, forbidden := range []string{EventCompleted, EventArtifactUpdated} {
		if sliceContains(types, forbidden) {
			t.Fatalf("failed run must not emit %s: %v", forbidden, types)
		}
	}
	var failed struct {
		ErrorCode string `json:"errorCode"`
	}
	if err := json.Unmarshal([]byte(events[len(events)-1].EventJSON), &failed); err != nil || failed.ErrorCode != ErrCodeLLMCallFailed {
		t.Fatalf("failed event errorCode = %q (%v)", failed.ErrorCode, err)
	}

	n := h.client.BackgroundTaskArtifact.Query().
		Where(backgroundtaskartifact.HasTaskWith(backgroundtask.SlugEQ(h.in.Slug))).
		CountX(ctx)
	if n != 0 {
		t.Fatalf("artifacts = %d, want 0 on failure", n)
	}
}

// assertOrderedSubsequence fails unless want appears in got in order (other
// elements may be interleaved).
func assertOrderedSubsequence(t *testing.T, got, want []string) {
	t.Helper()
	i := 0
	for _, g := range got {
		if i < len(want) && g == want[i] {
			i++
		}
	}
	if i != len(want) {
		t.Fatalf("event types %v missing ordered subsequence %v (matched %d)", got, want, i)
	}
}

// assertEventPayload decodes the legacy {type,message,progress} payload shape.
func assertEventPayload(t *testing.T, eventJSON, wantType, wantMessage string, wantProgress int) {
	t.Helper()
	var payload struct {
		Type     string `json:"type"`
		Message  string `json:"message"`
		Progress int    `json:"progress"`
	}
	if err := json.Unmarshal([]byte(eventJSON), &payload); err != nil {
		t.Fatalf("event payload: %v", err)
	}
	if payload.Type != wantType || payload.Message != wantMessage || payload.Progress != wantProgress {
		t.Fatalf("event payload = %+v, want {%s %q %d}", payload, wantType, wantMessage, wantProgress)
	}
}
