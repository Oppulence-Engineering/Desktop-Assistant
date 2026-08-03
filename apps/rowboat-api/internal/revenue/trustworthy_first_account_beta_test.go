package revenue

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipidentitycandidate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipobservation"
)

// TestTrustworthyFirstAccountGoldenJourney is the named production-shaped
// acceptance spine for RFC 038 section 10.1. Provider adapters, clients, and
// executors retain focused fault suites; this test proves their authoritative
// server contracts compose into one durable account loop without bypassing a
// trust boundary.
func TestTrustworthyFirstAccountGoldenJourney(t *testing.T) {
	f := newFixture(t)
	base := time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return base }
	f.link(t)

	googleScopes := []string{
		"https://www.googleapis.com/auth/gmail.readonly",
		"https://www.googleapis.com/auth/calendar.events.readonly",
	}
	hubSpotScopes := []string{
		"crm.objects.companies.read",
		"crm.objects.contacts.read",
		"crm.objects.deals.read",
	}
	for _, source := range []struct {
		name, account string
		scopes        []string
	}{
		{name: "google", account: "pilot-google", scopes: googleScopes},
		{name: "hubspot", account: "pilot-portal", scopes: hubSpotScopes},
	} {
		if _, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, source.name, SourceAuthorizationInput{
			SourceAccountID: source.account, State: "started",
		}); err != nil {
			t.Fatalf("start %s consent: %v", source.name, err)
		}
		if _, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, source.name, SourceAuthorizationInput{
			SourceAccountID: source.account, State: "completed", GrantedScopes: source.scopes,
		}); err != nil {
			t.Fatalf("complete %s consent: %v", source.name, err)
		}
		if _, err := f.svc.BeginSourceBackfill(f.ctx, f.user, source.name, source.account); err != nil {
			t.Fatalf("begin %s backfill: %v", source.name, err)
		}
		partial, err := f.svc.ReportSourceSyncProgress(f.ctx, f.user, SourceSyncProgressInput{
			Source: source.name, SourceAccountID: source.account, Completed: 1, Total: 10,
			Watermark: "opaque-progress", OccurredAt: base,
		})
		if err != nil || partial.Status != "backfilling" || partial.Completeness != "partial" {
			t.Fatalf("truthful partial %s backfill: status=%+v err=%v", source.name, partial, err)
		}
	}

	inputs := make([]RelationshipObservationInput, 0, 10)
	for index := 0; index < 10; index++ {
		occurredAt := base.Add(time.Duration(index) * time.Minute)
		input := goldenAccountObservation(index, occurredAt)
		if index == 0 {
			input.ResourceRefs = []string{"hubspot:company:golden-conflict"}
		}
		inputs = append(inputs, input)
	}
	results, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, inputs)
	if err != nil || len(results) != 10 {
		t.Fatalf("ingest ten eligible accounts: count=%d err=%v", len(results), err)
	}
	account := results[0].Relationship
	unrelated := results[1].Relationship
	if count, err := f.client.Relationship.Query().Where(relationship.StatusNEQ("archived")).Count(f.ctx); err != nil || count < 10 {
		t.Fatalf("activation corpus did not produce ten relationships: count=%d err=%v", count, err)
	}

	duplicate, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{inputs[2]})
	if err != nil || len(duplicate) != 1 || !duplicate[0].Duplicate {
		t.Fatalf("provider replay was not idempotent: result=%+v err=%v", duplicate, err)
	}
	newer := RelationshipObservationInput{
		RelationshipID: account.ID, Source: "hubspot", SourceAccountID: "pilot-portal",
		ExternalID: "golden-out-of-order", SourceVersion: "2", EventType: "company.updated",
		OccurredAt: base.Add(20 * time.Minute), ReceivedAt: base.Add(20 * time.Minute),
		Assertions: []RelationshipAssertionInput{{
			Dimension: "engagement", Value: "increasing", SourceType: "source_fact", Confidence: 1,
			Reason: "Latest provider event.", ValidFrom: base.Add(20 * time.Minute),
		}},
	}
	older := newer
	older.SourceVersion = "1"
	older.OccurredAt = base.Add(10 * time.Minute)
	older.ReceivedAt = base.Add(21 * time.Minute)
	older.Assertions = []RelationshipAssertionInput{{
		Dimension: "engagement", Value: "declining", SourceType: "source_fact", Confidence: 1,
		Reason: "Older provider event delivered late.", ValidFrom: older.OccurredAt,
	}}
	f.svc.now = func() time.Time { return base.Add(22 * time.Minute) }
	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{newer, older}); err != nil {
		t.Fatalf("out-of-order ingest: %v", err)
	}
	account, err = f.svc.GetRelationship(f.ctx, account.ID)
	if err != nil || account.Engagement != "increasing" {
		t.Fatalf("late old evidence displaced current state: account=%+v err=%v", account, err)
	}
	if processed, err := f.svc.RunDueRelationshipProjections(f.ctx, f.user, 100, "golden-journey"); err != nil || processed < 9 {
		t.Fatalf("run durable temporal projections: processed=%d err=%v", processed, err)
	}

	for _, source := range []struct{ name, account string }{
		{name: "google", account: "pilot-google"},
		{name: "hubspot", account: "pilot-portal"},
	} {
		if _, err := f.svc.ReportSourceSyncProgress(f.ctx, f.user, SourceSyncProgressInput{
			Source: source.name, SourceAccountID: source.account, Completed: 10, Total: 10,
			Watermark: "opaque-live", Done: true, OccurredAt: base.Add(22 * time.Minute),
		}); err != nil {
			t.Fatalf("complete %s backfill: %v", source.name, err)
		}
	}

	proposed, err := f.svc.CreateRelationship(f.ctx, f.user, RelationshipInput{
		Kind: "company", DisplayName: "Golden Account duplicate",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		RelationshipID: proposed.ID, DisplayName: proposed.DisplayName,
		Source: "hubspot", SourceAccountID: "pilot-portal", ExternalID: "golden-conflicting-record",
		SourceVersion: "1", EventType: "company.updated", ResourceRefs: []string{"hubspot:company:golden-conflict"},
		OccurredAt: base.Add(23 * time.Minute), ReceivedAt: base.Add(23 * time.Minute),
		Assertions: []RelationshipAssertionInput{{
			Dimension: "summary", Value: "Ambiguous account evidence", SourceType: "source_fact",
			Confidence: 1, Reason: "Conflicting exact provider anchor.",
		}},
	}}); err != nil {
		t.Fatalf("create intentional identity conflict: %v", err)
	}
	candidate, err := f.client.RelationshipIdentityCandidate.Query().
		Where(relationshipidentitycandidate.StatusEQ(identityPending)).
		WithProposedRelationship().WithExistingRelationship().Only(f.ctx)
	if err != nil {
		t.Fatalf("durable identity candidate: %v", err)
	}
	deferred, err := f.svc.DecideIdentityCandidate(f.ctx, f.user, candidate.ID, IdentityDecisionInput{
		Decision: "defer", Reason: "Account owner verification required.",
		ExpectedVersion: candidate.Version, IdempotencyKey: "golden-defer",
	})
	if err != nil || deferred.Status != identityDeferred {
		t.Fatalf("defer ambiguity: candidate=%+v err=%v", deferred, err)
	}
	if model, err := f.svc.MissionControl(f.ctx, f.user, unrelated.ID); err != nil || model.StateVersion == 0 {
		t.Fatalf("deferred conflict blocked unrelated account: model=%+v err=%v", model, err)
	}
	resolved, err := f.svc.DecideIdentityCandidate(f.ctx, f.user, candidate.ID, IdentityDecisionInput{
		Decision: "merge", Reason: "Exact provider record verified by account owner.",
		ExpectedVersion: deferred.Version, IdempotencyKey: "golden-merge",
	})
	if err != nil || resolved.Status != identityResolved || len(resolved.Edges.LineageEvents) < 3 {
		t.Fatalf("resolve ambiguity with lineage: candidate=%+v err=%v", resolved, err)
	}

	model, err := f.svc.MissionControl(f.ctx, f.user, account.ID)
	if err != nil {
		t.Fatalf("open Mission Control: %v", err)
	}
	if model.StateVersion == 0 || model.StateHash == "" || model.AggregateHash == "" ||
		model.Completeness.Status != "complete" || !model.Completeness.ExternalActionSafe {
		t.Fatalf("Mission Control did not answer from one safe version: %+v", model)
	}
	for dimension, evidence := range model.Evidence {
		if !evidence.Supported || (evidence.Authority != "user_correction" && len(evidence.Evidence) == 0) {
			t.Fatalf("material dimension %s is unsupported: %+v", dimension, evidence)
		}
	}
	repeated, err := f.svc.MissionControl(f.ctx, f.user, account.ID)
	if err != nil || repeated.AggregateHash != model.AggregateHash {
		t.Fatalf("web/desktop aggregate parity drift: first=%s second=%+v err=%v", model.AggregateHash, repeated, err)
	}
	if _, err := f.svc.AcknowledgeMissionControl(f.ctx, f.user, account.ID, model.StateVersion, model.StateHash); err != nil {
		t.Fatalf("acknowledge reviewed state: %v", err)
	}
	f.svc.now = func() time.Time { return base.Add(25 * time.Minute) }
	corrected, err := f.svc.CorrectRelationship(f.ctx, f.user, account.ID, RelationshipCorrectionInput{
		Dimension: "health", Value: "needs_attention", Reason: "Pilot owner verified delivery risk.",
	})
	if err != nil {
		t.Fatalf("apply correction: %v", err)
	}
	correctedModel, err := f.svc.MissionControl(f.ctx, f.user, account.ID)
	if err != nil || correctedModel.StateVersion != corrected.StateVersion ||
		correctedModel.Evidence["health"].Authority != "user_correction" || !correctedModel.ChangedSinceReview {
		t.Fatalf("cross-client correction boundary: model=%+v err=%v", correctedModel, err)
	}
	if _, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "google", SourceAuthorizationInput{
		SourceAccountID: "pilot-google", State: "completed", GrantedScopes: append(googleScopes,
			"https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.compose"),
	}); err != nil {
		t.Fatalf("grant progressive Gmail send scope: %v", err)
	}
	if _, err := f.svc.ReportSourceSyncProgress(f.ctx, f.user, SourceSyncProgressInput{
		Source: "google", SourceAccountID: "pilot-google", Completed: 10, Total: 10,
		Watermark: "opaque-action-ready", Done: true, OccurredAt: base.Add(25 * time.Minute),
	}); err != nil {
		t.Fatalf("confirm action provider readiness: %v", err)
	}

	action, err := f.svc.CreateAction(f.ctx, f.user, ActionInput{
		RelationshipID: account.ID, ActionType: "warm_follow_up", Channel: "email",
		DedupeKey: "golden-follow-up-v1", Reason: "Verified risk requires an owner-approved follow-up.",
		RecipientEmail: "buyer0@golden0.example", ProposedSubject: "Delivery plan",
		ProposedMessage: "Can we review the delivery plan?", ExecutionMode: ExecModeSend,
		PriorityScore: 88, PriorityParts: map[string]int{"urgency": 38, "evidence_quality": 50},
	})
	if err != nil {
		t.Fatalf("create governed recommendation: %v", err)
	}
	if err := f.svc.RefreshRelationshipAttention(f.ctx, f.user); err != nil {
		t.Fatal(err)
	}
	attention, err := f.svc.ListRelationshipAttention(f.ctx, f.user, "open", 100)
	if err != nil || len(attention) == 0 {
		t.Fatalf("open relationship-native attention item: count=%d err=%v", len(attention), err)
	}
	if _, err := f.svc.Evaluate(f.ctx, f.user, action.ID); err != nil {
		t.Fatalf("evaluate first revision: %v", err)
	}
	if _, err := f.svc.Approve(f.ctx, f.user, action.ID, false); err != nil {
		t.Fatalf("approve first revision: %v", err)
	}
	editedBody := "Can we review the delivery plan and agree owners by Friday?"
	edited, err := f.svc.EditAction(f.ctx, f.user, action.ID, EditInput{ProposedMessage: &editedBody})
	if err != nil || edited.Revision != 2 || edited.ApprovalStatus != ApprovalPending {
		t.Fatalf("edit did not invalidate approval: action=%+v err=%v", edited, err)
	}
	if _, err := f.svc.Execute(f.ctx, f.user, action.ID); !errors.Is(err, ErrNotApproved) {
		t.Fatalf("stale approval executed revised action: %v", err)
	}
	if _, err := f.svc.Evaluate(f.ctx, f.user, action.ID); err != nil {
		t.Fatalf("evaluate revised action: %v", err)
	}
	if _, err := f.svc.Approve(f.ctx, f.user, action.ID, false); err != nil {
		t.Fatalf("approve revised action: %v", err)
	}
	f.exec.err = ErrAmbiguous
	ambiguous, err := f.svc.Execute(f.ctx, f.user, action.ID)
	if err != nil || ambiguous.ExecutionStatus != ExecAmbiguous || f.exec.calls != 1 {
		t.Fatalf("truthful post-acceptance timeout: action=%+v writes=%d err=%v", ambiguous, f.exec.calls, err)
	}
	if _, err := f.svc.Execute(f.ctx, f.user, action.ID); err != nil || f.exec.calls != 1 {
		t.Fatalf("ambiguous redelivery repeated provider write: writes=%d err=%v", f.exec.calls, err)
	}
	f.exec.err = nil
	f.exec.reconcileFound = true
	f.exec.reconcileResult = &ExecResult{ProviderMessageID: "golden-receipt", ProviderThreadID: "golden-thread"}
	reconciled, err := f.svc.ReconcileAmbiguousAction(f.ctx, f.user, action.ID)
	if err != nil || reconciled.ExecutionStatus != ExecSent || f.exec.calls != 1 || f.exec.reconcileCalls != 1 {
		t.Fatalf("read-only reconciliation: action=%+v writes=%d reads=%d err=%v", reconciled, f.exec.calls, f.exec.reconcileCalls, err)
	}
	if _, err := f.svc.AppendOutcome(f.ctx, f.user, action.ID, OutcomeInput{
		Kind: "replied", Source: "gmail", SourceEventID: "golden-reply", OccurredAt: base.Add(time.Hour),
	}); err != nil {
		t.Fatalf("observe provider outcome: %v", err)
	}
	timeline, err := f.svc.RelationshipTimeline(f.ctx, account.ID, 100)
	if err != nil || !observationEventPresent(timeline, "action.outcome.replied") {
		t.Fatalf("outcome missing from relationship history: count=%d err=%v", len(timeline), err)
	}
	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	learning, err := f.svc.outcomeLearningDetails(f.ctx, f.client, ws, "warm_follow_up", "email")
	if err != nil || learning.Samples == 0 || learning.PositiveSamples == 0 {
		t.Fatalf("outcome was not available to explain the next recommendation: %+v err=%v", learning, err)
	}
	next, err := f.svc.CreateAction(f.ctx, f.user, ActionInput{
		RelationshipID: account.ID, ActionType: "warm_follow_up", Channel: "email",
		DedupeKey: "golden-follow-up-v2", Reason: "Later evidence created a new reviewable next step.",
		RecipientEmail: "buyer0@golden0.example", ProposedSubject: "Next checkpoint",
		ProposedMessage: "Would Tuesday work for the next checkpoint?",
		PriorityScore:   80 + learning.Lift, PriorityParts: map[string]int{"outcome_learning": learning.Lift},
	})
	if err != nil || !strings.Contains(next.PriorityComponentsJSON, `"outcome_learning"`) {
		t.Fatalf("factor-level recommendation learning is not inspectable: action=%+v err=%v", next, err)
	}

	observationCount, err := f.client.RelationshipObservation.Query().
		Where(relationshipobservation.HasRelationshipWith(relationship.IDEQ(account.ID))).Count(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.MarkSourceDisconnected(f.ctx, f.user, "hubspot", "pilot-portal"); err != nil {
		t.Fatalf("disconnect source: %v", err)
	}
	disconnected, err := f.svc.MissionControl(f.ctx, f.user, account.ID)
	if err != nil || disconnected.Completeness.Status != "stale" || disconnected.Completeness.ExternalActionSafe {
		t.Fatalf("disconnect did not immediately downgrade completeness: model=%+v err=%v", disconnected, err)
	}
	if _, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "hubspot", SourceAuthorizationInput{
		SourceAccountID: "pilot-portal", State: "completed", GrantedScopes: hubSpotScopes,
	}); err != nil {
		t.Fatalf("reconnect authorization: %v", err)
	}
	if _, err := f.svc.BeginSourceBackfill(f.ctx, f.user, "hubspot", "pilot-portal"); err != nil {
		t.Fatalf("resume backfill: %v", err)
	}
	if _, err := f.svc.ReportSourceSyncProgress(f.ctx, f.user, SourceSyncProgressInput{
		Source: "hubspot", SourceAccountID: "pilot-portal", Completed: 10, Total: 10,
		Watermark: "opaque-resumed", Done: true, OccurredAt: base.Add(70 * time.Minute),
	}); err != nil {
		t.Fatalf("finish resumed backfill: %v", err)
	}
	reconnected, err := f.svc.MissionControl(f.ctx, f.user, account.ID)
	if err != nil || reconnected.Completeness.Status != "complete" {
		t.Fatalf("reconnect did not restore trusted completeness: model=%+v err=%v", reconnected, err)
	}
	afterReconnect, err := f.client.RelationshipObservation.Query().
		Where(relationshipobservation.HasRelationshipWith(relationship.IDEQ(account.ID))).Count(f.ctx)
	if err != nil || afterReconnect != observationCount {
		t.Fatalf("reconnect duplicated relationship history: before=%d after=%d err=%v", observationCount, afterReconnect, err)
	}
}

func goldenAccountObservation(index int, occurredAt time.Time) RelationshipObservationInput {
	return RelationshipObservationInput{
		DisplayName:   fmt.Sprintf("Golden Account %02d", index),
		PrimaryEmail:  fmt.Sprintf("buyer%d@golden%d.example", index, index),
		AccountDomain: fmt.Sprintf("golden%d.example", index),
		Source:        "hubspot", SourceAccountID: "pilot-portal",
		ExternalID: fmt.Sprintf("golden-company-%02d", index), SourceVersion: "1",
		EventType: "company.updated", OccurredAt: occurredAt, ReceivedAt: occurredAt,
		Summary: "Production-shaped synthetic relationship evidence.",
		Assertions: []RelationshipAssertionInput{
			{Dimension: "lifecycle", Value: "evaluation", SourceType: "source_fact", Confidence: 1, Reason: "Verified CRM stage."},
			{Dimension: "engagement", Value: "steady", SourceType: "source_fact", Confidence: 1, Reason: "Verified recent activity."},
			{Dimension: "sentiment", Value: "positive", SourceType: "source_fact", Confidence: 1, Reason: "Verified customer signal."},
			{Dimension: "health", Value: "healthy", SourceType: "source_fact", Confidence: 1, Reason: "Verified account status."},
			{Dimension: "summary", Value: "Evaluation is active with a confirmed buyer.", SourceType: "source_fact", Confidence: 1, Reason: "Verified CRM summary."},
			{Dimension: "next_action", Value: "Confirm delivery owners.", SourceType: "source_fact", Confidence: 1, Reason: "Verified next step."},
			{Dimension: "risk", Value: "Delivery ownership is unresolved.", SourceType: "source_fact", Confidence: 1, Reason: "Verified open risk."},
			{Dimension: "milestone", Value: "Technical evaluation started.", SourceType: "source_fact", Confidence: 1, Reason: "Verified milestone."},
		},
	}
}

func observationEventPresent(observations []*ent.RelationshipObservation, eventType string) bool {
	for _, observation := range observations {
		if observation.EventType == eventType {
			return true
		}
	}
	return false
}
