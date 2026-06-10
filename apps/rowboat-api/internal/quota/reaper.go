package quota

import (
	"context"
	"strings"
	"time"

	"entgo.io/ent/dialect/sql"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/creditledger"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"go.uber.org/zap"
)

const (
	// reaperInterval paces the orphan sweep.
	reaperInterval = 15 * time.Minute

	// reaperMinAge is how old a reserve row must be before it is considered
	// orphaned. It must exceed the longest possible in-flight charge by a
	// wide margin (the Temporal activity StartToCloseTimeout is 5m and
	// upstream HTTP timeouts are ~30s) so a refunded reservation can never
	// still settle: a late settle after the refund would hit the
	// (request_id, reason) unique index and be dropped as already-applied.
	reaperMinAge = time.Hour

	// reaperBatch bounds one sweep.
	reaperBatch = 200
)

// RunReaper sweeps for orphaned reservations until ctx is cancelled. An
// orphan is a `<op>.reserve` ledger row whose process died between Reserve
// and Settle/Refund — without this, the debited estimate is lost forever
// (credits.Available sums the raw ledger and nothing else ever revisits the
// row). Runs in the scheduler process, the always-on housekeeping home.
func RunReaper(ctx context.Context, client *ent.Client, log *zap.Logger) {
	if log == nil {
		log = zap.NewNop()
	}
	ticker := time.NewTicker(reaperInterval)
	defer ticker.Stop()
	for {
		if n, err := ReapOrphanedReservations(ctx, client, log, reaperMinAge); err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Warn("reservation reaper sweep failed", zap.Error(err))
		} else if n > 0 {
			log.Info("refunded orphaned credit reservations", zap.Int("count", n))
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// ReapOrphanedReservations refunds reserve rows older than olderThan that
// have no terminal (settle/refund) row for the same request id. Idempotent
// and race-safe: the refund reuses the charge's request id and terminal
// reason, so the (request_id, reason) unique index makes a concurrent or
// late terminal write a no-op for whichever side loses.
func ReapOrphanedReservations(ctx context.Context, client *ent.Client, log *zap.Logger, olderThan time.Duration) (int, error) {
	ctx = auth.WithInternal(ctx)
	cutoff := time.Now().UTC().Add(-olderThan)

	orphans, err := client.CreditLedger.Query().
		Where(
			creditledger.ReasonHasSuffix(reserveReasonSuffix),
			creditledger.TsLT(cutoff),
			// Anti-join: no terminal row shares this request id. request_id
			// is unique per charge, so the suffix match is sufficient.
			func(s *sql.Selector) {
				t := sql.Table(creditledger.Table).As("terminal")
				s.Where(sql.NotExists(
					sql.Select(t.C(creditledger.FieldID)).From(t).Where(sql.And(
						sql.ColumnsEQ(t.C(creditledger.FieldRequestID), s.C(creditledger.FieldRequestID)),
						sql.Like(t.C(creditledger.FieldReason), "%"+terminalReasonSuffix),
					)),
				))
			},
		).
		WithUser().
		Order(ent.Asc(creditledger.FieldTs)).
		Limit(reaperBatch).
		All(ctx)
	if err != nil {
		return 0, err
	}

	reaped := 0
	for _, orphan := range orphans {
		owner := orphan.Edges.User
		if owner == nil {
			continue // user gone; nothing to credit
		}
		terminalReason := strings.TrimSuffix(orphan.Reason, reserveReasonSuffix) + terminalReasonSuffix
		err := client.CreditLedger.Create().
			SetUser(owner).
			SetDelta(-orphan.Delta). // reserve deltas are negative; refund the full estimate
			SetReason(terminalReason).
			SetRequestID(orphan.RequestID).
			Exec(ctx)
		if err != nil {
			if ent.IsConstraintError(err) {
				continue // a terminal row landed concurrently; charge is closed
			}
			return reaped, err
		}
		reaped++
		log.Info("refunded orphaned reservation",
			zap.String("requestId", orphan.RequestID.String()),
			zap.String("reason", orphan.Reason),
			zap.Int("credits", -orphan.Delta),
			zap.Time("reservedAt", orphan.Ts))
	}
	return reaped, nil
}
