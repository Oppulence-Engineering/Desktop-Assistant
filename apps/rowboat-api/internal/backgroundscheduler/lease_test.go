package backgroundscheduler

import (
	"context"
	"errors"
	"testing"
	"time"
)

// TestNoopLeasesAlwaysGrants: the single-replica default grants every lease and
// no-ops the rest, so the loop's lease calls are harmless until RFC 002 wires a
// real implementation.
func TestNoopLeasesAlwaysGrants(t *testing.T) {
	var l Leases = NoopLeases{}
	ctx := context.Background()

	lease, ok, err := l.Acquire(ctx, nil, "cron", "cron:2026-06-08T13:00:00Z", "owner", 90*time.Second)
	if err != nil || !ok {
		t.Fatalf("Acquire = %+v, ok=%v, err=%v; want granted", lease, ok, err)
	}
	if err := l.Complete(ctx, lease.ID, "sched-cron-1"); err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if err := l.Release(ctx, lease.ID, errors.New("boom")); err != nil {
		t.Fatalf("Release: %v", err)
	}
	if err := l.CleanupExpired(ctx); err != nil {
		t.Fatalf("CleanupExpired: %v", err)
	}
}
