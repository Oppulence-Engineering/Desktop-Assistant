package revenue

import (
	"errors"
	"testing"
	"time"
)

func TestMissionControlOwnsStateChangeEvidenceCompletenessAndAction(t *testing.T) {
	f := newFixture(t)
	base := time.Date(2026, 7, 31, 19, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return base }
	result, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{acmeObservation(base)})
	if err != nil {
		t.Fatal(err)
	}
	rel := result[0].Relationship
	if _, err := f.svc.ReportSourceSyncProgress(f.ctx, f.user, SourceSyncProgressInput{
		Source: "hubspot", SourceAccountID: "default", Completed: 10, Total: 10, Done: true, OccurredAt: base,
	}); err != nil {
		t.Fatal(err)
	}
	action, err := f.svc.CreateAction(f.ctx, f.user, ActionInput{
		RelationshipID: rel.ID, ActionType: "warm_follow_up", Channel: "email", Reason: "Recent source evidence supports a follow-up.",
		RecipientEmail: "buyer@acme.example", ProposedSubject: "Next step", ProposedMessage: "Hello",
		PriorityScore: 82, PriorityParts: map[string]int{"evidence_quality": 30, "commitment_urgency": 22},
	})
	if err != nil {
		t.Fatal(err)
	}

	model, err := f.svc.MissionControl(f.ctx, f.user, rel.ID)
	if err != nil {
		t.Fatal(err)
	}
	if model.ContractVersion != missionControlContractVersion || model.AggregateHash == "" || model.StateVersion != rel.StateVersion || model.StateHash != rel.StateHash {
		t.Fatalf("aggregate boundary drifted: model=%+v rel=%+v", model, rel)
	}
	repeated, err := f.svc.MissionControl(f.ctx, f.user, rel.ID)
	if err != nil || repeated.AggregateHash != model.AggregateHash {
		t.Fatalf("unchanged aggregate hash drifted: first=%s repeated=%+v err=%v", model.AggregateHash, repeated, err)
	}
	if !model.Evidence["lifecycle"].Supported || model.Evidence["lifecycle"].AssertionID == "" || len(model.Evidence["lifecycle"].Evidence) != 1 {
		t.Fatalf("winning lifecycle assertion is not source-linked: %+v", model.Evidence["lifecycle"])
	}
	if lifecycle := model.Evidence["lifecycle"]; lifecycle.Status != relationshipAssertionStatusAccepted ||
		lifecycle.AuthorityRank != 4 || lifecycle.ValueSchemaVersion != relationshipAssertionValueSchemaVersion ||
		lifecycle.ExtractorVersion == "" || lifecycle.ProjectorCompatVersion != relationshipProjectorVersion {
		t.Fatalf("winning lifecycle authority metadata is incomplete: %+v", lifecycle)
	}
	hubSpotComplete := false
	for _, source := range model.Completeness.Sources {
		if source.Source == "hubspot" && source.Completeness == "complete" {
			hubSpotComplete = true
		}
	}
	if !hubSpotComplete || model.Completeness.ExternalActionSafe || model.Completeness.Status != "partial" {
		t.Fatalf("complete source was not represented truthfully: %+v", model.Completeness)
	}
	if model.ActiveRecommendation == nil || model.ActiveRecommendation.ID != action.ID.String() || model.ActiveRecommendation.RankFactors["evidence_quality"] != 30 {
		t.Fatalf("active recommendation/factors missing: %+v", model.ActiveRecommendation)
	}
	if model.Capabilities["acknowledge"] == "" || model.Capabilities["correct"] == "" {
		t.Fatalf("control links missing: %+v", model.Capabilities)
	}
}

func TestMissionControlHashIgnoresWallClockLag(t *testing.T) {
	f := newFixture(t)
	base := time.Date(2026, 7, 31, 19, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return base }
	result, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{acmeObservation(base)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ReportSourceSyncProgress(f.ctx, f.user, SourceSyncProgressInput{
		Source: "hubspot", SourceAccountID: "default", Completed: 1, Total: 1, Done: true, OccurredAt: base,
	}); err != nil {
		t.Fatal(err)
	}

	clock := base
	f.svc.now = func() time.Time {
		clock = clock.Add(2 * time.Second)
		return clock
	}
	first, err := f.svc.MissionControl(f.ctx, f.user, result[0].Relationship.ID)
	if err != nil {
		t.Fatal(err)
	}
	second, err := f.svc.MissionControl(f.ctx, f.user, result[0].Relationship.ID)
	if err != nil || second.AggregateHash != first.AggregateHash {
		t.Fatalf("wall-clock lag destabilized the aggregate: first=%s second=%+v err=%v", first.AggregateHash, second, err)
	}
}

func TestMissionControlLoadsUnprojectedRelationship(t *testing.T) {
	f := newFixture(t)
	model, err := f.svc.MissionControl(f.ctx, f.user, f.relationship(t).ID)
	if err != nil {
		t.Fatal(err)
	}
	if model.StateVersion != 0 || model.StateHash != "" || model.AggregateHash == "" {
		t.Fatalf("unexpected unprojected aggregate: %+v", model)
	}
}

func TestMissionControlAcknowledgementAndCorrectionBoundary(t *testing.T) {
	f := newFixture(t)
	base := time.Date(2026, 7, 31, 20, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return base }
	result, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{acmeObservation(base)})
	if err != nil {
		t.Fatal(err)
	}
	rel := result[0].Relationship
	ack, err := f.svc.AcknowledgeMissionControl(f.ctx, f.user, rel.ID, rel.StateVersion, rel.StateHash)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.AcknowledgeMissionControl(f.ctx, f.user, rel.ID, rel.StateVersion, rel.StateHash); err != nil {
		t.Fatalf("acknowledgement replay must be idempotent: %v", err)
	}
	model, err := f.svc.MissionControl(f.ctx, f.user, rel.ID)
	if err != nil {
		t.Fatal(err)
	}
	if model.ChangedSinceReview || model.PreviousReviewedStateVersion != ack.StateVersion {
		t.Fatalf("acknowledgement boundary ignored: %+v", model)
	}

	f.svc.now = func() time.Time { return base.Add(time.Minute) }
	corrected, err := f.svc.CorrectRelationship(f.ctx, f.user, rel.ID, RelationshipCorrectionInput{
		Dimension: "health", Value: "needs_attention", Reason: "Owner corrected the account health.",
	})
	if err != nil {
		t.Fatal(err)
	}
	model, err = f.svc.MissionControl(f.ctx, f.user, rel.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !model.ChangedSinceReview || model.StateVersion != corrected.StateVersion || model.PreviousReviewedStateVersion != ack.StateVersion {
		t.Fatalf("correction did not cross acknowledgement boundary: %+v", model)
	}
	if model.Evidence["health"].Authority != "user_correction" || !model.Evidence["health"].Supported ||
		model.Evidence["health"].AuthorityRank != 5 || model.Evidence["health"].ReviewerID != f.user.ID.String() ||
		model.Evidence["health"].ReviewDecision != relationshipAssertionStatusAccepted || model.Evidence["health"].ReviewedAt == nil {
		t.Fatalf("user correction did not become the visible winner: %+v", model.Evidence["health"])
	}
	found := false
	for _, change := range model.Changes {
		if change.Dimension == "health" {
			found = true
		}
	}
	if !found {
		t.Fatalf("dimension-level change missing: %+v", model.Changes)
	}
	if _, err := f.svc.AcknowledgeMissionControl(f.ctx, f.user, rel.ID, ack.StateVersion, ack.StateHash); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale acknowledgement must fail, got %v", err)
	}
}

func TestMissionControlFreshnessDowngradeAndBetaActionGate(t *testing.T) {
	f := newFixture(t)
	base := time.Date(2026, 7, 31, 21, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return base }
	result, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{acmeObservation(base)})
	if err != nil {
		t.Fatal(err)
	}
	rel := result[0].Relationship
	if _, err := f.svc.ReportSourceSyncProgress(f.ctx, f.user, SourceSyncProgressInput{
		Source: "hubspot", SourceAccountID: "default", Completed: 1, Total: 1, Done: true, OccurredAt: base,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.SetWorkspaceFeatureControl(f.ctx, f.user, CapabilityBetaEntitlement, true, "synthetic", "test"); err != nil {
		t.Fatal(err)
	}
	f.svc.now = func() time.Time { return base.Add(2 * time.Hour) }
	model, err := f.svc.MissionControl(f.ctx, f.user, rel.ID)
	if err != nil {
		t.Fatal(err)
	}
	if model.Completeness.Status != "stale" || model.Completeness.ExternalActionSafe {
		t.Fatalf("stale source appeared safe: %+v", model.Completeness)
	}
	if _, err := f.svc.CreateAction(f.ctx, f.user, ActionInput{
		RelationshipID: rel.ID, ActionType: "warm_follow_up", Channel: "email", Detector: "requested_follow_up_due", Reason: "should be suppressed",
		RecipientEmail: "buyer@acme.example", ProposedSubject: "Hi", ProposedMessage: "Hi",
	}); !errors.Is(err, ErrSourceIncomplete) {
		t.Fatalf("beta recommendation must be suppressed on stale required evidence, got %v", err)
	}
}

func TestMissionControlCompletenessIgnoresUnrelatedWorkspaceSource(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 7, 31, 22, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	results, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{acmeObservation(now)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ReportSourceSyncProgress(f.ctx, f.user, SourceSyncProgressInput{
		Source: "hubspot", SourceAccountID: "default", Completed: 1, Total: 1, Done: true, OccurredAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.MarkSourceDisconnected(f.ctx, f.user, "google", "another-user@example.com"); err != nil {
		t.Fatal(err)
	}
	model, err := f.svc.MissionControl(f.ctx, f.user, results[0].Relationship.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Completeness.Sources) != 1 || model.Completeness.Sources[0].Source != "hubspot" {
		t.Fatalf("unrelated source contaminated account completeness: %+v", model.Completeness.Sources)
	}
}

func TestMissionControlBindsEvidenceFreshnessToExactProviderAccount(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 7, 31, 22, 30, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	input := acmeObservation(now)
	input.SourceAccountID = "a-live-portal"
	results, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{input})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ReportSourceSyncProgress(f.ctx, f.user, SourceSyncProgressInput{
		Source: "hubspot", SourceAccountID: "a-live-portal", Completed: 1, Total: 1, Done: true, OccurredAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "hubspot", SourceAuthorizationInput{
		SourceAccountID: "z-partial-portal", State: "completed",
		GrantedScopes: []string{
			"crm.objects.companies.read", "crm.objects.contacts.read", "crm.objects.deals.read",
		},
	}); err != nil {
		t.Fatal(err)
	}
	model, err := f.svc.MissionControl(f.ctx, f.user, results[0].Relationship.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !model.Evidence["lifecycle"].Fresh {
		t.Fatalf("a second partial account made exact live-account evidence stale: %+v", model.Evidence["lifecycle"])
	}
	if model.Completeness.ExternalActionSafe || model.Completeness.Status != "partial" {
		t.Fatalf("workspace-wide multi-account completeness stopped being conservative: %+v", model.Completeness)
	}
}

func TestMissionControlNeverRendersAssertionsAheadOfDurableProjection(t *testing.T) {
	f := newFixture(t)
	base := time.Date(2026, 7, 31, 23, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return base }
	validFrom := base.Add(time.Minute)
	results, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		DisplayName: "Scheduled Account", AccountDomain: "scheduled.example",
		Source: "hubspot", SourceAccountID: "portal-1", ExternalID: "scheduled-state",
		EventType: "company.updated", OccurredAt: validFrom, ReceivedAt: base,
		Assertions: []RelationshipAssertionInput{{
			Dimension: "health", Value: "needs_attention", SourceType: "source_fact",
			Confidence: 1, Reason: "This assertion becomes valid after the initial projection.", ValidFrom: validFrom,
		}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ReportSourceSyncProgress(f.ctx, f.user, SourceSyncProgressInput{
		Source: "hubspot", SourceAccountID: "portal-1", Completed: 1, Total: 1, Done: true, OccurredAt: base,
	}); err != nil {
		t.Fatal(err)
	}
	f.svc.now = func() time.Time { return base.Add(2 * time.Minute) }
	before, err := f.svc.MissionControl(f.ctx, f.user, results[0].Relationship.ID)
	if err != nil {
		t.Fatal(err)
	}
	if before.Evidence["health"].Supported || before.Evidence["health"].Value != "unknown" ||
		before.Completeness.Status != "rebuilding" || before.Completeness.ExternalActionSafe {
		t.Fatalf("pending projection leaked future evidence into published state: %+v", before)
	}
	if processed, err := f.svc.RunDueRelationshipProjections(f.ctx, f.user, 10, "mission-control-test"); err != nil || processed != 1 {
		t.Fatalf("run due projection: processed=%d err=%v", processed, err)
	}
	after, err := f.svc.MissionControl(f.ctx, f.user, results[0].Relationship.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !after.Evidence["health"].Supported || after.Evidence["health"].Value != "needs_attention" ||
		after.StateVersion <= before.StateVersion {
		t.Fatalf("published projection did not atomically advance state and evidence: before=%+v after=%+v", before, after)
	}
}

func TestMissionControlIncludesActiveActionProviderAndProgressiveWriteScope(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	results, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{
		goldenAccountObservation(0, now),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ReportSourceSyncProgress(f.ctx, f.user, SourceSyncProgressInput{
		Source: "hubspot", SourceAccountID: "pilot-portal", Completed: 1, Total: 1, Done: true, OccurredAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	readScopes := []string{
		"https://www.googleapis.com/auth/gmail.readonly",
		"https://www.googleapis.com/auth/calendar.events.readonly",
	}
	if _, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "google", SourceAuthorizationInput{
		SourceAccountID: "pilot-google", State: "completed", GrantedScopes: readScopes,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ReportSourceSyncProgress(f.ctx, f.user, SourceSyncProgressInput{
		Source: "google", SourceAccountID: "pilot-google", Completed: 1, Total: 1, Done: true, OccurredAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.CreateAction(f.ctx, f.user, ActionInput{
		RelationshipID: results[0].Relationship.ID, ActionType: "warm_follow_up", Channel: "email",
		Reason: "A provider-scoped recommendation.", RecipientEmail: "buyer0@golden0.example",
		ProposedSubject: "Follow up", ProposedMessage: "Hello", ExecutionMode: ExecModeSend,
	}); err != nil {
		t.Fatal(err)
	}
	before, err := f.svc.MissionControl(f.ctx, f.user, results[0].Relationship.ID)
	if err != nil {
		t.Fatal(err)
	}
	googleFound := false
	for _, source := range before.Completeness.Sources {
		if source.Source == "google" {
			googleFound = true
			if !containsString(source.MissingScopes, "https://www.googleapis.com/auth/gmail.send") {
				t.Fatalf("active action write scope was not disclosed: %+v", source)
			}
		}
	}
	if !googleFound || before.Completeness.ExternalActionSafe || before.Completeness.Status != "partial" {
		t.Fatalf("active action provider readiness was omitted: %+v", before.Completeness)
	}
	if _, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "google", SourceAuthorizationInput{
		SourceAccountID: "pilot-google", State: "completed",
		GrantedScopes: append(readScopes, "https://www.googleapis.com/auth/gmail.send"),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ReportSourceSyncProgress(f.ctx, f.user, SourceSyncProgressInput{
		Source: "google", SourceAccountID: "pilot-google", Completed: 1, Total: 1, Done: true, OccurredAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	after, err := f.svc.MissionControl(f.ctx, f.user, results[0].Relationship.ID)
	if err != nil || !after.Completeness.ExternalActionSafe || after.Completeness.Status != "complete" {
		t.Fatalf("progressive write scope did not restore action safety: %+v err=%v", after.Completeness, err)
	}
}
