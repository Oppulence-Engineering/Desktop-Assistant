package backgroundtasks

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
)

type runWithSourceEvent struct {
	RunID       string `json:"runId"`
	Trigger     string `json:"trigger"`
	SourceEvent *struct {
		ID         string  `json:"id"`
		Source     string  `json:"source"`
		EventType  string  `json:"eventType"`
		Subject    string  `json:"subject"`
		OccurredAt *string `json:"occurredAt"`
	} `json:"sourceEvent"`
}

func seedEventLinkedRun(t *testing.T, client *ent.Client, u *ent.User) (slug, runID string) {
	t.Helper()
	ctx := auth.WithInternal(context.Background())
	task := client.BackgroundTask.Create().
		SetUser(u).SetSlug("event-task").SetName("Event Task").
		SetInstructions("React to disputes.").SetExecutionTarget("api").
		SaveX(ctx)
	occurred := time.Date(2026, 6, 11, 14, 0, 0, 0, time.UTC)
	ev := client.CloudEvent.Create().
		SetUser(u).
		SetSource("gmail").
		SetEventType("message.new").
		SetSubject("Invoice #4821 dispute").
		SetText("We dispute line 3 — should never appear in run views").
		SetDedupeKey("gmail:msg-1").
		SetOccurredAt(occurred).
		SaveX(ctx)
	run := client.BackgroundTaskRun.Create().
		SetUser(u).SetTask(task).
		SetRunID("event-run-1").SetTrigger("event").
		SetStatus("succeeded").SetExecutor("api").
		SetCloudEventID(ev.ID).
		SaveX(ctx)
	return task.Slug, run.RunID
}

func TestGetRunIncludesSourceEvent(t *testing.T) {
	client, u, router := setupTest(t)
	slug, runID := seedEventLinkedRun(t, client, u)

	rec := authedJSON(t, router, u, http.MethodGet, "/v1/background-tasks/"+slug+"/runs/"+runID, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("get run = %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeBody[runWithSourceEvent](t, rec)
	se := body.SourceEvent
	if se == nil {
		t.Fatal("sourceEvent missing on single-run GET")
	}
	if se.Source != "gmail" || se.EventType != "message.new" || se.Subject != "Invoice #4821 dispute" {
		t.Fatalf("sourceEvent = %+v", *se)
	}
	if se.OccurredAt == nil || *se.OccurredAt != "2026-06-11T14:00:00Z" {
		t.Fatalf("occurredAt = %v", se.OccurredAt)
	}
	// Only the safe display fields cross the wire — never the normalized
	// text, payload, or routing internals.
	raw := rec.Body.String()
	for _, leak := range []string{"We dispute line 3", "payload", "routing"} {
		if strings.Contains(raw, leak) {
			t.Fatalf("run view leaked event internals (%q): %s", leak, raw)
		}
	}
}

func TestSourceEventOmittedElsewhere(t *testing.T) {
	client, u, router := setupTest(t)
	slug, runID := seedEventLinkedRun(t, client, u)

	for _, path := range []string{
		"/v1/background-tasks/" + slug + "/runs",
		"/v1/background-task-runs",
		"/v1/background-tasks/" + slug + "/runs/" + runID + "/status",
	} {
		rec := authedJSON(t, router, u, http.MethodGet, path, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s = %d", path, rec.Code)
		}
		if strings.Contains(rec.Body.String(), "sourceEvent") {
			t.Fatalf("%s must omit sourceEvent: %s", path, rec.Body.String())
		}
	}
}

func TestGetRunWithoutEventOmitsSourceEvent(t *testing.T) {
	client, u, router := setupTest(t)
	ctx := auth.WithInternal(context.Background())
	task := client.BackgroundTask.Create().
		SetUser(u).SetSlug("plain-task").SetName("Plain").
		SetInstructions("x").SetExecutionTarget("api").
		SaveX(ctx)
	client.BackgroundTaskRun.Create().
		SetUser(u).SetTask(task).
		SetRunID("manual-run-1").SetTrigger("manual").
		SetStatus("succeeded").SetExecutor("api").
		SaveX(ctx)

	rec := authedJSON(t, router, u, http.MethodGet, "/v1/background-tasks/plain-task/runs/manual-run-1", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("get run = %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "sourceEvent") {
		t.Fatalf("non-event run must omit sourceEvent: %s", rec.Body.String())
	}
}
