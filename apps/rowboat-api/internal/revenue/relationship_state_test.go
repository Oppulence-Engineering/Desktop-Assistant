package revenue

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitment"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitmentevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipassertion"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipobservation"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
)

func acmeObservation(now time.Time) RelationshipObservationInput {
	return RelationshipObservationInput{
		DisplayName:   "Acme",
		AccountDomain: "acme.example",
		Source:        "hubspot",
		ExternalID:    "company_123",
		EventType:     "company.updated",
		OccurredAt:    now,
		ReceivedAt:    now,
		Summary:       "Acme signed and entered onboarding.",
		Facts: map[string]any{
			"dealStage": "closed_won",
		},
		Participants: []RelationshipParticipantInput{{
			DisplayName: "Sarah Chen",
			Email:       "sarah@acme.example",
			Role:        "champion",
			Title:       "VP Engineering",
		}},
		Assertions: []RelationshipAssertionInput{
			{
				Dimension:  "lifecycle",
				Value:      "onboarding",
				SourceType: "source_fact",
				Confidence: 1,
				Reason:     "HubSpot deal stage changed to closed won.",
				ValidFrom:  now,
			},
			{
				Dimension:  "health",
				Value:      "healthy",
				SourceType: "ai_inference",
				Confidence: 0.8,
				Reason:     "The deal closed with recent engagement.",
				ValidFrom:  now,
			},
		},
	}
}

func TestRelationshipObservationProjectionAndCorrection(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)

	results, err := f.svc.IngestRelationshipObservations(
		f.ctx, f.user, []RelationshipObservationInput{acmeObservation(now)},
	)
	if err != nil {
		t.Fatalf("ingest hubspot: %v", err)
	}
	if len(results) != 1 || results[0].Duplicate {
		t.Fatalf("unexpected ingest result: %#v", results)
	}
	relID := results[0].Relationship.ID

	// A later AI guess cannot override an explicit source fact.
	_, err = f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		RelationshipID: relID,
		Source:         "gmail",
		ExternalID:     "thread_456",
		EventType:      "thread.updated",
		OccurredAt:     now.Add(time.Hour),
		ReceivedAt:     now.Add(time.Hour),
		Summary:        "No reply to the onboarding plan.",
		Assertions: []RelationshipAssertionInput{{
			Dimension:  "lifecycle",
			Value:      "prospect",
			SourceType: "ai_inference",
			Confidence: 0.99,
			Reason:     "The model guessed from an isolated thread.",
			ValidFrom:  now.Add(time.Hour),
		}, {
			Dimension:  "health",
			Value:      "needs_attention",
			SourceType: "deterministic",
			Confidence: 1,
			Reason:     "The promised onboarding reply is overdue.",
			ValidFrom:  now.Add(time.Hour),
		}},
	}})
	if err != nil {
		t.Fatalf("ingest gmail: %v", err)
	}
	rel, err := f.svc.GetRelationship(f.ctx, relID)
	if err != nil {
		t.Fatalf("get relationship: %v", err)
	}
	if rel.Lifecycle != "onboarding" {
		t.Fatalf("source fact must outrank AI inference: got %s", rel.Lifecycle)
	}
	if rel.Health != "needs_attention" {
		t.Fatalf("deterministic health should win over AI: got %s", rel.Health)
	}
	if rel.StateVersion != 2 {
		t.Fatalf("want two changed snapshots, got version %d", rel.StateVersion)
	}
	if len(rel.Edges.Participants) != 1 || rel.Edges.Participants[0].Role != "champion" {
		t.Fatalf("champion participant missing: %#v", rel.Edges.Participants)
	}

	corrected, err := f.svc.CorrectRelationship(f.ctx, f.user, relID, RelationshipCorrectionInput{
		Dimension: "health",
		Value:     "healthy",
		Reason:    "Customer confirmed the plan in a call.",
	})
	if err != nil {
		t.Fatalf("correct relationship: %v", err)
	}
	if corrected.Health != "healthy" || corrected.StateVersion != 3 {
		t.Fatalf("user correction did not become canonical: %#v", corrected)
	}

	changes, err := f.svc.RelationshipChanges(f.ctx, relID)
	if err != nil {
		t.Fatalf("changes: %v", err)
	}
	if len(changes) != 2 || changes[0].Version != 3 || changes[1].Version != 2 {
		t.Fatalf("want latest two snapshots, got %#v", changes)
	}
	var state RelationshipState
	if err := json.Unmarshal([]byte(changes[0].StateJSON), &state); err != nil {
		t.Fatalf("snapshot json: %v", err)
	}
	if state.Health != "healthy" || state.StateReason != "Customer confirmed the plan in a call." {
		t.Fatalf("snapshot explanation mismatch: %#v", state)
	}
}

func TestConfirmedMeetingCommitmentBecomesSharedCommitmentExactlyOnce(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 7, 31, 12, 35, 0, 0, time.UTC)
	existing, err := f.svc.CreateRelationship(f.ctx, f.user, RelationshipInput{
		Kind:          "company",
		DisplayName:   "Acme",
		PrimaryEmail:  "sales@acme.example",
		AccountDomain: "acme.example",
	})
	if err != nil {
		t.Fatalf("create existing account: %v", err)
	}
	input := RelationshipObservationInput{
		DisplayName:   "Acme",
		PrimaryEmail:  "avery@acme.example",
		AccountDomain: "acme.example",
		Source:        "meeting",
		ExternalID:    "commitment:session-1:0-2000",
		SourceVersion: "1",
		EventType:     "commitment_confirmed",
		OccurredAt:    now,
		ReceivedAt:    now,
		Summary:       "We committed to send the proposal.",
		Facts: map[string]any{
			"user_confirmed":       true,
			"commitment_text":      "Send the proposal",
			"commitment_direction": "promised_by_me",
			"commitment_id":        "session-1:0-2000",
			"commitment_due_at":    now.Add(24 * time.Hour).Format(time.RFC3339),
			"evidence_quote":       "I will send the proposal.",
			"evidence_start_ms":    0,
			"evidence_end_ms":      2000,
		},
		Assertions: []RelationshipAssertionInput{{
			Dimension:  "next_action",
			Value:      "Send the proposal",
			SourceType: "source_fact",
			Confidence: 1,
			Reason:     "User confirmed the cited meeting commitment.",
			ValidFrom:  now,
		}},
	}

	first, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{input})
	if err != nil {
		t.Fatalf("ingest confirmed commitment: %v", err)
	}
	second, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{input})
	if err != nil {
		t.Fatalf("replay confirmed commitment: %v", err)
	}
	if len(first) != 1 || first[0].Duplicate || len(second) != 1 || !second[0].Duplicate {
		t.Fatalf("unexpected idempotency results: first=%#v second=%#v", first, second)
	}
	if first[0].Relationship.ID != existing.ID {
		t.Fatalf("meeting should resolve to existing account, got %s", first[0].Relationship.ID)
	}
	rows, err := f.client.Commitment.Query().WithEvidences().All(f.ctx)
	if err != nil {
		t.Fatalf("query commitments: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("want one shared commitment after replay, got %d", len(rows))
	}
	if rows[0].Text != "Send the proposal" || rows[0].Direction != "promised_by_me" || !rows[0].UserConfirmed {
		t.Fatalf("unexpected shared commitment: %#v", rows[0])
	}
	if rows[0].DueAt == nil || !rows[0].DueAt.Equal(now.Add(24*time.Hour)) {
		t.Fatalf("spoken due date was not persisted: %#v", rows[0].DueAt)
	}
	if len(rows[0].Edges.Evidences) != 1 {
		t.Fatalf("confirmed commitment must retain one source evidence edge, got %d", len(rows[0].Edges.Evidences))
	}
	events, err := f.client.CommitmentEvent.Query().
		Where(commitmentevent.HasCommitmentWith(commitment.IDEQ(rows[0].ID))).
		Order(ent.Asc(commitmentevent.FieldVersion)).All(f.ctx)
	if err != nil || len(events) != 2 || events[0].Kind != "proposed" || events[1].Kind != "internally_confirmed" {
		t.Fatalf("confirmed commitment must start with two immutable events: %#v err=%v", events, err)
	}
	rel, err := f.svc.GetRelationship(f.ctx, first[0].Relationship.ID)
	if err != nil {
		t.Fatalf("get relationship: %v", err)
	}
	if rel.NextAction != "Send the proposal" {
		t.Fatalf("confirmed promise should project next action, got %q", rel.NextAction)
	}
	actions, err := f.client.RevenueAction.Query().WithEvidences().All(f.ctx)
	if err != nil {
		t.Fatalf("query follow-up actions: %v", err)
	}
	if len(actions) != 1 {
		t.Fatalf("want one approval-gated follow-up after replay, got %d", len(actions))
	}
	action := actions[0]
	if action.ActionType != "meeting_follow_up" || action.Channel != "email" ||
		action.RecipientEmail != "avery@acme.example" || action.ApprovalStatus != "pending" ||
		action.ExecutionStatus != "pending" {
		t.Fatalf("unexpected follow-up action: %#v", action)
	}
	if !strings.Contains(action.Reason, input.ExternalID) {
		t.Fatalf("follow-up reason must cite the immutable observation: %q", action.Reason)
	}
	if len(action.Edges.Evidences) != 1 || action.Edges.Evidences[0].Source != "meeting" {
		t.Fatalf("follow-up must link the confirmed meeting evidence: %#v", action.Edges.Evidences)
	}
	_, err = f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		RelationshipID: rel.ID,
		Source:         "meeting",
		ExternalID:     "commitment-update:session-1:0-2000:fulfilled",
		EventType:      "commitment_status_changed",
		OccurredAt:     now.Add(2 * time.Hour),
		ReceivedAt:     now.Add(2 * time.Hour),
		Facts: map[string]any{"commitment_updates": []map[string]any{{
			"commitmentId": "session-1:0-2000", "status": "fulfilled",
		}}},
	}})
	if err != nil {
		t.Fatalf("reconcile commitment fulfillment: %v", err)
	}
	fulfilled, err := f.client.Commitment.Get(f.ctx, rows[0].ID)
	if err != nil || fulfilled.Status != "fulfilled" || fulfilled.CurrentEventVersion != 3 || fulfilled.CompletedAt == nil {
		t.Fatalf("commitment was not closed: %#v err=%v", fulfilled, err)
	}
	events, err = f.client.CommitmentEvent.Query().
		Where(commitmentevent.HasCommitmentWith(commitment.IDEQ(rows[0].ID))).
		Order(ent.Asc(commitmentevent.FieldVersion)).All(f.ctx)
	if err != nil || len(events) != 3 || events[2].Kind != "fulfilled" || events[2].Version != 3 {
		t.Fatalf("fulfillment must append event version 3: %#v err=%v", events, err)
	}
}

func TestRelationshipObservationReplayIsIdempotent(t *testing.T) {
	f := newFixture(t)
	input := acmeObservation(time.Now().UTC())
	first, err := f.svc.IngestRelationshipObservations(
		f.ctx, f.user, []RelationshipObservationInput{input},
	)
	if err != nil {
		t.Fatalf("first ingest: %v", err)
	}
	second, err := f.svc.IngestRelationshipObservations(
		f.ctx, f.user, []RelationshipObservationInput{input},
	)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if !second[0].Duplicate || second[0].Observation.ID != first[0].Observation.ID {
		t.Fatalf("replay must return existing observation: %#v", second)
	}
	observations, err := f.client.RelationshipObservation.Query().
		Where(relationshipobservation.ExternalIDEQ(input.ExternalID)).
		All(f.ctx)
	if err != nil || len(observations) != 1 {
		t.Fatalf("want one observation, got %d err=%v", len(observations), err)
	}
	assertions, err := f.client.RelationshipAssertion.Query().
		Where(relationshipassertion.HasRelationshipWith()).
		All(f.ctx)
	if err != nil || len(assertions) != len(input.Assertions) {
		t.Fatalf("replay duplicated assertions: got %d err=%v", len(assertions), err)
	}
}

func TestRelationshipObservationsAreTenantScoped(t *testing.T) {
	f := newFixture(t)
	results, err := f.svc.IngestRelationshipObservations(
		f.ctx, f.user, []RelationshipObservationInput{acmeObservation(time.Now().UTC())},
	)
	if err != nil {
		t.Fatalf("ingest: %v", err)
	}
	other := newUser(t, f.client, "other@example.com", "user_other_relationships")
	otherCtx := authContextForTest(other)
	_, err = f.client.RelationshipObservation.Get(otherCtx, results[0].Observation.ID)
	if !ent.IsNotFound(err) && !errors.Is(err, db.ErrNoViewer) {
		t.Fatalf("other tenant read should be hidden, got %v", err)
	}
}

func TestAcmeGoldenPathProjectsFourSourcesIntoOneRelationship(t *testing.T) {
	f := newFixture(t)
	base := time.Date(2026, 7, 8, 15, 0, 0, 0, time.UTC)
	fixtures := []struct {
		adapt func(AdapterEvent) (RelationshipObservationInput, error)
		event AdapterEvent
	}{
		{
			adapt: AdaptHubSpotEvent,
			event: AdapterEvent{
				ExternalID:    "acme-deal-stage",
				AccountName:   "Acme",
				AccountDomain: "acme.com",
				EventType:     "deal_stage_changed",
				Summary:       "Acme moved into evaluation.",
				OccurredAt:    base,
				Assertions: []RelationshipAssertionInput{{
					Dimension: "lifecycle", Value: "evaluation", SourceType: "source_fact",
					Confidence: 1, Reason: "CRM stage is evaluation.", ValidFrom: base,
				}},
			},
		},
		{
			adapt: AdaptCalendarEvent,
			event: AdapterEvent{
				ExternalID:    "acme-security-meeting",
				AccountName:   "Acme",
				AccountDomain: "acme.com",
				EventType:     "meeting_missing",
				Summary:       "No security-review meeting was scheduled.",
				OccurredAt:    base.Add(15 * 24 * time.Hour),
				Assertions: []RelationshipAssertionInput{{
					Dimension: "health", Value: "needs_attention", SourceType: "deterministic",
					Confidence: 1, Reason: "Security review has no meeting.", ValidFrom: base.Add(15 * 24 * time.Hour),
				}},
			},
		},
		{
			adapt: AdaptGmailEvent,
			event: AdapterEvent{
				ExternalID:    "acme-security-promise",
				AccountName:   "Acme",
				AccountDomain: "acme.com",
				EventType:     "commitment_created",
				Summary:       "We promised the security packet by July 22.",
				OccurredAt:    base.Add(10 * 24 * time.Hour),
				Participants: []RelationshipParticipantInput{{
					DisplayName: "Avery Chen", Email: "avery@acme.com", Role: "champion",
				}},
			},
		},
		{
			adapt: AdaptSlackEvent,
			event: AdapterEvent{
				ExternalID:    "acme-engagement",
				AccountName:   "Acme",
				AccountDomain: "acme.com",
				EventType:     "engagement_declined",
				Summary:       "No champion reply after pricing.",
				OccurredAt:    base.Add(17 * 24 * time.Hour),
				Assertions: []RelationshipAssertionInput{{
					Dimension: "engagement", Value: "declining", SourceType: "deterministic",
					Confidence: 1, Reason: "Champion engagement declined after pricing.", ValidFrom: base.Add(17 * 24 * time.Hour),
				}},
			},
		},
	}
	inputs := make([]RelationshipObservationInput, 0, len(fixtures))
	for _, fixture := range fixtures {
		input, err := fixture.adapt(fixture.event)
		if err != nil {
			t.Fatalf("adapt event: %v", err)
		}
		inputs = append(inputs, input)
	}
	results, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, inputs)
	if err != nil {
		t.Fatalf("ingest golden path: %v", err)
	}
	if len(results) != 4 {
		t.Fatalf("want four observations, got %d", len(results))
	}
	relID := results[0].Relationship.ID
	for _, result := range results {
		if result.Relationship.ID != relID {
			t.Fatalf("all provider evidence must resolve to one Acme relationship")
		}
	}
	rel, err := f.svc.GetRelationship(f.ctx, relID)
	if err != nil {
		t.Fatalf("get relationship: %v", err)
	}
	if rel.Lifecycle != "evaluation" || rel.Health != "needs_attention" || rel.Engagement != "declining" {
		t.Fatalf("unexpected projected state: lifecycle=%s health=%s engagement=%s", rel.Lifecycle, rel.Health, rel.Engagement)
	}
	timeline, err := f.svc.RelationshipTimeline(f.ctx, relID, 50)
	if err != nil || len(timeline) != 4 {
		t.Fatalf("want unified four-source timeline, got %d err=%v", len(timeline), err)
	}
	sources, err := f.svc.RelationshipSourceStatuses(f.ctx, f.user)
	if err != nil || len(sources) != 4 {
		t.Fatalf("want four source statuses, got %d err=%v", len(sources), err)
	}
}

func authContextForTest(user *ent.User) context.Context {
	return auth.WithUser(context.Background(), user)
}
