package revenue

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipidentitycandidate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipobservation"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
)

func identityCollisionFixture(t *testing.T) (*fixture, *ent.Relationship, *ent.Relationship, *ent.RelationshipIdentityCandidate, *ent.RevenueAction) {
	t.Helper()
	f := newFixture(t)
	now := time.Date(2026, 7, 31, 17, 0, 0, 0, time.UTC)
	seed, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		DisplayName: "Canonical Acme", Source: "hubspot", ExternalID: "canonical-acme", EventType: "company.created",
		ResourceRefs: []string{"hubspot:company:identity-review"}, OccurredAt: now, ReceivedAt: now,
	}})
	if err != nil {
		t.Fatal(err)
	}
	existing := seed[0].Relationship
	proposed, err := f.svc.CreateRelationship(f.ctx, f.user, RelationshipInput{Kind: "company", DisplayName: "Proposed Acme"})
	if err != nil {
		t.Fatal(err)
	}
	action, err := f.svc.CreateAction(f.ctx, f.user, ActionInput{
		RelationshipID: proposed.ID, ActionType: "warm_follow_up", Channel: "email",
		Reason: "pre-existing proposed action", RecipientEmail: "buyer@acme.example",
		ProposedSubject: "Follow up", ProposedMessage: "Hello", ExecutionMode: ExecModeDraft,
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		RelationshipID: proposed.ID, DisplayName: "Proposed Acme", Source: "hubspot",
		ExternalID: "ambiguous-acme", EventType: "company.updated",
		ResourceRefs: []string{"hubspot:company:identity-review"}, OccurredAt: now.Add(time.Minute), ReceivedAt: now.Add(time.Minute),
		Assertions: []RelationshipAssertionInput{{Dimension: "summary", Value: "Ambiguous evidence", SourceType: "source_fact", Confidence: 1}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	candidate, err := f.client.RelationshipIdentityCandidate.Query().
		Where(relationshipidentitycandidate.StatusEQ(identityPending)).
		WithProposedRelationship().WithExistingRelationship().Only(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	return f, existing, proposed, candidate, action
}

func TestIdentityDeferMergeAndCompensatingSplitPreserveLineage(t *testing.T) {
	f, existing, proposed, candidate, action := identityCollisionFixture(t)

	deferred, err := f.svc.DecideIdentityCandidate(f.ctx, f.user, candidate.ID, IdentityDecisionInput{
		Decision: "defer", Reason: "need account owner review", ExpectedVersion: candidate.Version, IdempotencyKey: "identity-defer-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if deferred.Status != identityDeferred || deferred.Version != 2 {
		t.Fatalf("unexpected deferred candidate: status=%s version=%d", deferred.Status, deferred.Version)
	}
	// Deferred ambiguity is scoped: unrelated relationships continue normally.
	unrelated, err := f.svc.CreateRelationship(f.ctx, f.user, RelationshipInput{Kind: "person", DisplayName: "Unrelated"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.CreateAction(f.ctx, f.user, ActionInput{
		RelationshipID: unrelated.ID, ActionType: "warm_follow_up", Channel: "email", Reason: "unrelated",
		RecipientEmail: "unrelated@example.com", ProposedSubject: "Hello", ProposedMessage: "Hello",
	}); err != nil {
		t.Fatalf("deferred candidate blocked unrelated relationship: %v", err)
	}

	merged, err := f.svc.DecideIdentityCandidate(f.ctx, f.user, candidate.ID, IdentityDecisionInput{
		Decision: "merge", Reason: "provider record is the same account", ExpectedVersion: deferred.Version, IdempotencyKey: "identity-merge-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if merged.Status != identityResolved || merged.Version != 3 {
		t.Fatalf("merge projection: %+v", merged)
	}
	observation, err := f.client.RelationshipObservation.Query().Where(relationshipobservation.ExternalIDEQ("ambiguous-acme")).WithRelationship().Only(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	owner, _ := observation.Edges.RelationshipOrErr()
	if owner.ID != existing.ID {
		t.Fatalf("merge did not move observation: got %s", owner.ID)
	}
	movedAction, err := f.client.RevenueAction.Query().Where(revenueaction.IDEQ(action.ID)).WithRelationship().Only(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	actionOwner, _ := movedAction.Edges.RelationshipOrErr()
	if actionOwner.ID != existing.ID {
		t.Fatalf("merge did not move pending action: got %s", actionOwner.ID)
	}
	archived, err := f.client.Relationship.Get(f.ctx, proposed.ID)
	if err != nil || archived.Status != "archived" {
		t.Fatalf("proposed relationship not archived: %+v err=%v", archived, err)
	}

	split, err := f.svc.DecideIdentityCandidate(f.ctx, f.user, candidate.ID, IdentityDecisionInput{
		Decision: "split", Reason: "new evidence proved separate accounts", ExpectedVersion: merged.Version, IdempotencyKey: "identity-split-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if split.Status != identityUndone || split.Version != 4 {
		t.Fatalf("split projection: %+v", split)
	}
	observation, err = f.client.RelationshipObservation.Query().Where(relationshipobservation.ExternalIDEQ("ambiguous-acme")).WithRelationship().Only(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	owner, _ = observation.Edges.RelationshipOrErr()
	if owner.ID != proposed.ID {
		t.Fatalf("split did not restore observation: got %s", owner.ID)
	}
	restoredAction, err := f.client.RevenueAction.Query().Where(revenueaction.IDEQ(action.ID)).WithRelationship().Only(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	actionOwner, _ = restoredAction.Edges.RelationshipOrErr()
	if actionOwner.ID != proposed.ID {
		t.Fatalf("split did not restore pending action: got %s", actionOwner.ID)
	}
	restored, err := f.client.Relationship.Get(f.ctx, proposed.ID)
	if err != nil || restored.Status != "active" {
		t.Fatalf("proposed relationship not restored: %+v err=%v", restored, err)
	}

	loaded, err := f.svc.GetIdentityCandidate(f.ctx, f.user, candidate.ID)
	if err != nil {
		t.Fatal(err)
	}
	decisions, _ := loaded.Edges.DecisionsOrErr()
	lineage, _ := loaded.Edges.LineageEventsOrErr()
	if len(decisions) != 3 || len(lineage) != 4 {
		t.Fatalf("immutable audit history missing: decisions=%d lineage=%d", len(decisions), len(lineage))
	}
	if decisions[2].CompensatesDecisionID == nil {
		t.Fatal("split decision must identify the decision it compensates")
	}
}

func TestIdentityDecisionIdempotencyAndOptimisticConcurrency(t *testing.T) {
	f, _, _, candidate, _ := identityCollisionFixture(t)
	first, err := f.svc.DecideIdentityCandidate(f.ctx, f.user, candidate.ID, IdentityDecisionInput{
		Decision: "keep_separate", Reason: "verified distinct", ExpectedVersion: candidate.Version, IdempotencyKey: "keep-separate-once",
	})
	if err != nil {
		t.Fatal(err)
	}
	again, err := f.svc.DecideIdentityCandidate(f.ctx, f.user, candidate.ID, IdentityDecisionInput{
		Decision: "keep_separate", Reason: "ignored replay body", ExpectedVersion: candidate.Version, IdempotencyKey: "keep-separate-once",
	})
	if err != nil {
		t.Fatalf("idempotent replay: %v", err)
	}
	if again.ID != first.ID || again.Version != first.Version {
		t.Fatalf("idempotent replay changed candidate: first=%+v again=%+v", first, again)
	}
	if _, err := f.svc.DecideIdentityCandidate(f.ctx, f.user, candidate.ID, IdentityDecisionInput{
		Decision: "defer", ExpectedVersion: candidate.Version, IdempotencyKey: "stale-reviewer",
	}); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale reviewer must lose optimistic CAS, got %v", err)
	}
}

func TestIdentityCandidateEvidenceWindowIsMonotonicForOutOfOrderEvidence(t *testing.T) {
	f, _, proposed, candidate, _ := identityCollisionFixture(t)
	if candidate.EvidenceFrom == nil || candidate.EvidenceTo == nil {
		t.Fatalf("candidate evidence window was not initialized: %+v", candidate)
	}
	latest := candidate.EvidenceTo.UTC()
	older := latest.Add(-2 * time.Hour)
	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		RelationshipID: proposed.ID, DisplayName: proposed.DisplayName, Source: "hubspot",
		ExternalID: "late-arriving-ambiguous-acme", EventType: "company.updated",
		OccurredAt: older, ReceivedAt: latest.Add(time.Minute),
	}}); err != nil {
		t.Fatal(err)
	}
	updated, err := f.client.RelationshipIdentityCandidate.Get(f.ctx, candidate.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.EvidenceFrom == nil || !updated.EvidenceFrom.Equal(older) {
		t.Fatalf("older evidence did not widen the lower boundary: %+v", updated)
	}
	if updated.EvidenceTo == nil || !updated.EvidenceTo.Equal(latest) {
		t.Fatalf("older evidence regressed the upper boundary: before=%s candidate=%+v", latest, updated)
	}
}

func TestConcurrentIdentityDecisionsResolveOnce(t *testing.T) {
	f, _, _, candidate, _ := identityCollisionFixture(t)
	start := make(chan struct{})
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for _, decision := range []string{"merge", "keep_separate"} {
		wg.Add(1)
		go func(decision string) {
			defer wg.Done()
			<-start
			_, err := f.svc.DecideIdentityCandidate(f.ctx, f.user, candidate.ID, IdentityDecisionInput{
				Decision: decision, ExpectedVersion: candidate.Version, IdempotencyKey: "concurrent-" + decision,
			})
			errs <- err
		}(decision)
	}
	close(start)
	wg.Wait()
	close(errs)
	success, conflicts := 0, 0
	for err := range errs {
		switch {
		case err == nil:
			success++
		case errors.Is(err, ErrConflict):
			conflicts++
		default:
			t.Fatalf("unexpected concurrent decision error: %v", err)
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatalf("decisions did not resolve once: success=%d conflict=%d", success, conflicts)
	}
	count, err := f.client.RelationshipIdentityDecision.Query().Count(f.ctx)
	if err != nil || count != 1 {
		t.Fatalf("immutable decisions=%d err=%v", count, err)
	}
}

func TestCompensationRefusesInFlightAction(t *testing.T) {
	f, _, _, candidate, _ := identityCollisionFixture(t)
	merged, err := f.svc.DecideIdentityCandidate(f.ctx, f.user, candidate.ID, IdentityDecisionInput{
		Decision: "merge", ExpectedVersion: candidate.Version, IdempotencyKey: "unsafe-merge",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.client.RevenueAction.Update().Where(revenueaction.ExecutionStatusEQ(ExecPending)).SetExecutionStatus(ExecRequested).Save(f.ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.DecideIdentityCandidate(f.ctx, f.user, candidate.ID, IdentityDecisionInput{
		Decision: "undo", ExpectedVersion: merged.Version, IdempotencyKey: "unsafe-undo",
	}); !errors.Is(err, ErrConflict) {
		t.Fatalf("unsafe compensation must fail closed, got %v", err)
	}
	status, err := f.client.RelationshipIdentityCandidate.Query().Where(relationshipidentitycandidate.IDEQ(candidate.ID)).Only(f.ctx)
	if err != nil || status.Status != identityResolved {
		t.Fatalf("failed compensation changed candidate: status=%+v err=%v", status, err)
	}
}

func TestSameDomainPeopleRemainDistinctUnderIdentityReview(t *testing.T) {
	f := newFixture(t)
	avery, err := f.svc.CreateRelationship(f.ctx, f.user, RelationshipInput{Kind: "person", DisplayName: "Avery", PrimaryEmail: "avery@acme.example", AccountDomain: "acme.example"})
	if err != nil {
		t.Fatal(err)
	}
	morgan, err := f.svc.CreateRelationship(f.ctx, f.user, RelationshipInput{Kind: "person", DisplayName: "Morgan", PrimaryEmail: "morgan@acme.example", AccountDomain: "acme.example"})
	if err != nil {
		t.Fatal(err)
	}
	if avery.ID == morgan.ID {
		t.Fatal("same-domain people auto-merged")
	}
	count, err := f.client.Relationship.Query().Where(relationship.KindEQ("person")).Count(f.ctx)
	if err != nil || count != 2 {
		t.Fatalf("person count=%d err=%v", count, err)
	}
}
