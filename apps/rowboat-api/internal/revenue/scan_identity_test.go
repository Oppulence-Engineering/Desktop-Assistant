package revenue

import (
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
)

// The Gmail scanner used to match relationships by the primary_email column with
// .First(), on a non-unique index: an arbitrary winner on collision, and no identity
// anchors or participants written at all. Its accounts were therefore invisible to
// every other source.
func TestScanHitAnchorsAndPopulatesTheRelationship(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)

	sum := &threadSummary{
		ThreadID:         "thread-1",
		Subject:          "Pricing",
		Counterparty:     "sarah@acme.example",
		CounterpartyName: "Sarah Chen",
		LastAt:           now,
		OutboundCount:    1,
		InboundCount:     1,
	}
	hit := &detectorHit{
		Detector:        "waiting_on_me",
		ActionType:      "warm_follow_up",
		Reason:          "they asked a question",
		ProposedMessage: "Following up.",
		Components:      map[string]int{"recency": 1},
		Anchor:          googleapi.GmailThreadMessage{ID: "m1", ThreadID: "thread-1", At: now, Snippet: "any update?"},
	}

	if _, _, _, err := f.svc.materializeHit(f.ctx, f.user, sum, hit); err != nil {
		t.Fatalf("materializeHit: %v", err)
	}

	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatalf("workspace: %v", err)
	}
	rels, err := f.client.Relationship.Query().
		Where(
			relationship.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			relationship.PrimaryEmailEQ("sarah@acme.example"),
		).All(f.ctx)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(rels) != 1 {
		t.Fatalf("expected 1 relationship, got %d", len(rels))
	}
	rel := rels[0]
	if rel.Kind != "person" {
		t.Fatalf("kind = %q, want person (PreferredKind must be honored)", rel.Kind)
	}

	// The whole point: durable anchors, so the next observation from any source
	// lands on this row instead of forking a second account.
	identities, err := rel.QueryIdentities().All(f.ctx)
	if err != nil {
		t.Fatalf("identities: %v", err)
	}
	if len(identities) == 0 {
		t.Fatal("scan hit wrote no identity anchors")
	}

	participants, err := rel.QueryParticipants().All(f.ctx)
	if err != nil {
		t.Fatalf("participants: %v", err)
	}
	if len(participants) != 1 || participants[0].Email != "sarah@acme.example" {
		t.Fatalf("expected the counterparty as a participant, got %+v", participants)
	}
	// And the person layer picked it up.
	if len(personsIn(t, f)) != 1 {
		t.Fatalf("expected a canonical person for the scan counterparty")
	}
}

// A rerun must not fork the account.
func TestScanHitIsIdempotentAcrossReruns(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	sum := &threadSummary{
		ThreadID: "thread-1", Subject: "Pricing",
		Counterparty: "sarah@acme.example", CounterpartyName: "Sarah Chen",
		LastAt: now, OutboundCount: 1, InboundCount: 1,
	}
	hit := &detectorHit{
		Detector: "waiting_on_me", ActionType: "warm_follow_up",
		Reason: "they asked a question", ProposedMessage: "Following up.",
		Components: map[string]int{"recency": 1},
		Anchor:     googleapi.GmailThreadMessage{ID: "m1", ThreadID: "thread-1", At: now, Snippet: "any update?"},
	}

	for round := 0; round < 3; round++ {
		if _, _, _, err := f.svc.materializeHit(f.ctx, f.user, sum, hit); err != nil {
			t.Fatalf("round %d: %v", round, err)
		}
	}

	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatalf("workspace: %v", err)
	}
	count, err := f.client.Relationship.Query().
		Where(
			relationship.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			relationship.PrimaryEmailEQ("sarah@acme.example"),
		).Count(f.ctx)
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Fatalf("reruns forked the account: %d relationships", count)
	}
}
