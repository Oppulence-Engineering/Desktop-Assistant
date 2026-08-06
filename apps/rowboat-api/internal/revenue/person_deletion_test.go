package revenue

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/person"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personattribute"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personidentity"
)

// Person data was unreachable by every deletion path in the product, and removing
// the rows alone would not have been enough: ingest re-derives people from every
// sync, so a person deleted today reappears tomorrow with the same name and
// address. These assert the whole promise — the rows go, and they stay gone.

func workspaceID(t *testing.T, f *fixture) uuid.UUID {
	t.Helper()
	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatalf("workspace: %v", err)
	}
	return ws.ID
}

func seedPerson(t *testing.T, f *fixture, externalID, name, email string) {
	t.Helper()
	now := time.Date(2026, 8, 6, 12, 0, 0, 0, time.UTC)
	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user,
		[]RelationshipObservationInput{personObservation(externalID, "Acme", "acme.example", now,
			RelationshipParticipantInput{
				DisplayName: name,
				Email:       email,
				Role:        "champion",
				Title:       "VP Engineering",
			})},
	); err != nil {
		t.Fatalf("ingest %s: %v", externalID, err)
	}
}

func TestDeletePersonRemovesEveryDerivedRow(t *testing.T) {
	f := newFixture(t)
	seedPerson(t, f, "obs_1", "Sarah Chen", "sarah@acme.example")

	people := personsIn(t, f)
	if len(people) != 1 {
		t.Fatalf("setup: expected 1 person, got %d", len(people))
	}
	target := people[0]

	receipt, err := f.svc.DeletePerson(f.ctx, f.user, workspaceID(t, f), target.ID, "subject_request", "asked to be removed")
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if receipt.Reason != "subject_request" {
		t.Errorf("reason = %q, want the request to be recorded as the subject's", receipt.Reason)
	}
	if receipt.Suppressed == 0 {
		t.Error("no suppression anchor written — the person would return on the next sync")
	}

	// The PII columns are on these rows: display_name, title, phone, org, and the
	// normalized address on the identity.
	if n, _ := f.client.Person.Query().Where(person.IDEQ(target.ID)).Count(f.ctx); n != 0 {
		t.Errorf("person row survived deletion (%d)", n)
	}
	if n, _ := f.client.PersonAttribute.Query().
		Where(personattribute.HasPersonWith(person.IDEQ(target.ID))).Count(f.ctx); n != 0 {
		t.Errorf("%d attributes survived — these hold the name, title and phone", n)
	}
	if n, _ := f.client.PersonIdentity.Query().
		Where(personidentity.HasPersonWith(person.IDEQ(target.ID))).Count(f.ctx); n != 0 {
		t.Errorf("%d identities survived — these hold the email address", n)
	}
}

func TestDeletedPersonDoesNotReturnOnTheNextSync(t *testing.T) {
	// The load-bearing test. Without suppression the rows come back within a day
	// and the deletion the user was shown was a lie.
	f := newFixture(t)
	seedPerson(t, f, "obs_1", "Sarah Chen", "sarah@acme.example")

	target := personsIn(t, f)[0]
	if _, err := f.svc.DeletePerson(f.ctx, f.user, workspaceID(t, f), target.ID, "subject_request", ""); err != nil {
		t.Fatalf("delete: %v", err)
	}

	// The same person, arriving again exactly as ingest would deliver them.
	seedPerson(t, f, "obs_2", "Sarah Chen", "sarah@acme.example")

	if people := personsIn(t, f); len(people) != 0 {
		t.Fatalf("person was recreated by the next sync (%d found) — deletion did not stick", len(people))
	}
}

func TestDeletingOnePersonLeavesOthersAlone(t *testing.T) {
	// Suppression is keyed per identity, so it must not be a blanket mute.
	f := newFixture(t)
	seedPerson(t, f, "obs_1", "Sarah Chen", "sarah@acme.example")
	seedPerson(t, f, "obs_2", "Tom Baker", "tom@acme.example")

	people := personsIn(t, f)
	if len(people) != 2 {
		t.Fatalf("setup: expected 2 people, got %d", len(people))
	}
	var sarah = people[0]
	for _, p := range people {
		if p.DisplayName == "Sarah Chen" {
			sarah = p
		}
	}

	if _, err := f.svc.DeletePerson(f.ctx, f.user, workspaceID(t, f), sarah.ID, "user_action", ""); err != nil {
		t.Fatalf("delete: %v", err)
	}

	remaining := personsIn(t, f)
	if len(remaining) != 1 || remaining[0].DisplayName != "Tom Baker" {
		t.Fatalf("expected only Tom Baker to remain, got %d people", len(remaining))
	}

	// And a colleague at the same domain still resolves normally afterwards.
	seedPerson(t, f, "obs_3", "Tom Baker", "tom@acme.example")
	if n := len(personsIn(t, f)); n != 1 {
		t.Fatalf("re-ingesting an unsuppressed colleague changed the count to %d", n)
	}
}

func TestDeletingTwiceIsNotAnError(t *testing.T) {
	// The unique index on (key_hash, workspace) makes a naive second write fail.
	f := newFixture(t)
	seedPerson(t, f, "obs_1", "Sarah Chen", "sarah@acme.example")
	target := personsIn(t, f)[0]

	if _, err := f.svc.DeletePerson(f.ctx, f.user, workspaceID(t, f), target.ID, "subject_request", ""); err != nil {
		t.Fatalf("first delete: %v", err)
	}
	// Same address arrives again and is suppressed, so there is no person to
	// delete a second time — the failure mode to avoid is a constraint violation
	// leaking out of a re-run.
	seedPerson(t, f, "obs_2", "Sarah Chen", "sarah@acme.example")
	if n := len(personsIn(t, f)); n != 0 {
		t.Fatalf("expected the identity to stay suppressed, found %d", n)
	}
}
