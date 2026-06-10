package backgroundtaskworkflow

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskartifact"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrun"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskrunevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"go.uber.org/zap"
)

func executeSetup(t *testing.T) (*ent.Client, StartInput) {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	bg := context.Background()
	u := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(bg)
	task := d.Client.BackgroundTask.Create().
		SetUser(u).SetSlug("daily-summary").SetName("Daily Account Summary").
		SetInstructions("Summarize important account changes.").
		SetExecutionTarget("api").SaveX(bg)
	d.Client.BackgroundTaskRun.Create().
		SetUser(u).SetTask(task).
		SetRunID("run-parity-1").SetStatus("running").SetExecutor("api").
		SaveX(bg)
	return d.Client, StartInput{
		UserID: u.ID.String(), TaskID: task.ID.String(), Slug: task.Slug,
		RunID: "run-parity-1", Trigger: "cron",
		RequestedContext: "Scheduled cron trigger fired.",
	}
}

// TestExecuteAPITaskNoopParity is the rollback contract at the ACTIVITY level:
// with NoopRuntime wired (CLOUD_RUNTIME_ENABLED=false), ExecuteAPITask must
// reproduce the pre-RFC-004 rows exactly — same artifact body/provenance, same
// progress updates, same two events in order, same summary.
func TestExecuteAPITaskNoopParity(t *testing.T) {
	client, in := executeSetup(t)
	noop := backgroundtaskruntime.NewNoop()
	noop.SetClock(func() time.Time { return time.Date(2026, 6, 10, 12, 0, 0, 0, time.UTC) })
	a := &Activities{Client: client, Log: zap.NewNop(), Runtime: noop}

	out, err := a.ExecuteAPITask(context.Background(), in)
	if err != nil {
		t.Fatalf("execute: %v", err)
	}

	wantSummary := "API worker completed Daily Account Summary via cron trigger. Context: Scheduled cron trigger fired."
	if out.Summary != wantSummary {
		t.Fatalf("summary = %q", out.Summary)
	}

	ctx := auth.WithInternal(context.Background())

	// Artifact row: golden body + provenance fields.
	artifact := client.BackgroundTaskArtifact.Query().
		Where(backgroundtaskartifact.UpdatedByRunID("run-parity-1")).
		OnlyX(ctx)
	wantArtifact := "# Daily Account Summary\n\n" + wantSummary + "\n\n" +
		"## Execution\n\n- Executor: api\n- Trigger: cron\n- Completed at: 2026-06-10T12:00:00Z\n\n" +
		"## Instructions\n\nSummarize important account changes.\n\n" +
		"## Requested Context\n\nScheduled cron trigger fired.\n"
	if artifact.Body != wantArtifact {
		t.Fatalf("artifact body =\n%q\nwant\n%q", artifact.Body, wantArtifact)
	}
	if artifact.ContentType != "text/markdown" || artifact.Revision != 1 {
		t.Fatalf("artifact meta = %s/%d", artifact.ContentType, artifact.Revision)
	}

	// Run row: final progress update from the artifact_updated pairing.
	run := client.BackgroundTaskRun.Query().Where(backgroundtaskrun.RunIDEQ("run-parity-1")).OnlyX(ctx)
	if run.ProgressPercent == nil || *run.ProgressPercent != 90 || run.ProgressMessage != "Artifact updated." {
		t.Fatalf("run progress = %v %q", run.ProgressPercent, run.ProgressMessage)
	}
	if run.LastHeartbeatAt == nil {
		t.Fatal("heartbeat timestamp missing")
	}

	// Events: exactly the legacy pair, in seq order, with the legacy payloads.
	events := client.BackgroundTaskRunEvent.Query().
		Where(backgroundtaskrunevent.HasRunWith(backgroundtaskrun.IDEQ(run.ID))).
		Order(backgroundtaskrunevent.BySeq()).
		AllX(ctx)
	if len(events) != 2 {
		t.Fatalf("events = %d, want 2", len(events))
	}
	assertEvent := func(idx int, wantType, wantMessage string, wantProgress int) {
		t.Helper()
		if events[idx].EventType != wantType {
			t.Fatalf("event[%d] type = %s, want %s", idx, events[idx].EventType, wantType)
		}
		var payload struct {
			Type     string `json:"type"`
			Message  string `json:"message"`
			Progress int    `json:"progress"`
		}
		if err := json.Unmarshal([]byte(events[idx].EventJSON), &payload); err != nil {
			t.Fatalf("event[%d] payload: %v", idx, err)
		}
		if payload.Type != wantType || payload.Message != wantMessage || payload.Progress != wantProgress {
			t.Fatalf("event[%d] payload = %+v", idx, payload)
		}
	}
	assertEvent(0, EventProgress, "Building API-native task artifact.", 50)
	assertEvent(1, EventArtifactUpdated, "Artifact updated.", 90)
}

// TestExecuteAPITaskMapsRuntimeErrors asserts classified runtime failures
// surface as non-retryable ApplicationErrors with their code.
func TestExecuteAPITaskMapsRuntimeErrors(t *testing.T) {
	client, in := executeSetup(t)
	a := &Activities{Client: client, Log: zap.NewNop(), Runtime: failingRuntime{}}

	_, err := a.ExecuteAPITask(context.Background(), in)
	if err == nil {
		t.Fatal("want error")
	}
	code, _ := ClassifyRunError(err)
	if code != ErrCodeRuntimeLLMBudgetExceeded {
		t.Fatalf("classified code = %s, want %s", code, ErrCodeRuntimeLLMBudgetExceeded)
	}
}

type failingRuntime struct{}

func (failingRuntime) Execute(context.Context, backgroundtaskruntime.RunInput) (backgroundtaskruntime.RunOutput, error) {
	return backgroundtaskruntime.RunOutput{}, &backgroundtaskruntime.RuntimeError{
		Code:    backgroundtaskruntime.CodeRuntimeLLMBudgetExceeded,
		Message: "llm_calls limit exceeded (12 > 12)",
	}
}
