package agentregistry

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/conversationintelligenceartifact"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipassertion"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipidentity"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
)

func TestRelationshipCreateCapabilityIsExactRetrySafeAndInternal(t *testing.T) {
	ctx, database, owner, seed := newWriteToolFixture(t)
	internal := auth.WithInternal(ctx)
	seedWorkspace := seed.QueryWorkspace().OnlyX(internal)
	workspaceOwner := database.Client.User.Create().SetEmail("workspace-owner@x.co").SetWorkosUserID("workspace-owner").SaveX(internal)
	targetWorkspace := database.Client.RevenueWorkspace.Create().SetUser(workspaceOwner).SetWorkosOrgID("org-target").SaveX(internal)
	database.Client.RevenueWorkspaceMember.Create().SetWorkspace(targetWorkspace).SetUser(owner).SetRole("member").SetStatus("active").SaveX(internal)
	foreignOwner := database.Client.User.Create().SetEmail("foreign-owner@x.co").SetWorkosUserID("foreign-owner").SaveX(internal)
	foreignWorkspace := database.Client.RevenueWorkspace.Create().SetUser(foreignOwner).SetWorkosOrgID("org-foreign").SaveX(internal)

	capability, ok := DefaultCatalog().Get("relationship.create")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("relationship.create capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-company-create", TurnSeq: 2, ToolCallIndex: 1}
	args := json.RawMessage(`{"workspaceId":"` + targetWorkspace.ID.String() + `","displayName":" Acme Systems ","accountDomain":"ACME.EXAMPLE","primaryEmail":"HELLO@ACME.EXAMPLE","summary":" Renewal account "}`)
	out, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("relationship.create: %v", err)
	}
	retry, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("relationship.create retry: %v", err)
	}
	if string(out) != string(retry) || !strings.Contains(string(out), `"displayName":"Acme Systems"`) {
		t.Fatalf("relationship.create output/retry mismatch: first=%s retry=%s", out, retry)
	}
	created := database.Client.Relationship.Query().Where(
		relationship.DisplayNameEQ("Acme Systems"),
		relationship.HasWorkspaceWith(revenueworkspace.IDEQ(targetWorkspace.ID)),
	).OnlyX(internal)
	if created.AccountDomain != "acme.example" || created.PrimaryEmail != "hello@acme.example" || created.Summary != "Renewal account" || len(created.ResourceRefs) != 0 {
		t.Fatalf("created company = %+v", created)
	}
	if got := database.Client.Relationship.Query().Where(relationship.DisplayNameEQ("Acme Systems")).CountX(internal); got != 1 {
		t.Fatalf("retry created %d companies, want 1", got)
	}
	if got := database.Client.RelationshipIdentity.Query().Where(
		relationshipidentity.ProviderEQ("oppulence"),
		relationshipidentity.HasWorkspaceWith(revenueworkspace.IDEQ(targetWorkspace.ID)),
	).CountX(internal); got != 1 {
		t.Fatalf("idempotency identity count = %d, want 1", got)
	}
	if got := database.Client.Relationship.Query().Where(
		relationship.HasWorkspaceWith(revenueworkspace.IDEQ(seedWorkspace.ID)),
	).CountX(internal); got != 1 {
		t.Fatalf("implicit workspace received %d relationships, want seed only", got)
	}
	if _, err := tool.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "foreign", TurnSeq: 1}, json.RawMessage(`{"workspaceId":"`+foreignWorkspace.ID.String()+`","displayName":"Wrong tenant"}`)); err == nil {
		t.Fatal("relationship.create accepted another tenant's workspace")
	}
	database.Client.RevenueWorkspaceMember.Create().SetWorkspace(foreignWorkspace).SetUser(owner).SetRole("viewer").SetStatus("active").SaveX(internal)
	if _, err := tool.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "viewer", TurnSeq: 1}, json.RawMessage(`{"workspaceId":"`+foreignWorkspace.ID.String()+`","displayName":"Viewer write"}`)); err == nil {
		t.Fatal("relationship.create accepted a viewer write")
	}
	if _, err := tool.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: "wrong-owner", RunID: "wrong"}, args); err == nil {
		t.Fatal("relationship.create accepted a mismatched workflow owner")
	}
}

func TestRelationshipCorrectCapabilityUsesAuditableProjection(t *testing.T) {
	ctx, database, owner, relationship := newWriteToolFixture(t)
	capability, ok := DefaultCatalog().Get("relationship.correct")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("relationship.correct capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-relationship", TurnSeq: 3, ToolCallIndex: 2}
	args := json.RawMessage(`{"relationshipId":"` + relationship.ID.String() + `","dimension":"health","value":"healthy","reason":"Confirmed by the user"}`)
	out, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("relationship.correct: %v", err)
	}
	if _, err := tool.Invoke(ctx, scope, args); err != nil {
		t.Fatalf("relationship.correct retry: %v", err)
	}
	if !strings.Contains(string(out), `"health":"healthy"`) {
		t.Fatalf("unexpected relationship.correct output: %s", out)
	}
	assertions := database.Client.RelationshipAssertion.Query().Where(
		relationshipassertion.SourceTypeEQ("user_correction"),
	).AllX(auth.WithInternal(ctx))
	if len(assertions) != 1 || assertions[0].Reason != "Confirmed by the user" {
		t.Fatalf("relationship correction assertions = %+v", assertions)
	}
	stored := database.Client.Relationship.GetX(auth.WithInternal(ctx), relationship.ID)
	if stored.Health != "healthy" || stored.StateVersion != 1 {
		t.Fatalf("corrected relationship = %+v", stored)
	}
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"relationshipId":"`+relationship.ID.String()+`","dimension":"unknown","value":"x","reason":"Wrong"}`)); err == nil {
		t.Fatal("relationship.correct accepted an unknown dimension")
	}
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"relationshipId":"`+relationship.ID.String()+`","dimension":"health","value":"impossible","reason":"Wrong"}`)); err == nil {
		t.Fatal("relationship.correct accepted an invalid value")
	}
	other := database.Client.User.Create().SetEmail("other@x.co").SetWorkosUserID("other-relationship").SaveX(auth.WithInternal(ctx))
	otherWorkspace := database.Client.RevenueWorkspace.Create().SetUser(other).SaveX(auth.WithInternal(ctx))
	otherRelationship := database.Client.Relationship.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetKind("company").SetDisplayName("Other Account").SaveX(auth.WithInternal(ctx))
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"relationshipId":"`+otherRelationship.ID.String()+`","dimension":"health","value":"critical","reason":"Must not change"}`)); err == nil {
		t.Fatal("relationship.correct accepted another tenant's relationship")
	}
	if got := database.Client.Relationship.GetX(auth.WithInternal(ctx), otherRelationship.ID).Health; got != "unknown" {
		t.Fatalf("other tenant relationship health = %q, want unknown", got)
	}
}

func TestRelationshipAssertionRetractCapabilityIsRetrySafeAndTenantScoped(t *testing.T) {
	ctx, database, owner, rel := newWriteToolFixture(t)
	internal := auth.WithInternal(ctx)
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-retract-relationship", TurnSeq: 4, ToolCallIndex: 1}

	correct, _ := DefaultCatalog().Get("relationship.correct")
	correctTool := correct.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	if _, err := correctTool.Invoke(ctx, scope, json.RawMessage(`{"relationshipId":"`+rel.ID.String()+`","dimension":"health","value":"healthy","reason":"Confirmed by the user"}`)); err != nil {
		t.Fatalf("relationship.correct setup: %v", err)
	}
	assertion := database.Client.RelationshipAssertion.Query().Where(
		relationshipassertion.SourceTypeEQ("user_correction"),
	).OnlyX(internal)

	read, _ := DefaultCatalog().Get("relationship.read")
	readTool := read.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	missionControlOut, err := readTool.Invoke(ctx, scope, json.RawMessage(`{"view":"mission_control","relationshipId":"`+rel.ID.String()+`"}`))
	if err != nil {
		t.Fatalf("relationship.read mission_control: %v", err)
	}
	if !strings.Contains(string(missionControlOut), `"aggregateHash":"sha256:`) || !strings.Contains(string(missionControlOut), `"stateVersion":1`) {
		t.Fatalf("relationship.read mission_control output = %s", missionControlOut)
	}
	readOut, err := readTool.Invoke(ctx, scope, json.RawMessage(`{"view":"assertions","relationshipId":"`+rel.ID.String()+`"}`))
	if err != nil {
		t.Fatalf("relationship.read assertions: %v", err)
	}
	if !strings.Contains(string(readOut), assertion.ID.String()) || !strings.Contains(string(readOut), `"sourceType":"user_correction"`) {
		t.Fatalf("relationship.read assertions output = %s", readOut)
	}

	capability, ok := DefaultCatalog().Get("relationship.assertion.retract")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("relationship.assertion.retract capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	args := json.RawMessage(`{"relationshipId":"` + rel.ID.String() + `","assertionId":"` + assertion.ID.String() + `","reason":"The correction was entered against the wrong call"}`)
	out, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("relationship.assertion.retract: %v", err)
	}
	firstVersion := database.Client.Relationship.GetX(internal, rel.ID).StateVersion
	if _, err := tool.Invoke(ctx, scope, args); err != nil {
		t.Fatalf("relationship.assertion.retract retry: %v", err)
	}
	if !strings.Contains(string(out), `"retracted":true`) || !strings.Contains(string(out), `"health":"unknown"`) {
		t.Fatalf("unexpected relationship.assertion.retract output: %s", out)
	}
	stored := database.Client.RelationshipAssertion.GetX(internal, assertion.ID)
	if stored.Status != "retracted" || stored.RetractedAt == nil || stored.RetractionReason != "The correction was entered against the wrong call" {
		t.Fatalf("retracted relationship assertion = %+v", stored)
	}
	if got := database.Client.Relationship.GetX(internal, rel.ID).StateVersion; got != firstVersion {
		t.Fatalf("retry changed relationship state version: got %d want %d", got, firstVersion)
	}
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"relationshipId":"`+rel.ID.String()+`","assertionId":"`+assertion.ID.String()+`","reason":" "}`)); err == nil {
		t.Fatal("relationship.assertion.retract accepted an empty reason")
	}

	other := database.Client.User.Create().SetEmail("other-retraction@x.co").SetWorkosUserID("other-retraction").SaveX(internal)
	otherWorkspace := database.Client.RevenueWorkspace.Create().SetUser(other).SaveX(internal)
	otherRelationship := database.Client.Relationship.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetKind("company").SetDisplayName("Other Account").SaveX(internal)
	foreignArgs := json.RawMessage(`{"relationshipId":"` + otherRelationship.ID.String() + `","assertionId":"` + assertion.ID.String() + `","reason":"Must not cross tenants"}`)
	if _, err := tool.Invoke(ctx, scope, foreignArgs); err == nil {
		t.Fatal("relationship.assertion.retract accepted another tenant's relationship")
	}
	if _, err := readTool.Invoke(ctx, scope, json.RawMessage(`{"view":"mission_control","relationshipId":"`+otherRelationship.ID.String()+`"}`)); err == nil {
		t.Fatal("relationship.read mission_control accepted another tenant's relationship")
	}
	if got := database.Client.Relationship.GetX(internal, otherRelationship.ID).StateVersion; got != 0 {
		t.Fatalf("other tenant relationship state version = %d, want 0", got)
	}
}

func TestRelationshipReviewAcknowledgeCapabilityIsExactRetrySafeAndTenantScoped(t *testing.T) {
	ctx, database, owner, rel := newWriteToolFixture(t)
	internal := auth.WithInternal(ctx)
	correct, _ := DefaultCatalog().Get("relationship.correct")
	correctTool := correct.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	firstScope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-review-relationship", TurnSeq: 1, ToolCallIndex: 1}
	if _, err := correctTool.Invoke(ctx, firstScope, json.RawMessage(`{"relationshipId":"`+rel.ID.String()+`","dimension":"health","value":"healthy","reason":"Confirmed by the user"}`)); err != nil {
		t.Fatalf("relationship.correct setup: %v", err)
	}

	read, _ := DefaultCatalog().Get("relationship.read")
	readTool := read.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	brief, err := readTool.Invoke(ctx, firstScope, json.RawMessage(`{"view":"mission_control","relationshipId":"`+rel.ID.String()+`"}`))
	if err != nil {
		t.Fatalf("relationship.read mission_control: %v", err)
	}
	var envelope struct {
		Data struct {
			StateVersion int    `json:"stateVersion"`
			StateHash    string `json:"stateHash"`
		} `json:"data"`
	}
	if err := json.Unmarshal(brief, &envelope); err != nil || envelope.Data.StateVersion != 1 || envelope.Data.StateHash == "" {
		t.Fatalf("decode relationship mission control: envelope=%+v err=%v", envelope, err)
	}

	capability, ok := DefaultCatalog().Get("relationship.review.acknowledge")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("relationship.review.acknowledge capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	args, _ := json.Marshal(map[string]any{
		"relationshipId": rel.ID.String(), "stateVersion": envelope.Data.StateVersion, "stateHash": envelope.Data.StateHash,
	})
	out, err := tool.Invoke(ctx, firstScope, args)
	if err != nil {
		t.Fatalf("relationship.review.acknowledge: %v", err)
	}
	if _, err := tool.Invoke(ctx, firstScope, args); err != nil {
		t.Fatalf("relationship.review.acknowledge retry: %v", err)
	}
	if !strings.Contains(string(out), `"stateVersion":1`) || !strings.Contains(string(out), envelope.Data.StateHash) {
		t.Fatalf("unexpected relationship.review.acknowledge output: %s", out)
	}
	if got := database.Client.RelationshipReviewAcknowledgement.Query().CountX(internal); got != 1 {
		t.Fatalf("relationship review acknowledgement count = %d, want 1", got)
	}
	readAfter, err := readTool.Invoke(ctx, firstScope, json.RawMessage(`{"view":"mission_control","relationshipId":"`+rel.ID.String()+`"}`))
	if err != nil || !strings.Contains(string(readAfter), `"changedSinceReview":false`) {
		t.Fatalf("reviewed mission control = %s err=%v", readAfter, err)
	}

	secondScope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-review-relationship", TurnSeq: 2, ToolCallIndex: 1}
	if _, err := correctTool.Invoke(ctx, secondScope, json.RawMessage(`{"relationshipId":"`+rel.ID.String()+`","dimension":"sentiment","value":"positive","reason":"New evidence"}`)); err != nil {
		t.Fatalf("relationship.correct second state: %v", err)
	}
	if _, err := tool.Invoke(ctx, firstScope, args); err == nil {
		t.Fatal("relationship.review.acknowledge accepted stale state")
	}

	other := database.Client.User.Create().SetEmail("other-review@x.co").SetWorkosUserID("other-review").SaveX(internal)
	otherWorkspace := database.Client.RevenueWorkspace.Create().SetUser(other).SaveX(internal)
	otherRelationship := database.Client.Relationship.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetKind("company").SetDisplayName("Other Account").SaveX(internal)
	foreignArgs, _ := json.Marshal(map[string]any{
		"relationshipId": otherRelationship.ID.String(), "stateVersion": 0, "stateHash": "",
	})
	if _, err := tool.Invoke(ctx, firstScope, foreignArgs); err == nil {
		t.Fatal("relationship.review.acknowledge accepted another tenant's relationship")
	}
	if got := database.Client.RelationshipReviewAcknowledgement.Query().CountX(internal); got != 1 {
		t.Fatalf("foreign review changed acknowledgement count: got %d want 1", got)
	}
}

func TestRelationshipIdentityReviewToolsAreRedactedRetrySafeAndTenantScoped(t *testing.T) {
	ctx, database, owner, proposed := newWriteToolFixture(t)
	internal := auth.WithInternal(ctx)
	workspace := proposed.QueryWorkspace().OnlyX(internal)
	existing := database.Client.Relationship.Create().SetWorkspace(workspace).SetUser(owner).
		SetKind("company").SetDisplayName("Existing Acme").SetAccountDomain("acme.example").SaveX(internal)
	candidate := database.Client.RelationshipIdentityCandidate.Create().
		SetWorkspace(workspace).SetProposedRelationship(proposed).SetExistingRelationship(existing).SetUser(owner).
		SetDedupeKey("identity-review-tool").SetAnchorKind("email").SetAnchorProvider("google").
		SetAnchorKeyHash("must-not-leak-owner-anchor-hash").SetAnchorPreview("buyer@acme.example").
		SetMatchingAnchors([]string{"email:google"}).SetConflictingAnchors([]string{"email:google"}).
		SetEvidenceRefs([]string{"relationship-observation:owner-evidence"}).SetEvidenceCount(1).
		SetImpactJSON(`{"observations":1,"actions":0}`).SetRecommendedDecision("defer").SetConfidence(0.4).
		SaveX(internal)

	read, _ := DefaultCatalog().Get("relationship.read")
	tool := read.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String()}
	out, err := tool.Invoke(ctx, scope, json.RawMessage(`{"view":"identity_reviews","relationshipId":"`+proposed.ID.String()+`","source":"Google"}`))
	if err != nil {
		t.Fatalf("relationship.read identity_reviews: %v", err)
	}
	for _, wanted := range []string{candidate.ID.String(), proposed.DisplayName, existing.DisplayName, "buyer@acme.example", "relationship-observation:owner-evidence", `"version":1`} {
		if !strings.Contains(string(out), wanted) {
			t.Fatalf("relationship.read identity_reviews missing %q: %s", wanted, out)
		}
	}
	if strings.Contains(string(out), "must-not-leak-owner-anchor-hash") {
		t.Fatalf("relationship.read identity_reviews leaked anchor hash: %s", out)
	}
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"view":"identity_reviews","status":"invalid"}`)); err == nil {
		t.Fatal("relationship.read identity_reviews accepted an invalid status")
	}

	other := database.Client.User.Create().SetEmail("other-identity-review@x.co").SetWorkosUserID("other-identity-review").SaveX(internal)
	otherWorkspace := database.Client.RevenueWorkspace.Create().SetUser(other).SaveX(internal)
	otherProposed := database.Client.Relationship.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetKind("company").SetDisplayName("Foreign Proposed").SaveX(internal)
	otherExisting := database.Client.Relationship.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetKind("company").SetDisplayName("Foreign Existing").SaveX(internal)
	foreignCandidate := database.Client.RelationshipIdentityCandidate.Create().
		SetWorkspace(otherWorkspace).SetProposedRelationship(otherProposed).SetExistingRelationship(otherExisting).SetUser(other).
		SetDedupeKey("foreign-identity-review").SetAnchorKind("email").SetAnchorKeyHash("foreign-secret-anchor-hash").
		SetAnchorPreview("foreign-secret@example.com").SaveX(internal)
	allOut, err := tool.Invoke(ctx, scope, json.RawMessage(`{"view":"identity_reviews","status":"all"}`))
	if err != nil {
		t.Fatalf("relationship.read all identity_reviews: %v", err)
	}
	if strings.Contains(string(allOut), "foreign-secret") || !strings.Contains(string(allOut), candidate.ID.String()) {
		t.Fatalf("relationship.read identity_reviews tenant scope failed: %s", allOut)
	}

	capability, ok := DefaultCatalog().Get("relationship.identity.decide")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("relationship.identity.decide capability = %+v, want internal write tier", capability)
	}
	decisionTool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	decisionScope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "identity-review-decision", TurnSeq: 2, ToolCallIndex: 1}
	if _, err := decisionTool.Invoke(ctx, decisionScope, json.RawMessage(`{"candidateId":"`+candidate.ID.String()+`","decision":"invalid","expectedVersion":1,"reason":"No"}`)); err == nil {
		t.Fatal("relationship.identity.decide accepted an invalid decision")
	}
	if _, err := decisionTool.Invoke(ctx, decisionScope, json.RawMessage(`{"candidateId":"`+candidate.ID.String()+`","decision":"defer","expectedVersion":1,"reason":" "}`)); err == nil {
		t.Fatal("relationship.identity.decide accepted an empty reason")
	}
	decisionArgs := json.RawMessage(`{"candidateId":"` + candidate.ID.String() + `","decision":"defer","expectedVersion":1,"reason":"Waiting for the account owner"}`)
	decisionOut, err := decisionTool.Invoke(ctx, decisionScope, decisionArgs)
	if err != nil {
		t.Fatalf("relationship.identity.decide: %v", err)
	}
	if _, err := decisionTool.Invoke(ctx, decisionScope, decisionArgs); err != nil {
		t.Fatalf("relationship.identity.decide retry: %v", err)
	}
	if !strings.Contains(string(decisionOut), `"status":"deferred"`) || !strings.Contains(string(decisionOut), `"version":2`) {
		t.Fatalf("relationship.identity.decide output = %s", decisionOut)
	}
	if got := database.Client.RelationshipIdentityDecision.Query().CountX(internal); got != 1 {
		t.Fatalf("relationship identity decision count = %d, want 1", got)
	}
	deferredOut, err := tool.Invoke(ctx, scope, json.RawMessage(`{"view":"identity_reviews","status":"deferred"}`))
	if err != nil || !strings.Contains(string(deferredOut), candidate.ID.String()) {
		t.Fatalf("deferred identity review = %s err=%v", deferredOut, err)
	}
	staleScope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "identity-review-stale", TurnSeq: 3, ToolCallIndex: 1}
	staleArgs := json.RawMessage(`{"candidateId":"` + candidate.ID.String() + `","decision":"keep_separate","expectedVersion":1,"reason":"Stale reviewer"}`)
	if _, err := decisionTool.Invoke(ctx, staleScope, staleArgs); err == nil {
		t.Fatal("relationship.identity.decide accepted a stale candidate version")
	}
	foreignScope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "identity-review-foreign", TurnSeq: 4, ToolCallIndex: 1}
	foreignArgs := json.RawMessage(`{"candidateId":"` + foreignCandidate.ID.String() + `","decision":"defer","expectedVersion":1,"reason":"Must not cross tenants"}`)
	if _, err := decisionTool.Invoke(ctx, foreignScope, foreignArgs); err == nil {
		t.Fatal("relationship.identity.decide accepted another tenant's candidate")
	}
	if got := database.Client.RelationshipIdentityDecision.Query().CountX(internal); got != 1 {
		t.Fatalf("foreign identity decision changed count: got %d want 1", got)
	}
}

func TestRelationshipAttentionDecideCapabilityIsVersionedRetrySafeAndTenantScoped(t *testing.T) {
	ctx, database, owner, rel := newWriteToolFixture(t)
	internal := auth.WithInternal(ctx)
	workspace := rel.QueryWorkspace().OnlyX(internal)
	now := time.Now().UTC().Truncate(time.Second)
	item := database.Client.RelationshipAttentionItem.Create().
		SetWorkspace(workspace).SetRelationship(rel).SetUser(owner).
		SetStableKey("attention-tool-owner").SetReasonCode("quiet_account").
		SetExplanation("No recorded interaction for 30 days.").SetTriggeringObjectRef("relationship:" + rel.ID.String()).
		SetUrgencyBand("normal").SetRankScore(60).SetMaterialHash("sha256:attention-tool-owner").SetLastDetectedAt(now).
		SaveX(internal)

	read, _ := DefaultCatalog().Get("relationship.read")
	readTool := read.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "attention-decision", TurnSeq: 1, ToolCallIndex: 1}
	attentionOut, err := readTool.Invoke(ctx, scope, json.RawMessage(`{"view":"attention"}`))
	if err != nil || !strings.Contains(string(attentionOut), item.ID.String()) || !strings.Contains(string(attentionOut), `"version":1`) {
		t.Fatalf("relationship.read attention = %s err=%v", attentionOut, err)
	}

	capability, ok := DefaultCatalog().Get("relationship.attention.decide")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("relationship.attention.decide capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"attentionId":"`+item.ID.String()+`","decision":"invalid","expectedVersion":1,"reason":"No"}`)); err == nil {
		t.Fatal("relationship.attention.decide accepted an invalid decision")
	}
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"attentionId":"`+item.ID.String()+`","decision":"acknowledge","expectedVersion":1,"reason":" "}`)); err == nil {
		t.Fatal("relationship.attention.decide accepted an empty reason")
	}
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"attentionId":"`+item.ID.String()+`","decision":"snooze","expectedVersion":1,"reason":"Wait"}`)); err == nil {
		t.Fatal("relationship.attention.decide accepted snooze without a time")
	}
	args := json.RawMessage(`{"attentionId":"` + item.ID.String() + `","decision":"acknowledge","expectedVersion":1,"reason":"Reviewed with the account owner"}`)
	out, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("relationship.attention.decide: %v", err)
	}
	if _, err := tool.Invoke(ctx, scope, args); err != nil {
		t.Fatalf("relationship.attention.decide retry: %v", err)
	}
	if !strings.Contains(string(out), `"status":"acknowledged"`) || !strings.Contains(string(out), `"version":2`) {
		t.Fatalf("relationship.attention.decide output = %s", out)
	}
	stored := database.Client.RelationshipAttentionItem.GetX(internal, item.ID)
	if stored.Status != "acknowledged" || stored.Version != 2 || stored.StateReason != "Reviewed with the account owner" {
		t.Fatalf("decided attention item = %+v", stored)
	}
	if got := database.Client.RevenueTrustEvent.Query().CountX(internal); got != 1 {
		t.Fatalf("attention decision trust event count = %d, want 1", got)
	}
	readAfter, err := readTool.Invoke(ctx, scope, json.RawMessage(`{"view":"attention"}`))
	if err != nil || !strings.Contains(string(readAfter), `"version":2`) || !strings.Contains(string(readAfter), `"stateReason":"Reviewed with the account owner"`) {
		t.Fatalf("decided relationship attention = %s err=%v", readAfter, err)
	}
	staleScope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "attention-stale", TurnSeq: 2, ToolCallIndex: 1}
	if _, err := tool.Invoke(ctx, staleScope, json.RawMessage(`{"attentionId":"`+item.ID.String()+`","decision":"dismiss","expectedVersion":1,"reason":"Stale reviewer"}`)); err == nil {
		t.Fatal("relationship.attention.decide accepted a stale version")
	}

	other := database.Client.User.Create().SetEmail("other-attention@x.co").SetWorkosUserID("other-attention").SaveX(internal)
	otherWorkspace := database.Client.RevenueWorkspace.Create().SetUser(other).SaveX(internal)
	otherRelationship := database.Client.Relationship.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetKind("company").SetDisplayName("Other Attention Account").SaveX(internal)
	foreign := database.Client.RelationshipAttentionItem.Create().
		SetWorkspace(otherWorkspace).SetRelationship(otherRelationship).SetUser(other).
		SetStableKey("attention-tool-foreign").SetReasonCode("quiet_account").
		SetExplanation("Foreign account is quiet.").SetTriggeringObjectRef("relationship:" + otherRelationship.ID.String()).
		SetUrgencyBand("normal").SetRankScore(50).SetMaterialHash("sha256:attention-tool-foreign").SetLastDetectedAt(now).
		SaveX(internal)
	foreignScope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "attention-foreign", TurnSeq: 3, ToolCallIndex: 1}
	if _, err := tool.Invoke(ctx, foreignScope, json.RawMessage(`{"attentionId":"`+foreign.ID.String()+`","decision":"acknowledge","expectedVersion":1,"reason":"Must not cross tenants"}`)); err == nil {
		t.Fatal("relationship.attention.decide accepted another tenant's item")
	}
	unchanged := database.Client.RelationshipAttentionItem.GetX(internal, foreign.ID)
	if unchanged.Status != "open" || unchanged.Version != 1 {
		t.Fatalf("foreign attention item changed: %+v", unchanged)
	}
}

func TestConversationDeleteCapabilityRequiresApprovalAndIsRetrySafe(t *testing.T) {
	ctx, database, owner, rel := newWriteToolFixture(t)
	internal := auth.WithInternal(ctx)
	capability, ok := DefaultCatalog().Get("conversation.delete")
	if !ok || capability.TrustTier != TierAct || !RequiresApproval(capability.TrustTier) {
		t.Fatalf("conversation.delete capability = %+v, want approval-gated action tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	args := json.RawMessage(`{"relationshipId":"` + rel.ID.String() + `","expectedRelationshipName":"` + rel.DisplayName + `"}`)
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "conversation-delete", TurnSeq: 1, ToolCallIndex: 1}
	if _, err := tool.Invoke(ctx, scope, args); err == nil {
		t.Fatal("conversation.delete ran without approval")
	}
	scope.ApprovalID = "approval-conversation-delete"
	wrongName := json.RawMessage(`{"relationshipId":"` + rel.ID.String() + `","expectedRelationshipName":"Wrong account"}`)
	if _, err := tool.Invoke(ctx, scope, wrongName); err == nil {
		t.Fatal("conversation.delete accepted a stale relationship name")
	}
	out, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("conversation.delete: %v", err)
	}
	if _, err := tool.Invoke(ctx, scope, args); err != nil {
		t.Fatalf("conversation.delete retry: %v", err)
	}
	for _, wanted := range []string{`"status":"partial"`, `"target":"api_evidence","status":"deleted"`, `"target":"provider","status":"pending"`, `"legalHold":false`} {
		if !strings.Contains(string(out), wanted) {
			t.Fatalf("conversation.delete output missing %s: %s", wanted, out)
		}
	}
	if strings.Contains(string(out), rel.DisplayName) {
		t.Fatalf("conversation.delete receipt exposed the relationship name: %s", out)
	}
	if got := database.Client.ConversationIntelligenceArtifact.Query().Where(
		conversationintelligenceartifact.KindEQ("deletion_receipt"),
	).CountX(internal); got != 1 {
		t.Fatalf("conversation deletion receipt count = %d, want 1", got)
	}

	other := database.Client.User.Create().SetEmail("other-conversation@x.co").SetWorkosUserID("other-conversation").SaveX(internal)
	otherWorkspace := database.Client.RevenueWorkspace.Create().SetUser(other).SaveX(internal)
	otherRelationship := database.Client.Relationship.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetKind("company").SetDisplayName("Other Conversation Account").SaveX(internal)
	foreignArgs := json.RawMessage(`{"relationshipId":"` + otherRelationship.ID.String() + `","expectedRelationshipName":"` + otherRelationship.DisplayName + `"}`)
	foreignScope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "conversation-delete-foreign", TurnSeq: 1, ToolCallIndex: 1, ApprovalID: "approval-foreign"}
	if _, err := tool.Invoke(ctx, foreignScope, foreignArgs); err == nil {
		t.Fatal("conversation.delete accepted another tenant's relationship")
	}
}
