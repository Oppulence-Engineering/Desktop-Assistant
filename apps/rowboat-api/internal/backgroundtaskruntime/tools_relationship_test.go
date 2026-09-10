package backgroundtaskruntime

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
)

func TestRelationshipReadToolIsTenantScoped(t *testing.T) {
	client, owner, ctx := setupDB(t)
	other := client.User.Create().
		SetEmail("other@x.co").
		SetWorkosUserID("user_other").
		SaveX(auth.WithInternal(ctx))
	ownerWorkspace := client.RevenueWorkspace.Create().SetUser(owner).SaveX(ctx)
	otherWorkspace := client.RevenueWorkspace.Create().SetUser(other).SaveX(ctx)
	ownerRelationship := client.Relationship.Create().
		SetWorkspace(ownerWorkspace).
		SetUser(owner).
		SetKind("company").
		SetDisplayName("Owner Account").
		SaveX(ctx)
	otherRelationship := client.Relationship.Create().
		SetWorkspace(otherWorkspace).
		SetUser(other).
		SetKind("company").
		SetDisplayName("Other Tenant Secret").
		SaveX(ctx)
	ownerPerson := client.Person.Create().SetWorkspace(ownerWorkspace).SetUser(owner).
		SetDisplayName("Owner Contact").SetPrimaryEmail("owner@example.com").SetOrgName("Owner Account").SaveX(ctx)
	otherPerson := client.Person.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetDisplayName("Other Tenant Person").SetPrimaryEmail("other@example.com").SaveX(ctx)
	client.RelationshipParticipant.Create().SetWorkspace(ownerWorkspace).SetUser(owner).SetRelationship(ownerRelationship).
		SetPerson(ownerPerson).SetDisplayName(ownerPerson.DisplayName).SetEmail(ownerPerson.PrimaryEmail).SetRole("champion").SaveX(ctx)
	client.RelationshipParticipant.Create().SetWorkspace(otherWorkspace).SetUser(other).SetRelationship(otherRelationship).
		SetPerson(otherPerson).SetDisplayName(otherPerson.DisplayName).SetEmail(otherPerson.PrimaryEmail).SaveX(ctx)
	client.MailThread.Create().SetUser(owner).SetProviderThreadID("owner-thread").SetSubject("Owner renewal conversation").
		SetCounterpartyEmail("owner@example.com").SetAccountDomain("example.com").SetRelationship(ownerRelationship).
		SetReplyState("needs_reply").SetInboundCount(2).SetMessageCount(3).SaveX(ctx)
	client.MailThread.Create().SetUser(other).SetProviderThreadID("other-thread").SetSubject("Other tenant conversation").
		SetCounterpartyEmail("other@example.com").SetRelationship(otherRelationship).SaveX(ctx)
	now := time.Now().UTC()
	client.PersonAttribute.Create().SetWorkspace(ownerWorkspace).SetUser(owner).SetPerson(ownerPerson).
		SetDimension("title").SetValue("VP Success").SetSourceType("source_fact").SetSource("gmail").
		SetExtractor("email_signature").SetConfidence(0.8).SetReason("Found in their signature.").
		SetObservedAt(now).SetValidFrom(now).SetDedupeKey("owner-title").
		SetSupportingObservationIds([]string{"owner-observation"}).SaveX(ctx)
	client.PersonInteractionStat.Create().SetWorkspace(ownerWorkspace).SetPerson(ownerPerson).SetRelationship(ownerRelationship).
		SetFirstInteractionAt(now.Add(-time.Hour)).SetLastInteractionAt(now).SetInteractionCount(3).
		SetInboundCount(2).SetOutboundCount(1).SetChannelCounts(map[string]int{"email": 3}).
		SetLastChannel("email").SetLastDirection("inbound").SaveX(ctx)
	client.RelationshipSourceStatus.Create().SetWorkspace(ownerWorkspace).SetUser(owner).
		SetSource("google").SetSourceAccountID("owner@example.com").SetStatus("live").SetBackfillPhase("live").
		SetBackfillCompleted(10).SetBackfillTotal(10).SetCompleteness("complete").
		SetExpectedCadenceSeconds(900).SetLastSuccessAt(now.Add(-31 * time.Minute)).SaveX(ctx)
	client.RelationshipSourceStatus.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetSource("google").SetSourceAccountID("other@example.com").SetStatus("live").SetBackfillPhase("live").
		SetBackfillCompleted(10).SetBackfillTotal(10).SetCompleteness("complete").
		SetExpectedCadenceSeconds(900).SetLastSuccessAt(now).SaveX(ctx)
	client.RelationshipObservation.Create().SetWorkspace(ownerWorkspace).SetUser(owner).SetRelationship(ownerRelationship).
		SetSource("desktop_note").SetExternalID("owner-note-old").SetEventType("note").
		SetOccurredAt(now.Add(-time.Minute)).SetReceivedAt(now.Add(-time.Minute)).SetSummary("Renewal notes").
		SetNormalizedFactsJSON(`{"noteId":"owner-note","title":"Renewal notes","body":"Old terms"}`).SetContentHash("owner-note-old").SaveX(ctx)
	client.RelationshipObservation.Create().SetWorkspace(ownerWorkspace).SetUser(owner).SetRelationship(ownerRelationship).
		SetSource("desktop_note").SetExternalID("owner-note-new").SetEventType("note").
		SetOccurredAt(now).SetReceivedAt(now).SetSummary("Renewal notes").
		SetNormalizedFactsJSON(`{"noteId":"owner-note","title":"Renewal notes","body":"Use the updated terms","liveLinked":true}`).SetContentHash("owner-note-new").SaveX(ctx)
	client.RelationshipObservation.Create().SetWorkspace(ownerWorkspace).SetUser(owner).SetRelationship(ownerRelationship).
		SetSource("desktop_note").SetExternalID("deleted-note-old").SetEventType("note").
		SetOccurredAt(now.Add(-2 * time.Minute)).SetReceivedAt(now.Add(-2 * time.Minute)).SetSummary("Deleted renewal note").
		SetNormalizedFactsJSON(`{"noteId":"deleted-note","title":"Deleted renewal note","body":"Must stay hidden"}`).SetContentHash("deleted-note-old").SaveX(ctx)
	client.RelationshipObservation.Create().SetWorkspace(ownerWorkspace).SetUser(owner).SetRelationship(ownerRelationship).
		SetSource("desktop_note").SetExternalID("deleted-note-new").SetEventType("note_deleted").
		SetOccurredAt(now.Add(time.Minute)).SetReceivedAt(now.Add(time.Minute)).
		SetNormalizedFactsJSON(`{"noteId":"deleted-note"}`).SetContentHash("deleted-note-new").SaveX(ctx)
	client.RelationshipObservation.Create().SetWorkspace(otherWorkspace).SetUser(other).SetRelationship(otherRelationship).
		SetSource("desktop_note").SetExternalID("other-note").SetEventType("note").
		SetOccurredAt(now).SetReceivedAt(now).SetSummary("Other renewal note").
		SetNormalizedFactsJSON(`{"noteId":"other-note","title":"Other renewal note","body":"Other tenant secret"}`).SetContentHash("other-note").SaveX(ctx)
	client.RevenueAction.Create().SetWorkspace(ownerWorkspace).SetUser(owner).SetRelationship(ownerRelationship).
		SetActionType("follow_up_task").SetChannel("task").SetDetector("manual").SetDedupeKey("owner-task").
		SetRevisionHash("owner-task-v1").SetReason("Review renewal plan").SetPriorityScore(60).SetDueAt(now).SaveX(ctx)
	client.RevenueAction.Create().SetWorkspace(ownerWorkspace).SetUser(owner).SetRelationship(ownerRelationship).
		SetActionType("warm_follow_up").SetChannel("email").SetDetector("manual").SetDedupeKey("owner-email").
		SetRevisionHash("owner-email-v1").SetReason("Review renewal email").SetPriorityScore(70).
		SetRecipientEmail("buyer@example.com").SetProposedSubject("Renewal follow-up").
		SetProposedMessage("Can we review the renewal?").SaveX(ctx)
	client.RevenueAction.Create().SetWorkspace(otherWorkspace).SetUser(other).SetRelationship(otherRelationship).
		SetActionType("follow_up_task").SetChannel("task").SetDetector("manual").SetDedupeKey("other-task").
		SetRevisionHash("other-task-v1").SetReason("Review other tenant secret").SetPriorityScore(80).SaveX(ctx)
	ownerScan := client.RevenueLeakScan.Create().SetWorkspace(ownerWorkspace).SetUser(owner).SetStatus("completed").SetMode("local").
		SetLookbackDays(90).SetThreadsSeen(12).SetCandidatesSeen(2).SetRelationshipsCreated(2).
		SetEvidencesCreated(2).SetActionsCreated(2).SetStartedAt(now.Add(-time.Minute)).SetCompletedAt(now).SaveX(ctx)
	client.RevenueLeakScan.Create().SetWorkspace(ownerWorkspace).SetUser(owner).SetStatus("failed").SetMode("local").
		SetError("revenue: gmail thread sweep: google api /gmail/v1/users/me/threads returned 401: Request had invalid authentication credentials.").SaveX(ctx)
	otherScan := client.RevenueLeakScan.Create().SetWorkspace(otherWorkspace).SetUser(other).SetStatus("failed").SetMode("local").
		SetError("Other tenant audit secret").SaveX(ctx)
	ownerCommitment := client.Commitment.Create().SetWorkspace(ownerWorkspace).SetRelationship(ownerRelationship).SetUser(owner).
		SetDirection("promised_by_me").SetText("Owner promise").SetConfidence(0.9).
		SetOwnerParticipantRef("owner@example.com").SetCounterpartyParticipantRef("buyer@example.com").
		SetAcceptance("internally_confirmed").SaveX(ctx)
	ownerEvidence := client.RevenueEvidence.Create().SetWorkspace(ownerWorkspace).AddRelationships(ownerRelationship).SetUser(owner).
		SetSource("gmail").SetSourceRecordID("owner-message").SetContentHash("owner-message-hash").
		SetExcerpt("Owner promise").SetSourceURI("https://mail.google.com/mail/u/0/#inbox/owner-message").
		SetOccurredAt(now).SetObservedAt(now).SaveX(ctx)
	ownerCommitment.Update().AddEvidences(ownerEvidence).SaveX(ctx)
	client.Commitment.Create().SetWorkspace(otherWorkspace).SetRelationship(otherRelationship).SetUser(other).
		SetDirection("promised_by_them").SetText("Other tenant promise").SetConfidence(0.9).
		SetAcceptance("internally_confirmed").SaveX(ctx)

	tool := NewRelationshipReadTool(client, owner.ID)
	out, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"portfolio","limit":100}`))
	if err != nil {
		t.Fatalf("relationship.read: %v", err)
	}
	if !strings.Contains(string(out), "Owner Account") {
		t.Fatalf("owner relationship missing: %s", out)
	}
	if strings.Contains(string(out), "Other Tenant Secret") {
		t.Fatalf("cross-tenant relationship leaked: %s", out)
	}
	graph, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"graph","relationshipId":"`+ownerRelationship.ID.String()+`","depth":2}`))
	if err != nil {
		t.Fatalf("relationship.read graph: %v", err)
	}
	if !strings.Contains(string(graph), `"contractVersion":"2026-08-01"`) ||
		!strings.Contains(string(graph), `"scope":"relationship"`) ||
		!strings.Contains(string(graph), "Owner Account") ||
		strings.Contains(string(graph), "Other Tenant Secret") {
		t.Fatalf("graph view lost contract or tenant scope: %s", graph)
	}
	if _, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"graph","graphScope":"relationship"}`)); err == nil {
		t.Fatal("relationship-scoped graph accepted a missing relationshipId")
	}
	if _, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"graph","relationshipId":"`+otherRelationship.ID.String()+`"}`)); err == nil {
		t.Fatal("graph view accepted another tenant's relationship")
	}
	filtered, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"portfolio","query":"not present"}`))
	if err != nil {
		t.Fatalf("relationship.read filtered portfolio: %v", err)
	}
	if !strings.Contains(string(filtered), `"data":[]`) || strings.Contains(string(filtered), "Owner Account") {
		t.Fatalf("portfolio query was ignored: %s", filtered)
	}
	if _, err := tool.Invoke(ctx, ToolScope{UserID: other.ID.String()}, json.RawMessage(`{"view":"portfolio"}`)); err == nil {
		t.Fatal("mismatched workflow scope must be rejected")
	}
	commitments, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"commitments"}`))
	if err != nil {
		t.Fatalf("relationship.read commitments: %v", err)
	}
	if !strings.Contains(string(commitments), "Owner promise") || strings.Contains(string(commitments), "Other tenant promise") {
		t.Fatalf("commitment view crossed tenant boundary: %s", commitments)
	}
	filteredCommitments, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"commitments","query":"not present"}`))
	if err != nil {
		t.Fatalf("relationship.read filtered commitments: %v", err)
	}
	if !strings.Contains(string(filteredCommitments), `"data":[]`) || strings.Contains(string(filteredCommitments), "Owner promise") {
		t.Fatalf("commitment query was ignored: %s", filteredCommitments)
	}
	if !strings.Contains(string(commitments), `"owner":"owner@example.com"`) || !strings.Contains(string(commitments), `"counterparty":"buyer@example.com"`) {
		t.Fatalf("commitment ownership context missing: %s", commitments)
	}
	openPromises, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"open_promises","scanId":"`+ownerScan.ID.String()+`"}`))
	if err != nil {
		t.Fatalf("relationship.read open promises: %v", err)
	}
	if !strings.Contains(string(openPromises), `"threadsSeen":12`) || !strings.Contains(string(openPromises), `"outboundCount":1`) ||
		!strings.Contains(string(openPromises), "Owner promise") || strings.Contains(string(openPromises), "Other tenant promise") {
		t.Fatalf("open promises report lost scan context or tenant scope: %s", openPromises)
	}
	if _, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"open_promises","scanId":"`+otherScan.ID.String()+`"}`)); err == nil {
		t.Fatal("open promises view accepted another tenant's audit")
	}
	people, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"people","query":"owner"}`))
	if err != nil {
		t.Fatalf("relationship.read people: %v", err)
	}
	if !strings.Contains(string(people), "Owner Contact") || !strings.Contains(string(people), "champion") || strings.Contains(string(people), "Other Tenant Person") {
		t.Fatalf("people view search or tenant scope failed: %s", people)
	}
	personDetail, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"person","personId":"`+ownerPerson.ID.String()+`"}`))
	if err != nil {
		t.Fatalf("relationship.read person: %v", err)
	}
	if !strings.Contains(string(personDetail), `"value":"VP Success"`) ||
		!strings.Contains(string(personDetail), `"relationship-observation:owner-observation"`) ||
		!strings.Contains(string(personDetail), `"relationshipName":"Owner Account"`) ||
		!strings.Contains(string(personDetail), `"count":3`) {
		t.Fatalf("person view lost evidence or interaction context: %s", personDetail)
	}
	if _, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"person","personId":"`+otherPerson.ID.String()+`"}`)); err == nil {
		t.Fatal("person view accepted another tenant's person")
	}
	conversations, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"conversations","query":"renewal"}`))
	if err != nil {
		t.Fatalf("relationship.read conversations: %v", err)
	}
	if !strings.Contains(string(conversations), "Owner renewal conversation") || !strings.Contains(string(conversations), "needs_reply") || strings.Contains(string(conversations), "Other tenant conversation") {
		t.Fatalf("conversation view search or tenant scope failed: %s", conversations)
	}
	linkedConversations, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"conversations","query":"Owner Account"}`))
	if err != nil {
		t.Fatalf("relationship.read linked conversations: %v", err)
	}
	if !strings.Contains(string(linkedConversations), "Owner renewal conversation") || strings.Contains(string(linkedConversations), "Other tenant conversation") {
		t.Fatalf("conversation view did not search the linked relationship: %s", linkedConversations)
	}
	timeline, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"timeline","relationshipId":"`+ownerRelationship.ID.String()+`"}`))
	if err != nil {
		t.Fatalf("relationship.read timeline: %v", err)
	}
	if !strings.Contains(string(timeline), "Use the updated terms") ||
		!strings.Contains(string(timeline), `"eventType":"note_deleted"`) ||
		!strings.Contains(string(timeline), "relationship-observation:") ||
		strings.Contains(string(timeline), "Other tenant secret") {
		t.Fatalf("timeline view lost immutable history or tenant scope: %s", timeline)
	}
	if _, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"timeline","relationshipId":"`+otherRelationship.ID.String()+`"}`)); err == nil {
		t.Fatal("timeline view accepted another tenant's relationship")
	}
	notes, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"notes","query":"renewal"}`))
	if err != nil {
		t.Fatalf("relationship.read notes: %v", err)
	}
	if !strings.Contains(string(notes), "Use the updated terms") || !strings.Contains(string(notes), `"liveLinked":true`) || strings.Contains(string(notes), "Old terms") || strings.Contains(string(notes), "Must stay hidden") || strings.Contains(string(notes), "Other tenant secret") {
		t.Fatalf("notes view did not preserve latest tenant-owned state: %s", notes)
	}
	tasks, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"tasks","query":"review"}`))
	if err != nil {
		t.Fatalf("relationship.read tasks: %v", err)
	}
	if !strings.Contains(string(tasks), "Review renewal plan") || !strings.Contains(string(tasks), "Owner Account") || strings.Contains(string(tasks), "Review renewal email") || strings.Contains(string(tasks), "Other tenant secret") {
		t.Fatalf("tasks view did not match the workspace task definition: %s", tasks)
	}
	recommendations, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"recommendations","query":"renewal email"}`))
	if err != nil {
		t.Fatalf("relationship.read recommendations: %v", err)
	}
	if !strings.Contains(string(recommendations), "Review renewal email") ||
		!strings.Contains(string(recommendations), `"channel":"email"`) ||
		!strings.Contains(string(recommendations), `"detector":"manual"`) ||
		!strings.Contains(string(recommendations), `"draftReady":true`) ||
		strings.Contains(string(recommendations), "buyer@example.com") ||
		strings.Contains(string(recommendations), "Review renewal plan") || strings.Contains(string(recommendations), "Other tenant secret") {
		t.Fatalf("recommendations view did not apply its query or tenant scope: %s", recommendations)
	}
	draft, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"recommendations","query":"renewal email","includeDraft":true}`))
	if err != nil {
		t.Fatalf("relationship.read recommendation draft: %v", err)
	}
	if !strings.Contains(string(draft), `"recipientEmail":"buyer@example.com"`) ||
		!strings.Contains(string(draft), `"proposedSubject":"Renewal follow-up"`) ||
		!strings.Contains(string(draft), `"proposedMessage":"Can we review the renewal?"`) {
		t.Fatalf("recommendation draft was not returned on request: %s", draft)
	}
	sources, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"sources"}`))
	if err != nil {
		t.Fatalf("relationship.read sources: %v", err)
	}
	if !strings.Contains(string(sources), `"status":"stale"`) || !strings.Contains(string(sources), `"completeness":"stale"`) ||
		strings.Contains(string(sources), "other@example.com") {
		t.Fatalf("sources view lost freshness or tenant scope: %s", sources)
	}
	audits, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"audits"}`))
	if err != nil {
		t.Fatalf("relationship.read audits: %v", err)
	}
	if !strings.Contains(string(audits), `"threadsSeen":12`) || !strings.Contains(string(audits), `"actionsCreated":2`) ||
		!strings.Contains(string(audits), "Google reported invalid authentication; reconnect is required.") ||
		strings.Contains(string(audits), "/gmail/v1") || strings.Contains(string(audits), "Other tenant audit secret") {
		t.Fatalf("audits view did not preserve tenant scope: %s", audits)
	}
	impact, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"impact"}`))
	if err != nil {
		t.Fatalf("relationship.read impact: %v", err)
	}
	if !strings.Contains(string(impact), `"surfaced":2`) || !strings.Contains(string(impact), `"relationships":1`) ||
		strings.Contains(string(impact), `"surfaced":3`) {
		t.Fatalf("impact view crossed tenant boundary: %s", impact)
	}
	client.RelationshipAttentionItem.Create().SetWorkspace(ownerWorkspace).SetUser(owner).SetRelationship(ownerRelationship).
		SetStableKey("owner-attention").SetReasonCode("quiet_account").SetExplanation("Owner renewal is quiet").
		SetTriggeringObjectRef("relationship:" + ownerRelationship.ID.String()).SetUrgencyBand("high").SetRankScore(80).
		SetMaterialHash("owner-attention-v1").SetLastDetectedAt(now).SaveX(ctx)
	client.RelationshipAttentionItem.Create().SetWorkspace(otherWorkspace).SetUser(other).SetRelationship(otherRelationship).
		SetStableKey("other-attention").SetReasonCode("quiet_account").SetExplanation("Other tenant secret risk").
		SetTriggeringObjectRef("relationship:" + otherRelationship.ID.String()).SetUrgencyBand("critical").SetRankScore(99).
		SetMaterialHash("other-attention-v1").SetLastDetectedAt(now).SaveX(ctx)
	attention, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"attention","query":"Owner Account"}`))
	if err != nil {
		t.Fatalf("relationship.read attention: %v", err)
	}
	if !strings.Contains(string(attention), "Owner renewal is quiet") || strings.Contains(string(attention), "Other tenant secret risk") {
		t.Fatalf("attention view lost relationship search or tenant scope: %s", attention)
	}
	missingAttention, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"attention","query":"not present"}`))
	if err != nil {
		t.Fatalf("relationship.read missing attention: %v", err)
	}
	if !strings.Contains(string(missingAttention), `"data":[]`) {
		t.Fatalf("attention query was ignored: %s", missingAttention)
	}
}

func TestRelationshipReadPersonIdentityReviewsAreRedactedAndTenantScoped(t *testing.T) {
	client, owner, ctx := setupDB(t)
	internal := auth.WithInternal(ctx)
	other := client.User.Create().SetEmail("other-person-review@x.co").SetWorkosUserID("other-person-review").SaveX(internal)
	ownerWorkspace := client.RevenueWorkspace.Create().SetUser(owner).SaveX(internal)
	otherWorkspace := client.RevenueWorkspace.Create().SetUser(other).SaveX(internal)
	proposed := client.Person.Create().SetWorkspace(ownerWorkspace).SetUser(owner).
		SetDisplayName("Owner Proposed Contact").SetPrimaryEmail("owner.proposed@example.com").SetOrgName("Owner Co").SaveX(internal)
	existing := client.Person.Create().SetWorkspace(ownerWorkspace).SetUser(owner).
		SetDisplayName("Owner Existing Contact").SetPrimaryEmail("owner.existing@example.com").SetOrgName("Owner Co").SaveX(internal)
	candidate := client.PersonMergeCandidate.Create().SetWorkspace(ownerWorkspace).SetUser(owner).
		SetProposedPerson(proposed).SetExistingPerson(existing).SetDedupeKey("must-not-leak-owner-dedupe").
		SetCandidateType("anchor_collision").SetAnchorKind("email").SetAnchorProvider("google").
		SetAnchorKeyHash("must-not-leak-owner-anchor-hash").SetAnchorPreview("email:google").
		SetMatchingAnchors([]string{"email:google"}).SetConflictingAnchors([]string{"shared-mailbox"}).
		SetRecommendedDecision("defer").SetConfidence(0.6).SetImpactJSON("must-not-leak-owner-impact").
		SaveX(internal)
	foreignProposed := client.Person.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetDisplayName("Foreign Proposed Secret").SaveX(internal)
	foreignExisting := client.Person.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetDisplayName("Foreign Existing Secret").SaveX(internal)
	client.PersonMergeCandidate.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetProposedPerson(foreignProposed).SetExistingPerson(foreignExisting).SetDedupeKey("foreign-person-review").
		SetAnchorKind("email").SetAnchorKeyHash("foreign-secret-anchor-hash").SetAnchorPreview("foreign-secret-preview").
		SaveX(internal)

	tool := NewRelationshipReadTool(client, owner.ID)
	out, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"person_identity_reviews","query":"Owner Proposed"}`))
	if err != nil {
		t.Fatalf("relationship.read person_identity_reviews: %v", err)
	}
	for _, wanted := range []string{candidate.ID.String(), proposed.DisplayName, existing.DisplayName, `"anchorPreview":"email:google"`, `"version":1`, `"recommendedDecision":"defer"`} {
		if !strings.Contains(string(out), wanted) {
			t.Fatalf("person identity reviews missing %q: %s", wanted, out)
		}
	}
	for _, forbidden := range []string{"must-not-leak", "Foreign Proposed Secret", "foreign-secret"} {
		if strings.Contains(string(out), forbidden) {
			t.Fatalf("person identity reviews leaked %q: %s", forbidden, out)
		}
	}
	missing, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"person_identity_reviews","query":"not present"}`))
	if err != nil || !strings.Contains(string(missing), `"data":[]`) {
		t.Fatalf("person identity review query = %s err=%v", missing, err)
	}
	if _, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"person_identity_reviews","status":"invalid"}`)); err == nil {
		t.Fatal("person_identity_reviews accepted an invalid status")
	}
	if stored := client.PersonMergeCandidate.GetX(internal, candidate.ID); stored.Status != "pending" || stored.Version != 1 {
		t.Fatalf("person identity read mutated candidate: %+v", stored)
	}
}
