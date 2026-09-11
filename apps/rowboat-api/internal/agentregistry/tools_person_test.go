package agentregistry

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/person"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personattribute"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipobservation"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
)

func TestPersonCreateCapabilityIsExactRetrySafeAndDoesNotFakeInteraction(t *testing.T) {
	ctx, database, owner, seed := newWriteToolFixture(t)
	internal := auth.WithInternal(ctx)
	seedWorkspace := seed.QueryWorkspace().OnlyX(internal)
	workspaceOwner := database.Client.User.Create().SetEmail("person-workspace-owner@x.co").SetWorkosUserID("person-workspace-owner").SaveX(internal)
	targetWorkspace := database.Client.RevenueWorkspace.Create().SetUser(workspaceOwner).SetWorkosOrgID("org-person-target").SaveX(internal)
	database.Client.RevenueWorkspaceMember.Create().SetWorkspace(targetWorkspace).SetUser(owner).SetRole("member").SetStatus("active").SaveX(internal)
	foreignOwner := database.Client.User.Create().SetEmail("person-foreign-owner@x.co").SetWorkosUserID("person-foreign-owner").SaveX(internal)
	foreignWorkspace := database.Client.RevenueWorkspace.Create().SetUser(foreignOwner).SetWorkosOrgID("org-person-foreign").SaveX(internal)

	capability, ok := DefaultCatalog().Get("person.create")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("person.create capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-person-create", TurnSeq: 2, ToolCallIndex: 1}
	args := json.RawMessage(`{"workspaceId":"` + targetWorkspace.ID.String() + `","displayName":" Ada Lovelace ","email":"ADA@ANALYTICAL.EXAMPLE"}`)
	out, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("person.create: %v", err)
	}
	retry, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("person.create retry: %v", err)
	}
	if string(out) != string(retry) || !strings.Contains(string(out), `"displayName":"Ada Lovelace"`) {
		t.Fatalf("person.create output/retry mismatch: first=%s retry=%s", out, retry)
	}
	p := database.Client.Person.Query().Where(
		person.PrimaryEmailEQ("ada@analytical.example"),
		person.HasWorkspaceWith(revenueworkspace.IDEQ(targetWorkspace.ID)),
	).OnlyX(internal)
	if p.DisplayName != "Ada Lovelace" || p.OrgDomain != "analytical.example" || p.LastInteractionAt != nil {
		t.Fatalf("created person = %+v", p)
	}
	rel := database.Client.Relationship.Query().Where(
		relationship.KindEQ("person"), relationship.DisplayNameEQ("Ada Lovelace"),
		relationship.HasWorkspaceWith(revenueworkspace.IDEQ(targetWorkspace.ID)),
	).OnlyX(internal)
	observation := database.Client.RelationshipObservation.Query().Where(
		relationshipobservation.ExternalIDEQ("agent-person-create:run-person-create:2:1:observation"),
	).OnlyX(internal)
	if observation.EventType != "person_added" || observation.Source != "user" {
		t.Fatalf("person creation observation = %+v", observation)
	}
	participant := rel.QueryParticipants().WithPerson().OnlyX(internal)
	linked, err := participant.Edges.PersonOrErr()
	if err != nil || linked.ID != p.ID {
		t.Fatalf("created participant person = %+v err=%v", linked, err)
	}
	if got := database.Client.PersonInteractionStat.Query().CountX(internal); got != 0 {
		t.Fatalf("person_added created %d fake interactions", got)
	}
	if got := database.Client.Person.Query().Where(person.HasWorkspaceWith(revenueworkspace.IDEQ(seedWorkspace.ID))).CountX(internal); got != 0 {
		t.Fatalf("implicit workspace received %d people", got)
	}
	if got := database.Client.Relationship.Query().Where(relationship.HasWorkspaceWith(revenueworkspace.IDEQ(seedWorkspace.ID))).CountX(internal); got != 1 {
		t.Fatalf("implicit workspace relationship count = %d, want seed only", got)
	}
	if _, err := tool.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "person-foreign", TurnSeq: 1}, json.RawMessage(`{"workspaceId":"`+foreignWorkspace.ID.String()+`","displayName":"Wrong tenant"}`)); err == nil {
		t.Fatal("person.create accepted another tenant's workspace")
	}
	database.Client.RevenueWorkspaceMember.Create().SetWorkspace(foreignWorkspace).SetUser(owner).SetRole("viewer").SetStatus("active").SaveX(internal)
	if _, err := tool.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "person-viewer", TurnSeq: 1}, json.RawMessage(`{"workspaceId":"`+foreignWorkspace.ID.String()+`","displayName":"Viewer write"}`)); err == nil {
		t.Fatal("person.create accepted a viewer write")
	}
	if _, err := tool.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: "wrong-owner", RunID: "wrong"}, args); err == nil {
		t.Fatal("person.create accepted a mismatched workflow owner")
	}
}

func TestPersonAttributeRetractCapabilityIsRetrySafeAndTenantScoped(t *testing.T) {
	ctx, database, owner, relationship := newWriteToolFixture(t)
	internal := auth.WithInternal(ctx)
	workspace := relationship.QueryWorkspace().OnlyX(internal)
	now := time.Now().UTC().Truncate(time.Second)
	p := database.Client.Person.Create().SetWorkspace(workspace).SetUser(owner).
		SetDisplayName("Jamie Doe").SetPrimaryEmail("jamie@example.com").SetTitle("Wrong title").SaveX(internal)
	attribute := database.Client.PersonAttribute.Create().SetWorkspace(workspace).SetPerson(p).SetUser(owner).
		SetDimension("title").SetValue("Wrong title").SetSourceType("source_fact").SetSource("gmail").
		SetExtractor("email_signature").SetConfidence(0.9).SetObservedAt(now).SetValidFrom(now).
		SetDedupeKey("person-attribute-retract-test").SaveX(internal)

	capability, ok := DefaultCatalog().Get("person.attribute.retract")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("person.attribute.retract capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String()}
	args := json.RawMessage(`{"personId":"` + p.ID.String() + `","attributeId":"` + attribute.ID.String() + `","reason":"The signature is stale"}`)
	out, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("person.attribute.retract: %v", err)
	}
	firstVersion := database.Client.Person.GetX(internal, p.ID).AttributesVersion
	if _, err := tool.Invoke(ctx, scope, args); err != nil {
		t.Fatalf("person.attribute.retract retry: %v", err)
	}
	if !strings.Contains(string(out), `"retracted":true`) || !strings.Contains(string(out), `"title":""`) {
		t.Fatalf("unexpected person.attribute.retract output: %s", out)
	}
	stored := database.Client.PersonAttribute.GetX(internal, attribute.ID)
	if stored.Status != "retracted" || stored.RetractedAt == nil || stored.Reason != "The signature is stale" {
		t.Fatalf("retracted person attribute = %+v", stored)
	}
	if got := database.Client.Person.GetX(internal, p.ID).AttributesVersion; got != firstVersion {
		t.Fatalf("retry changed person attributes version: got %d want %d", got, firstVersion)
	}
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"personId":"`+p.ID.String()+`","attributeId":"`+attribute.ID.String()+`","reason":" "}`)); err == nil {
		t.Fatal("person.attribute.retract accepted an empty reason")
	}
	other := database.Client.User.Create().SetEmail("retract-other@x.co").SetWorkosUserID("retract-other").SaveX(internal)
	otherWorkspace := database.Client.RevenueWorkspace.Create().SetUser(other).SaveX(internal)
	otherPerson := database.Client.Person.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetDisplayName("Other Person").SaveX(internal)
	otherAttribute := database.Client.PersonAttribute.Create().SetWorkspace(otherWorkspace).SetPerson(otherPerson).SetUser(other).
		SetDimension("title").SetValue("Private title").SetSourceType("source_fact").SetSource("gmail").
		SetExtractor("email_signature").SetObservedAt(now).SetValidFrom(now).SetDedupeKey("other-person-attribute").SaveX(internal)
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"personId":"`+otherPerson.ID.String()+`","attributeId":"`+otherAttribute.ID.String()+`","reason":"Changed"}`)); err == nil {
		t.Fatal("person.attribute.retract accepted another tenant's attribute")
	}
}

func TestPersonCorrectCapabilityUsesAuditableProjection(t *testing.T) {
	ctx, database, owner, relationship := newWriteToolFixture(t)
	workspace := relationship.QueryWorkspace().OnlyX(auth.WithInternal(ctx))
	p := database.Client.Person.Create().SetWorkspace(workspace).SetUser(owner).
		SetDisplayName("Jamie Doe").SetPrimaryEmail("jamie@example.com").SaveX(auth.WithInternal(ctx))

	capability, ok := DefaultCatalog().Get("person.correct")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("person.correct capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-person", TurnSeq: 3, ToolCallIndex: 2}
	args := json.RawMessage(`{"personId":"` + p.ID.String() + `","dimension":"org_name","value":"Acme","reason":"Confirmed by the user"}`)
	out, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("person.correct: %v", err)
	}
	if _, err := tool.Invoke(ctx, scope, args); err != nil {
		t.Fatalf("person.correct retry: %v", err)
	}
	if !strings.Contains(string(out), `"orgName":"Acme"`) {
		t.Fatalf("unexpected person.correct output: %s", out)
	}
	attributes := database.Client.PersonAttribute.Query().Where(personattribute.DimensionEQ("org_name")).AllX(auth.WithInternal(ctx))
	if len(attributes) != 1 || attributes[0].SourceType != "user_correction" || attributes[0].Reason != "Confirmed by the user" {
		t.Fatalf("person correction attributes = %+v", attributes)
	}
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"personId":"`+p.ID.String()+`","dimension":"unknown","value":"x"}`)); err == nil {
		t.Fatal("person.correct accepted an unknown dimension")
	}
	other := database.Client.User.Create().SetEmail("other@x.co").SetWorkosUserID("other-person").SaveX(auth.WithInternal(ctx))
	otherWorkspace := database.Client.RevenueWorkspace.Create().SetUser(other).SaveX(auth.WithInternal(ctx))
	otherPerson := database.Client.Person.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetDisplayName("Other Person").SaveX(auth.WithInternal(ctx))
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"personId":"`+otherPerson.ID.String()+`","dimension":"title","value":"Must not change"}`)); err == nil {
		t.Fatal("person.correct accepted another tenant's person")
	}
}

func TestPersonIdentityDecideCapabilityPreservesHistoryAndRollsBack(t *testing.T) {
	ctx, database, owner, rel := newWriteToolFixture(t)
	internal := auth.WithInternal(ctx)
	workspace := rel.QueryWorkspace().OnlyX(internal)
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	existing := database.Client.Person.Create().SetWorkspace(workspace).SetUser(owner).
		SetCreatedAt(now.Add(-7 * 24 * time.Hour)).SetDisplayName("Jamie Doe").SaveX(internal)
	proposed := database.Client.Person.Create().SetWorkspace(workspace).SetUser(owner).
		SetCreatedAt(now.Add(-24 * time.Hour)).SetDisplayName("J. Doe").SaveX(internal)
	identity := database.Client.PersonIdentity.Create().SetWorkspace(workspace).SetUser(owner).SetPerson(proposed).
		SetKind("email").SetProvider("google").SetKeyHash("person-merge-anchor").SetNormalizedValue("jamie@example.com").
		SetFirstSeenAt(now.Add(-24 * time.Hour)).SetLastSeenAt(now).SaveX(internal)
	attribute := database.Client.PersonAttribute.Create().SetWorkspace(workspace).SetUser(owner).SetPerson(proposed).
		SetDimension("title").SetValue("VP Sales").SetSourceType("source_fact").SetSource("gmail").
		SetExtractor("email_signature").SetObservedAt(now).SetValidFrom(now).SetDedupeKey("person-merge-title").SaveX(internal)
	participant := database.Client.RelationshipParticipant.Create().SetWorkspace(workspace).SetUser(owner).
		SetRelationship(rel).SetPerson(proposed).SetDisplayName("J. Doe").SetEmail("jamie@example.com").SaveX(internal)
	existingStat := database.Client.PersonInteractionStat.Create().SetWorkspace(workspace).SetPerson(existing).SetRelationship(rel).
		SetFirstInteractionAt(now.Add(-72 * time.Hour)).SetLastInteractionAt(now.Add(-48 * time.Hour)).
		SetLastInboundAt(now.Add(-48 * time.Hour)).SetInteractionCount(2).SetInboundCount(2).
		SetChannelCounts(map[string]int{"email": 2}).SetSourceCounts(map[string]int{"gmail": 2}).
		SetLastChannel("email").SetLastDirection("inbound").SaveX(internal)
	proposedStat := database.Client.PersonInteractionStat.Create().SetWorkspace(workspace).SetPerson(proposed).SetRelationship(rel).
		SetFirstInteractionAt(now.Add(-24 * time.Hour)).SetLastInteractionAt(now).
		SetLastOutboundAt(now).SetInteractionCount(3).SetOutboundCount(2).SetMeetingCount(1).
		SetChannelCounts(map[string]int{"email": 1, "meeting": 2}).SetSourceCounts(map[string]int{"gmail": 1, "calendar": 2}).
		SetLastChannel("meeting").SetLastDirection("outbound").SaveX(internal)
	candidate := database.Client.PersonMergeCandidate.Create().SetWorkspace(workspace).SetUser(owner).
		SetProposedPerson(proposed).SetExistingPerson(existing).SetDedupeKey("person-merge-candidate").
		SetAnchorKind("email").SetAnchorKeyHash("person-merge-candidate-anchor").SaveX(internal)

	capability, ok := DefaultCatalog().Get("person.identity.decide")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("person.identity.decide capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	deferScope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "person-defer", TurnSeq: 1, ToolCallIndex: 1}
	deferArgs := json.RawMessage(`{"candidateId":"` + candidate.ID.String() + `","decision":"defer","expectedVersion":1,"reason":"Need confirmation"}`)
	if _, err := tool.Invoke(ctx, deferScope, deferArgs); err != nil {
		t.Fatalf("person.identity.decide defer: %v", err)
	}
	if _, err := tool.Invoke(ctx, deferScope, deferArgs); err != nil {
		t.Fatalf("person.identity.decide defer retry: %v", err)
	}
	if got := database.Client.PersonMergeCandidate.GetX(internal, candidate.ID); got.Status != "deferred" || got.Version != 2 {
		t.Fatalf("deferred candidate = %+v", got)
	}

	mergeScope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "person-merge", TurnSeq: 2, ToolCallIndex: 1}
	mergeArgs := json.RawMessage(`{"candidateId":"` + candidate.ID.String() + `","decision":"merge","expectedVersion":2,"reason":"Same person confirmed"}`)
	out, err := tool.Invoke(ctx, mergeScope, mergeArgs)
	if err != nil {
		t.Fatalf("person.identity.decide merge: %v", err)
	}
	if _, err := tool.Invoke(ctx, mergeScope, mergeArgs); err != nil {
		t.Fatalf("person.identity.decide merge retry: %v", err)
	}
	if !strings.Contains(string(out), `"status":"resolved"`) || !strings.Contains(string(out), `"version":3`) {
		t.Fatalf("unexpected person.identity.decide output: %s", out)
	}
	mergedPerson := database.Client.Person.GetX(internal, proposed.ID)
	if mergedPerson.Status != "merged" || mergedPerson.MergedIntoPersonID == nil || *mergedPerson.MergedIntoPersonID != existing.ID {
		t.Fatalf("merged person = %+v", mergedPerson)
	}
	for label, got := range map[string]string{
		"identity":    identity.QueryPerson().OnlyX(internal).ID.String(),
		"attribute":   attribute.QueryPerson().OnlyX(internal).ID.String(),
		"participant": participant.QueryPerson().OnlyX(internal).ID.String(),
	} {
		if got != existing.ID.String() {
			t.Fatalf("%s stayed on merged person: got %s want %s", label, got, existing.ID)
		}
	}
	mergedStat := existing.QueryInteractionStats().OnlyX(internal)
	if mergedStat.InteractionCount != 5 || mergedStat.InboundCount != 2 || mergedStat.OutboundCount != 2 ||
		mergedStat.MeetingCount != 1 || !mergedStat.FirstInteractionAt.Equal(now.Add(-72*time.Hour)) ||
		!mergedStat.LastInteractionAt.Equal(now) || mergedStat.LastChannel != "meeting" || mergedStat.LastDirection != "outbound" ||
		mergedStat.ChannelCounts["email"] != 3 || mergedStat.ChannelCounts["meeting"] != 2 ||
		mergedStat.SourceCounts["gmail"] != 3 || mergedStat.SourceCounts["calendar"] != 2 {
		t.Fatalf("merged interaction stat = %+v", mergedStat)
	}
	stored := database.Client.PersonMergeCandidate.GetX(internal, candidate.ID)
	for _, id := range []string{identity.ID.String(), attribute.ID.String(), participant.ID.String(), existingStat.ID.String(), proposedStat.ID.String()} {
		if !strings.Contains(stored.PreviousStateJSON, id) {
			t.Fatalf("compensation omitted %s: %s", id, stored.PreviousStateJSON)
		}
	}
	if got := database.Client.Person.GetX(internal, existing.ID); got.Title != "VP Sales" || got.RelationshipCount != 1 {
		t.Fatalf("surviving person projection = %+v", got)
	}

	undoScope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "person-undo", TurnSeq: 3, ToolCallIndex: 1}
	undoArgs := json.RawMessage(`{"candidateId":"` + candidate.ID.String() + `","decision":"undo","expectedVersion":3,"reason":"These are different people"}`)
	undoOut, err := tool.Invoke(ctx, undoScope, undoArgs)
	if err != nil {
		t.Fatalf("person.identity.decide undo: %v", err)
	}
	if _, err := tool.Invoke(ctx, undoScope, undoArgs); err != nil {
		t.Fatalf("person.identity.decide undo retry: %v", err)
	}
	if !strings.Contains(string(undoOut), `"status":"undone"`) || !strings.Contains(string(undoOut), `"version":4`) {
		t.Fatalf("unexpected person identity undo output: %s", undoOut)
	}
	restoredPerson := database.Client.Person.GetX(internal, proposed.ID)
	if restoredPerson.Status != "active" || restoredPerson.MergedIntoPersonID != nil || restoredPerson.MergedAt != nil || restoredPerson.Title != "VP Sales" {
		t.Fatalf("restored person = %+v", restoredPerson)
	}
	for label, got := range map[string]string{
		"identity":    identity.QueryPerson().OnlyX(internal).ID.String(),
		"attribute":   attribute.QueryPerson().OnlyX(internal).ID.String(),
		"participant": participant.QueryPerson().OnlyX(internal).ID.String(),
	} {
		if got != proposed.ID.String() {
			t.Fatalf("undo left %s on survivor: got %s want %s", label, got, proposed.ID)
		}
	}
	restoredExistingStat := existing.QueryInteractionStats().OnlyX(internal)
	restoredProposedStat := proposed.QueryInteractionStats().OnlyX(internal)
	if restoredExistingStat.ID != existingStat.ID || restoredExistingStat.InteractionCount != 2 || restoredExistingStat.InboundCount != 2 ||
		restoredProposedStat.ID != proposedStat.ID || restoredProposedStat.InteractionCount != 3 || restoredProposedStat.OutboundCount != 2 {
		t.Fatalf("restored interaction stats = existing %+v proposed %+v", restoredExistingStat, restoredProposedStat)
	}
	if got := database.Client.Person.GetX(internal, existing.ID); got.Title != "" || got.RelationshipCount != 1 {
		t.Fatalf("restored survivor projection = %+v", got)
	}
	if got := database.Client.PersonMergeCandidate.GetX(internal, candidate.ID); got.Status != "undone" || got.Decision != "undo" || got.Version != 4 {
		t.Fatalf("undone candidate = %+v", got)
	}
	if _, err := tool.Invoke(ctx, undoScope, json.RawMessage(`{"candidateId":"`+candidate.ID.String()+`","decision":"undo","expectedVersion":4,"reason":" "}`)); err == nil {
		t.Fatal("person.identity.decide accepted an empty reason")
	}

	changedHistoryCandidate := database.Client.PersonMergeCandidate.Create().SetWorkspace(workspace).SetUser(owner).
		SetProposedPerson(proposed).SetExistingPerson(existing).SetDedupeKey("changed-history-candidate").
		SetAnchorKind("email").SetAnchorKeyHash("changed-history-anchor").SaveX(internal)
	changedMergeScope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "changed-history-merge", TurnSeq: 4, ToolCallIndex: 1}
	changedMergeArgs := json.RawMessage(`{"candidateId":"` + changedHistoryCandidate.ID.String() + `","decision":"merge","expectedVersion":1,"reason":"Merge before new history"}`)
	if _, err := tool.Invoke(ctx, changedMergeScope, changedMergeArgs); err != nil {
		t.Fatalf("person.identity.decide changed-history merge: %v", err)
	}
	changedStat := existing.QueryInteractionStats().OnlyX(internal)
	changedStat.Update().SetInteractionCount(changedStat.InteractionCount + 1).SaveX(internal)
	changedUndoScope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "changed-history-undo", TurnSeq: 5, ToolCallIndex: 1}
	changedUndoArgs := json.RawMessage(`{"candidateId":"` + changedHistoryCandidate.ID.String() + `","decision":"undo","expectedVersion":2,"reason":"Attempt unsafe split"}`)
	if _, err := tool.Invoke(ctx, changedUndoScope, changedUndoArgs); err == nil {
		t.Fatal("person.identity.decide undid a merge after interaction history changed")
	}
	if got := database.Client.PersonMergeCandidate.GetX(internal, changedHistoryCandidate.ID); got.Status != "resolved" || got.Version != 2 {
		t.Fatalf("rejected undo changed candidate = %+v", got)
	}
	other := database.Client.User.Create().SetEmail("person-merge-other@x.co").SetWorkosUserID("person-merge-other").SaveX(internal)
	otherWorkspace := database.Client.RevenueWorkspace.Create().SetUser(other).SaveX(internal)
	foreignProposed := database.Client.Person.Create().SetWorkspace(otherWorkspace).SetUser(other).SetDisplayName("Foreign Proposed").SaveX(internal)
	foreignExisting := database.Client.Person.Create().SetWorkspace(otherWorkspace).SetUser(other).SetDisplayName("Foreign Existing").SaveX(internal)
	foreignCandidate := database.Client.PersonMergeCandidate.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetProposedPerson(foreignProposed).SetExistingPerson(foreignExisting).SetDedupeKey("foreign-person-candidate").
		SetAnchorKind("email").SetAnchorKeyHash("foreign-person-anchor").SaveX(internal)
	foreignArgs := json.RawMessage(`{"candidateId":"` + foreignCandidate.ID.String() + `","decision":"keep_separate","expectedVersion":1,"reason":"Must stay private"}`)
	if _, err := tool.Invoke(ctx, mergeScope, foreignArgs); err == nil {
		t.Fatal("person.identity.decide accepted another tenant's candidate")
	}
	if got := database.Client.PersonMergeCandidate.GetX(internal, foreignCandidate.ID); got.Status != "pending" || got.Version != 1 {
		t.Fatalf("foreign candidate changed = %+v", got)
	}

	rollbackExisting := database.Client.Person.Create().SetWorkspace(workspace).SetUser(owner).
		SetCreatedAt(now.Add(-6 * 24 * time.Hour)).SetDisplayName("Rollback Existing").SaveX(internal)
	rollbackProposed := database.Client.Person.Create().SetWorkspace(workspace).SetUser(owner).
		SetCreatedAt(now.Add(-time.Hour)).SetDisplayName("Rollback Proposed").SaveX(internal)
	rollbackIdentity := database.Client.PersonIdentity.Create().SetWorkspace(workspace).SetUser(owner).SetPerson(rollbackProposed).
		SetKind("email").SetKeyHash("rollback-anchor").SetNormalizedValue("rollback@example.com").
		SetFirstSeenAt(now).SetLastSeenAt(now).SaveX(internal)
	rollbackCandidate := database.Client.PersonMergeCandidate.Create().SetWorkspace(workspace).SetUser(owner).
		SetProposedPerson(rollbackProposed).SetExistingPerson(rollbackExisting).SetDedupeKey("rollback-candidate").
		SetAnchorKind("email").SetAnchorKeyHash("rollback-candidate-anchor").SaveX(internal)
	database.Client.Use(func(next ent.Mutator) ent.Mutator {
		return ent.MutateFunc(func(ctx context.Context, mutation ent.Mutation) (ent.Value, error) {
			if personMutation, ok := mutation.(*ent.PersonMutation); ok && mutation.Op().Is(ent.OpUpdateOne) {
				if id, exists := personMutation.ID(); exists && id == rollbackProposed.ID {
					return nil, errors.New("injected person merge failure")
				}
			}
			return next.Mutate(ctx, mutation)
		})
	})
	rollbackScope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "person-rollback", TurnSeq: 3, ToolCallIndex: 1}
	rollbackArgs := json.RawMessage(`{"candidateId":"` + rollbackCandidate.ID.String() + `","decision":"merge","expectedVersion":1,"reason":"Exercise rollback"}`)
	if _, err := tool.Invoke(ctx, rollbackScope, rollbackArgs); err == nil {
		t.Fatal("person.identity.decide ignored an injected merge failure")
	}
	if got := database.Client.PersonMergeCandidate.GetX(internal, rollbackCandidate.ID); got.Status != "pending" || got.Version != 1 {
		t.Fatalf("failed merge changed candidate = %+v", got)
	}
	if got := rollbackIdentity.QueryPerson().OnlyX(internal).ID; got != rollbackProposed.ID {
		t.Fatalf("failed merge moved identity to %s", got)
	}
}

func TestPersonDeleteCapabilityRequiresApprovalAndDeletesMergeFamily(t *testing.T) {
	ctx, database, owner, rel := newWriteToolFixture(t)
	internal := auth.WithInternal(ctx)
	workspace := rel.QueryWorkspace().OnlyX(internal)
	now := time.Date(2026, 9, 9, 15, 0, 0, 0, time.UTC)
	canonical := database.Client.Person.Create().SetWorkspace(workspace).SetUser(owner).
		SetDisplayName("Canonical Person").SetPrimaryEmail("canonical@example.com").SaveX(internal)
	duplicate := database.Client.Person.Create().SetWorkspace(workspace).SetUser(owner).
		SetDisplayName("Duplicate Private Name").SetStatus("merged").SetMergedIntoPersonID(canonical.ID).SetMergedAt(now).SaveX(internal)
	identity := database.Client.PersonIdentity.Create().SetWorkspace(workspace).SetUser(owner).SetPerson(canonical).
		SetKind("email").SetProvider("google").SetKeyHash("delete-family-anchor").SetNormalizedValue("canonical@example.com").
		SetFirstSeenAt(now).SetLastSeenAt(now).SaveX(internal)
	database.Client.PersonAttribute.Create().SetWorkspace(workspace).SetUser(owner).SetPerson(duplicate).
		SetDimension("title").SetValue("Private title").SetSourceType("source_fact").SetSource("gmail").
		SetExtractor("email_signature").SetObservedAt(now).SetValidFrom(now).SetDedupeKey("delete-family-attribute").SaveX(internal)
	database.Client.PersonInteractionStat.Create().SetWorkspace(workspace).SetPerson(duplicate).SetRelationship(rel).
		SetFirstInteractionAt(now).SetLastInteractionAt(now).SetInteractionCount(1).
		SetChannelCounts(map[string]int{"email": 1}).SetSourceCounts(map[string]int{"gmail": 1}).SaveX(internal)
	participant := database.Client.RelationshipParticipant.Create().SetWorkspace(workspace).SetUser(owner).
		SetRelationship(rel).SetPerson(duplicate).SetDisplayName("Duplicate Private Name").SaveX(internal)
	database.Client.PersonMergeCandidate.Create().SetWorkspace(workspace).SetUser(owner).
		SetProposedPerson(duplicate).SetExistingPerson(canonical).SetDedupeKey("delete-family-candidate").
		SetAnchorKind("email").SetAnchorKeyHash("delete-family-candidate-anchor").SaveX(internal)

	capability, ok := DefaultCatalog().Get("person.delete")
	if !ok || capability.TrustTier != TierAct || !RequiresApproval(capability.TrustTier) {
		t.Fatalf("person.delete capability = %+v, want approval-gated act tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	args := json.RawMessage(`{"personId":"` + duplicate.ID.String() + `","expectedDisplayName":"Canonical Person","reason":"subject_request","note":"Asked to be removed"}`)
	if _, err := tool.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: owner.ID.String()}, args); err == nil {
		t.Fatal("person.delete ran without approval")
	}
	approved := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), ApprovalID: "approved-person-delete"}
	wrongName := json.RawMessage(`{"personId":"` + duplicate.ID.String() + `","expectedDisplayName":"Wrong Person","reason":"subject_request"}`)
	if _, err := tool.Invoke(ctx, approved, wrongName); err == nil {
		t.Fatal("person.delete ignored the display-name guard")
	}
	if got := database.Client.Person.Query().CountX(internal); got != 2 {
		t.Fatalf("rejected person.delete changed %d people", got)
	}
	out, err := tool.Invoke(ctx, approved, args)
	if err != nil {
		t.Fatalf("person.delete: %v", err)
	}
	if !strings.Contains(string(out), `"personsDeleted":2`) || !strings.Contains(string(out), `"suppressedIdentities":1`) ||
		strings.Contains(string(out), "Canonical Person") || strings.Contains(string(out), "canonical@example.com") {
		t.Fatalf("unexpected person.delete receipt: %s", out)
	}
	if got := database.Client.Person.Query().CountX(internal); got != 0 {
		t.Fatalf("person.delete left %d family members", got)
	}
	if got := database.Client.PersonIdentity.Query().CountX(internal); got != 0 {
		t.Fatalf("person.delete left %d identities", got)
	}
	if got := database.Client.PersonAttribute.Query().CountX(internal); got != 0 {
		t.Fatalf("person.delete left %d attributes", got)
	}
	if got := database.Client.PersonInteractionStat.Query().CountX(internal); got != 0 {
		t.Fatalf("person.delete left %d interaction stats", got)
	}
	if got := database.Client.PersonMergeCandidate.Query().CountX(internal); got != 0 {
		t.Fatalf("person.delete left %d merge candidates", got)
	}
	suppression := database.Client.PersonSuppression.Query().OnlyX(internal)
	if suppression.KeyHash != identity.KeyHash || suppression.Reason != "subject_request" || suppression.Note != "Asked to be removed" {
		t.Fatalf("person.delete suppression = %+v", suppression)
	}
	if _, err := participant.QueryPerson().Only(internal); !ent.IsNotFound(err) {
		t.Fatalf("person.delete left participant linked: %v", err)
	}
}
