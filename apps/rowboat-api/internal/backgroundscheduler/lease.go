package backgroundscheduler

import (
	"context"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/google/uuid"
)

// Lease is the handle returned by Leases.Acquire — the durable schedule-state
// row this replica now owns for one cycle. Revision and Owner are carried so
// Complete/Release can guard their writes (only the current owner, at the
// expected revision, may finalize the cycle).
type Lease struct {
	ID       uuid.UUID
	Revision int
	Key      string
	Owner    string
}

// Leases gates at-most-once-per-cycle run creation across replicas. RFC 001
// keeps the calls in the loop with a no-op implementation so going from one
// replica to many is a configuration change, not a code change; RFC 002
// (Durable Schedule State) provides the durable ent/Postgres implementation
// (EntLeases).
//
// Acquire returns (lease, true, nil) when this replica owns the cycle, or
// (_, false, nil) when a peer already holds or fired it. Complete records the
// run that satisfied the cycle (the permanent do-not-re-fire sentinel); Release
// relinquishes a lease whose run never started (so the cycle retries).
// CleanupExpired reaps/heals stale rows and prunes old fired cycles each tick.
type Leases interface {
	Acquire(ctx context.Context, task *ent.BackgroundTask, triggerType, scheduleKey, owner string, ttl time.Duration) (Lease, bool, error)
	Complete(ctx context.Context, lease Lease, runID string) error
	Release(ctx context.Context, lease Lease, cause error) error
	CleanupExpired(ctx context.Context) error
}

// NoopLeases always grants the lease. Correctness with a single evaluator then
// rests on the task's own runtime fields (last_run_at advances only on success;
// last_attempt_at anchors backoff), exactly as the desktop scheduler relies on
// them. Safe ONLY for a single replica — use EntLeases (RFC 002) to scale past
// one.
type NoopLeases struct{}

// Acquire always grants the lease (single-replica safety comes from the task's
// own last_run_at cycle anchoring).
func (NoopLeases) Acquire(context.Context, *ent.BackgroundTask, string, string, string, time.Duration) (Lease, bool, error) {
	return Lease{}, true, nil
}

// Complete is a no-op; there is no durable lease to mark satisfied.
func (NoopLeases) Complete(context.Context, Lease, string) error { return nil }

// Release is a no-op; there is no durable lease to relinquish.
func (NoopLeases) Release(context.Context, Lease, error) error { return nil }

// CleanupExpired is a no-op; there are no durable leases to reap.
func (NoopLeases) CleanupExpired(context.Context) error { return nil }
