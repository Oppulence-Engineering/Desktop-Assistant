// Package minutes meters a user's free cloud meeting-transcription minutes per
// UTC month (RFC 009 §16, Appendix O).
//
// It mirrors the credit-quota gate's reserve → settle/refund shape, but over a
// small per-period counter (MeetingMinuteUsage) rather than an append-only
// ledger: free meeting minutes are a *plan allowance*, not priced credits. Paid
// plans and BYOK callers bypass the gate entirely (unlimited cloud). The desktop
// reads Remaining to decide whether to keep meetings on cloud or fall back to
// on-device transcription.
package minutes

import (
	"context"
	"errors"
	"time"

	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/meetingminuteusage"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
)

// ErrMinutesExhausted is returned by Reserve when the free allowance can't cover
// the estimate. Handlers map it to 402 so the desktop falls back to on-device.
var ErrMinutesExhausted = errors.New("meeting_minutes_exhausted")

// ErrNoUser is returned when a gate method runs without an authenticated user.
var ErrNoUser = errors.New("minutes: no user in context")

// unlimitedSentinel is the "remaining" value reported for paid/unlimited plans.
const unlimitedSentinel = 1 << 30

// AllowanceFunc maps a plan to its monthly second allowance; a negative result
// means unlimited (paid plans / BYOK).
type AllowanceFunc func(plan string) int

// Gate meters meeting seconds against the per-period MeetingMinuteUsage row.
type Gate struct {
	client    *ent.Client
	log       *zap.Logger
	allowance AllowanceFunc
}

// New builds a minutes gate.
func New(client *ent.Client, log *zap.Logger, allowance AllowanceFunc) *Gate {
	return &Gate{client: client, log: log, allowance: allowance}
}

// IsUnlimited reports whether the plan has an unbounded allowance.
func (g *Gate) IsUnlimited(plan string) bool { return g.allowance(plan) < 0 }

// Period is the UTC-month key for a timestamp, e.g. "2026-06".
func Period(now time.Time) string { return now.UTC().Format("2006-01") }

// Remaining returns the free seconds left this month: allowance − (used +
// reserved). Unlimited plans return a large sentinel. Read-only (no row write).
func (g *Gate) Remaining(ctx context.Context, plan string) (int, error) {
	allow := g.allowance(plan)
	if allow < 0 {
		return unlimitedSentinel, nil
	}
	used, reserved, err := g.usage(ctx, Period(time.Now()))
	if err != nil {
		return 0, err
	}
	rem := allow - (used + reserved)
	if rem < 0 {
		rem = 0
	}
	return rem, nil
}

// usage returns the current (used, reserved) seconds for the scoped user +
// period, treating a missing row as zero (no write on the read path).
func (g *Gate) usage(ctx context.Context, period string) (used, reserved int, err error) {
	row, err := g.client.MeetingMinuteUsage.Query().
		Where(meetingminuteusage.Period(period)).
		Only(ctx)
	if ent.IsNotFound(err) {
		return 0, 0, nil
	}
	if err != nil {
		return 0, 0, err
	}
	return row.UsedSeconds, row.ReservedSeconds, nil
}

// Charge is an in-flight meeting-minute reservation.
type Charge struct {
	gate     *Gate
	period   string
	reserved int
	done     bool
}

// Reserve debits an estimate against the month's allowance inside a transaction
// after a balance check. Paid/unlimited callers get a no-op charge. Concurrent
// reservations serialize on the transaction (matching the credit gate's
// accepted Postgres tradeoff — a tiny residual race, never an overspend on the
// single-writer dev path).
func (g *Gate) Reserve(ctx context.Context, plan string, estSeconds int) (*Charge, error) {
	if estSeconds < 0 {
		estSeconds = 0
	}
	allow := g.allowance(plan)
	if allow < 0 {
		return &Charge{gate: g, reserved: 0}, nil // unlimited
	}

	period := Period(time.Now())
	tx, err := g.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	row, err := g.txRow(ctx, tx, period)
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	if row.UsedSeconds+row.ReservedSeconds+estSeconds > allow {
		_ = tx.Rollback()
		return nil, ErrMinutesExhausted
	}
	if _, err := tx.Client().MeetingMinuteUsage.UpdateOne(row).AddReservedSeconds(estSeconds).Save(ctx); err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &Charge{gate: g, period: period, reserved: estSeconds}, nil
}

// txRow gets-or-creates the (scoped user, period) row within the transaction.
func (g *Gate) txRow(ctx context.Context, tx *ent.Tx, period string) (*ent.MeetingMinuteUsage, error) {
	txc := tx.Client()
	row, err := txc.MeetingMinuteUsage.Query().Where(meetingminuteusage.Period(period)).Only(ctx)
	if err == nil {
		return row, nil
	}
	if !ent.IsNotFound(err) {
		return nil, err
	}
	u, ok := auth.UserFromCtx(ctx)
	if !ok {
		return nil, ErrNoUser
	}
	return txc.MeetingMinuteUsage.Create().SetUser(u).SetPeriod(period).Save(ctx)
}

// Settle converts the reservation to actual usage: count the real seconds and
// release the rest of the reservation. Idempotent per Charge.
func (c *Charge) Settle(ctx context.Context, actualSeconds int) error {
	if c.done || c.reserved == 0 {
		return nil
	}
	c.done = true
	if actualSeconds < 0 {
		actualSeconds = 0
	}
	row, err := c.gate.scopedRow(ctx, c.period)
	if err != nil {
		return err
	}
	_, err = c.gate.client.MeetingMinuteUsage.UpdateOne(row).
		AddUsedSeconds(actualSeconds).
		AddReservedSeconds(-c.reserved).
		Save(ctx)
	return err
}

// Refund releases the whole reservation (the stream failed before metering).
func (c *Charge) Refund(ctx context.Context) error {
	if c.done || c.reserved == 0 {
		return nil
	}
	c.done = true
	row, err := c.gate.scopedRow(ctx, c.period)
	if err != nil {
		return err
	}
	_, err = c.gate.client.MeetingMinuteUsage.UpdateOne(row).AddReservedSeconds(-c.reserved).Save(ctx)
	return err
}

// scopedRow fetches the existing (scoped user, period) row outside a tx.
func (g *Gate) scopedRow(ctx context.Context, period string) (*ent.MeetingMinuteUsage, error) {
	return g.client.MeetingMinuteUsage.Query().Where(meetingminuteusage.Period(period)).Only(ctx)
}
