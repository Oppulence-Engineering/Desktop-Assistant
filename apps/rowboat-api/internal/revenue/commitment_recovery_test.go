package revenue

import (
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitment"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitmentevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/conversationintelligenceartifact"
)

func recoveryCommitment(t *testing.T, f *fixture, now time.Time) (*ent.Relationship, *ent.Commitment) {
	t.Helper()
	rel := f.relationship(t)
	_, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		RelationshipID: rel.ID, Source: "meeting", ExternalID: "commitment:recovery-test",
		EventType: "commitment_confirmed", OccurredAt: now.Add(-24 * time.Hour),
		ReceivedAt: now.Add(-24 * time.Hour),
		Facts: map[string]any{
			"user_confirmed": true, "commitment_text": "Send the security packet",
			"commitment_direction": "promised_by_me",
			"commitment_due_at":    now.Add(-12 * time.Hour).Format(time.RFC3339),
			"evidence_quote":       "I will send the security packet.",
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	row, err := f.client.Commitment.Query().Where(commitment.HasRelationshipWith()).Only(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	return rel, row
}

func TestCommitmentRecoveryDedupesGovernedActionAndStoresRanking(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	rel, _ := recoveryCommitment(t, f, now)
	evaluations, err := f.svc.ReconcileDueCommitments(f.ctx, f.user, &rel.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(evaluations) != 1 || evaluations[0].Classification != "forgotten" ||
		evaluations[0].ProposedActionType != "reminder" {
		t.Fatalf("unexpected evaluation: %#v", evaluations)
	}
	if _, err := f.svc.ReconcileDueCommitments(f.ctx, f.user, &rel.ID); err != nil {
		t.Fatal(err)
	}
	actions, _ := f.client.RevenueAction.Query().All(f.ctx)
	if len(actions) != 2 { // confirmation follow-up plus exactly one recovery action
		t.Fatalf("recovery replay duplicated action: %#v", actions)
	}
	rankCount, err := f.client.ConversationIntelligenceArtifact.Query().Where(
		conversationintelligenceartifact.KindEQ("recommendation_evaluation"),
	).Count(f.ctx)
	if err != nil || rankCount != 1 {
		t.Fatalf("rank explanation was not persisted once: count=%d err=%v", rankCount, err)
	}
}

func TestCommitmentRecoveryReevaluatesWhenSourceFreshnessChanges(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	rel, _ := recoveryCommitment(t, f, now)
	if _, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "google", SourceAuthorizationInput{
		SourceAccountID: "owner@example.com", State: "completed",
		GrantedScopes: []string{scopeGmailReadonly, "https://www.googleapis.com/auth/calendar.events.readonly"},
	}); err != nil {
		t.Fatal(err)
	}
	first, err := f.svc.ReconcileDueCommitments(f.ctx, f.user, &rel.ID)
	if err != nil || len(first) != 1 || first[0].Classification != "unknown_stale_sources" {
		t.Fatalf("stale evaluation: %#v err=%v", first, err)
	}
	if _, err := f.svc.ReportSourceSyncProgress(f.ctx, f.user, SourceSyncProgressInput{
		Source: "google", SourceAccountID: "owner@example.com", Done: true, OccurredAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	second, err := f.svc.ReconcileDueCommitments(f.ctx, f.user, &rel.ID)
	if err != nil || len(second) != 1 || second[0].Classification != "forgotten" {
		t.Fatalf("fresh evaluation: %#v err=%v", second, err)
	}
	if first[0].EvaluationID == second[0].EvaluationID {
		t.Fatal("materially different recovery inputs reused an artifact id")
	}
}

func TestCommitmentRecoverySkipsUnreviewedCandidates(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	rel := f.relationship(t)
	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.client.Commitment.Create().SetWorkspace(ws).SetRelationship(rel).SetUser(f.user).
		SetDirection("promised_by_me").SetText("Unreviewed extraction").SetConfidence(0.7).
		SetDueAt(now.Add(time.Hour)).Save(f.ctx); err != nil {
		t.Fatal(err)
	}
	evaluations, err := f.svc.ReconcileDueCommitments(f.ctx, f.user, &rel.ID)
	if err != nil || len(evaluations) != 0 {
		t.Fatalf("unreviewed candidates must not create recovery work: %#v err=%v", evaluations, err)
	}
}

func TestFreshExplicitRecoveryEvidenceClosesCommitmentExactlyOnce(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	rel, row := recoveryCommitment(t, f, now)
	_, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		RelationshipID: rel.ID, Source: "gmail", ExternalID: "gmail-proof-1",
		EventType: "commitment_evidence_observed", OccurredAt: now.Add(-time.Hour), ReceivedAt: now.Add(-time.Hour),
		Facts: map[string]any{"commitment_recovery_evidence": []map[string]any{{
			"commitmentId": row.ID.String(), "kind": "explicit_fulfilled",
			"evidenceRef": "gmail-message:proof-1",
		}}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	evaluations, err := f.svc.ReconcileDueCommitments(f.ctx, f.user, &rel.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(evaluations) != 1 || evaluations[0].Classification != "fulfilled" || evaluations[0].RequiresReview {
		t.Fatalf("explicit fresh proof should close deterministically: %#v", evaluations)
	}
	closed, _ := f.client.Commitment.Get(f.ctx, row.ID)
	if closed.Status != "fulfilled" || closed.CurrentEventVersion != 3 {
		t.Fatalf("materialized commitment did not follow event stream: %#v", closed)
	}
	events, err := f.client.CommitmentEvent.Query().Where(
		commitmentevent.HasCommitmentWith(commitment.IDEQ(row.ID)),
	).Count(f.ctx)
	if err != nil || events != 3 {
		t.Fatalf("closure must append once: events=%d err=%v", events, err)
	}
	if again, err := f.svc.ReconcileDueCommitments(f.ctx, f.user, &rel.ID); err != nil || len(again) != 0 {
		t.Fatalf("closed commitment should leave recovery scan: %#v err=%v", again, err)
	}
}
