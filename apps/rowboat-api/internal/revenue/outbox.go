package revenue

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/actionoutcome"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/predicate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
)

// appendOutboxTx writes one transactional-outbox row (RFC 030 integration
// events). It is called with the same *ent.Client (or tx client) as the state
// change it accompanies so the row commits atomically with the change. A
// duplicate idempotency key is swallowed: the event is already queued.
//
// Payloads carry the bounded envelope only — never raw bodies, proposed
// messages, tokens, or provider payloads.
func (s *Service) appendOutboxTx(ctx context.Context, client *ent.Client, ws *ent.RevenueWorkspace, u *ent.User, eventType string, actionID uuid.UUID, idempotencyKey string, payload map[string]any, occurredAt time.Time) error {
	create := client.RevenueOutboxEvent.Create().
		SetWorkspace(ws).
		SetUser(u).
		SetEventType(eventType).
		SetSchemaVersion(1).
		SetActionID(actionID).
		SetCorrelationID(actionID.String()).
		SetIdempotencyKey(idempotencyKey).
		SetOccurredAt(occurredAt.UTC())
	if len(payload) > 0 {
		raw, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		create.SetPayloadJSON(string(raw))
	}
	if err := create.Exec(ctx); err != nil {
		if ent.IsConstraintError(err) {
			return nil // already queued; duplicate delivery prevented
		}
		return err
	}
	return nil
}

// appendOutbox is appendOutboxTx for call sites outside an explicit
// transaction (the event still commits atomically on its own).
func (s *Service) appendOutbox(ctx context.Context, client *ent.Client, ws *ent.RevenueWorkspace, u *ent.User, eventType string, actionID uuid.UUID, idempotencyKey string, payload map[string]any, occurredAt time.Time) error {
	return s.appendOutboxTx(ctx, client, ws, u, eventType, actionID, idempotencyKey, payload, occurredAt)
}

// actionOutcomeForAction scopes an outcome query to one action.
func actionOutcomeForAction(id uuid.UUID) predicate.ActionOutcome {
	return actionoutcome.HasActionWith(revenueaction.IDEQ(id))
}

// actionOutcomeSourceEvent matches the (source, source_event_id) idempotency
// pair (invariant 10).
func actionOutcomeSourceEvent(source, eventID string) predicate.ActionOutcome {
	return actionoutcome.And(
		actionoutcome.SourceEQ(source),
		actionoutcome.SourceEventIDEQ(eventID),
	)
}
