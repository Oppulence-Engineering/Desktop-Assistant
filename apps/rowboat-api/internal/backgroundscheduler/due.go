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

// dueResult is the single evaluation of a task's timed triggers: which
// sub-trigger (if any) is ready to fire, plus the concrete occurrence/window it
// matched. Computing this once (rather than deciding due-ness and then
// re-deriving the occurrence for provenance) keeps the firing decision and the
// schedule/lease key describing the SAME cycle.
type dueResult struct {
	source     string    // "" | "cron" | "window"
	occurrence time.Time // matched cron occurrence (source == "cron")
	window     Window    // matched window (source == "window")
}

// evaluateDue reports which timed sub-trigger has a cycle ready to fire at `now`
// and the occurrence/window it matched. It is a pure cycle check and does NOT
// consider backoff — the caller gates on backoff separately.
//
// Cron wins over window when both are due (schedule/utils.ts:32-36). Cycle
// accounting is anchored on lastRunAt, which advances only on a successful run
// (or, for the cloud scheduler, optimistically at fire), so a failed run leaves
// the cycle unfired and this returns the matched trigger again. Mirrors
// schedule/utils.ts:26-41.
//
// lastAttemptAt widens the cron grace window for a pending retry — see
// cronDueOccurrence.
func evaluateDue(tr Triggers, lastRunAt, lastAttemptAt *time.Time, now time.Time) dueResult {
	if occ, ok := cronDueOccurrence(tr.CronExpr, lastRunAt, lastAttemptAt, now); ok {
		return dueResult{source: "cron", occurrence: occ}
	}
	if w, ok := firstDueWindow(tr, lastRunAt, now); ok {
		return dueResult{source: "window", window: w}
	}
	return dueResult{}
}

// dueTimedTrigger reports which timed sub-trigger is ready to fire: "cron",
// "window", or "" for none. Thin wrapper over evaluateDue.
func dueTimedTrigger(tr Triggers, lastRunAt, lastAttemptAt *time.Time, now time.Time) string {
	return evaluateDue(tr, lastRunAt, lastAttemptAt, now).source
}

// cronDueOccurrence reports whether the cron cycle is ready to fire at `now` and
// returns the matched occurrence (the most-recent tick at-or-before now).
//
// The occurrence is computed against `now` truncated to the minute, so it is
// always minute-aligned (matching cron-parser's .prev()) and stable across
// ticks within the same minute — gronx.PrevTickBefore with inclRefTime returns
// the reference time to the second when it is itself due, which would otherwise
// make the occurrence (and the schedule/lease key built from it) drift every
// tick. Mirrors schedule/utils.ts:55-75.
//
// An invalid expression returns (_, false) rather than erroring, matching the
// desktop's try/catch; the scheduler surfaces invalid cron via
// Triggers.HasValidCron.
//
// Grace: normally an occurrence is fireable for cronGrace after it ticks. But
// when the current cycle has a PENDING RETRY — lastAttemptAt is newer than
// lastRunAt, i.e. a start was attempted and failed without advancing the cycle
// — the grace is widened by retryBackoff (plus a tick of slack). Without this,
// retryBackoff (5m) > cronGrace (2m) guarantees the post-backoff retry finds
// the occurrence already outside grace and the occurrence is silently dropped
// on any single transient start failure. The schedule-state row (keyed by the
// unchanged occurrence) still dedupes the retry against any concurrent fire.
func cronDueOccurrence(expr string, lastRunAt, lastAttemptAt *time.Time, now time.Time) (time.Time, bool) {
	if expr == "" || !gronx.IsValid(expr) {
		return time.Time{}, false
	}
	occurrence, err := gronx.PrevTickBefore(expr, now.Truncate(time.Minute), true)
	if err != nil {
		return time.Time{}, false
	}
	if lastRunAt == nil {
		return occurrence, true // never ran — immediately due
	}
	// Already ran at-or-after this occurrence → skip.
	if !lastRunAt.Before(occurrence) {
		return time.Time{}, false
	}
	grace := cronGrace
	if lastAttemptAt != nil && lastAttemptAt.After(*lastRunAt) {
		grace += retryBackoff + time.Minute
	}
	// Within grace → fire; outside grace → missed, skip.
	if now.After(occurrence.Add(grace)) {
		return time.Time{}, false
	}
	return occurrence, true
}

// isCronDue reports whether the cron cycle is ready to fire at `now`.
func isCronDue(expr string, lastRunAt, lastAttemptAt *time.Time, now time.Time) bool {
	_, ok := cronDueOccurrence(expr, lastRunAt, lastAttemptAt, now)
	return ok
}

// firstDueWindow returns the first window whose daily cycle is ready to fire at
// `now`, matching the iteration order evaluateDue uses to report "window".
func firstDueWindow(tr Triggers, lastRunAt *time.Time, now time.Time) (Window, bool) {
	for _, w := range tr.Windows {
		if isWindowDue(w.StartTime, w.EndTime, lastRunAt, now) {
			return w, true
		}
	}
	return Window{}, false
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

// NextWindowStart predicts when the loop would next fire any of the task's
// daily windows, using the same cycle semantics as isWindowDue (RFC 006
// schedule-state display). Returns nil when no window is valid. A window that
// is due right now reports `now`; one already fired today (lastRunAt after
// today's cycle start) reports tomorrow's start.
func NextWindowStart(tr Triggers, lastRunAt *time.Time, now time.Time) *time.Time {
	var next *time.Time
	for _, w := range tr.Windows {
		startHour, startMin, ok := parseHHMM(w.StartTime)
		if !ok {
			continue
		}
		endHour, endMin, ok := parseHHMM(w.EndTime)
		if !ok {
			continue
		}
		cycleStart := time.Date(now.Year(), now.Month(), now.Day(), startHour, startMin, 0, 0, now.Location())
		cycleEnd := time.Date(now.Year(), now.Month(), now.Day(), endHour, endMin, 0, 0, now.Location())
		firedToday := lastRunAt != nil && lastRunAt.After(cycleStart)
		var candidate time.Time
		switch {
		case firedToday || now.After(cycleEnd):
			candidate = cycleStart.AddDate(0, 0, 1)
		case now.Before(cycleStart):
			candidate = cycleStart
		default:
			candidate = now // inside the band and unfired — due immediately
		}
		if next == nil || candidate.Before(*next) {
			c := candidate
			next = &c
		}
	}
	return next
}
