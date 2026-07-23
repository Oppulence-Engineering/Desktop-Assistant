package revenue

import (
	"context"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
)

func TestImpactAggregates(t *testing.T) {
	f := newFixture(t)

	// Surface three actions; handle+execute one; dismiss one; leave one open.
	a1 := f.action(t, ExecModeDraft)
	_ = f.action(t, ExecModeDraft) // stays open
	a3 := f.action(t, ExecModeDraft)

	if _, err := f.svc.Approve(f.ctx, f.user, a1.ID, false); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if _, err := f.svc.Execute(f.ctx, f.user, a1.ID); err != nil {
		t.Fatalf("execute: %v", err)
	}
	if _, err := f.svc.Dismiss(f.ctx, f.user, a3.ID, "nope"); err != nil {
		t.Fatalf("dismiss: %v", err)
	}
	// Log a reply on the executed action.
	if _, err := f.svc.AppendOutcome(f.ctx, f.user, a1.ID, OutcomeInput{
		Kind: "replied", Source: "user", SourceEventID: "r1",
	}); err != nil {
		t.Fatalf("outcome: %v", err)
	}

	imp, err := f.svc.Impact(f.ctx, f.user)
	if err != nil {
		t.Fatalf("impact: %v", err)
	}
	if imp.Surfaced != 3 {
		t.Fatalf("surfaced = %d, want 3", imp.Surfaced)
	}
	if imp.Open != 1 {
		t.Fatalf("open = %d, want 1", imp.Open)
	}
	if imp.Handled != 1 {
		t.Fatalf("handled = %d, want 1", imp.Handled)
	}
	if imp.Dismissed != 1 {
		t.Fatalf("dismissed = %d, want 1", imp.Dismissed)
	}
	if imp.Approved != 1 || imp.Executed != 1 {
		t.Fatalf("approved=%d executed=%d, want 1/1", imp.Approved, imp.Executed)
	}
	// The dismiss also records a "dismissed" outcome, plus our "replied".
	if imp.OutcomeCount("replied") != 1 {
		t.Fatalf("replied outcome = %d, want 1", imp.OutcomeCount("replied"))
	}
	if len(imp.Detectors) == 0 {
		t.Fatal("expected per-detector breakdown")
	}
	// Tenant isolation: a second user sees an empty impact.
	other := newUser(t, f.client, "z@x.co", "user_z")
	octx := auth.WithUser(context.Background(), other)
	oimp, err := f.svc.Impact(octx, other)
	if err != nil {
		t.Fatalf("other impact: %v", err)
	}
	if oimp.Surfaced != 0 {
		t.Fatalf("cross-tenant leak: other user surfaced = %d", oimp.Surfaced)
	}
}
