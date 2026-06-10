package backgroundtaskruntime

import (
	"context"
	"testing"
	"time"
)

// TestNoopRuntimeGoldenParity locks the deterministic path to the exact
// pre-RFC-004 output: same summary string, same artifact markdown, same
// progress/event sequence. This is the rollback contract — if this test
// changes, the rollback is no longer byte-identical.
func TestNoopRuntimeGoldenParity(t *testing.T) {
	store := &fakeArtifactStore{}
	sink := &fakeEventSink{}
	rt := NewNoop()
	rt.SetClock(func() time.Time { return time.Date(2026, 6, 10, 12, 0, 0, 0, time.UTC) })

	out, err := rt.Execute(context.Background(), RunInput{
		UserID: "u1", TaskID: "t1", Slug: "daily-summary", RunID: "run-1",
		TaskName:         "Daily Account Summary",
		Trigger:          "cron",
		RequestedContext: "Scheduled cron trigger fired.",
		Instructions:     "Summarize important account changes.",
		Artifacts:        store,
		Events:           sink,
		Limits:           DefaultLimits(),
	})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}

	wantSummary := "API worker completed Daily Account Summary via cron trigger. Context: Scheduled cron trigger fired."
	if out.Summary != wantSummary {
		t.Fatalf("summary = %q\nwant      %q", out.Summary, wantSummary)
	}

	wantArtifact := "# Daily Account Summary\n\n" +
		wantSummary + "\n\n" +
		"## Execution\n\n" +
		"- Executor: api\n" +
		"- Trigger: cron\n" +
		"- Completed at: 2026-06-10T12:00:00Z\n\n" +
		"## Instructions\n\n" +
		"Summarize important account changes.\n\n" +
		"## Requested Context\n\n" +
		"Scheduled cron trigger fired.\n"
	if len(store.writes) != 1 || store.writes[0] != wantArtifact {
		t.Fatalf("artifact =\n%q\nwant\n%q", store.writes[0], wantArtifact)
	}
	if store.contentType != "text/markdown" {
		t.Fatalf("content type = %q", store.contentType)
	}

	// Exact event sequence: progress-50 temporal.progress, then progress-90
	// temporal.artifact_updated.
	if len(sink.records) != 2 {
		t.Fatalf("events = %+v, want 2", sink.records)
	}
	if sink.records[0].EventType != eventProgress || sink.records[0].Percent != 50 ||
		sink.records[0].Message != "Building API-native task artifact." {
		t.Fatalf("first event = %+v", sink.records[0])
	}
	if sink.records[1].EventType != eventArtifactUpdated || sink.records[1].Percent != 90 ||
		sink.records[1].Message != "Artifact updated." {
		t.Fatalf("second event = %+v", sink.records[1])
	}
	if out.ArtifactBytes != len(wantArtifact) {
		t.Fatalf("artifact bytes = %d, want %d", out.ArtifactBytes, len(wantArtifact))
	}
}

// TestNoopRuntimeNoContextVariant covers the no-requested-context shape.
func TestNoopRuntimeNoContextVariant(t *testing.T) {
	store := &fakeArtifactStore{}
	rt := NewNoop()
	out, err := rt.Execute(context.Background(), RunInput{
		TaskName: "T", Trigger: "manual", Instructions: "I",
		Artifacts: store, Events: &fakeEventSink{}, Limits: DefaultLimits(),
	})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if out.Summary != "API worker completed T via manual trigger." {
		t.Fatalf("summary = %q", out.Summary)
	}
}
