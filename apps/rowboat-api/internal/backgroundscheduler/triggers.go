// Package backgroundscheduler evaluates cron/window triggers for
// executionTarget=api background tasks inside the Rowboat API deployment, so
// scheduled cloud runs fire while the desktop is offline.
//
// The trigger parser and due math here are a deliberate, bit-for-bit port of
// the desktop scheduler's pure functions
// (apps/x/packages/core/src/schedule/utils.ts) so a task behaves identically
// whether desktop- or cloud-scheduled. The only intentional divergence is
// timezone: the desktop evaluates windows in device-local time, while v1 cloud
// evaluates in the configured scheduler timezone (UTC by default) — callers
// pass `now` already in that location.
package backgroundscheduler

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/adhocore/gronx"
)

// hhmm matches a 24-hour clock time "HH:MM", mirroring the shared Zod validator
// for window bounds (apps/x/packages/shared live-note / background-task schema).
var hhmm = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

// Triggers is the typed view of a task's triggers_json. Unknown fields are
// ignored for forward compatibility (newer desktops may add trigger kinds the
// scheduler does not yet evaluate).
type Triggers struct {
	CronExpr string   `json:"cronExpr"`
	Windows  []Window `json:"windows"`
}

// Window is a once-per-day time-of-day band [StartTime, EndTime], both "HH:MM".
type Window struct {
	StartTime string `json:"startTime"`
	EndTime   string `json:"endTime"`
}

// ParseTriggers decodes and structurally validates a task's triggers_json.
//
// The ent validJSON validator already rejects malformed JSON at write time, so
// the failure this guards against is a well-formed JSON document with the wrong
// shape (e.g. a window time of "9am"). Such tasks are skipped with an
// errors{stage=parse} metric rather than crashing the loop.
//
// Cron expression validity is intentionally NOT enforced here: an invalid cron
// must not suppress a task's otherwise-valid windows (desktop parity). Use
// HasValidCron to check the cron separately.
func ParseTriggers(raw string) (Triggers, error) {
	var tr Triggers
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return tr, nil // manual-only task; no scheduler action
	}
	if err := json.Unmarshal([]byte(trimmed), &tr); err != nil {
		return tr, fmt.Errorf("decode triggers_json: %w", err)
	}
	tr.CronExpr = strings.TrimSpace(tr.CronExpr)
	for i, w := range tr.Windows {
		if !hhmm.MatchString(w.StartTime) || !hhmm.MatchString(w.EndTime) {
			return tr, fmt.Errorf("window %d: times must be HH:MM, got %q-%q", i, w.StartTime, w.EndTime)
		}
	}
	return tr, nil
}

// HasCron reports whether a cron sub-trigger is configured.
func (t Triggers) HasCron() bool { return t.CronExpr != "" }

// HasValidCron reports whether the configured cron expression parses. A false
// result means the cron is skipped (and the scheduler counts a parse error)
// while any windows still evaluate.
func (t Triggers) HasValidCron() bool {
	return t.CronExpr != "" && gronx.IsValid(t.CronExpr)
}

// parseHHMM splits a validated "HH:MM" into minutes-of-day components.
func parseHHMM(v string) (hour, minute int, ok bool) {
	if !hhmm.MatchString(v) {
		return 0, 0, false
	}
	h, _ := strconv.Atoi(v[:2])
	m, _ := strconv.Atoi(v[3:])
	return h, m, true
}
