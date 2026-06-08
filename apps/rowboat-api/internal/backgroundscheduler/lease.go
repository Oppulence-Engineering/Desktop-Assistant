package backgroundscheduler

import (
	"context"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
)

// Lease is the handle returned by Leases.Acquire. RFC 002 fills in the durable
// fields; the scheduler only needs the id to Complete or Release it.
type Lease struct {
	ID  string
	Key string
}

// Leases gates at-most-once-per-cycle run creation across replicas. RFC 001
// keeps the calls in the loop with a no-op implementation so going from one
// replica to many is a configuration change, not a code change; RFC 002
// (Durable Schedule State) provides the Postgres-backed implementation.
//
// Acquire returns (lease, true, nil) when this replica owns the cycle, or
// (_, false, nil) when another replica already holds it. Complete records the
// run that satisfied the cycle; Release relinquishes a lease whose run never
// started (so the cycle retries). CleanupExpired reaps stale leases each tick.
type Leases interface {
	Acquire(ctx context.Context, task *ent.BackgroundTask, source, key, owner string, ttl time.Duration) (Lease, bool, error)
	Complete(ctx context.Context, leaseID, runID string) error
	Release(ctx context.Context, leaseID string, cause error) error
	CleanupExpired(ctx context.Context) error
}

// NoopLeases always grants the lease. Correctness with a single evaluator then
// rests on the task's own runtime fields (last_run_at advances only on success;
// last_attempt_at anchors backoff), exactly as the desktop scheduler relies on
// them. Safe ONLY for a single replica — do not scale past one until a real
// Leases implementation (RFC 002) is wired.
type NoopLeases struct{}

func (NoopLeases) Acquire(context.Context, *ent.BackgroundTask, string, string, string, time.Duration) (Lease, bool, error) {
	return Lease{}, true, nil
}
func (NoopLeases) Complete(context.Context, string, string) error { return nil }
func (NoopLeases) Release(context.Context, string, error) error   { return nil }
func (NoopLeases) CleanupExpired(context.Context) error           { return nil }
