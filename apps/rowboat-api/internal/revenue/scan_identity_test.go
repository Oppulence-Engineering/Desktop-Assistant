package revenue

import (
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
)

// Gmail company mail is grouped by domain while the human sender remains a
// participant. Public mailbox addresses remain person records.
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
			relationship.AccountDomainEQ("acme.example"),
		).All(f.ctx)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(rels) != 1 {
		t.Fatalf("expected 1 relationship, got %d", len(rels))
	}
	rel := rels[0]
	if rel.Kind != "company" || rel.DisplayName != "acme.example" || rel.PrimaryEmail != "" {
		t.Fatalf("company identity = %+v", rel)
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

func TestScanGroupsBusinessContactsByCompany(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	hit := &detectorHit{
		Detector: "waiting_on_me", ActionType: "warm_follow_up", Reason: "they asked",
		ProposedMessage: "Following up.", Components: map[string]int{"recency": 1},
	}
	for i, email := range []string{"sarah@acme.example", "morgan@acme.example"} {
		sum := &threadSummary{
			ThreadID: email, Counterparty: email, CounterpartyName: []string{"Sarah Chen", "Morgan Lee"}[i],
			LastAt: now.Add(time.Duration(i) * time.Minute), OutboundCount: 1, InboundCount: 1,
		}
		hit.Anchor = googleapi.GmailThreadMessage{ID: email, ThreadID: email, At: sum.LastAt, Snippet: "any update?"}
		if _, _, _, err := f.svc.materializeHit(f.ctx, f.user, sum, hit); err != nil {
			t.Fatalf("materialize %s: %v", email, err)
		}
	}
	rel := f.client.Relationship.Query().Where(relationship.AccountDomainEQ("acme.example")).OnlyX(f.ctx)
	if rel.Kind != "company" || rel.QueryParticipants().CountX(f.ctx) != 2 {
		t.Fatalf("company=%s participants=%d", rel.Kind, rel.QueryParticipants().CountX(f.ctx))
	}
	personal := threadRelationshipInput(&threadSummary{Counterparty: "person@gmail.com", LastAt: now})
	if personal.PreferredKind != "person" || personal.PrimaryEmail != "person@gmail.com" || personal.AccountDomain != "" {
		t.Fatalf("public mailbox identity = %+v", personal)
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
			relationship.AccountDomainEQ("acme.example"),
		).Count(f.ctx)
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Fatalf("reruns forked the account: %d relationships", count)
	}
}
