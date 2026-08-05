package revenue

import (
	"testing"
	"time"
)

// Two people can share a display name. An input carrying no address must not be
// allowed to claim a row that does carry one, or the two collapse into one person.
func TestNamelessParticipantDoesNotClaimAnAddressedRow(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)

	// A real, addressed participant.
	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user,
		[]RelationshipObservationInput{personObservation("obs_1", "Acme", "acme.example", now,
			RelationshipParticipantInput{DisplayName: "John Smith", Email: "john@acme.example"},
		)},
	); err != nil {
		t.Fatalf("first ingest: %v", err)
	}
	before := personsIn(t, f)
	if len(before) != 1 {
		t.Fatalf("expected 1 person, got %d", len(before))
	}

	// A different John Smith, arriving with no address at all.
	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user,
		[]RelationshipObservationInput{personObservation("obs_2", "Acme", "acme.example", now.Add(time.Hour),
			RelationshipParticipantInput{DisplayName: "John Smith"},
		)},
	); err != nil {
		t.Fatalf("second ingest: %v", err)
	}

	after := personsIn(t, f)
	if len(after) != 2 {
		t.Fatalf("expected two distinct people sharing a name, got %d", len(after))
	}
	// The addressed person keeps their own participant row and their anchor.
	addressed := before[0]
	participants, err := addressed.QueryParticipants().All(f.ctx)
	if err != nil {
		t.Fatalf("participants: %v", err)
	}
	for _, row := range participants {
		if row.Email != "john@acme.example" {
			t.Fatalf("an addressless input claimed the addressed row: %+v", row)
		}
	}
}
