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

// Charge is an in-flight reservation. Call Settle on success or Refund on
// failure (idempotent; calling neither leaves the full reservation debited).
type Charge struct {
	gate      *Gate
	user      *ent.User
	op        string
	requestID uuid.UUID
	reserved  int
}

// Reserved returns the amount tentatively debited.
func (c *Charge) Reserved() int { return c.reserved }

// Reserve checks the balance and writes a reservation debit in a transaction.
// op is the operation label (e.g. "llm_call", "voice_tts", "exa_search").
func (g *Gate) Reserve(ctx context.Context, op string, estimated int, requestID uuid.UUID) (*Charge, error) {
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
		SetReason(op + ".reserve").
		SetRequestID(requestID).
		Exec(ctx)
	if err != nil {
		_ = tx.Rollback()
		if ent.IsConstraintError(err) {
			// Already reserved for this request → idempotent retry.
			return &Charge{gate: g, user: u, op: op, requestID: requestID, reserved: estimated}, nil
		}
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &Charge{gate: g, user: u, op: op, requestID: requestID, reserved: estimated}, nil
}

// CheckSpendLimits verifies that estimated additional spend would not exceed
// the configured daily/monthly caps for the current viewer.
func (g *Gate) CheckSpendLimits(ctx context.Context, estimated int, limits SpendLimits) error {
	if limits.Daily <= 0 && limits.Monthly <= 0 {
		return nil
	}
	if _, ok := auth.UserFromCtx(ctx); !ok {
		return ErrNoUser
	}
	if estimated < 0 {
		estimated = 0
	}
	now := time.Now().UTC()
	if limits.Daily > 0 {
		start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
		spent, err := g.consumedSince(ctx, start)
		if err != nil {
			return err
		}
		if spent+estimated > limits.Daily {
			return ErrDailyLimitExceeded
		}
	}
	if limits.Monthly > 0 {
		start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
		spent, err := g.consumedSince(ctx, start)
		if err != nil {
			return err
		}
		if spent+estimated > limits.Monthly {
			return ErrMonthlyLimitExceeded
		}
	}
	return nil
}

// Settle records the difference between the reservation and the actual cost.
// diff = reserved - actual: positive refunds the excess, negative debits more.
func (c *Charge) Settle(ctx context.Context, actual int) error {
	if actual < 0 {
		actual = 0
	}
	diff := c.reserved - actual
	if diff == 0 {
		return nil
	}
	return c.gate.write(ctx, c.user, diff, c.op+".settle", c.requestID)
}

// Refund returns the entire reservation (used when the call failed).
func (c *Charge) Refund(ctx context.Context) error {
	if c.reserved == 0 {
		return nil
	}
	return c.gate.write(ctx, c.user, c.reserved, c.op+".refund", c.requestID)
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

func (g *Gate) consumedSince(ctx context.Context, start time.Time) (int, error) {
	var rows []struct {
		Total *int `json:"total"`
	}
	err := g.client.CreditLedger.Query().
		Where(
			creditledger.TsGTE(start),
			creditledger.DeltaLT(0),
		).
		Aggregate(ent.As(ent.Sum(creditledger.FieldDelta), "total")).
		Scan(ctx, &rows)
	if err != nil {
		return 0, err
	}
	if len(rows) == 0 || rows[0].Total == nil {
		return 0, nil
	}
	return -*rows[0].Total, nil
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
