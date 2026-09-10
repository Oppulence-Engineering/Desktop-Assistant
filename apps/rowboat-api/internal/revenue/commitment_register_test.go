package revenue

import (
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
)

// seedCommitment creates one commitment on a relationship, with the fields the
// register actually filters on.
func seedCommitment(
	t *testing.T,
	f *fixture,
	rel *ent.Relationship,
	direction, text, owner string,
	dueAt *time.Time,
) *ent.Commitment {
	t.Helper()
	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	create := f.client.Commitment.Create().SetWorkspace(ws).SetRelationship(rel).SetUser(f.user).
		SetDirection(direction).SetText(text).SetConfidence(0.9).SetSourcePhrase(text).
		// Seeds are confirmed obligations. An unconfirmed candidate belongs in
		// the review queue, not the register, which TestRegisterExcludes...
		// asserts separately.
		SetAcceptance("internally_confirmed").SetUserConfirmed(true)
	if owner != "" {
		create = create.SetOwnerParticipantRef(owner)
	}
	if dueAt != nil {
		create = create.SetDueAt(*dueAt)
	}
	row, err := create.Save(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	return row
}

// The five views of the one-pager §3 must each be one query against the
// register. Before this route existed only "by account" was reachable, because
// every commitment endpoint was nested under a relationship id.
func TestRegisterServesTheFiveViews(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }

	acme := f.relationship(t)
	globex := f.relationship(t)
	soon := now.Add(24 * time.Hour)
	later := now.Add(30 * 24 * time.Hour)

	seedCommitment(t, f, acme, "promised_by_me", "Ship the migration", "alex@x.co", &soon)
	seedCommitment(t, f, acme, "promised_by_me", "Send the SOC 2 report", "sam@x.co", &later)
	seedCommitment(t, f, globex, "promised_by_them", "Send the sandbox credentials", "", &soon)

	t.Run("what we owe", func(t *testing.T) {
		rows, err := f.svc.ListCommitments(f.ctx, f.user, CommitmentFilter{
			Direction: "promised_by_me",
		})
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != 2 {
			t.Fatalf("want 2 outbound commitments across accounts, got %d", len(rows))
		}
	})

	t.Run("what they owe us", func(t *testing.T) {
		rows, err := f.svc.ListCommitments(f.ctx, f.user, CommitmentFilter{
			Direction: "promised_by_them",
		})
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != 1 || rows[0].Text != "Send the sandbox credentials" {
			t.Fatalf("inbound view wrong: %#v", rows)
		}
	})

	t.Run("what changed", func(t *testing.T) {
		rows, err := f.svc.ListCommitments(f.ctx, f.user, CommitmentFilter{
			ChangedSince: time.Now().UTC().Add(-time.Hour),
		})
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != 3 {
			t.Fatalf("want 3 recently changed, got %d", len(rows))
		}
		none, err := f.svc.ListCommitments(f.ctx, f.user, CommitmentFilter{
			ChangedSince: now.Add(365 * 24 * time.Hour),
		})
		if err != nil {
			t.Fatal(err)
		}
		if len(none) != 0 {
			t.Fatalf("future changedSince returned rows: %d", len(none))
		}
	})

	t.Run("by account", func(t *testing.T) {
		rows, err := f.svc.ListCommitments(f.ctx, f.user, CommitmentFilter{
			RelationshipID: globex.ID,
		})
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != 1 {
			t.Fatalf("want 1 commitment for globex, got %d", len(rows))
		}
	})

	t.Run("by owner", func(t *testing.T) {
		rows, err := f.svc.ListCommitments(f.ctx, f.user, CommitmentFilter{
			Owner: "alex@x.co",
		})
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != 1 || rows[0].Text != "Ship the migration" {
			t.Fatalf("by-owner view wrong: %#v", rows)
		}
	})
}

// At risk is derived from the clock, so a commitment crosses into it without
// anyone writing a row.
func TestAtRiskIsDerivedFromTheDueDate(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	rel := f.relationship(t)

	due := now.Add(24 * time.Hour) // inside the 72h window
	far := now.Add(30 * 24 * time.Hour)
	seedCommitment(t, f, rel, "promised_by_me", "Due soon", "", &due)
	seedCommitment(t, f, rel, "promised_by_me", "Due later", "", &far)
	seedCommitment(t, f, rel, "promised_by_me", "No due date", "", nil)

	atRisk, err := f.svc.ListCommitments(f.ctx, f.user, CommitmentFilter{States: []string{RegisterAtRisk}})
	if err != nil {
		t.Fatal(err)
	}
	if len(atRisk) != 1 || atRisk[0].Text != "Due soon" {
		t.Fatalf("at-risk derivation wrong: %#v", atRisk)
	}

	open, err := f.svc.ListCommitments(f.ctx, f.user, CommitmentFilter{States: []string{RegisterOpen}})
	if err != nil {
		t.Fatal(err)
	}
	if len(open) != 2 {
		t.Fatalf("want 2 plain-open commitments, got %d", len(open))
	}

	// A commitment with no due date is never at risk. One-pager §4: due dates
	// are never guessed.
	for _, row := range atRisk {
		if row.DueAt == nil {
			t.Fatal("a commitment with no due date was reported at risk")
		}
	}
}

// One-pager §4: "Missed is never inferred from silence alone."
func TestMissedRequiresAnElapsedDueDate(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	rel := f.relationship(t)

	future := now.Add(48 * time.Hour)
	pending := seedCommitment(t, f, rel, "promised_by_me", "Not yet due", "", &future)
	if _, err := f.svc.AppendCommitmentTransition(f.ctx, f.user, rel.ID, pending.ID, CommitmentTransitionInput{
		Kind: "missed", IdempotencyKey: "miss:pending",
	}); err == nil {
		t.Fatal("a commitment that is not yet due was recorded as missed")
	}

	undated := seedCommitment(t, f, rel, "promised_by_me", "No due date", "", nil)
	if _, err := f.svc.AppendCommitmentTransition(f.ctx, f.user, rel.ID, undated.ID, CommitmentTransitionInput{
		Kind: "missed", IdempotencyKey: "miss:undated",
	}); err == nil {
		t.Fatal("a commitment with no due date was recorded as missed")
	}

	past := now.Add(-48 * time.Hour)
	elapsed := seedCommitment(t, f, rel, "promised_by_me", "Overdue", "", &past)
	missed, err := f.svc.AppendCommitmentTransition(f.ctx, f.user, rel.ID, elapsed.ID, CommitmentTransitionInput{
		Kind: "missed", IdempotencyKey: "miss:elapsed", Reason: "Reviewed in the weekly pass.",
	})
	if err != nil {
		t.Fatalf("an elapsed, reviewed commitment could not be marked missed: %v", err)
	}
	if missed.Status != "missed" {
		t.Fatalf("status not projected: %#v", missed)
	}
	if got := commitmentRegisterState(missed, now); got != RegisterMissed {
		t.Fatalf("register state = %q, want missed", got)
	}
}

// A waiver is the counterparty releasing the obligation, so it must say who
// released it and why. An unexplained waiver is indistinguishable from a
// deletion.
func TestWaiverRequiresAReason(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	rel := f.relationship(t)
	row := seedCommitment(t, f, rel, "promised_by_them", "Send the data export", "", nil)

	if _, err := f.svc.AppendCommitmentTransition(f.ctx, f.user, rel.ID, row.ID, CommitmentTransitionInput{
		Kind: "waived", IdempotencyKey: "waive:no-reason",
	}); err == nil {
		t.Fatal("a waiver was accepted with no reason")
	}

	waived, err := f.svc.AppendCommitmentTransition(f.ctx, f.user, rel.ID, row.ID, CommitmentTransitionInput{
		Kind: "waived", IdempotencyKey: "waive:reason", Reason: "Customer confirmed they no longer need it.",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := commitmentRegisterState(waived, now); got != RegisterWaived {
		t.Fatalf("register state = %q, want waived", got)
	}
}

// The register is workspace-scoped. A commitment in another workspace must not
// appear, whatever the filter.
func TestRegisterDoesNotLeakAcrossWorkspaces(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	rel := f.relationship(t)
	seedCommitment(t, f, rel, "promised_by_me", "Ours", "", nil)

	other, err := f.client.RevenueWorkspace.Create().SetMode("local").Save(f.ctx)
	if err != nil {
		t.Skipf("second workspace unavailable in this fixture: %v", err)
	}
	if _, err := f.client.Commitment.Create().SetWorkspace(other).SetRelationship(rel).SetUser(f.user).
		SetDirection("promised_by_me").SetText("Theirs").SetConfidence(0.9).
		SetAcceptance("internally_confirmed").Save(f.ctx); err != nil {
		t.Skipf("cross-tenant seed unavailable: %v", err)
	}

	rows, err := f.svc.ListCommitments(f.ctx, f.user, CommitmentFilter{})
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if row.Text == "Theirs" {
			t.Fatal("the register returned another workspace's commitment")
		}
	}
}

func TestRegisterRejectsAnUnknownDirection(t *testing.T) {
	f := newFixture(t)
	if _, err := f.svc.ListCommitments(f.ctx, f.user, CommitmentFilter{Direction: "sideways"}); err == nil {
		t.Fatal("unknown direction was accepted")
	}
}

func TestRegisterRejectsAnUnknownState(t *testing.T) {
	f := newFixture(t)
	if _, err := f.svc.ListCommitments(f.ctx, f.user, CommitmentFilter{
		States: []string{RegisterOpen, "guessing"},
	}); err == nil {
		t.Fatal("unknown state was ignored")
	}
}

func TestDerivedStatePaginationDoesNotDropLaterMatches(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	rel := f.relationship(t)
	dueSoon := now.Add(time.Hour)
	for i := 0; i < 205; i++ {
		seedCommitment(t, f, rel, "promised_by_me", "At risk", "", &dueSoon)
	}
	dueLater := now.Add(30 * 24 * time.Hour)
	seedCommitment(t, f, rel, "promised_by_me", "Still open", "", &dueLater)

	rows, err := f.svc.ListCommitments(f.ctx, f.user, CommitmentFilter{
		States: []string{RegisterOpen}, Limit: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Text != "Still open" {
		t.Fatalf("derived-state pagination dropped the later match: %#v", rows)
	}
}

func TestRenegotiationReopensAndUnblocksAMissedCommitment(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	rel := f.relationship(t)
	past := now.Add(-24 * time.Hour)
	row := seedCommitment(t, f, rel, "promised_by_me", "Ship the migration", "", &past)
	row, err := row.Update().SetBlocker("Waiting on the customer").Save(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	row, err = f.svc.AppendCommitmentTransition(f.ctx, f.user, rel.ID, row.ID, CommitmentTransitionInput{
		Kind: "missed", IdempotencyKey: "renegotiate:missed", Reason: "Reviewed after the due date",
	})
	if err != nil {
		t.Fatal(err)
	}
	future := now.Add(7 * 24 * time.Hour)
	row, err = f.svc.AppendCommitmentTransition(f.ctx, f.user, rel.ID, row.ID, CommitmentTransitionInput{
		Kind: "renegotiated", IdempotencyKey: "renegotiate:new-terms", DueAt: future,
	})
	if err != nil {
		t.Fatal(err)
	}
	if row.Status != "open" || row.Blocker != "" {
		t.Fatalf("renegotiation did not reopen cleanly: status=%q blocker=%q", row.Status, row.Blocker)
	}
}

// One-pager §6: "Low-confidence extractions enter a review queue rather than
// the register." The product's failure mode must be "it asked me", never "it
// was confidently wrong", so an unconfirmed candidate stays out of the list.
func TestRegisterExcludesUnconfirmedCandidates(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	rel := f.relationship(t)
	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.client.Commitment.Create().SetWorkspace(ws).SetRelationship(rel).SetUser(f.user).
		SetDirection("promised_by_me").SetText("Model guessed this").SetConfidence(0.4).
		Save(f.ctx); err != nil {
		t.Fatal(err)
	}
	seedCommitment(t, f, rel, "promised_by_me", "A human confirmed this", "", nil)

	rows, err := f.svc.ListCommitments(f.ctx, f.user, CommitmentFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Text != "A human confirmed this" {
		t.Fatalf("the register admitted an unconfirmed candidate: %#v", rows)
	}

	withCandidates, err := f.svc.ListCommitments(f.ctx, f.user, CommitmentFilter{IncludeCandidates: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(withCandidates) != 2 {
		t.Fatalf("the review queue could not see candidates: %d", len(withCandidates))
	}
}
