package revenue

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
)

func startedScan(t *testing.T, f *fixture, lookbackDays int) string {
	t.Helper()
	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	scan, err := f.client.RevenueLeakScan.Create().
		SetWorkspace(ws).SetUser(f.user).SetMode("local").
		SetLookbackDays(lookbackDays).SetStatus("completed").SetThreadsSeen(412).
		SetCreatedAt(f.svc.now().UTC()).
		Save(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	return scan.ID.String()
}

func seedReportCommitment(
	t *testing.T,
	f *fixture,
	rel *ent.Relationship,
	direction, text, owner string,
	dueAt *time.Time,
	occurredAt time.Time,
) *ent.Commitment {
	t.Helper()
	row := seedCommitment(t, f, rel, direction, text, owner, dueAt)
	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	evidence, err := f.client.RevenueEvidence.Create().
		SetWorkspace(ws).AddRelationships(rel).SetUser(f.user).
		SetSource("gmail").SetSourceRecordID("message:" + row.ID.String()).
		SetContentHash("sha256:" + row.ID.String()).SetExcerpt(text).
		SetSourceURI("https://mail.google.com/mail/u/0/#inbox/" + row.ID.String()).
		SetOccurredAt(occurredAt).SetObservedAt(occurredAt).Save(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := row.Update().AddEvidences(evidence).Save(f.ctx); err != nil {
		t.Fatal(err)
	}
	return row
}

// One-pager §11: the report says "here are the commitments your team made in
// the last 90 days that have no evidence of fulfilment, and here is the exact
// message that created each one." It is the sale and the onboarding at once,
// so it must be readable with nothing else configured.
func TestOpenPromisesReportShowsBothDirectionsWithSources(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	scanID := startedScan(t, f, 90)

	acme := f.relationship(t)
	globex := f.relationship(t)
	soon := now.Add(24 * time.Hour)
	later := now.Add(20 * 24 * time.Hour)

	ship := seedReportCommitment(t, f, acme, "promised_by_me", "Ship the migration", "alex@x.co", &soon, now.Add(-30*24*time.Hour))
	seedReportCommitment(t, f, acme, "promised_by_me", "Send the SOC 2 report", "sam@x.co", &later, now.Add(-20*24*time.Hour))
	seedReportCommitment(t, f, globex, "promised_by_them", "Send the sandbox credentials", "", &soon, now.Add(-10*24*time.Hour))
	seedReportCommitment(t, f, globex, "promised_by_them", "Too old for this report", "", &soon, now.Add(-120*24*time.Hour))
	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	oldEvidence, err := f.client.RevenueEvidence.Create().
		SetWorkspace(ws).AddRelationships(acme).SetUser(f.user).
		SetSource("gmail").SetSourceRecordID("old-message").SetContentHash("sha256:old").
		SetExcerpt("An older version of the promise.").SetSourceURI("https://example.com/old").
		SetOccurredAt(now.Add(-120 * 24 * time.Hour)).SetObservedAt(now).Save(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ship.Update().AddEvidences(oldEvidence).Save(f.ctx); err != nil {
		t.Fatal(err)
	}

	scanUUID := mustParseUUID(t, scanID)
	report, err := f.svc.OpenPromisesReport(f.ctx, f.user, scanUUID)
	if err != nil {
		t.Fatal(err)
	}
	if report.OutboundCount != 2 || report.InboundCount != 1 {
		t.Fatalf("direction counts wrong: out=%d in=%d", report.OutboundCount, report.InboundCount)
	}
	if report.LookbackDays != 90 || report.ThreadsSeen != 412 {
		t.Fatalf("scan context lost: %#v", report)
	}
	if len(report.Items) != 3 {
		t.Fatalf("report did not honor the scan window: %#v", report.Items)
	}
	// At risk sorts first: the reader's eye must land on what costs them soonest.
	if report.Items[0].State != RegisterAtRisk {
		t.Fatalf("report did not lead with an at-risk promise: %#v", report.Items[0])
	}

	doc := report.Markdown()
	for _, want := range []string{
		"# Open promises",
		"last 90 days",
		"promises we made",
		"promises made to us",
		"Ship the migration",
		"Send the sandbox credentials",
		"They owe",
		"We owe",
		"https://mail.google.com/",
	} {
		if !strings.Contains(doc, want) {
			t.Errorf("report missing %q\n---\n%s", want, doc)
		}
	}
	if strings.Contains(doc, "https://example.com/old") {
		t.Fatal("report cited evidence outside the scan window")
	}
}

// The report is the review surface for what the scan extracted, so unlike the
// register it must show unconfirmed candidates. If it hid them there would be
// nothing to review and the wedge would be empty on day one.
func TestOpenPromisesReportShowsUnconfirmedCandidates(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	scanID := startedScan(t, f, 90)
	rel := f.relationship(t)
	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	evidence, err := f.client.RevenueEvidence.Create().
		SetWorkspace(ws).AddRelationships(rel).SetUser(f.user).
		SetSource("gmail").SetSourceRecordID("candidate-message").SetContentHash("sha256:candidate").
		SetExcerpt("I'll get that over to you Thursday.").SetOccurredAt(now.Add(-time.Hour)).
		SetObservedAt(now.Add(-time.Hour)).Save(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.client.Commitment.Create().SetWorkspace(ws).SetRelationship(rel).SetUser(f.user).
		SetDirection("promised_by_me").SetText("Extracted from the thread").SetConfidence(0.7).
		SetSourcePhrase("I'll get that over to you Thursday.").AddEvidences(evidence).Save(f.ctx); err != nil {
		t.Fatal(err)
	}

	report, err := f.svc.OpenPromisesReport(f.ctx, f.user, mustParseUUID(t, scanID))
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Items) != 1 {
		t.Fatalf("the report hid the scan's own candidates: %#v", report.Items)
	}
	if !strings.Contains(report.Markdown(), "I'll get that over to you Thursday.") {
		t.Fatal("the report dropped the verbatim source quote")
	}
}

func TestOpenPromisesReportDisclosesTruncation(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	scanID := startedScan(t, f, 90)
	rel := f.relationship(t)
	dueAt := now.Add(30 * 24 * time.Hour)
	for i := 0; i < 201; i++ {
		seedReportCommitment(t, f, rel, "promised_by_me", "Open promise", "", &dueAt, now.Add(-time.Hour))
	}

	report, err := f.svc.OpenPromisesReport(f.ctx, f.user, mustParseUUID(t, scanID))
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Items) != 200 || !report.Truncated {
		t.Fatalf("report did not disclose truncation: items=%d truncated=%v", len(report.Items), report.Truncated)
	}
	if !strings.Contains(report.Markdown(), "first 200") {
		t.Fatal("Markdown did not disclose truncation")
	}
}

// An empty report must say so plainly rather than look broken. A prospect whose
// sources are not connected yet is the most common first run.
func TestOpenPromisesReportIsHonestWhenEmpty(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	scanID := startedScan(t, f, 90)

	report, err := f.svc.OpenPromisesReport(f.ctx, f.user, mustParseUUID(t, scanID))
	if err != nil {
		t.Fatal(err)
	}
	doc := report.Markdown()
	if !strings.Contains(doc, "No open promises were found") {
		t.Fatalf("empty report was not explicit:\n%s", doc)
	}
	if !strings.Contains(doc, "sources are not connected") {
		t.Fatalf("empty report did not name the likely cause:\n%s", doc)
	}
}

func mustParseUUID(t *testing.T, raw string) uuid.UUID {
	t.Helper()
	id, err := uuid.Parse(raw)
	if err != nil {
		t.Fatalf("parse uuid %q: %v", raw, err)
	}
	return id
}
