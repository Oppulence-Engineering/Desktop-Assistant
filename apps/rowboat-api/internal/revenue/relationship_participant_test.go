package revenue

import (
	"errors"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipparticipant"
	"github.com/google/uuid"
)

// participantObservation is a minimal observation carrying one participant.
func participantObservation(
	externalID string, now time.Time, participants ...RelationshipParticipantInput,
) RelationshipObservationInput {
	return RelationshipObservationInput{
		DisplayName:   "Acme",
		AccountDomain: "acme.example",
		Source:        "hubspot",
		ExternalID:    externalID,
		EventType:     "company.updated",
		OccurredAt:    now,
		ReceivedAt:    now,
		Participants:  participants,
	}
}

func participantsOf(t *testing.T, f *fixture, relID uuid.UUID) []*ent.RelationshipParticipant {
	t.Helper()
	rows, err := f.client.RelationshipParticipant.Query().
		Where(relationshipparticipant.HasRelationshipWith(relationship.IDEQ(relID))).
		Order(ent.Asc(relationshipparticipant.FieldCreatedAt), ent.Asc(relationshipparticipant.FieldID)).
		All(f.ctx)
	if err != nil {
		t.Fatalf("query participants: %v", err)
	}
	return rows
}

// Two participants in one relationship can legitimately hold the same email:
// (relationship_id, email) carries no unique index, and upsertRelationshipParticipant's
// own backfill sets an email on a row whose address another row already holds.
//
// That made the lookup's .Only() return NotSingularError -- which is NOT
// ent.IsNotFound -- so the query branch returned it and every subsequent
// observation for that account failed permanently, unrecoverable short of
// editing the table by hand.
func TestUpsertParticipantToleratesDuplicateEmails(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)

	results, err := f.svc.IngestRelationshipObservations(f.ctx, f.user,
		[]RelationshipObservationInput{participantObservation("obs_1", now,
			RelationshipParticipantInput{
				DisplayName: "Sarah Chen",
				Email:       "sarah@acme.example",
				Role:        "champion",
			})},
	)
	if err != nil {
		t.Fatalf("first ingest: %v", err)
	}
	rel := results[0].Relationship

	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatalf("workspace: %v", err)
	}

	// Manufacture the duplicate the schema permits.
	if _, err := f.client.RelationshipParticipant.Create().
		SetWorkspace(ws).
		SetRelationship(rel).
		SetUser(f.user).
		SetDisplayName("S. Chen").
		SetEmail("sarah@acme.example").
		SetRole("contact").
		SetExternalRefs([]string{}).
		Save(f.ctx); err != nil {
		t.Fatalf("create duplicate participant: %v", err)
	}
	if got := len(participantsOf(t, f, rel.ID)); got != 2 {
		t.Fatalf("expected 2 participant rows before the regression case, got %d", got)
	}

	// The regression: this used to fail permanently with NotSingularError.
	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user,
		[]RelationshipObservationInput{participantObservation("obs_2", now.Add(time.Hour),
			RelationshipParticipantInput{
				DisplayName: "Sarah Chen",
				Email:       "sarah@acme.example",
				Role:        "champion",
				Title:       "VP Engineering",
			})},
	); err != nil {
		t.Fatalf("ingest with duplicate participant emails must succeed, got: %v", err)
	}

	rows := participantsOf(t, f, rel.ID)
	if len(rows) != 2 {
		t.Fatalf("expected the duplicate to be reused, not a third row invented; got %d rows", len(rows))
	}
	titled := 0
	for _, row := range rows {
		if row.Title == "VP Engineering" {
			titled++
		}
	}
	if titled != 1 {
		t.Fatalf("expected exactly one row to take the update, got %d", titled)
	}

	// Stable across retries: a replay must not flip to the other duplicate.
	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user,
		[]RelationshipObservationInput{participantObservation("obs_3", now.Add(2*time.Hour),
			RelationshipParticipantInput{
				DisplayName: "Sarah Chen",
				Email:       "sarah@acme.example",
				Role:        "champion",
				Title:       "SVP Engineering",
			})},
	); err != nil {
		t.Fatalf("replay ingest: %v", err)
	}
	rows = participantsOf(t, f, rel.ID)
	promoted := 0
	for _, row := range rows {
		if row.Title == "SVP Engineering" {
			promoted++
		}
		if row.Title == "VP Engineering" {
			t.Fatalf("the update landed on a different duplicate on replay: %s", row.DisplayName)
		}
	}
	if promoted != 1 {
		t.Fatalf("expected exactly one row to take the replayed update, got %d", promoted)
	}
}

// The >1 check exists for a real conflict -- an email and a provider ref pointing
// at genuinely different people -- and folding duplicates must not weaken it.
func TestUpsertParticipantStillRejectsGenuineIdentityConflict(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)

	results, err := f.svc.IngestRelationshipObservations(f.ctx, f.user,
		[]RelationshipObservationInput{participantObservation("obs_1", now,
			RelationshipParticipantInput{
				DisplayName:  "Sarah Chen",
				Email:        "sarah@acme.example",
				Role:         "champion",
				ExternalRefs: []string{"hubspot:contact:1"},
			},
			RelationshipParticipantInput{
				DisplayName:  "Dana Fox",
				Email:        "dana@acme.example",
				Role:         "contact",
				ExternalRefs: []string{"hubspot:contact:2"},
			})},
	)
	if err != nil {
		t.Fatalf("first ingest: %v", err)
	}
	rel := results[0].Relationship
	if got := len(participantsOf(t, f, rel.ID)); got != 2 {
		t.Fatalf("expected 2 distinct participants, got %d", got)
	}

	// Sarah's email with Dana's provider ref: two different humans, no safe answer.
	_, err = f.svc.IngestRelationshipObservations(f.ctx, f.user,
		[]RelationshipObservationInput{participantObservation("obs_2", now.Add(time.Hour),
			RelationshipParticipantInput{
				DisplayName:  "Sarah Chen",
				Email:        "sarah@acme.example",
				ExternalRefs: []string{"hubspot:contact:2"},
			})},
	)
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("expected ErrConflict for a genuine identity conflict, got: %v", err)
	}
}
