package backgroundscheduler

import (
	"context"
	"testing"
	"time"

	"go.uber.org/zap"
)

// The RFC 005 handoff gate: a cron whose Temporal Schedule sync is "current"
// is skipped by the loop, while windows on the same task still fire and every
// other sync state (or a disabled flag) keeps the loop evaluating the cron.

func handoffClock() func() time.Time {
	now := time.Date(2026, 6, 8, 13, 1, 30, 0, time.UTC)
	return func() time.Time { return now }
}

func runTick(t *testing.T, specs []taskSpec, schedulesEnabled bool) *fakeStarter {
	t.Helper()
	client := openDB(t)
	u := newUser(t, client, "a@x.co", "user_1")
	seed(t, client, u, specs)
	starter := &fakeStarter{}
	s := New(client, starter, NoopLeases{}, Config{
		Interval: time.Second, Owner: "test",
		Clock:            handoffClock(),
		SchedulesEnabled: schedulesEnabled,
	}, zap.NewNop())
	if err := s.tick(context.Background()); err != nil {
		t.Fatalf("tick: %v", err)
	}
	return starter
}

func TestHandedOffCronSkippedButWindowStillFires(t *testing.T) {
	noon := time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)
	// Both the cron occurrence (13:00) and the 13:00-14:00 window are due at
	// 13:01:30. evaluateDue prefers cron — the gate must blank it so the
	// window fires on the SAME tick instead of being masked.
	starter := runTick(t, []taskSpec{{
		slug: "both-due", target: "api", active: true,
		triggers:  `{"cronExpr":"0 * * * *","windows":[{"startTime":"13:00","endTime":"14:00"}]}`,
		lastRun:   tptr(noon),
		syncState: "current",
	}}, true)
	if len(starter.calls) != 1 || starter.calls[0].Trigger != "window" {
		t.Fatalf("want exactly one window fire, got %+v", starter.calls)
	}
}

func TestHandedOffCronOnlyTaskFiresNothing(t *testing.T) {
	noon := time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)
	starter := runTick(t, []taskSpec{{
		slug: "cron-only", target: "api", active: true,
		triggers:  `{"cronExpr":"0 * * * *"}`,
		lastRun:   tptr(noon),
		syncState: "current",
	}}, true)
	if len(starter.calls) != 0 {
		t.Fatalf("handed-off cron must not fire via the loop: %+v", starter.calls)
	}
}

func TestNonCurrentSyncStatesKeepLoopFallback(t *testing.T) {
	noon := time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)
	for _, state := range []string{"failed", "syncing", "paused"} {
		t.Run(state, func(t *testing.T) {
			starter := runTick(t, []taskSpec{{
				slug: "cron-" + state, target: "api", active: true,
				triggers:  `{"cronExpr":"0 * * * *"}`,
				lastRun:   tptr(noon),
				syncState: state,
			}}, true)
			if len(starter.calls) != 1 || starter.calls[0].Trigger != "cron" {
				t.Fatalf("state %q must keep the loop firing cron, got %+v", state, starter.calls)
			}
		})
	}
}

func TestDisabledFlagOverridesPersistedCurrent(t *testing.T) {
	// Migration backout: TEMPORAL_SCHEDULES_ENABLED=false must resume loop
	// evaluation even for tasks still persisted as "current".
	noon := time.Date(2026, 6, 8, 12, 0, 0, 0, time.UTC)
	starter := runTick(t, []taskSpec{{
		slug: "backout", target: "api", active: true,
		triggers:  `{"cronExpr":"0 * * * *"}`,
		lastRun:   tptr(noon),
		syncState: "current",
	}}, false)
	if len(starter.calls) != 1 || starter.calls[0].Trigger != "cron" {
		t.Fatalf("disabled flag must override persisted current, got %+v", starter.calls)
	}
}
