package backgroundscheduler

import (
	"testing"
	"time"
)

func TestCronKey(t *testing.T) {
	occ := time.Date(2026, 6, 5, 14, 0, 0, 0, time.UTC)
	if got := CronKey("0 * * * *", occ); got != "cron:0 * * * *:2026-06-05T14:00:00Z" {
		t.Fatalf("CronKey = %q", got)
	}
	// Non-UTC occurrence is normalized to UTC so the key is timezone-stable.
	ny, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skipf("tzdata unavailable: %v", err)
	}
	occNY := occ.In(ny)
	if CronKey("0 * * * *", occNY) != CronKey("0 * * * *", occ) {
		t.Fatalf("CronKey must be identical regardless of the occurrence's location")
	}
}

func TestWindowKey(t *testing.T) {
	cycle := time.Date(2026, 6, 5, 9, 30, 0, 0, time.UTC)
	if got := WindowKey("09:00", "12:00", cycle); got != "window:09:00-12:00:2026-06-05" {
		t.Fatalf("WindowKey = %q", got)
	}
}

// TestScheduleKeysDeterministicAndDistinct: the same cycle yields the same key,
// and distinct cycles (different occurrence/date/expr/window) never collide.
func TestScheduleKeysDeterministicAndDistinct(t *testing.T) {
	occ1 := time.Date(2026, 6, 5, 14, 0, 0, 0, time.UTC)
	occ2 := time.Date(2026, 6, 5, 15, 0, 0, 0, time.UTC)
	seen := map[string]int{}
	keys := []string{
		CronKey("0 * * * *", occ1),
		CronKey("0 * * * *", occ1),   // identical → same key
		CronKey("0 * * * *", occ2),   // different occurrence
		CronKey("*/5 * * * *", occ1), // different expr
		WindowKey("09:00", "12:00", occ1),
		WindowKey("09:00", "12:00", occ1.AddDate(0, 0, 1)), // different date
		WindowKey("12:00", "15:00", occ1),                  // different window
	}
	for _, k := range keys {
		seen[k]++
	}
	// 7 keys, exactly one duplicate pair (the two identical CronKey calls) → 6 distinct.
	if len(seen) != 6 {
		t.Fatalf("expected 6 distinct keys, got %d: %v", len(seen), seen)
	}
	if seen[CronKey("0 * * * *", occ1)] != 2 {
		t.Fatalf("identical cycle must produce the same key")
	}
}
