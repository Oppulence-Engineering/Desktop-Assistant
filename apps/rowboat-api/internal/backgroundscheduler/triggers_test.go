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
			name:    "bad window time rejected",
			raw:     `{"windows":[{"startTime":"9am","endTime":"noon"}]}`,
			wantErr: true,
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
