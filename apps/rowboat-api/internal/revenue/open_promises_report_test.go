package revenue

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
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
		Save(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	return scan.ID.String()
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

	seedCommitment(t, f, acme, "promised_by_me", "Ship the migration", "alex@x.co", &soon)
	seedCommitment(t, f, acme, "promised_by_me", "Send the SOC 2 report", "sam@x.co", &later)
	seedCommitment(t, f, globex, "promised_by_them", "Send the sandbox credentials", "", &soon)

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
	} {
		if !strings.Contains(doc, want) {
			t.Errorf("report missing %q\n---\n%s", want, doc)
		}
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
	if _, err := f.client.Commitment.Create().SetWorkspace(ws).SetRelationship(rel).SetUser(f.user).
		SetDirection("promised_by_me").SetText("Extracted from the thread").SetConfidence(0.7).
		SetSourcePhrase("I'll get that over to you Thursday.").Save(f.ctx); err != nil {
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
