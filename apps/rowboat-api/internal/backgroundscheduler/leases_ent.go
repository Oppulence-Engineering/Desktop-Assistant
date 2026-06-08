package backgroundscheduler

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtask"
	btss "github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtaskschedulestate"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const (
	// scheduleStateRetention bounds how long schedule-state rows are kept before
	// the cleanup prunes them (RFC 002 Decisions: 7 days).
	scheduleStateRetention = 7 * 24 * time.Hour
	// pruneInterval throttles the retention DELETE: CleanupExpired is called
	// every tick (~15s) but actually prunes at most this often, so the loop does
	// not scan the table every tick to delete nothing.
	pruneInterval = time.Hour
)

// EntLeases is the durable, ent/Postgres-backed Leases implementation (RFC 002).
// The unique index (trigger_type, schedule_key, background_task_id) is the
// cross-replica duplicate guard: exactly one INSERT per cycle wins via
// ON CONFLICT DO NOTHING; the losers load the winner's row and skip or steal.
//
// It works on any ent backend (sqlite for functional tests), but the
// at-most-once guarantee under concurrency is a Postgres property and is tested
// there (RFC 002 test plan).
type EntLeases struct {
	client *ent.Client
	log    *zap.Logger

	mu           sync.Mutex
	lastPrunedAt time.Time // throttles CleanupExpired's retention DELETE
}

// NewEntLeases builds a durable lease store over the given ent client.
func NewEntLeases(client *ent.Client, log *zap.Logger) *EntLeases {
	if log == nil {
		log = zap.NewNop()
	}
	return &EntLeases{client: client, log: log}
}

// Acquire claims the cycle for owner. It inserts the cycle row with a
// client-side id; on a unique conflict the insert is a no-op, so it then loads
// the row and decides: if the stored row carries OUR id we won the insert
// (Held); otherwise the row pre-existed and we skip (fired/held) or steal an
// expired lease.
func (l *EntLeases) Acquire(ctx context.Context, task *ent.BackgroundTask, triggerType, scheduleKey, owner string, ttl time.Duration) (Lease, bool, error) {
	if task.Edges.User == nil {
		return Lease{}, false, errors.New("backgroundscheduler: Acquire requires task.Edges.User")
	}
	now := time.Now().UTC()
	exp := now.Add(ttl)
	myID := uuid.New()

	if err := l.client.BackgroundTaskScheduleState.Create().
		SetID(myID).
		SetUser(task.Edges.User).
		SetTask(task).
		SetTriggerType(triggerType).
		SetScheduleKey(scheduleKey).
		SetLeaseOwner(owner).
		SetLeaseExpiresAt(exp).
		SetLastEvaluatedAt(now).
		OnConflictColumns(btss.FieldTriggerType, btss.FieldScheduleKey, btss.TaskColumn).
		Ignore().
		Exec(ctx); err != nil {
		leaseMetrics.Errors.WithLabelValues("acquire").Inc()
		return Lease{}, false, err
	}

	row, err := l.client.BackgroundTaskScheduleState.Query().
		Where(
			btss.TriggerTypeEQ(triggerType),
			btss.ScheduleKeyEQ(scheduleKey),
			btss.HasTaskWith(backgroundtask.IDEQ(task.ID)),
		).
		Only(ctx)
	if err != nil {
		leaseMetrics.Errors.WithLabelValues("acquire").Inc()
		return Lease{}, false, err
	}

	// We inserted it → we own the fresh cycle.
	if row.ID == myID {
		leaseMetrics.Acquired.Inc()
		return Lease{ID: row.ID, Revision: row.Revision, Key: scheduleKey, Owner: owner}, true, nil
	}

	// (2) Already fired — the do-not-re-fire sentinel.
	if row.LastRunID != "" {
		leaseMetrics.Skipped.WithLabelValues("fired").Inc()
		return Lease{}, false, nil
	}
	// (3) A peer holds a live lease.
	if row.LeaseExpiresAt != nil && now.Before(*row.LeaseExpiresAt) {
		leaseMetrics.Skipped.WithLabelValues("held").Inc()
		return Lease{}, false, nil
	}

	// (4) Expired/unheld → steal via a revision-guarded CAS. Exactly one
	// concurrent thief observes n == 1.
	n, err := l.client.BackgroundTaskScheduleState.Update().
		Where(
			btss.IDEQ(row.ID),
			btss.RevisionEQ(row.Revision),
			btss.LastRunIDEQ(""),
			btss.Or(btss.LeaseExpiresAtIsNil(), btss.LeaseExpiresAtLTE(now)),
		).
		SetLeaseOwner(owner).
		SetLeaseExpiresAt(exp).
		SetLastEvaluatedAt(now).
		AddRevision(1).
		Save(ctx)
	if err != nil {
		leaseMetrics.Errors.WithLabelValues("acquire").Inc()
		return Lease{}, false, err
	}
	if n == 0 {
		leaseMetrics.Skipped.WithLabelValues("steal_lost").Inc()
		return Lease{}, false, nil
	}
	leaseMetrics.Stolen.Inc()
	return Lease{ID: row.ID, Revision: row.Revision + 1, Key: scheduleKey, Owner: owner}, true, nil
}

// Complete marks the cycle fired — the permanent do-not-re-fire sentinel. It is
// guarded by id+revision+owner and last_run_id==” so only the current,
// not-yet-completed owner can finalize it.
func (l *EntLeases) Complete(ctx context.Context, lease Lease, runID string) error {
	now := time.Now().UTC()
	n, err := l.client.BackgroundTaskScheduleState.Update().
		Where(
			btss.IDEQ(lease.ID),
			btss.RevisionEQ(lease.Revision),
			btss.LeaseOwnerEQ(lease.Owner),
			btss.LastRunIDEQ(""),
		).
		SetLastRunID(runID).
		SetLastTriggeredAt(now).
		SetLastEvaluatedAt(now).
		ClearLeaseExpiresAt().
		SetLeaseOwner("").
		AddRevision(1).
		Save(ctx)
	if err != nil {
		leaseMetrics.Errors.WithLabelValues("complete").Inc()
		return err
	}
	if n == 0 {
		// The run may exist even though the lease did not complete (lost the
		// row to a steal, or a double-complete). The reconciler/sweep heals it.
		l.log.Error("schedule lease complete affected no rows",
			zap.String("leaseId", lease.ID.String()), zap.String("scheduleKey", lease.Key),
			zap.String("owner", lease.Owner), zap.String("runId", runID))
	}
	return nil
}

// Release relinquishes a lease whose run never started, so the cycle stays
// eligible (it does NOT set last_run_id). Guarded by id+revision and unfired.
func (l *EntLeases) Release(ctx context.Context, lease Lease, cause error) error {
	l.log.Warn("releasing schedule lease after failed run start",
		zap.String("leaseId", lease.ID.String()), zap.String("scheduleKey", lease.Key), zap.Error(cause))
	_, err := l.client.BackgroundTaskScheduleState.Update().
		Where(
			btss.IDEQ(lease.ID),
			btss.RevisionEQ(lease.Revision),
			btss.LastRunIDEQ(""),
		).
		ClearLeaseExpiresAt().
		SetLeaseOwner("").
		SetLastEvaluatedAt(time.Now().UTC()).
		AddRevision(1).
		Save(ctx)
	if err != nil {
		leaseMetrics.Errors.WithLabelValues("release").Inc()
		return err
	}
	return nil
}

// CleanupExpired prunes schedule-state rows older than the retention window so
// the table stays bounded. It deletes ALL old rows, not just Fired ones: a row
// older than the window is for a cron occurrence / window date that is long past
// and can never recur, so an unfired orphan (left by a Release or a
// crash-before-Complete on a cycle that has since lapsed) is dead weight too —
// pruning only Fired rows would leak those unbounded. Live leases are seconds
// old and never within the window. It is throttled to pruneInterval since the
// scheduler calls it every tick. Runs under the scheduler's internal context.
func (l *EntLeases) CleanupExpired(ctx context.Context) error {
	now := time.Now().UTC()
	l.mu.Lock()
	due := now.Sub(l.lastPrunedAt) >= pruneInterval
	if due {
		l.lastPrunedAt = now
	}
	l.mu.Unlock()
	if !due {
		return nil
	}

	n, err := l.client.BackgroundTaskScheduleState.Delete().
		Where(btss.CreatedAtLT(now.Add(-scheduleStateRetention))).
		Exec(ctx)
	if err != nil {
		leaseMetrics.Errors.WithLabelValues("prune").Inc()
		return err
	}
	if n > 0 {
		leaseMetrics.Pruned.Add(float64(n))
		l.log.Info("pruned old schedule-state rows", zap.Int("count", n))
	}
	return nil
}
