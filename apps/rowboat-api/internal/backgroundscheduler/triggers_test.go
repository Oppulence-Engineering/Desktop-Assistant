package backgroundscheduler

import "testing"

func TestParseTriggers(t *testing.T) {
	cases := []struct {
		name    string
		raw     string
		wantErr bool
		check   func(*testing.T, Triggers)
	}{
		{
			name: "empty is manual-only",
			raw:  "",
			check: func(t *testing.T, tr Triggers) {
				if tr.HasCron() || len(tr.Windows) != 0 {
					t.Fatalf("expected empty triggers, got %+v", tr)
				}
			},
		},
		{
			name: "empty object is manual-only",
			raw:  `{}`,
			check: func(t *testing.T, tr Triggers) {
				if tr.HasCron() || len(tr.Windows) != 0 {
					t.Fatalf("expected empty triggers, got %+v", tr)
				}
			},
		},
		{
			name: "cron and windows",
			raw:  `{"cronExpr":"*/5 * * * *","windows":[{"startTime":"09:00","endTime":"12:00"}]}`,
			check: func(t *testing.T, tr Triggers) {
				if !tr.HasValidCron() {
					t.Fatalf("expected valid cron, got %q", tr.CronExpr)
				}
				if len(tr.Windows) != 1 || tr.Windows[0].StartTime != "09:00" {
					t.Fatalf("unexpected windows: %+v", tr.Windows)
				}
			},
		},
		{
			name: "unknown fields ignored",
			raw:  `{"cronExpr":"0 * * * *","eventMatchCriteria":{"foo":"bar"},"extra":42}`,
			check: func(t *testing.T, tr Triggers) {
				if tr.CronExpr != "0 * * * *" {
					t.Fatalf("cron lost: %q", tr.CronExpr)
				}
			},
		},
		{
			name: "cron is trimmed",
			raw:  `{"cronExpr":"  0 * * * *  "}`,
			check: func(t *testing.T, tr Triggers) {
				if tr.CronExpr != "0 * * * *" {
					t.Fatalf("cron not trimmed: %q", tr.CronExpr)
				}
			},
		},
		{
			name: "bad window time parses but is flagged invalid",
			raw:  `{"windows":[{"startTime":"9am","endTime":"noon"}]}`,
			check: func(t *testing.T, tr Triggers) {
				if len(tr.InvalidWindows()) != 1 {
					t.Fatalf("expected 1 invalid window, got %d", len(tr.InvalidWindows()))
				}
			},
		},
		{
			name: "bad window does not suppress a valid cron",
			raw:  `{"cronExpr":"0 9 * * *","windows":[{"startTime":"9am","endTime":"17:00"}]}`,
			check: func(t *testing.T, tr Triggers) {
				if !tr.HasValidCron() {
					t.Fatalf("valid cron must survive a malformed sibling window")
				}
				if len(tr.InvalidWindows()) != 1 {
					t.Fatalf("expected 1 invalid window, got %d", len(tr.InvalidWindows()))
				}
			},
		},
		{
			name:    "malformed json rejected",
			raw:     `{"cronExpr":`,
			wantErr: true,
		},
		{
			name: "invalid cron parses but is not valid",
			raw:  `{"cronExpr":"not a cron"}`,
			check: func(t *testing.T, tr Triggers) {
				if !tr.HasCron() {
					t.Fatalf("cron should be present")
				}
				if tr.HasValidCron() {
					t.Fatalf("cron should be invalid")
				}
			},
		},
		{
			name: "window bounds at extremes accepted",
			raw:  `{"windows":[{"startTime":"00:00","endTime":"23:59"}]}`,
			check: func(t *testing.T, tr Triggers) {
				if len(tr.Windows) != 1 {
					t.Fatalf("expected one window, got %d", len(tr.Windows))
				}
			},
		},
		{
			name: "whitespace-only cron is not a cron",
			raw:  `{"cronExpr":"   "}`,
			check: func(t *testing.T, tr Triggers) {
				if tr.HasCron() {
					t.Fatalf("whitespace-only cron should not count as a cron")
				}
			},
		},
		{
			name: "multiple windows preserved in order",
			raw:  `{"windows":[{"startTime":"08:00","endTime":"12:00"},{"startTime":"13:00","endTime":"17:00"}]}`,
			check: func(t *testing.T, tr Triggers) {
				if len(tr.Windows) != 2 || tr.Windows[1].StartTime != "13:00" {
					t.Fatalf("windows not preserved in order: %+v", tr.Windows)
				}
			},
		},
		{
			name: "one bad window is flagged, the valid one is kept",
			raw:  `{"windows":[{"startTime":"08:00","endTime":"12:00"},{"startTime":"bad","endTime":"17:00"}]}`,
			check: func(t *testing.T, tr Triggers) {
				if len(tr.Windows) != 2 {
					t.Fatalf("both windows should be parsed, got %d", len(tr.Windows))
				}
				if len(tr.InvalidWindows()) != 1 {
					t.Fatalf("expected exactly 1 invalid window, got %d", len(tr.InvalidWindows()))
				}
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tr, err := ParseTriggers(tc.raw)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error for %q", tc.raw)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tc.check != nil {
				tc.check(t, tr)
			}
		})
	}
}

// TestParseHHMMBoundaries checks the clock-time validator accepts the legal
// extremes and rejects out-of-range values (mirrors the shared Zod regex).
func TestParseHHMMBoundaries(t *testing.T) {
	valid := []string{"00:00", "09:05", "12:00", "23:59"}
	for _, v := range valid {
		if _, _, ok := parseHHMM(v); !ok {
			t.Fatalf("%q should be valid", v)
		}
	}
	invalid := []string{"24:00", "23:60", "9:00", "09:5", "", "aa:bb", "12:00:00", "-1:00"}
	for _, v := range invalid {
		if _, _, ok := parseHHMM(v); ok {
			t.Fatalf("%q should be invalid", v)
		}
	}
}

func TestHasValidCron(t *testing.T) {
	if (Triggers{}).HasValidCron() {
		t.Fatalf("no cron should not be valid")
	}
	if !(Triggers{CronExpr: "*/15 * * * *"}).HasValidCron() {
		t.Fatalf("*/15 should be valid")
	}
	if (Triggers{CronExpr: "totally bogus"}).HasValidCron() {
		t.Fatalf("bogus cron should not be valid")
	}
}
