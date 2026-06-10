// Package quota enforces credit limits with a reserve → settle/refund pattern.
//
// Pre-call, Reserve debits the estimated cost (after a balance check) so
// concurrent calls can't oversubscribe. Post-call, Settle writes the delta
// between estimate and actual, or Refund returns the whole reservation on
// failure. Every phase is keyed by (request_id, reason) in the append-only
// ledger, so retries are safe.
package quota

import (
	"context"
	"errors"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/creditledger"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/credits"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// ErrInsufficientCredits is returned by Reserve when the balance can't cover
// the estimate. Handlers map it to 402.
var ErrInsufficientCredits = errors.New("insufficient_credits")

// ErrNoUser is returned when Reserve runs without an authenticated user.
var ErrNoUser = errors.New("quota: no user in context")

// ErrDailyLimitExceeded is returned when the caller would exceed the daily
// metered spend cap.
var ErrDailyLimitExceeded = errors.New("daily_credit_limit_exceeded")

// ErrMonthlyLimitExceeded is returned when the caller would exceed the monthly
// metered spend cap.
var ErrMonthlyLimitExceeded = errors.New("monthly_credit_limit_exceeded")

// SpendLimits caps net consumed credits for the current UTC day/month.
type SpendLimits struct {
	Daily   int
	Monthly int
}

// Gate issues credit reservations against the ledger.
type Gate struct {
	client *ent.Client
	log    *zap.Logger
}

// New builds a quota gate.
func New(client *ent.Client, log *zap.Logger) *Gate { return &Gate{client: client, log: log} }

const (
	// reserveReasonSuffix / terminalReasonSuffix are the ledger "reason" suffixes
	// for the two phases of a charge. The terminal phase (settle OR refund) shares
	// one reason so the unique (request_id, reason) index makes them mutually
	// exclusive — see Settle/Refund.
	reserveReasonSuffix  = ".reserve"
	terminalReasonSuffix = ".final"

	// inFlightWindow bounds how long a reserved-but-unfinalized charge is treated
	// as "still in progress" for the concurrent-duplicate guard. It must comfortably
	// exceed normal request latency; past it, the original is assumed to have died
	// before writing a terminal row, so a duplicate is allowed to proceed rather
	// than being 409'd forever.
	inFlightWindow = 5 * time.Minute
)

// Charge is an in-flight reservation. Call Settle on success or Refund on
// failure (idempotent; calling neither leaves the full reservation debited).
type Charge struct {
	gate      *Gate
	user      *ent.User
	op        string
	requestID uuid.UUID
	reserved  int
	// inProgress is set when this charge is a duplicate of another request that
	// is still being processed (same request_id, no terminal row yet, recent
	// reserve). Handlers should reject such a duplicate instead of re-calling the
	// upstream vendor (which would double-bill the vendor for one user charge).
	inProgress bool
	// finalized is set when this charge duplicates a request that already
	// settled or refunded. Handlers must reject it without re-calling the
	// upstream vendor: the terminal ledger row makes every accounting write a
	// no-op, so proceeding would hand out vendor-billed work for free.
	finalized bool
}

// Reserved returns the amount tentatively debited.
func (c *Charge) Reserved() int { return c.reserved }

// InProgress reports whether this charge duplicates another in-flight request
// with the same request_id. Handlers map it to 409.
func (c *Charge) InProgress() bool { return c.inProgress }

// Finalized reports whether this charge duplicates a request that already
// reached a terminal phase (settled or refunded). Handlers map it to 409.
func (c *Charge) Finalized() bool { return c.finalized }

// Reserve checks the balance and writes a reservation debit in a transaction.
// op is the operation label (e.g. "llm_call", "voice_tts", "exa_search").
// limits, when non-zero, caps net consumed credits for the current UTC
// day/month; the check runs inside the reservation transaction so concurrent
// requests cannot collectively exceed a cap.
func (g *Gate) Reserve(ctx context.Context, op string, estimated int, requestID uuid.UUID, limits SpendLimits) (*Charge, error) {
	u, ok := auth.UserFromCtx(ctx)
	if !ok {
		return nil, ErrNoUser
	}
	if estimated < 0 {
		estimated = 0
	}

	tx, err := g.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	txc := tx.Client()

	// NOTE: on Postgres, strict isolation would add SELECT ... FOR UPDATE on the
	// subscription row. The transaction + SQLite's single-writer model serialize
	// reservations here; the residual cross-request race on Postgres is tiny and
	// at worst permits a small transient overspend.
	sanctioned, err := sanctionedCredits(ctx, txc)
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	available, err := credits.Available(ctx, txc, sanctioned)
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	if available < estimated {
		_ = tx.Rollback()
		return nil, ErrInsufficientCredits
	}

	err = txc.CreditLedger.Create().
		SetUser(u).
		SetDelta(-estimated).
		SetReason(op + reserveReasonSuffix).
		SetRequestID(requestID).
		Exec(ctx)
	if err != nil {
		_ = tx.Rollback()
		if ent.IsConstraintError(err) {
			// Already reserved for this request → idempotent retry. Read back the
			// amount ACTUALLY debited by the original reserve instead of trusting
			// this call's `estimated`: request_id is derived from a client-supplied
			// Idempotency-Key, so a retry presenting a different (inflated) estimate
			// must not be able to Settle/Refund more than was originally reserved
			// (otherwise the excess is minted into the append-only ledger).
			existing, qErr := g.client.CreditLedger.Query().
				Where(
					creditledger.RequestID(requestID),
					creditledger.Reason(op+reserveReasonSuffix),
				).
				Only(ctx)
			if qErr != nil {
				return nil, qErr
			}
			finalized, inProgress, dupErr := g.duplicateState(ctx, op, requestID, existing.Ts)
			if dupErr != nil {
				return nil, dupErr
			}
			return &Charge{gate: g, user: u, op: op, requestID: requestID, reserved: -existing.Delta, inProgress: inProgress, finalized: finalized}, nil
		}
		return nil, err
	}

	// Enforce spend caps inside the transaction, AFTER the reserve insert: the
	// new reservation is visible to consumedSince here, so concurrent requests
	// serialize on the cap instead of each passing a stale pre-reserve read and
	// collectively exceeding it.
	if err := checkSpendLimitsTx(ctx, txc, limits); err != nil {
		_ = tx.Rollback()
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &Charge{gate: g, user: u, op: op, requestID: requestID, reserved: estimated}, nil
}

// duplicateState classifies a duplicate request (same request_id):
//   - finalized: a terminal ledger row exists — the original already settled or
//     refunded. The duplicate must NOT re-call the upstream vendor: every
//     accounting write would be a constraint-collision no-op, so the replay
//     would receive vendor-billed work with zero net ledger delta.
//   - inProgress: no terminal row yet and the original reservation is recent —
//     a concurrent duplicate. Handlers 409 it instead of double-calling the
//     vendor.
//   - neither: no terminal row and the reservation is old; the original is
//     assumed to have died before finalizing, so the retry may proceed.
func (g *Gate) duplicateState(ctx context.Context, op string, requestID uuid.UUID, reservedAt time.Time) (finalized, inProgress bool, err error) {
	finalized, err = g.client.CreditLedger.Query().
		Where(
			creditledger.RequestID(requestID),
			creditledger.Reason(op+terminalReasonSuffix),
		).
		Exist(ctx)
	if err != nil {
		return false, false, err
	}
	if finalized {
		return true, false, nil
	}
	return false, time.Since(reservedAt) < inFlightWindow, nil
}

// checkSpendLimitsTx verifies the daily/monthly caps against the transaction's
// view of the ledger (which already includes the current reservation, so the
// comparison is spent > cap, not spent+estimate > cap).
func checkSpendLimitsTx(ctx context.Context, txc *ent.Client, limits SpendLimits) error {
	if limits.Daily <= 0 && limits.Monthly <= 0 {
		return nil
	}
	now := time.Now().UTC()
	if limits.Daily > 0 {
		start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
		spent, err := consumedSince(ctx, txc, start)
		if err != nil {
			return err
		}
		if spent > limits.Daily {
			return ErrDailyLimitExceeded
		}
	}
	if limits.Monthly > 0 {
		start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
		spent, err := consumedSince(ctx, txc, start)
		if err != nil {
			return err
		}
		if spent > limits.Monthly {
			return ErrMonthlyLimitExceeded
		}
	}
	return nil
}

// Settle and Refund are the two mutually-exclusive TERMINAL phases of a charge.
// They write under the SAME ledger reason (op+".final") so the unique
// (request_id, reason) index admits exactly one of them — atomically, even when
// a settle and a refund for the same request_id race concurrently (e.g. two
// duplicate retries, one upstream success and one failure). The loser's insert
// hits the constraint and is a no-op. This bounds a charge's net ledger delta to
// [-reserved, 0] (one reserve debit + at most one terminal credit), so credits
// can never be minted by replaying or racing duplicate requests.

// Settle records the difference between the reservation and the actual cost.
// diff = reserved - actual: positive refunds the excess, negative debits more.
func (c *Charge) Settle(ctx context.Context, actual int) error {
	if actual < 0 {
		actual = 0
	}
	// Always written, even when diff == 0 (reserved == actual, the common case
	// for flat-rate voice/search charges): the row claims the terminal slot so a
	// later/concurrent duplicate Refund cannot release the reservation again.
	return c.gate.write(ctx, c.user, c.reserved-actual, c.op+terminalReasonSuffix, c.requestID)
}

// Refund returns the entire reservation (used when the call failed). It is
// mutually exclusive with Settle via the shared terminal ledger reason.
func (c *Charge) Refund(ctx context.Context) error {
	return c.gate.write(ctx, c.user, c.reserved, c.op+terminalReasonSuffix, c.requestID)
}

// write appends a ledger row, treating a uniqueness violation as an
// already-applied phase (idempotent).
func (g *Gate) write(ctx context.Context, u *ent.User, delta int, reason string, requestID uuid.UUID) error {
	err := g.client.CreditLedger.Create().
		SetUser(u).
		SetDelta(delta).
		SetReason(reason).
		SetRequestID(requestID).
		Exec(ctx)
	if err != nil && ent.IsConstraintError(err) {
		return nil
	}
	return err
}

func consumedSince(ctx context.Context, client *ent.Client, start time.Time) (int, error) {
	// Attribute each charge to the period of its RESERVE, not to the individual
	// timestamps of its rows. A charge spans a reserve row and a terminal row
	// written at different real times; summing rows by their own ts would, for a
	// call straddling the period boundary (reserve at 23:59, settle at 00:01),
	// count the positive terminal in the next period WITHOUT its negative reserve
	// and hand the user free spend-cap headroom. So: find the request_ids whose
	// reserve falls in the window, then sum the NET delta over all their phases
	// (a fully-refunded call nets to 0; a settled one nets to its actual cost).
	// Both queries are tenant-scoped by the ent interceptor.
	var idRows []struct {
		RequestID uuid.UUID `json:"request_id"`
	}
	if err := client.CreditLedger.Query().
		Where(
			creditledger.ReasonHasSuffix(reserveReasonSuffix),
			creditledger.TsGTE(start),
		).
		Select(creditledger.FieldRequestID).
		Scan(ctx, &idRows); err != nil {
		return 0, err
	}
	if len(idRows) == 0 {
		return 0, nil
	}
	ids := make([]uuid.UUID, len(idRows))
	for i, row := range idRows {
		ids[i] = row.RequestID
	}
	var rows []struct {
		Total *int `json:"total"`
	}
	if err := client.CreditLedger.Query().
		Where(creditledger.RequestIDIn(ids...)).
		Aggregate(ent.As(ent.Sum(creditledger.FieldDelta), "total")).
		Scan(ctx, &rows); err != nil {
		return 0, err
	}
	if len(rows) == 0 || rows[0].Total == nil {
		return 0, nil
	}
	consumed := -*rows[0].Total
	if consumed < 0 {
		consumed = 0
	}
	return consumed, nil
}

// sanctionedCredits returns the viewer's sanctioned credit grant (0 if none).
func sanctionedCredits(ctx context.Context, client *ent.Client) (int, error) {
	sub, err := client.Subscription.Query().Only(ctx)
	switch {
	case err == nil:
		return sub.SanctionedCredits, nil
	case ent.IsNotFound(err):
		return 0, nil
	default:
		return 0, err
	}
}
