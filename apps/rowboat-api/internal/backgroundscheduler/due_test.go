package backgroundscheduler

import (
	"testing"
	"time"
)

// ts parses an RFC3339 UTC instant for the fixtures.
func ts(t *testing.T, s string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatalf("parse %q: %v", s, err)
	}
	return parsed.UTC()
}

func ptr(v time.Time) *time.Time { return &v }

// TestDueParityFixtures is the cross-language parity table from RFC 001. Each
// case must match the desktop scheduler's behavior bit-for-bit so a task fires
// identically whether desktop- or cloud-scheduled.
func TestDueParityFixtures(t *testing.T) {
	cases := []struct {
		name     string
		cron     string
		winStart string
		winEnd   string
		lastRun  *time.Time
		now      time.Time
		want     bool
	}{
		// Cron — anchored on lastRunAt, 2-minute grace.
		{"cron_never_ran_immediate", "*/5 * * * *", "", "", nil, ts(t, "2026-06-08T14:03:00Z"), true},
		{"cron_within_grace", "0 * * * *", "", "", ptr(ts(t, "2026-06-08T12:00:00Z")), ts(t, "2026-06-08T13:01:30Z"), true},
		{"cron_outside_grace", "0 * * * *", "", "", ptr(ts(t, "2026-06-08T12:00:00Z")), ts(t, "2026-06-08T13:03:00Z"), false},
		{"cron_already_advanced", "0 * * * *", "", "", ptr(ts(t, "2026-06-08T13:00:00Z")), ts(t, "2026-06-08T13:01:00Z"), false},

		// Windows — once per day, both bounds inclusive.
		{"window_first_today", "", "09:00", "12:00", nil, ts(t, "2026-06-08T10:15:00Z"), true},
		{"window_already_today", "", "09:00", "12:00", ptr(ts(t, "2026-06-08T09:30:00Z")), ts(t, "2026-06-08T10:15:00Z"), false},
		{"window_boundary_start", "", "09:00", "12:00", ptr(ts(t, "2026-06-07T09:30:00Z")), ts(t, "2026-06-08T09:00:00Z"), true},
		{"window_boundary_end", "", "09:00", "12:00", ptr(ts(t, "2026-06-07T09:30:00Z")), ts(t, "2026-06-08T12:00:00Z"), true},
		{"window_after_end", "", "09:00", "12:00", ptr(ts(t, "2026-06-07T09:30:00Z")), ts(t, "2026-06-08T12:01:00Z"), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var got bool
			if tc.cron != "" {
				got = isCronDue(tc.cron, tc.lastRun, tc.now)
			} else {
				got = isWindowDue(tc.winStart, tc.winEnd, tc.lastRun, tc.now)
			}
			if got != tc.want {
				t.Fatalf("%s: got %v, want %v", tc.name, got, tc.want)
			}
		})
	}
}

// TestDueTimedTriggerCronWinsOverWindow mirrors schedule/utils.ts:32-36: when a
// cron occurrence and a window are both ready, cron is reported.
func TestDueTimedTriggerCronWinsOverWindow(t *testing.T) {
	tr := Triggers{
		CronExpr: "0 * * * *",
		Windows:  []Window{{StartTime: "09:00", EndTime: "23:00"}},
	}
	lastRun := ts(t, "2026-06-08T12:00:00Z")
	now := ts(t, "2026-06-08T13:01:30Z") // cron due (13:00) and inside window band
	if got := dueTimedTrigger(tr, &lastRun, now); got != "cron" {
		t.Fatalf("both due: got %q, want cron", got)
	}
}

func TestDueTimedTriggerWindowWhenNoCron(t *testing.T) {
	tr := Triggers{Windows: []Window{{StartTime: "09:00", EndTime: "12:00"}}}
	now := ts(t, "2026-06-08T10:00:00Z")
	if got := dueTimedTrigger(tr, nil, now); got != "window" {
		t.Fatalf("window only: got %q, want window", got)
	}
}

func TestDueTimedTriggerNoneWhenNeither(t *testing.T) {
	tr := Triggers{CronExpr: "0 * * * *", Windows: []Window{{StartTime: "09:00", EndTime: "12:00"}}}
	lastRun := ts(t, "2026-06-08T13:00:00Z") // cron already advanced
	now := ts(t, "2026-06-08T13:01:00Z")     // and outside the window band
	if got := dueTimedTrigger(tr, &lastRun, now); got != "" {
		t.Fatalf("neither due: got %q, want empty", got)
	}
}

// TestDueTimedTriggerInvalidCronStillEvaluatesWindow proves an unparseable cron
// does not suppress a valid window (desktop parity).
func TestDueTimedTriggerInvalidCronStillEvaluatesWindow(t *testing.T) {
	tr := Triggers{CronExpr: "not a cron", Windows: []Window{{StartTime: "09:00", EndTime: "12:00"}}}
	now := ts(t, "2026-06-08T10:00:00Z")
	if got := dueTimedTrigger(tr, nil, now); got != "window" {
		t.Fatalf("invalid cron + valid window: got %q, want window", got)
	}
}

func TestBackoffRemaining(t *testing.T) {
	now := ts(t, "2026-06-08T13:00:00Z")
	if d := backoffRemaining(nil, now); d != 0 {
		t.Fatalf("nil attempt: got %v, want 0", d)
	}
	recent := now.Add(-1 * time.Minute)
	if d := backoffRemaining(&recent, now); d != 4*time.Minute {
		t.Fatalf("1m ago: got %v, want 4m", d)
	}
	old := now.Add(-6 * time.Minute)
	if d := backoffRemaining(&old, now); d != 0 {
		t.Fatalf("6m ago: got %v, want 0", d)
	}
	future := now.Add(1 * time.Minute)
	if d := backoffRemaining(&future, now); d != 0 {
		t.Fatalf("future attempt: got %v, want 0", d)
	}
}

// TestCronGraceBoundaryIsInclusive checks the exact edge of the grace window:
// at occurrence+grace it still fires; one second past, it does not.
func TestCronGraceBoundaryIsInclusive(t *testing.T) {
	last := ts(t, "2026-06-08T12:00:00Z")
	atGrace := ts(t, "2026-06-08T13:02:00Z") // 13:00 occurrence + 2m grace
	if !isCronDue("0 * * * *", &last, atGrace) {
		t.Fatalf("at grace boundary: want due")
	}
	pastGrace := ts(t, "2026-06-08T13:02:01Z")
	if isCronDue("0 * * * *", &last, pastGrace) {
		t.Fatalf("one second past grace: want not due")
	}
}
