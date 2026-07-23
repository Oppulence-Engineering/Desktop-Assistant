package actions

import (
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/actionproposal"
)

// executeProposal drives a proposal through approve+execute and returns it.
func (f *fixture) executeProposal(t *testing.T, financial bool) *ent.ActionProposal {
	t.Helper()
	p := f.propose(financial)
	res, err := f.broker.Approve(f.ctx, f.user, p.ID, true)
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if _, err := f.broker.Execute(f.ctx, f.user, p.ID, res.Token); err != nil {
		t.Fatalf("execute: %v", err)
	}
	return f.client.ActionProposal.GetX(f.ctx, p.ID)
}

// returnEvent creates a product Act-seam return CloudEvent for a correlation id.
func (f *fixture) returnEvent(t *testing.T, correlationID string) *ent.CloudEvent {
	t.Helper()
	return f.client.CloudEvent.Create().
		SetUser(f.user).
		SetSource("conduit").
		SetDedupeKey("evt-" + correlationID).
		SetCorrelationID(correlationID).
		SetEventType("conduit.invoice.paid").
		SetRoutingStatus("pending").
		SaveX(f.ctx)
}

func TestCorrelateReturnClosesLoop(t *testing.T) {
	f := newFixture(t)
	p := f.executeProposal(t, false)
	f.now = f.now.Add(2 * time.Minute) // some time passes before the return event
	ev := f.returnEvent(t, p.CorrelationID)

	m, err := f.broker.CorrelateReturn(f.ctx, f.user, ev)
	if err != nil {
		t.Fatalf("correlate: %v", err)
	}
	if !m.Matched || m.AlreadyClosed {
		t.Fatalf("expected fresh match, got %+v", m)
	}
	if m.OriginRunID != "" {
		// propose() sets no origin run; the tool path would. Fine either way.
	}
	if m.Kind != p.Kind || m.Target != p.Target {
		t.Fatalf("match binding wrong: %+v", m)
	}
	// The proposal is now resolved and linked to the return event.
	got := f.client.ActionProposal.GetX(f.ctx, p.ID)
	if got.ResolvedAt == nil {
		t.Fatal("resolved_at should be set")
	}
	if got.ReturnEventID != ev.ID.String() {
		t.Fatalf("return event id = %q, want %q", got.ReturnEventID, ev.ID.String())
	}
}

func TestCorrelateReturnIdempotent(t *testing.T) {
	f := newFixture(t)
	p := f.executeProposal(t, false)
	ev := f.returnEvent(t, p.CorrelationID)

	if _, err := f.broker.CorrelateReturn(f.ctx, f.user, ev); err != nil {
		t.Fatalf("first correlate: %v", err)
	}
	firstResolved := f.client.ActionProposal.GetX(f.ctx, p.ID).ResolvedAt

	// A duplicate return event (at-least-once delivery) is a no-op.
	ev2 := f.client.CloudEvent.Create().
		SetUser(f.user).SetSource("conduit").SetDedupeKey("evt-dup").
		SetCorrelationID(p.CorrelationID).SetRoutingStatus("pending").SaveX(f.ctx)

	m, err := f.broker.CorrelateReturn(f.ctx, f.user, ev2)
	if err != nil {
		t.Fatalf("second correlate: %v", err)
	}
	if !m.Matched || !m.AlreadyClosed {
		t.Fatalf("duplicate return should be AlreadyClosed, got %+v", m)
	}
	// The original resolution is unchanged (not overwritten by the duplicate).
	if got := f.client.ActionProposal.GetX(f.ctx, p.ID); !got.ResolvedAt.Equal(*firstResolved) {
		t.Fatal("duplicate return must not re-resolve the proposal")
	}
}

func TestCorrelateReturnNoMatch(t *testing.T) {
	f := newFixture(t)
	f.executeProposal(t, false)
	ev := f.returnEvent(t, "some-unrelated-correlation")
	m, err := f.broker.CorrelateReturn(f.ctx, f.user, ev)
	if err != nil {
		t.Fatalf("correlate: %v", err)
	}
	if m.Matched {
		t.Fatalf("unrelated correlation should not match, got %+v", m)
	}
}

func TestCorrelateReturnEmptyCorrelationIsNoop(t *testing.T) {
	f := newFixture(t)
	ev := f.client.CloudEvent.Create().
		SetUser(f.user).SetSource("conduit").SetDedupeKey("evt-empty").
		SetRoutingStatus("pending").SaveX(f.ctx)
	m, err := f.broker.CorrelateReturn(f.ctx, f.user, ev)
	if err != nil || m.Matched {
		t.Fatalf("empty correlation should be a no-op: %v %+v", err, m)
	}
}

// A return event for another tenant's proposal must not close this user's loop.
func TestCorrelateReturnTenantScoped(t *testing.T) {
	f := newFixture(t)
	p := f.executeProposal(t, false)

	other := f.client.User.Create().SetEmail("c@example.com").SetWorkosUserID("op_3").
		SaveX(internalCtx())
	// An event owned by `other` carrying this user's correlation id.
	ev := f.client.CloudEvent.Create().
		SetUser(other).SetSource("conduit").SetDedupeKey("evt-cross").
		SetCorrelationID(p.CorrelationID).SetRoutingStatus("pending").SaveX(internalCtx())

	m, err := f.broker.CorrelateReturn(internalCtx(), other, ev)
	if err != nil {
		t.Fatalf("correlate: %v", err)
	}
	if m.Matched {
		t.Fatal("cross-tenant correlation must not match")
	}
	if got := f.client.ActionProposal.GetX(f.ctx, p.ID); got.ResolvedAt != nil {
		t.Fatal("the owner's proposal must remain unresolved")
	}
	// Sanity: the correlation id really is present for the true owner.
	if f.client.ActionProposal.Query().Where(actionproposal.CorrelationID(p.CorrelationID)).CountX(f.ctx) != 1 {
		t.Fatal("expected exactly one proposal for the correlation id")
	}
}
