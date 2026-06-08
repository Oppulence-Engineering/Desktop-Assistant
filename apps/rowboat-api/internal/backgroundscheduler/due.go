package backgroundscheduler

import (
	"time"

	"github.com/adhocore/gronx"
)

// Timing constants ported verbatim from schedule/utils.ts. cronGrace is the
// window after a cron occurrence within which a fire is still honored (avoids
// replay storms after downtime); retryBackoff is the cool-off after a failed
// attempt before the cycle retries.
const (
	cronGrace    = 2 * time.Minute // schedule/utils.ts GRACE_MS
	retryBackoff = 5 * time.Minute // schedule/utils.ts RETRY_BACKOFF_MS
)

// dueTimedTrigger reports which timed sub-trigger (if any) has a cycle ready to
// fire at `now`: "cron", "window", or "" for none. It is a pure cycle check and
// does NOT consider backoff — the caller gates on backoff separately.
//
// Cron wins over window when both are due (schedule/utils.ts:32-36). Cycle
// accounting is anchored on lastRunAt, which advances only on a *successful*
// run, so a failed run leaves the cycle unfired and this returns the matched
// trigger again next tick (gated by backoff). Mirrors schedule/utils.ts:26-41.
func dueTimedTrigger(tr Triggers, lastRunAt *time.Time, now time.Time) string {
	if isCronDue(tr.CronExpr, lastRunAt, now) {
		return "cron"
	}
	if _, ok := firstDueWindow(tr, lastRunAt, now); ok {
		return "window"
	}
	return ""
}

// firstDueWindow returns the first window whose daily cycle is ready to fire,
// matching the iteration order dueTimedTrigger uses to report "window".
func firstDueWindow(tr Triggers, lastRunAt *time.Time, now time.Time) (Window, bool) {
	for _, w := range tr.Windows {
		if isWindowDue(w.StartTime, w.EndTime, lastRunAt, now) {
			return w, true
		}
	}
	return Window{}, false
}

// cronOccurrence returns the most-recent occurrence at-or-before now for a valid
// expression, used to build run provenance and the lease key. The bool is false
// for an empty/invalid expression.
func cronOccurrence(expr string, now time.Time) (time.Time, bool) {
	if expr == "" || !gronx.IsValid(expr) {
		return time.Time{}, false
	}
	occ, err := gronx.PrevTickBefore(expr, now, true)
	if err != nil {
		return time.Time{}, false
	}
	return occ, true
}

// isCronDue reports whether the cron cycle is ready to fire at `now`.
//
// It finds the most-recent occurrence at-or-before `now` (the previous tick,
// not the one after lastRunAt — an old lastRunAt would otherwise pin evaluation
// to an ancient occurrence that always falls outside the grace window and would
// block every future fire). It fires iff lastRunAt is before that occurrence
// AND `now` is within the grace window after it. Mirrors schedule/utils.ts:55-75.
//
// An invalid expression returns false (not due) rather than erroring, matching
// the desktop's try/catch; the scheduler surfaces invalid cron as a parse
// metric via Triggers.HasValidCron.
func isCronDue(expr string, lastRunAt *time.Time, now time.Time) bool {
	if expr == "" || !gronx.IsValid(expr) {
		// Invalid cron is skipped (not due) so it never fires and never
		// suppresses a sibling window. Validity is checked before the never-ran
		// shortcut so garbage expressions don't fire once on a fresh task.
		return false
	}
	if lastRunAt == nil {
		return true // never ran — immediately due
	}
	occurrence, err := gronx.PrevTickBefore(expr, now, true)
	if err != nil {
		return false
	}
	// Already ran at-or-after this occurrence → skip.
	if !lastRunAt.Before(occurrence) {
		return false
	}
	// Within grace → fire; outside grace → missed, skip.
	return !now.After(occurrence.Add(cronGrace))
}

// isWindowDue reports whether a daily window [start,end] is ready to fire at
// `now`: `now` is inside the time-of-day band AND lastRunAt is before today's
// cycle start (anchored at `start`). Fires at most once per day per window.
// Adjacent windows sharing an endpoint (e.g. 08–12 and 12–15) each still fire,
// because both bounds are inclusive. Mirrors schedule/utils.ts:77-92.
//
// `now` is evaluated in its own location, so the caller controls the timezone
// (UTC for v1). The desktop evaluates in device-local time — the one accepted,
// documented divergence.
func isWindowDue(start, end string, lastRunAt *time.Time, now time.Time) bool {
	startHour, startMin, ok := parseHHMM(start)
	if !ok {
		return false
	}
	endHour, endMin, ok := parseHHMM(end)
	if !ok {
		return false
	}
	startMinutes := startHour*60 + startMin
	endMinutes := endHour*60 + endMin
	nowMinutes := now.Hour()*60 + now.Minute()
	if nowMinutes < startMinutes || nowMinutes > endMinutes {
		return false
	}
	if lastRunAt == nil {
		return true
	}
	cycleStart := time.Date(now.Year(), now.Month(), now.Day(), startHour, startMin, 0, 0, now.Location())
	return !lastRunAt.After(cycleStart)
}

// backoffRemaining returns how long until the retry backoff lifts: a positive
// duration while within retryBackoff of the last attempt, or 0 otherwise (also
// 0 if the attempt timestamp is somehow in the future). Mirrors
// schedule/utils.ts backoffRemainingMs.
func backoffRemaining(lastAttemptAt *time.Time, now time.Time) time.Duration {
	if lastAttemptAt == nil {
		return 0
	}
	since := now.Sub(*lastAttemptAt)
	if since < 0 || since >= retryBackoff {
		return 0
	}
	return retryBackoff - since
}
