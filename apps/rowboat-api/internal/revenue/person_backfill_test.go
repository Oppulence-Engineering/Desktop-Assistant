package revenue

import (
	"testing"
	"time"
)

// The backfill must link every existing participant without inventing duplicates,
// and running it twice must change nothing.
func TestBackfillLinksExistingParticipantsIdempotently(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatalf("workspace: %v", err)
	}

	// Two accounts, and one human who appears on both.
	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user,
		[]RelationshipObservationInput{
			personObservation("obs_1", "Acme", "acme.example", now,
				RelationshipParticipantInput{DisplayName: "Sarah Chen", Email: "sarah@acme.example"}),
			personObservation("obs_2", "Globex", "globex.example", now,
				RelationshipParticipantInput{DisplayName: "Sarah Chen", Email: "sarah@acme.example"}),
		}); err != nil {
		t.Fatalf("ingest: %v", err)
	}

	// Simulate rows that predate the person layer.
	if _, err := f.client.RelationshipParticipant.Update().
		ClearPerson().Save(f.ctx); err != nil {
		t.Fatalf("unlink participants: %v", err)
	}

	report, err := f.svc.BackfillWorkspacePersons(f.ctx, f.user, ws)
	if err != nil {
		t.Fatalf("backfill: %v", err)
	}
	if report.ParticipantsScanned != 2 {
		t.Fatalf("scanned = %d, want 2", report.ParticipantsScanned)
	}
	if report.ParticipantsLinked != 2 {
		t.Fatalf("linked = %d, want 2", report.ParticipantsLinked)
	}
	if report.DuplicateParticipants != 0 {
		t.Fatalf("duplicates = %d; the unique index must not ship until this is 0",
			report.DuplicateParticipants)
	}
	// One human on two accounts is one person.
	if got := len(personsIn(t, f)); got != 1 {
		t.Fatalf("expected 1 canonical person, got %d", got)
	}

	second, err := f.svc.BackfillWorkspacePersons(f.ctx, f.user, ws)
	if err != nil {
		t.Fatalf("second backfill: %v", err)
	}
	if second.ParticipantsLinked != 0 {
		t.Fatalf("a second pass must be a no-op, linked %d", second.ParticipantsLinked)
	}
	if got := len(personsIn(t, f)); got != 1 {
		t.Fatalf("second pass forked the person: %d", got)
	}
}

// The report is the gate on the unique index, so it has to actually count.
func TestBackfillReportsDuplicateParticipants(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatalf("workspace: %v", err)
	}

	results, err := f.svc.IngestRelationshipObservations(f.ctx, f.user,
		[]RelationshipObservationInput{personObservation("obs_1", "Acme", "acme.example", now,
			RelationshipParticipantInput{DisplayName: "Sarah Chen", Email: "sarah@acme.example"})},
	)
	if err != nil {
		t.Fatalf("ingest: %v", err)
	}

	// The duplicate the schema permits and the old .Only() choked on.
	if _, err := f.client.RelationshipParticipant.Create().
		SetWorkspace(ws).
		SetRelationship(results[0].Relationship).
		SetUser(f.user).
		SetDisplayName("S. Chen").
		SetEmail("sarah@acme.example").
		SetRole("contact").
		SetExternalRefs([]string{}).
		Save(f.ctx); err != nil {
		t.Fatalf("create duplicate: %v", err)
	}

	report, err := f.svc.BackfillWorkspacePersons(f.ctx, f.user, ws)
	if err != nil {
		t.Fatalf("backfill: %v", err)
	}
	if report.DuplicateParticipants != 1 {
		t.Fatalf("duplicates = %d, want 1", report.DuplicateParticipants)
	}
	// Both rows still resolve to the same human.
	if got := len(personsIn(t, f)); got != 1 {
		t.Fatalf("expected 1 person behind the duplicate rows, got %d", got)
	}
}
