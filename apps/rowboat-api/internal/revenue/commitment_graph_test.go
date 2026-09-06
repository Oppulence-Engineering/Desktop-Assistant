package revenue

import (
	"testing"
	"time"
)

func TestCommitmentTransitionIsValidatedAtomicAndIdempotent(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	rel, row := recoveryCommitment(t, f, now)
	accepted, err := f.svc.AppendCommitmentTransition(f.ctx, f.user, rel.ID, row.ID, CommitmentTransitionInput{
		Kind: "accepted", IdempotencyKey: "user-accept:commitment-1",
		EvidenceRefs: []string{"plan-response:acceptance-1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if accepted.Acceptance != "accepted" || accepted.CurrentEventVersion != 3 {
		t.Fatalf("accepted projection diverged from event stream: %#v", accepted)
	}
	replayed, err := f.svc.AppendCommitmentTransition(f.ctx, f.user, rel.ID, row.ID, CommitmentTransitionInput{
		Kind: "accepted", IdempotencyKey: "user-accept:commitment-1",
		EvidenceRefs: []string{"plan-response:acceptance-1"},
	})
	if err != nil || replayed.CurrentEventVersion != 3 {
		t.Fatalf("idempotent replay changed the stream: %#v err=%v", replayed, err)
	}
	events, err := f.svc.CommitmentEventHistory(f.ctx, rel.ID, row.ID)
	if err != nil || len(events) != 3 || events[2].Kind != "accepted" {
		t.Fatalf("unexpected event history: %#v err=%v", events, err)
	}
	if _, err := f.svc.AppendCommitmentTransition(f.ctx, f.user, rel.ID, row.ID, CommitmentTransitionInput{
		Kind: "accepted", IdempotencyKey: "invalid-repeat-accept",
	}); err == nil {
		t.Fatal("invalid repeated acceptance was allowed")
	}
}

func TestCommitmentCorrectionConfirmsAndPreservesHistory(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	rel := f.relationship(t)
	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	row, err := f.client.Commitment.Create().SetWorkspace(ws).SetRelationship(rel).SetUser(f.user).
		SetDirection("promised_by_me").SetText("Send the draft").SetConfidence(0.8).
		SetSourcePhrase("I will send the draft.").Save(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	dueAt := now.Add(48 * time.Hour)
	corrected, err := f.svc.AppendCommitmentTransition(f.ctx, f.user, rel.ID, row.ID, CommitmentTransitionInput{
		Kind: "corrected", IdempotencyKey: "user-correct:commitment-1:v0",
		Action: "Send the signed draft", DueAt: dueAt, Reason: "Corrected during queue review.",
	})
	if err != nil {
		t.Fatal(err)
	}
	if corrected.Text != "Send the signed draft" || corrected.DueAt == nil || !corrected.DueAt.Equal(dueAt) ||
		!corrected.UserConfirmed || corrected.Acceptance != "internally_confirmed" {
		t.Fatalf("correction was not projected as a reviewed value: %#v", corrected)
	}
	events, err := f.svc.CommitmentEventHistory(f.ctx, rel.ID, row.ID)
	if err != nil || len(events) != 1 || events[0].Kind != "corrected" {
		t.Fatalf("correction history = %#v, err=%v", events, err)
	}
}

func TestCommitmentDependenciesRejectCyclesAndCrossRelationshipEdges(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	rel, first := recoveryCommitment(t, f, now)
	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	second, err := f.client.Commitment.Create().SetWorkspace(ws).SetRelationship(rel).SetUser(f.user).
		SetDirection("promised_by_them").SetText("Return the security review").SetConfidence(1).
		SetUserConfirmed(true).SetAcceptance("accepted").Save(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	created, err := f.svc.CreateCommitmentDependency(f.ctx, f.user, rel.ID, CommitmentDependencyInput{
		FromCommitmentID: first.ID, ToCommitmentID: second.ID, Kind: "blocks",
		EvidenceRefs: []string{"relationship-observation:dependency-proof"},
	})
	if err != nil || created.Kind != "blocks" {
		t.Fatalf("valid dependency was not persisted: %#v err=%v", created, err)
	}
	if _, err := f.svc.CreateCommitmentDependency(f.ctx, f.user, rel.ID, CommitmentDependencyInput{
		FromCommitmentID: second.ID, ToCommitmentID: first.ID, Kind: "requires",
		EvidenceRefs: []string{"relationship-observation:cycle-proof"},
	}); err == nil {
		t.Fatal("dependency cycle was allowed")
	}
	otherRelationship := f.relationship(t)
	other, err := f.client.Commitment.Create().SetWorkspace(ws).SetRelationship(otherRelationship).SetUser(f.user).
		SetDirection("promised_by_me").SetText("Unrelated promise").SetConfidence(1).Save(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.CreateCommitmentDependency(f.ctx, f.user, rel.ID, CommitmentDependencyInput{
		FromCommitmentID: first.ID, ToCommitmentID: other.ID, Kind: "requires",
		EvidenceRefs: []string{"relationship-observation:cross-scope"},
	}); err == nil {
		t.Fatal("cross-relationship dependency was allowed")
	}
}
