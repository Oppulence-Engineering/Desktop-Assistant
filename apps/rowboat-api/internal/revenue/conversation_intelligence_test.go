package revenue

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/conversationintelligenceartifact"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
)

func compiledConversationInput(now time.Time, externalID, version string) RelationshipObservationInput {
	riskQuote := "We are concerned the security review will delay the renewal."
	commitmentQuote := "I will send the security packet by Friday."
	claims := []map[string]any{
		{
			"id": "claim-risk", "kind": "risk", "value": "Security review may delay renewal",
			"exactQuote": riskQuote, "startMs": 1_000, "endMs": 4_000,
			"speakerId": "anonymous:remote", "speakerLabel": "Other",
			"speakerConfidence": 0.55, "confidence": 0.7,
			"captureCaveats": []string{"remote channel may contain multiple speakers"},
			"material":       true, "stateDimension": "risk",
		},
		{
			"id": "claim-commitment", "kind": "commitment", "value": "Send the security packet",
			"exactQuote": commitmentQuote, "startMs": 5_000, "endMs": 8_000,
			"speakerId": "local-user", "speakerLabel": "You",
			"speakerConfidence": 1.0, "confidence": 0.9,
			"captureCaveats": []string{}, "material": true, "stateDimension": "next_action",
		},
	}
	actions := []map[string]any{
		{
			"id": "recap-email", "actionType": "meeting_recap", "channel": "email",
			"reason": "Send a quote-backed recap.", "proposedSubject": "Renewal recap",
			"proposedMessage":  "Security review and next steps.",
			"evidenceClaimIds": []string{"claim-risk", "claim-commitment"}, "confidence": 0.85,
		},
		{
			"id": "follow-up-task", "actionType": "follow_up_task", "channel": "task",
			"reason": "Keep the promise from slipping.", "proposedMessage": "Send the security packet",
			"dueAt":            now.Add(48 * time.Hour).Format(time.RFC3339),
			"evidenceClaimIds": []string{"claim-commitment"}, "confidence": 0.9,
		},
	}
	payload, _ := json.Marshal(map[string]any{"envelope": map[string]any{
		"segments": []map[string]any{{"text": riskQuote}, {"text": commitmentQuote}},
	}})
	return RelationshipObservationInput{
		DisplayName: "Acme", PrimaryEmail: "avery@acme.example", AccountDomain: "acme.example",
		Source: "meeting", SourceAccountID: "oppulence", ExternalID: externalID,
		SourceVersion: version, EventType: "conversation_evidence_compiled",
		OccurredAt: now, ReceivedAt: now, Summary: "Acme renewal conversation",
		Facts: map[string]any{
			"conversation_claims": claims, "action_pack": actions,
			"governance_receipt": map[string]any{
				"receiptId": "receipt-1", "capturedAt": now.Format(time.RFC3339),
				"capturePolicy": "manual_capture", "routing": "local_transcription_to_oppulence",
				"region": "local_device", "retention": "untilTranscribed",
				"participantDisclosure": "not_recorded", "legalHold": false,
				"deletionOutcome": "scheduled_after_transcription", "evidenceClip": "not_retained",
			},
		},
		Payload: payload,
		Assertions: []RelationshipAssertionInput{
			{Dimension: "risk", Value: "Security review may delay renewal", SourceType: "ai_inference", Confidence: 0.7, Reason: "Quoted risk claim.", ValidFrom: now},
			{Dimension: "next_action", Value: "Send the security packet", SourceType: "ai_inference", Confidence: 0.9, Reason: "Quoted commitment claim.", ValidFrom: now},
		},
	}
}

func TestConversationEvidenceMaterializesEvidenceActionsReviewDeltaAndCues(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 7, 31, 14, 0, 0, 0, time.UTC)
	input := compiledConversationInput(now, "oppulence:session-42", "fingerprint-1")
	results, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{input})
	if err != nil {
		t.Fatalf("ingest compiled conversation: %v", err)
	}
	if len(results) != 1 || results[0].Duplicate {
		t.Fatalf("unexpected ingest result: %#v", results)
	}

	evidences, err := f.client.RevenueEvidence.Query().All(f.ctx)
	if err != nil || len(evidences) != 2 {
		t.Fatalf("want one immutable evidence row per claim, got %d err=%v", len(evidences), err)
	}
	actions, err := f.client.RevenueAction.Query().WithEvidences().All(f.ctx)
	if err != nil || len(actions) != 2 {
		t.Fatalf("want two independently approvable actions, got %d err=%v", len(actions), err)
	}
	for _, action := range actions {
		if action.ApprovalStatus != ApprovalPending || len(action.Edges.Evidences) == 0 {
			t.Fatalf("action is not approval-gated and evidence-backed: %#v", action)
		}
	}
	if _, err := f.svc.Approve(f.ctx, f.user, actions[0].ID, false); err != nil {
		t.Fatalf("approve first proposal: %v", err)
	}
	if _, err := f.svc.Reject(f.ctx, f.user, actions[1].ID, "Not needed"); err != nil {
		t.Fatalf("reject second proposal: %v", err)
	}
	first, _ := f.svc.GetAction(f.ctx, actions[0].ID)
	second, _ := f.svc.GetAction(f.ctx, actions[1].ID)
	if first.ApprovalStatus != ApprovalApproved || second.ApprovalStatus != ApprovalRejected {
		t.Fatalf("actions were not independently decided: first=%s second=%s", first.ApprovalStatus, second.ApprovalStatus)
	}

	rel, err := f.svc.GetRelationship(f.ctx, results[0].Relationship.ID)
	if err != nil {
		t.Fatal(err)
	}
	intelligence, err := f.svc.RelationshipIntelligenceFor(f.ctx, rel)
	if err != nil {
		t.Fatal(err)
	}
	if len(intelligence.Claims) != 2 || len(intelligence.GovernanceReceipts) != 1 {
		t.Fatalf("compiled intelligence missing: %#v", intelligence)
	}
	if len(intelligence.ReviewItems) < 2 {
		t.Fatalf("low-confidence claim and speaker must be focused for review: %#v", intelligence.ReviewItems)
	}
	if len(intelligence.Delta.Changes) == 0 || len(intelligence.LiveCues) == 0 {
		t.Fatalf("delta and full-history cue cards must be derived: %#v", intelligence)
	}

	var claimReview ConversationReviewItem
	for _, item := range intelligence.ReviewItems {
		if item.Kind == "claim" && item.StateDimension == "risk" {
			claimReview = item
			break
		}
	}
	if claimReview.ID == "" {
		t.Fatal("risk claim review item missing")
	}
	corrected, afterCorrection, err := f.svc.CorrectConversationReview(f.ctx, f.user, rel.ID, ConversationReviewCorrectionInput{
		ReviewItemID: claimReview.ID, Kind: claimReview.Kind,
		CorrectedValue: "Security review is complete", Reason: "Customer corrected this claim.",
	})
	if err != nil {
		t.Fatalf("correct conversation evidence: %v", err)
	}
	if len(afterCorrection.ReviewItems) >= len(intelligence.ReviewItems) {
		t.Fatalf("resolved review item should disappear: before=%d after=%d", len(intelligence.ReviewItems), len(afterCorrection.ReviewItems))
	}
	if len(corrected.Risks) != 1 || corrected.Risks[0] != "Security review is complete" {
		t.Fatalf("user correction did not deterministically outrank inference: %#v", corrected.Risks)
	}
	var correctedRisk ConversationClaim
	var speakerReview ConversationReviewItem
	for _, claim := range afterCorrection.Claims {
		if claim.ID == "claim-risk" {
			correctedRisk = claim
		}
	}
	for _, item := range afterCorrection.ReviewItems {
		if item.Kind == "speaker" && item.ClaimID == "claim-risk" {
			speakerReview = item
		}
	}
	if correctedRisk.Value != "Security review is complete" || correctedRisk.Confidence != 1 || correctedRisk.ExactQuote == "" {
		t.Fatalf("derived claim must reflect the correction while preserving source words: %#v", correctedRisk)
	}
	if speakerReview.ID == "" {
		t.Fatal("speaker review item missing after claim correction")
	}
	beforeSpeakerHealth := corrected.Health
	afterSpeakerRelationship, afterSpeaker, err := f.svc.CorrectConversationReview(f.ctx, f.user, rel.ID, ConversationReviewCorrectionInput{
		ReviewItemID: speakerReview.ID,
		// These client-supplied values are intentionally hostile: the server must
		// use the matched review item's kind and must not mutate canonical health.
		Kind: "claim", StateDimension: "health",
		CorrectedValue: "Avery", Reason: "Calendar attendee confirmed the speaker.",
	})
	if err != nil {
		t.Fatalf("correct speaker attribution: %v", err)
	}
	if afterSpeakerRelationship.Health != beforeSpeakerHealth {
		t.Fatalf("speaker correction unexpectedly mutated canonical health: %s", afterSpeakerRelationship.Health)
	}
	speakerCorrected := false
	for _, claim := range afterSpeaker.Claims {
		if claim.ID != "claim-risk" {
			continue
		}
		speakerCorrected = claim.SpeakerLabel == "Avery" && claim.SpeakerConfidence == 1
	}
	if !speakerCorrected {
		t.Fatalf("speaker correction was not overlaid on derived evidence: %#v", afterSpeaker.Claims)
	}
	outcomes, err := f.client.ActionOutcome.Query().All(f.ctx)
	if err != nil || len(outcomes) == 0 || outcomes[0].Kind != "corrected" {
		t.Fatalf("correction must link back as an action outcome: %#v err=%v", outcomes, err)
	}

	replay, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{input})
	if err != nil || !replay[0].Duplicate {
		t.Fatalf("canonical replay was not deduplicated: %#v err=%v", replay, err)
	}
	count, _ := f.client.RevenueAction.Query().Count(f.ctx)
	if count != 2 {
		t.Fatalf("replay duplicated action pack: %d", count)
	}
}

func TestConversationRecommendationRankingLearnsFromOutcomesWithoutChangingState(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 7, 31, 14, 0, 0, 0, time.UTC)
	firstInput := compiledConversationInput(now, "oppulence:session-1", "v1")
	first, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{firstInput})
	if err != nil {
		t.Fatal(err)
	}
	email, err := f.client.RevenueAction.Query().
		Where(revenueaction.ActionTypeEQ("meeting_recap"), revenueaction.ChannelEQ("email")).
		Only(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.AppendOutcome(f.ctx, f.user, email.ID, OutcomeInput{
		Kind: "replied", Source: "gmail", SourceEventID: "reply-1", OccurredAt: now.Add(time.Hour),
	}); err != nil {
		t.Fatal(err)
	}
	stateVersion := first[0].Relationship.StateVersion
	secondInput := compiledConversationInput(now.Add(24*time.Hour), "oppulence:session-2", "v2")
	secondInput.RelationshipID = first[0].Relationship.ID
	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{secondInput}); err != nil {
		t.Fatal(err)
	}
	emails, err := f.client.RevenueAction.Query().
		Where(revenueaction.ActionTypeEQ("meeting_recap"), revenueaction.ChannelEQ("email")).
		Order(ent.Asc(revenueaction.FieldCreatedAt)).All(f.ctx)
	if err != nil || len(emails) != 2 {
		t.Fatalf("email recommendations: %d %v", len(emails), err)
	}
	if !strings.Contains(emails[1].PriorityComponentsJSON, `"outcome_learning":2`) {
		t.Fatalf("second recommendation did not learn a bounded outcome lift: %s", emails[1].PriorityComponentsJSON)
	}
	rel, _ := f.svc.GetRelationship(f.ctx, first[0].Relationship.ID)
	if rel.StateVersion < stateVersion {
		t.Fatalf("learning must not rewind or independently mutate canonical state")
	}
}

func TestConversationClaimWithoutExactPayloadQuoteIsRejected(t *testing.T) {
	f := newFixture(t)
	input := compiledConversationInput(time.Now().UTC(), "oppulence:tampered", "v1")
	input.Payload = json.RawMessage(`{"envelope":{"segments":[{"text":"different words"}]}}`)
	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{input}); err == nil || !strings.Contains(err.Error(), "exact transcript segment") {
		t.Fatalf("tampered evidence should fail closed, got %v", err)
	}
}

func TestCompiledConversationWithoutValidGovernanceReceiptIsRejected(t *testing.T) {
	f := newFixture(t)
	input := compiledConversationInput(time.Now().UTC(), "oppulence:unsafe-governance", "v1")
	input.Facts["governance_receipt"] = map[string]any{
		"receiptId": "receipt-unsafe", "capturedAt": time.Now().UTC().Format(time.RFC3339),
		"capturePolicy": "manual_capture", "routing": "local_transcription_to_oppulence",
		"region": "local_device", "retention": "untilTranscribed",
		"participantDisclosure": "not_recorded", "legalHold": false,
		"deletionOutcome": "retained", "evidenceClip": "plain_audio",
	}
	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{input}); err == nil || !strings.Contains(err.Error(), "must be encrypted") {
		t.Fatalf("unencrypted retained evidence should fail closed, got %v", err)
	}
}

func semanticConversationInput(now time.Time, externalID string) RelationshipObservationInput {
	input := compiledConversationInput(now, externalID, "semantic-v1")
	input.Facts["conversation_claim_candidates"] = []map[string]any{
		{
			"candidateId": "candidate-risk", "kind": "risk",
			"normalizedValue": map[string]any{"kind": "risk", "text": "Security review may delay renewal"},
			"displayValue":    "Security review may delay renewal",
			"evidence": []map[string]any{{
				"exactQuote": "We are concerned the security review will delay the renewal.",
				"segmentIds": []string{"segment-1"}, "startMs": 1000, "endMs": 4000,
			}},
			"stateDimension": "risk", "confidence": 0.96, "caveats": []string{},
		},
	}
	input.Facts["conversation_extraction"] = map[string]any{
		"schema_version": 2, "envelope_fingerprint": "semantic-v1",
		"candidate_count": 1, "rejected_candidate_count": 0,
	}
	return input
}

func TestSemanticConversationRequiresDecisionBeforeStateOrActions(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 7, 31, 14, 0, 0, 0, time.UTC)
	input := semanticConversationInput(now, "oppulence:semantic-review")
	results, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{input})
	if err != nil {
		t.Fatal(err)
	}
	rel, err := f.svc.GetRelationship(f.ctx, results[0].Relationship.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(rel.Risks) != 0 {
		t.Fatalf("unreviewed semantic candidate mutated state: %#v", rel.Risks)
	}
	actionCount, _ := f.client.RevenueAction.Query().Count(f.ctx)
	if actionCount != 0 {
		t.Fatalf("unreviewed semantic candidate created %d actions", actionCount)
	}
	artifacts, err := f.client.ConversationIntelligenceArtifact.Query().
		Where(conversationintelligenceartifact.HasRelationshipWith()).All(f.ctx)
	if err != nil || len(artifacts) != 4 {
		t.Fatalf("extraction, candidate, batch, and policy decision must persist atomically: %#v err=%v", artifacts, err)
	}
	intelligence, err := f.svc.RelationshipIntelligenceFor(f.ctx, rel)
	if err != nil {
		t.Fatal(err)
	}
	var review ConversationReviewItem
	for _, item := range intelligence.ReviewItems {
		if item.ClaimID == "candidate-risk" && item.BatchID != "" {
			review = item
			break
		}
	}
	if review.ID == "" || review.Status != "pending_review" || review.ExactQuote == "" {
		t.Fatalf("semantic review item missing evidence/baseline: %#v", intelligence.ReviewItems)
	}

	updated, after, err := f.svc.DecideConversationReview(f.ctx, f.user, rel.ID, ConversationReviewDecisionInput{
		ReviewItemID: review.ID, Kind: "approve", Reason: "The customer stated this directly.",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(updated.Risks) != 1 || updated.Risks[0] != "Security review may delay renewal" {
		t.Fatalf("approved candidate did not project: %#v", updated.Risks)
	}
	for _, item := range after.ReviewItems {
		if item.ID == review.ID {
			t.Fatal("terminal review decision remained pending")
		}
	}
	decisionCount, err := f.client.ConversationIntelligenceArtifact.Query().Where(
		conversationintelligenceartifact.KindEQ("review_decision"),
		conversationintelligenceartifact.StableIDEQ(review.ID),
	).Count(f.ctx)
	if err != nil || decisionCount != 1 {
		t.Fatalf("review decision must have one immutable artifact: count=%d err=%v", decisionCount, err)
	}
}

func TestSemanticReviewRejectsStaleBaseline(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 7, 31, 14, 0, 0, 0, time.UTC)
	results, err := f.svc.IngestRelationshipObservations(
		f.ctx, f.user, []RelationshipObservationInput{semanticConversationInput(now, "oppulence:stale-review")},
	)
	if err != nil {
		t.Fatal(err)
	}
	rel, _ := f.svc.GetRelationship(f.ctx, results[0].Relationship.ID)
	intelligence, _ := f.svc.RelationshipIntelligenceFor(f.ctx, rel)
	var review ConversationReviewItem
	for _, item := range intelligence.ReviewItems {
		if item.BatchID != "" {
			review = item
			break
		}
	}
	_, err = f.svc.CorrectRelationship(f.ctx, f.user, rel.ID, RelationshipCorrectionInput{
		Dimension: "sentiment", Value: "positive", Reason: "New source fact",
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = f.svc.DecideConversationReview(f.ctx, f.user, rel.ID, ConversationReviewDecisionInput{
		ReviewItemID: review.ID, Kind: "approve",
	})
	if err == nil || !strings.Contains(err.Error(), "stale") {
		t.Fatalf("stale decision should fail with current-version context, got %v", err)
	}
}

func TestTypedContradictionPersistsAndResolutionReferencesEverySide(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 7, 31, 15, 0, 0, 0, time.UTC)
	first, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		DisplayName: "Acme", AccountDomain: "acme.example", Source: "crm",
		ExternalID: "crm-lifecycle-1", EventType: "lifecycle_changed", OccurredAt: now, ReceivedAt: now,
		Assertions: []RelationshipAssertionInput{{
			Dimension: "lifecycle", Value: "evaluation", SourceType: "source_fact", Confidence: 1,
			Reason: "CRM reports the account is in evaluation.", ValidFrom: now,
		}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	relID := first[0].Relationship.ID
	_, err = f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		RelationshipID: relID, Source: "meeting", ExternalID: "meeting-lifecycle-2",
		EventType: "lifecycle_observed", OccurredAt: now.Add(time.Hour), ReceivedAt: now.Add(time.Hour),
		Assertions: []RelationshipAssertionInput{{
			Dimension: "lifecycle", Value: "renewal", SourceType: "source_fact", Confidence: 1,
			Reason: "Meeting evidence describes an active renewal.", ValidFrom: now.Add(time.Hour),
		}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	rel, _ := f.svc.GetRelationship(f.ctx, relID)
	intelligence, err := f.svc.RelationshipIntelligenceFor(f.ctx, rel)
	if err != nil || len(intelligence.ContradictionCases) != 1 {
		t.Fatalf("want one durable typed case: %#v err=%v", intelligence.ContradictionCases, err)
	}
	contradiction := intelligence.ContradictionCases[0]
	if contradiction.Status != "open" || len(contradiction.Sides) != 2 {
		t.Fatalf("unexpected contradiction: %#v", contradiction)
	}
	updated, after, err := f.svc.ResolveContradiction(f.ctx, f.user, relID, ContradictionResolutionInput{
		CaseID: contradiction.CaseID, SelectedAssertionID: contradiction.Sides[0].AssertionID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Lifecycle != "renewal" {
		t.Fatalf("selected user correction did not project: %#v", updated)
	}
	resolved := false
	for _, candidate := range after.ContradictionCases {
		if candidate.CaseID == contradiction.CaseID {
			resolved = candidate.Status == "user_resolved" && candidate.ResolutionAssertionID != ""
		}
	}
	if !resolved {
		t.Fatalf("original contradiction was not resolved immutably: %#v", after.ContradictionCases)
	}
	versions, err := f.client.ConversationIntelligenceArtifact.Query().Where(
		conversationintelligenceartifact.KindEQ("contradiction_case"),
		conversationintelligenceartifact.StableIDEQ(contradiction.CaseID),
	).Count(f.ctx)
	if err != nil || versions != 2 {
		t.Fatalf("contradiction must retain open and resolved versions: %d err=%v", versions, err)
	}
}
