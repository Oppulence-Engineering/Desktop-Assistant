package revenue

import (
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
)

// The Gmail scanner re-materializes the same thread on every periodic run. Counting
// an interaction per run made the totals measure scan frequency rather than how
// often the user actually talked to someone.
func TestScanRerunsDoNotInflateInteractionCount(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	sum := &threadSummary{
		ThreadID: "t1", Subject: "Pricing", Counterparty: "sarah@acme.example",
		CounterpartyName: "Sarah Chen", LastAt: now, OutboundCount: 1, InboundCount: 1,
	}
	hit := &detectorHit{
		Detector: "waiting_on_me", ActionType: "warm_follow_up",
		Reason: "they asked a question", ProposedMessage: "Following up.",
		Components: map[string]int{"recency": 1},
		Anchor: googleapi.GmailThreadMessage{
			ID: "m1", ThreadID: "t1", At: now, Snippet: "any update?",
		},
	}

	for round := 0; round < 4; round++ {
		if _, _, _, err := f.svc.materializeHit(f.ctx, f.user, sum, hit); err != nil {
			t.Fatalf("round %d: %v", round, err)
		}
	}

	people := personsIn(t, f)
	if len(people) != 1 {
		t.Fatalf("expected 1 person, got %d", len(people))
	}
	stats, err := people[0].QueryInteractionStats().All(f.ctx)
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if len(stats) != 1 {
		t.Fatalf("expected 1 rollup, got %d", len(stats))
	}
	if stats[0].InteractionCount != 1 {
		t.Fatalf("four scans of one thread counted %d interactions, want 1",
			stats[0].InteractionCount)
	}
	// The person is still fully linked despite only being counted once.
	participants, err := people[0].QueryParticipants().All(f.ctx)
	if err != nil {
		t.Fatalf("participants: %v", err)
	}
	if len(participants) != 1 {
		t.Fatalf("expected the participant to stay linked, got %d", len(participants))
	}
}

// New evidence on the same thread must still count.
func TestNewThreadActivityCountsAnotherInteraction(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	sum := &threadSummary{
		ThreadID: "t1", Subject: "Pricing", Counterparty: "sarah@acme.example",
		CounterpartyName: "Sarah Chen", LastAt: now, OutboundCount: 1, InboundCount: 1,
	}
	first := &detectorHit{
		Detector: "waiting_on_me", ActionType: "warm_follow_up", Reason: "q",
		ProposedMessage: "m", Components: map[string]int{"recency": 1},
		Anchor: googleapi.GmailThreadMessage{ID: "m1", ThreadID: "t1", At: now, Snippet: "any update?"},
	}
	if _, _, _, err := f.svc.materializeHit(f.ctx, f.user, sum, first); err != nil {
		t.Fatalf("first: %v", err)
	}

	// A later reply is a different anchor, so a different evidence row.
	sum.LastAt = now.Add(48 * time.Hour)
	second := &detectorHit{
		Detector: "waiting_on_me", ActionType: "warm_follow_up", Reason: "q",
		ProposedMessage: "m", Components: map[string]int{"recency": 1},
		Anchor: googleapi.GmailThreadMessage{
			ID: "m2", ThreadID: "t1", At: sum.LastAt, Snippet: "following up again",
		},
	}
	if _, _, _, err := f.svc.materializeHit(f.ctx, f.user, sum, second); err != nil {
		t.Fatalf("second: %v", err)
	}

	stats, err := personsIn(t, f)[0].QueryInteractionStats().All(f.ctx)
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if stats[0].InteractionCount != 2 {
		t.Fatalf("genuinely new activity counted %d, want 2", stats[0].InteractionCount)
	}
}
