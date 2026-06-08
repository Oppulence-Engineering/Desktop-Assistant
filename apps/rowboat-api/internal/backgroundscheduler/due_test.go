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

func TestDueTimedTriggerEmpty(t *testing.T) {
	if got := dueTimedTrigger(Triggers{}, nil, ts(t, "2026-06-08T10:00:00Z")); got != "" {
		t.Fatalf("empty triggers: got %q, want empty", got)
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

// TestIsCronDueStepExpressions covers */N step crons across the grace boundary.
func TestIsCronDueStepExpressions(t *testing.T) {
	last := ts(t, "2026-06-08T13:00:00Z")
	cases := []struct {
		name string
		now  string
		want bool
	}{
		{"five_min_at_occurrence", "2026-06-08T13:05:00Z", true},
		{"five_min_within_grace", "2026-06-08T13:06:59Z", true},
		{"five_min_at_grace_edge", "2026-06-08T13:07:00Z", true},
		{"five_min_past_grace", "2026-06-08T13:07:01Z", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isCronDue("*/5 * * * *", &last, ts(t, tc.now)); got != tc.want {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}

// TestIsCronDueLastRunEquality: a last run exactly at the occurrence means the
// cycle already fired (>= comparison); one second before still fires.
func TestIsCronDueLastRunEquality(t *testing.T) {
	occ := ts(t, "2026-06-08T13:00:00Z")
	now := ts(t, "2026-06-08T13:01:00Z")
	if isCronDue("0 * * * *", &occ, now) {
		t.Fatalf("last run == occurrence should not be due")
	}
	justBefore := occ.Add(-time.Second)
	if !isCronDue("0 * * * *", &justBefore, now) {
		t.Fatalf("last run just before occurrence should be due")
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

func TestIsCronDueInvalidOrEmpty(t *testing.T) {
	now := ts(t, "2026-06-08T13:00:00Z")
	if isCronDue("", nil, now) {
		t.Fatalf("empty expr should not be due")
	}
	if isCronDue("not a cron", nil, now) {
		t.Fatalf("invalid expr should not be due even when never run")
	}
}

// TestIsWindowDueCycleStartEquality: a last run exactly at the cycle start is
// not "after" it, so the window is still due (mirrors the JS `>` comparison).
func TestIsWindowDueCycleStartEquality(t *testing.T) {
	cycleStart := ts(t, "2026-06-08T09:00:00Z")
	now := ts(t, "2026-06-08T10:00:00Z")
	if !isWindowDue("09:00", "12:00", &cycleStart, now) {
		t.Fatalf("last run == cycle start should still be due")
	}
	justAfter := cycleStart.Add(time.Second)
	if isWindowDue("09:00", "12:00", &justAfter, now) {
		t.Fatalf("last run just after cycle start should not be due")
	}
}

// TestAdjacentWindowsShareEndpoint: 08-12 and 12-15 both fire at 12:00 because
// both window bounds are inclusive (RFC test plan).
func TestAdjacentWindowsShareEndpoint(t *testing.T) {
	noonish := ts(t, "2026-06-08T12:00:00Z")
	if !isWindowDue("08:00", "12:00", nil, noonish) {
		t.Fatalf("end-inclusive window 08-12 should fire at 12:00")
	}
	if !isWindowDue("12:00", "15:00", nil, noonish) {
		t.Fatalf("start-inclusive window 12-15 should fire at 12:00")
	}
	tr := Triggers{Windows: []Window{{StartTime: "08:00", EndTime: "12:00"}, {StartTime: "12:00", EndTime: "15:00"}}}
	if got := dueTimedTrigger(tr, nil, noonish); got != "window" {
		t.Fatalf("dueTimedTrigger = %q, want window", got)
	}
}

// TestInvertedWindowNeverDue documents that a start-after-end window (which the
// desktop never produces) is treated as never in-band rather than overnight.
func TestInvertedWindowNeverDue(t *testing.T) {
	for _, nowStr := range []string{"2026-06-08T23:30:00Z", "2026-06-08T01:00:00Z", "2026-06-08T12:00:00Z"} {
		if isWindowDue("22:00", "06:00", nil, ts(t, nowStr)) {
			t.Fatalf("inverted window should not be due at %s", nowStr)
		}
	}
}

func TestIsWindowDueMalformedTimes(t *testing.T) {
	now := ts(t, "2026-06-08T10:00:00Z")
	if isWindowDue("9am", "noon", nil, now) {
		t.Fatalf("malformed window times should not be due")
	}
	if isWindowDue("25:00", "26:00", nil, now) {
		t.Fatalf("out-of-range window times should not be due")
	}
}

// TestBackoffRemaining covers the backoff math at the key points.
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

// TestBackoffRemainingMonotonic: the remaining backoff strictly decreases as
// now advances and reaches zero at the window edge.
func TestBackoffRemainingMonotonic(t *testing.T) {
	attempt := ts(t, "2026-06-08T13:00:00Z")
	prev := time.Duration(1<<62 - 1)
	for i := 0; i <= 5; i++ {
		now := attempt.Add(time.Duration(i) * time.Minute)
		d := backoffRemaining(&attempt, now)
		if d > prev {
			t.Fatalf("backoff not monotonic at +%dm: %v > %v", i, d, prev)
		}
		prev = d
	}
	if backoffRemaining(&attempt, attempt.Add(5*time.Minute)) != 0 {
		t.Fatalf("backoff should be zero at the 5m edge")
	}
}

// TestWindowEvaluatedInProvidedLocation is the documented timezone behavior:
// window bands use the wall clock of `now`'s location. The same instant is
// in-band in New York local time but out of band in UTC.
func TestWindowEvaluatedInProvidedLocation(t *testing.T) {
	ny, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skipf("tzdata unavailable: %v", err)
	}
	nowNY := time.Date(2026, 6, 8, 10, 30, 0, 0, ny) // 10:30 EDT == 14:30 UTC
	if !isWindowDue("09:00", "12:00", nil, nowNY) {
		t.Fatalf("10:30 local should be inside the 09:00-12:00 band")
	}
	if isWindowDue("09:00", "12:00", nil, nowNY.UTC()) {
		t.Fatalf("14:30 UTC should be outside the 09:00-12:00 band")
	}
}

// TestCronEvaluatedInProvidedLocation: cron prev-occurrence also respects the
// location of `now`.
func TestCronEvaluatedInProvidedLocation(t *testing.T) {
	ny, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skipf("tzdata unavailable: %v", err)
	}
	yesterday := time.Date(2026, 6, 7, 9, 30, 0, 0, ny)
	nowNY := time.Date(2026, 6, 8, 9, 1, 0, 0, ny) // just after the 9am NY occurrence
	if !isCronDue("0 9 * * *", &yesterday, nowNY) {
		t.Fatalf("09:01 local should be within grace of the 9am NY occurrence")
	}
	if isCronDue("0 9 * * *", &yesterday, nowNY.UTC()) {
		t.Fatalf("13:01 UTC should be outside grace of the 9am UTC occurrence")
	}
}

// TestCronDueOccurrenceMinuteAligned: the matched occurrence is always the
// minute-aligned cron tick, even when `now` falls inside the matching minute at
// some sub-minute second (gronx would otherwise return now-to-the-second).
func TestCronDueOccurrenceMinuteAligned(t *testing.T) {
	now := ts(t, "2026-06-08T13:00:37Z") // inside the matching minute
	occ, ok := cronDueOccurrence("0 * * * *", nil, now)
	if !ok || !occ.Equal(ts(t, "2026-06-08T13:00:00Z")) {
		t.Fatalf("occurrence = %v/%v, want 13:00:00/true (minute-aligned)", occ, ok)
	}
	last := ts(t, "2026-06-08T12:00:00Z")
	occ2, ok2 := cronDueOccurrence("0 * * * *", &last, ts(t, "2026-06-08T13:01:30Z"))
	if !ok2 || !occ2.Equal(ts(t, "2026-06-08T13:00:00Z")) {
		t.Fatalf("occurrence2 = %v/%v, want 13:00:00/true", occ2, ok2)
	}
	if _, ok := cronDueOccurrence("not a cron", nil, now); ok {
		t.Fatalf("invalid expr should return ok=false")
	}
	if _, ok := cronDueOccurrence("", nil, now); ok {
		t.Fatalf("empty expr should return ok=false")
	}
}

func TestFirstDueWindowPicksMatch(t *testing.T) {
	// First window already ran today; second has not → second is the match.
	ranAt0930 := ts(t, "2026-06-08T09:30:00Z")
	now := ts(t, "2026-06-08T13:30:00Z")
	tr := Triggers{Windows: []Window{
		{StartTime: "09:00", EndTime: "10:00"}, // not in band at 13:30
		{StartTime: "13:00", EndTime: "14:00"}, // in band, not yet run today
	}}
	w, ok := firstDueWindow(tr, &ranAt0930, now)
	if !ok || w.StartTime != "13:00" {
		t.Fatalf("firstDueWindow = %+v/%v, want 13:00 window", w, ok)
	}
}
