package backgroundscheduler

import (
	"fmt"
	"time"
)

// Schedule keys are the deterministic, collision-free identity of a single
// scheduled cycle (RFC 002 "Schedule keys"). They are the payload of the
// schedule-state unique index, so re-evaluating the same occurrence must yield
// the same key → the same row → the cross-replica duplicate guard. The format
// is stable; changing it is a breaking change for in-flight cycles.

// CronKey is the key for one cron occurrence: "cron:{expr}:{occurrence}".
// The occurrence is the minute-aligned prev-tick (see cronDueOccurrence),
// formatted as RFC3339 in UTC so the key is timezone-stable.
func CronKey(expr string, occurrence time.Time) string {
	return fmt.Sprintf("cron:%s:%s", expr, occurrence.UTC().Format(time.RFC3339))
}

// WindowKey is the key for one window cycle: "window:{start}-{end}:{cycle-date}".
// cycle is the date of the window's startTime anchor in the scheduler's
// location; only its calendar date is used, giving once-per-day identity.
func WindowKey(start, end string, cycle time.Time) string {
	return fmt.Sprintf("window:%s-%s:%s", start, end, cycle.Format("2006-01-02"))
}
