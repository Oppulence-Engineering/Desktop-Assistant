package agentworkflow

import (
	"context"
	"testing"

	"go.uber.org/zap"
)

type fakeSchedStarter struct {
	called int
	last   ScheduledSessionInput
}

func (f *fakeSchedStarter) StartScheduledSession(_ context.Context, in ScheduledSessionInput) (string, error) {
	f.called++
	f.last = in
	return "sess-scheduled", nil
}

// TestCreateScheduledSessionEnabled starts a session through the canonical
// starter when the runtime is enabled.
func TestCreateScheduledSessionEnabled(t *testing.T) {
	fs := &fakeSchedStarter{}
	a := &ScheduleActivities{Starter: fs, Enabled: true, Log: zap.NewNop()}
	sid, err := a.CreateScheduledSession(context.Background(), ScheduledSessionInput{UserID: "u1", AgentSlug: "assistant", Input: "daily digest"})
	if err != nil {
		t.Fatalf("CreateScheduledSession: %v", err)
	}
	if sid != "sess-scheduled" || fs.called != 1 {
		t.Fatalf("expected one scheduled start, got sid=%q called=%d", sid, fs.called)
	}
	if fs.last.AgentSlug != "assistant" || fs.last.Input != "daily digest" {
		t.Fatalf("schedule input not forwarded: %+v", fs.last)
	}
}

// TestCreateScheduledSessionDisabledSkips confirms a fire is a no-op when the
// runtime is disabled (mirrors the RFC 005 backout skip).
func TestCreateScheduledSessionDisabledSkips(t *testing.T) {
	fs := &fakeSchedStarter{}
	a := &ScheduleActivities{Starter: fs, Enabled: false, Log: zap.NewNop()}
	if _, err := a.CreateScheduledSession(context.Background(), ScheduledSessionInput{UserID: "u1", AgentSlug: "assistant"}); err != nil {
		t.Fatalf("disabled fire should not error: %v", err)
	}
	if fs.called != 0 {
		t.Fatal("disabled fire must not start a session")
	}
}

func TestScheduleIDsDeterministic(t *testing.T) {
	if SessionScheduleID("u1", "a") != SessionScheduleID("u1", "a") {
		t.Fatal("schedule id must be stable")
	}
	if SessionScheduleID("u1", "a") == SessionScheduleID("u1", "b") {
		t.Fatal("different agents must have different schedule ids")
	}
}
