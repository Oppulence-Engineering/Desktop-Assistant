package revenue

import (
	"strings"
	"testing"
	"time"
)

// One-pager §3: the exportable record is what makes the ledger useful in the
// moments that matter. A record that cannot leave the tool cannot settle an
// argument, so the document must carry the obligation, its history, and the
// verbatim evidence with timestamps.
func TestExportedRecordCarriesEvidenceAndHistory(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	rel := f.relationship(t)
	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}

	evidence, err := f.client.RevenueEvidence.Create().
		SetWorkspace(ws).AddRelationships(rel).SetUser(f.user).
		SetSource("gmail").SetSourceRecordID("thread-1").
		SetContentHash("sha256:abc123").
		SetExcerpt("We will have the migration live by the 14th.").
		SetSourceURI("https://mail.google.com/thread-1").
		SetOccurredAt(now.Add(-72 * time.Hour)).SetObservedAt(now.Add(-71 * time.Hour)).
		Save(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	due := now.Add(120 * time.Hour)
	row, err := f.client.Commitment.Create().SetWorkspace(ws).SetRelationship(rel).SetUser(f.user).
		SetDirection("promised_by_me").SetText("Migration live").SetConfidence(0.95).
		SetSourcePhrase("We will have the migration live by the 14th.").
		SetAcceptance("internally_confirmed").SetUserConfirmed(true).
		SetOwnerParticipantRef("alex@x.co").SetCounterpartyParticipantRef("jordan@example.com").
		SetDueAt(due).AddEvidences(evidence).Save(f.ctx)
	if err != nil {
		t.Fatal(err)
	}

	record, err := f.svc.ExportCommitment(f.ctx, f.user, row.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(record.Evidence) != 1 {
		t.Fatalf("record lost its evidence: %#v", record.Evidence)
	}
	if record.Evidence[0].Excerpt != "We will have the migration live by the 14th." {
		t.Fatalf("verbatim quote not preserved: %q", record.Evidence[0].Excerpt)
	}
	if record.Evidence[0].ContentHash != "sha256:abc123" {
		t.Fatalf("content hash missing: %q", record.Evidence[0].ContentHash)
	}

	doc := record.Markdown()
	for _, want := range []string{
		"# Commitment record",
		"We promised",
		"Migration live",
		"We will have the migration live by the 14th.",
		"sha256:abc123",
		"https://mail.google.com/thread-1",
		"alex@x.co",
	} {
		if !strings.Contains(doc, want) {
			t.Errorf("exported document is missing %q\n---\n%s", want, doc)
		}
	}
}

// One-pager §4: due dates are never guessed. A commitment with no due date must
// say "unspecified" in the record rather than imply a date.
func TestExportedRecordNeverGuessesADueDate(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	rel := f.relationship(t)
	row := seedCommitment(t, f, rel, "promised_by_me", "Send the security questionnaire", "", nil)

	record, err := f.svc.ExportCommitment(f.ctx, f.user, row.ID)
	if err != nil {
		t.Fatal(err)
	}
	doc := record.Markdown()
	if !strings.Contains(doc, "| Due | unspecified |") {
		t.Fatalf("undated commitment did not export as unspecified:\n%s", doc)
	}
	if !strings.Contains(doc, "No source evidence is attached") {
		t.Fatalf("a record with no evidence did not say so:\n%s", doc)
	}
}

// The export is workspace-scoped like every other read.
func TestExportRejectsACommitmentOutsideTheWorkspace(t *testing.T) {
	f := newFixture(t)
	rel := f.relationship(t)
	row := seedCommitment(t, f, rel, "promised_by_me", "Ours", "", nil)

	if _, err := f.svc.ExportCommitment(f.ctx, f.user, row.ID); err != nil {
		t.Fatalf("could not export our own commitment: %v", err)
	}

	other, err := f.client.RevenueWorkspace.Create().SetMode("local").Save(f.ctx)
	if err != nil {
		t.Skipf("second workspace unavailable: %v", err)
	}
	foreign, err := f.client.Commitment.Create().SetWorkspace(other).SetRelationship(rel).SetUser(f.user).
		SetDirection("promised_by_me").SetText("Theirs").SetConfidence(0.9).
		SetAcceptance("internally_confirmed").Save(f.ctx)
	if err != nil {
		t.Skipf("cross-tenant seed unavailable: %v", err)
	}
	if _, err := f.svc.ExportCommitment(f.ctx, f.user, foreign.ID); err == nil {
		t.Fatal("exported a commitment from another workspace")
	}
}

// The exported record is forwarded into a customer conversation. A raw
// "at_risk" in that table reads as a database dump and undermines the record it
// is meant to prove.
func TestExportedRecordUsesHumanStateNames(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	rel := f.relationship(t)
	soon := now.Add(24 * time.Hour)
	row := seedCommitment(t, f, rel, "promised_by_me", "Ship the migration", "", &soon)

	record, err := f.svc.ExportCommitment(f.ctx, f.user, row.ID)
	if err != nil {
		t.Fatal(err)
	}
	doc := record.Markdown()
	if !strings.Contains(doc, "| State | At risk |") {
		t.Fatalf("state was not humanised:\n%s", doc)
	}
	if strings.Contains(doc, "at_risk") {
		t.Fatalf("raw enum leaked into the document:\n%s", doc)
	}
}
