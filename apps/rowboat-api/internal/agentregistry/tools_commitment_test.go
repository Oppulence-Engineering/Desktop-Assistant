package agentregistry

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
)

func TestCommitmentExportCapabilityReturnsTenantScopedEvidenceAndHistory(t *testing.T) {
	ctx, database, owner, relationship := newWriteToolFixture(t)
	internal := auth.WithInternal(ctx)
	workspace := relationship.QueryWorkspace().OnlyX(internal)
	now := time.Now().UTC().Truncate(time.Second)
	evidence := database.Client.RevenueEvidence.Create().SetWorkspace(workspace).AddRelationships(relationship).SetUser(owner).
		SetSource("gmail").SetSourceRecordID("thread-export").SetContentHash("sha256:export").
		SetExcerpt("We will send the signed renewal.").SetOccurredAt(now).SetObservedAt(now).SaveX(internal)
	row := database.Client.Commitment.Create().SetWorkspace(workspace).SetRelationship(relationship).SetUser(owner).
		SetDirection("promised_by_me").SetText("Send the signed renewal").SetConfidence(1).
		SetAcceptance("internally_confirmed").AddEvidences(evidence).SaveX(internal)
	database.Client.CommitmentEvent.Create().SetWorkspace(workspace).SetRelationship(relationship).SetUser(owner).
		SetCommitment(row).SetSourceEventID("export-event").SetVersion(1).SetKind("internally_confirmed").
		SetActorType("user").SetOccurredAt(now).SaveX(internal)

	capability, ok := DefaultCatalog().Get("commitment.export")
	if !ok || capability.TrustTier != TierRead || RequiresApproval(capability.TrustTier) {
		t.Fatalf("commitment.export capability = %+v, want read tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String()}
	out, err := tool.Invoke(ctx, scope, json.RawMessage(`{"commitmentId":"`+row.ID.String()+`"}`))
	if err != nil {
		t.Fatalf("commitment.export: %v", err)
	}
	for _, want := range []string{"Send the signed renewal", "We will send the signed renewal.", "sha256:export", "internally_confirmed", "# Commitment record"} {
		if !strings.Contains(string(out), want) {
			t.Fatalf("commitment.export output missing %q: %s", want, out)
		}
	}
	if _, err := tool.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: "wrong-owner"}, json.RawMessage(`{"commitmentId":"`+row.ID.String()+`"}`)); err == nil {
		t.Fatal("commitment.export accepted a mismatched workflow owner")
	}
	other := database.Client.User.Create().SetEmail("export-other@x.co").SetWorkosUserID("export-other").SaveX(internal)
	otherWorkspace := database.Client.RevenueWorkspace.Create().SetUser(other).SaveX(internal)
	otherRelationship := database.Client.Relationship.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetKind("company").SetDisplayName("Other Account").SaveX(internal)
	otherCommitment := database.Client.Commitment.Create().SetWorkspace(otherWorkspace).SetRelationship(otherRelationship).SetUser(other).
		SetDirection("promised_by_them").SetText("Private promise").SetConfidence(1).SaveX(internal)
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"commitmentId":"`+otherCommitment.ID.String()+`"}`)); err == nil {
		t.Fatal("commitment.export returned another tenant's commitment")
	}
}

func TestCommitmentDisputeCapabilityUsesAppendOnlyLifecycle(t *testing.T) {
	ctx, database, owner, relationship := newWriteToolFixture(t)
	workspace := relationship.QueryWorkspace().OnlyX(auth.WithInternal(ctx))
	row := database.Client.Commitment.Create().SetWorkspace(workspace).SetRelationship(relationship).SetUser(owner).
		SetDirection("promised_by_them").SetText("Approve the renewal").SetConfidence(1).
		SetAcceptance("accepted").SetUserConfirmed(true).SaveX(auth.WithInternal(ctx))

	capability, ok := DefaultCatalog().Get("commitment.dispute")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("commitment.dispute capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-commitment-dispute", TurnSeq: 7, ToolCallIndex: 1}
	args := json.RawMessage(`{"commitmentId":"` + row.ID.String() + `","reason":"The customer says these were not the agreed terms"}`)
	first, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("commitment.dispute: %v", err)
	}
	retry, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("commitment.dispute retry: %v", err)
	}
	if !strings.Contains(string(first), `"acceptance":"disputed"`) ||
		!strings.Contains(string(retry), `"alreadyDisputed":true`) {
		t.Fatalf("unexpected outputs: first=%s retry=%s", first, retry)
	}
	stored := database.Client.Commitment.GetX(auth.WithInternal(ctx), row.ID)
	if stored.Acceptance != "disputed" || stored.CurrentEventVersion != 1 {
		t.Fatalf("disputed commitment = %+v", stored)
	}
	events := database.Client.CommitmentEvent.Query().AllX(auth.WithInternal(ctx))
	if len(events) != 1 || events[0].Kind != "disputed" || !strings.Contains(events[0].PayloadJSON, "not the agreed terms") {
		t.Fatalf("dispute events = %+v", events)
	}
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"commitmentId":"`+row.ID.String()+`","reason":" "}`)); err == nil {
		t.Fatal("commitment.dispute accepted an empty reason")
	}
	candidate := database.Client.Commitment.Create().SetWorkspace(workspace).SetRelationship(relationship).SetUser(owner).
		SetDirection("promised_by_me").SetText("Unreviewed promise").SetConfidence(0.5).SaveX(auth.WithInternal(ctx))
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"commitmentId":"`+candidate.ID.String()+`","reason":"Not reviewed"}`)); err == nil {
		t.Fatal("commitment.dispute accepted an unconfirmed candidate")
	}
	other := database.Client.User.Create().SetEmail("dispute-other@x.co").SetWorkosUserID("dispute-other").SaveX(auth.WithInternal(ctx))
	otherWorkspace := database.Client.RevenueWorkspace.Create().SetUser(other).SaveX(auth.WithInternal(ctx))
	otherRelationship := database.Client.Relationship.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetKind("company").SetDisplayName("Other Account").SaveX(auth.WithInternal(ctx))
	otherCommitment := database.Client.Commitment.Create().SetWorkspace(otherWorkspace).SetRelationship(otherRelationship).SetUser(other).
		SetDirection("promised_by_them").SetText("Private promise").SetConfidence(1).
		SetAcceptance("offered").SaveX(auth.WithInternal(ctx))
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"commitmentId":"`+otherCommitment.ID.String()+`","reason":"Changed"}`)); err == nil {
		t.Fatal("commitment.dispute accepted another tenant's commitment")
	}
}

func TestCommitmentUnblockCapabilityUsesAppendOnlyLifecycle(t *testing.T) {
	ctx, database, owner, relationship := newWriteToolFixture(t)
	workspace := relationship.QueryWorkspace().OnlyX(auth.WithInternal(ctx))
	row := database.Client.Commitment.Create().SetWorkspace(workspace).SetRelationship(relationship).SetUser(owner).
		SetDirection("promised_by_me").SetText("Send the renewal packet").SetConfidence(1).
		SetAcceptance("accepted").SetUserConfirmed(true).SetBlocker("Waiting for legal approval").SaveX(auth.WithInternal(ctx))

	capability, ok := DefaultCatalog().Get("commitment.unblock")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("commitment.unblock capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-commitment-unblock", TurnSeq: 6, ToolCallIndex: 1}
	args := json.RawMessage(`{"commitmentId":"` + row.ID.String() + `"}`)
	first, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("commitment.unblock: %v", err)
	}
	retry, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("commitment.unblock retry: %v", err)
	}
	if string(first) != string(retry) || !strings.Contains(string(first), `"eventVersion":1`) {
		t.Fatalf("unexpected outputs: first=%s retry=%s", first, retry)
	}
	stored := database.Client.Commitment.GetX(auth.WithInternal(ctx), row.ID)
	if stored.Blocker != "" || stored.CurrentEventVersion != 1 {
		t.Fatalf("unblocked commitment = %+v", stored)
	}
	events := database.Client.CommitmentEvent.Query().AllX(auth.WithInternal(ctx))
	if len(events) != 1 || events[0].Kind != "unblocked" || events[0].ActorType != "user" {
		t.Fatalf("unblock events = %+v", events)
	}
	unblocked := database.Client.Commitment.Create().SetWorkspace(workspace).SetRelationship(relationship).SetUser(owner).
		SetDirection("promised_by_them").SetText("No blocker").SetConfidence(1).
		SetAcceptance("accepted").SaveX(auth.WithInternal(ctx))
	if _, err := tool.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "unblocked-row", TurnSeq: 1, ToolCallIndex: 1}, json.RawMessage(`{"commitmentId":"`+unblocked.ID.String()+`"}`)); err == nil {
		t.Fatal("commitment.unblock accepted a commitment without a blocker")
	}
	other := database.Client.User.Create().SetEmail("unblock-other@x.co").SetWorkosUserID("unblock-other").SaveX(auth.WithInternal(ctx))
	otherWorkspace := database.Client.RevenueWorkspace.Create().SetUser(other).SaveX(auth.WithInternal(ctx))
	otherRelationship := database.Client.Relationship.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetKind("company").SetDisplayName("Other Account").SaveX(auth.WithInternal(ctx))
	otherCommitment := database.Client.Commitment.Create().SetWorkspace(otherWorkspace).SetRelationship(otherRelationship).SetUser(other).
		SetDirection("promised_by_them").SetText("Private promise").SetConfidence(1).
		SetAcceptance("accepted").SetBlocker("Private blocker").SaveX(auth.WithInternal(ctx))
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"commitmentId":"`+otherCommitment.ID.String()+`"}`)); err == nil {
		t.Fatal("commitment.unblock accepted another tenant's commitment")
	}
}

func TestCommitmentBlockCapabilityUsesAppendOnlyLifecycle(t *testing.T) {
	ctx, database, owner, relationship := newWriteToolFixture(t)
	workspace := relationship.QueryWorkspace().OnlyX(auth.WithInternal(ctx))
	row := database.Client.Commitment.Create().SetWorkspace(workspace).SetRelationship(relationship).SetUser(owner).
		SetDirection("promised_by_me").SetText("Send the renewal packet").SetConfidence(1).
		SetAcceptance("accepted").SetUserConfirmed(true).SaveX(auth.WithInternal(ctx))

	capability, ok := DefaultCatalog().Get("commitment.block")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("commitment.block capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-commitment-block", TurnSeq: 5, ToolCallIndex: 1}
	args := json.RawMessage(`{"commitmentId":"` + row.ID.String() + `","blocker":"Waiting for legal approval"}`)
	first, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("commitment.block: %v", err)
	}
	retry, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("commitment.block retry: %v", err)
	}
	if !strings.Contains(string(first), `"blocker":"Waiting for legal approval"`) ||
		!strings.Contains(string(retry), `"alreadyBlocked":true`) {
		t.Fatalf("unexpected outputs: first=%s retry=%s", first, retry)
	}
	stored := database.Client.Commitment.GetX(auth.WithInternal(ctx), row.ID)
	if stored.Blocker != "Waiting for legal approval" || stored.CurrentEventVersion != 1 {
		t.Fatalf("blocked commitment = %+v", stored)
	}
	events := database.Client.CommitmentEvent.Query().AllX(auth.WithInternal(ctx))
	if len(events) != 1 || events[0].Kind != "blocked" || !strings.Contains(events[0].PayloadJSON, "Waiting for legal approval") {
		t.Fatalf("block events = %+v", events)
	}
	candidate := database.Client.Commitment.Create().SetWorkspace(workspace).SetRelationship(relationship).SetUser(owner).
		SetDirection("promised_by_them").SetText("Unreviewed promise").SetConfidence(0.5).SaveX(auth.WithInternal(ctx))
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"commitmentId":"`+candidate.ID.String()+`","blocker":"Unknown owner"}`)); err == nil {
		t.Fatal("commitment.block accepted an unconfirmed candidate")
	}
	other := database.Client.User.Create().SetEmail("block-other@x.co").SetWorkosUserID("block-other").SaveX(auth.WithInternal(ctx))
	otherWorkspace := database.Client.RevenueWorkspace.Create().SetUser(other).SaveX(auth.WithInternal(ctx))
	otherRelationship := database.Client.Relationship.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetKind("company").SetDisplayName("Other Account").SaveX(auth.WithInternal(ctx))
	otherCommitment := database.Client.Commitment.Create().SetWorkspace(otherWorkspace).SetRelationship(otherRelationship).SetUser(other).
		SetDirection("promised_by_them").SetText("Private promise").SetConfidence(1).
		SetAcceptance("accepted").SaveX(auth.WithInternal(ctx))
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"commitmentId":"`+otherCommitment.ID.String()+`","blocker":"Changed"}`)); err == nil {
		t.Fatal("commitment.block accepted another tenant's commitment")
	}
}

func TestCommitmentAcceptCapabilityUsesAppendOnlyLifecycle(t *testing.T) {
	ctx, database, owner, relationship := newWriteToolFixture(t)
	workspace := relationship.QueryWorkspace().OnlyX(auth.WithInternal(ctx))
	row := database.Client.Commitment.Create().SetWorkspace(workspace).SetRelationship(relationship).SetUser(owner).
		SetDirection("promised_by_them").SetText("Approve the renewal").SetConfidence(1).
		SetAcceptance("internally_confirmed").SetUserConfirmed(true).SaveX(auth.WithInternal(ctx))

	capability, ok := DefaultCatalog().Get("commitment.accept")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("commitment.accept capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-commitment-accept", TurnSeq: 4, ToolCallIndex: 1}
	args := json.RawMessage(`{"commitmentId":"` + row.ID.String() + `"}`)
	first, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("commitment.accept: %v", err)
	}
	retry, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("commitment.accept retry: %v", err)
	}
	if !strings.Contains(string(first), `"acceptance":"accepted"`) ||
		!strings.Contains(string(retry), `"alreadyAccepted":true`) {
		t.Fatalf("unexpected outputs: first=%s retry=%s", first, retry)
	}
	stored := database.Client.Commitment.GetX(auth.WithInternal(ctx), row.ID)
	if stored.Acceptance != "accepted" || stored.CurrentEventVersion != 1 {
		t.Fatalf("accepted commitment = %+v", stored)
	}
	events := database.Client.CommitmentEvent.Query().AllX(auth.WithInternal(ctx))
	if len(events) != 1 || events[0].Kind != "accepted" || events[0].ActorType != "user" {
		t.Fatalf("acceptance events = %+v", events)
	}
	candidate := database.Client.Commitment.Create().SetWorkspace(workspace).SetRelationship(relationship).SetUser(owner).
		SetDirection("promised_by_me").SetText("Unreviewed promise").SetConfidence(0.5).SaveX(auth.WithInternal(ctx))
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"commitmentId":"`+candidate.ID.String()+`"}`)); err == nil {
		t.Fatal("commitment.accept accepted an unconfirmed candidate")
	}
	other := database.Client.User.Create().SetEmail("accept-other@x.co").SetWorkosUserID("accept-other").SaveX(auth.WithInternal(ctx))
	otherWorkspace := database.Client.RevenueWorkspace.Create().SetUser(other).SaveX(auth.WithInternal(ctx))
	otherRelationship := database.Client.Relationship.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetKind("company").SetDisplayName("Other Account").SaveX(auth.WithInternal(ctx))
	otherCommitment := database.Client.Commitment.Create().SetWorkspace(otherWorkspace).SetRelationship(otherRelationship).SetUser(other).
		SetDirection("promised_by_them").SetText("Private promise").SetConfidence(1).
		SetAcceptance("offered").SaveX(auth.WithInternal(ctx))
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"commitmentId":"`+otherCommitment.ID.String()+`"}`)); err == nil {
		t.Fatal("commitment.accept accepted another tenant's commitment")
	}
}

func TestCommitmentConfirmCapabilityUsesAppendOnlyLifecycle(t *testing.T) {
	ctx, database, owner, relationship := newWriteToolFixture(t)
	workspace := relationship.QueryWorkspace().OnlyX(auth.WithInternal(ctx))
	row := database.Client.Commitment.Create().SetWorkspace(workspace).SetRelationship(relationship).SetUser(owner).
		SetDirection("promised_by_me").SetText("Send the security packet").SetConfidence(0.8).SaveX(auth.WithInternal(ctx))

	capability, ok := DefaultCatalog().Get("commitment.confirm")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("commitment.confirm capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-commitment-confirm", TurnSeq: 3, ToolCallIndex: 1}
	args := json.RawMessage(`{"commitmentId":"` + row.ID.String() + `"}`)
	first, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("commitment.confirm: %v", err)
	}
	retry, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("commitment.confirm retry: %v", err)
	}
	if !strings.Contains(string(first), `"acceptance":"internally_confirmed"`) ||
		!strings.Contains(string(retry), `"alreadyConfirmed":true`) {
		t.Fatalf("unexpected outputs: first=%s retry=%s", first, retry)
	}
	stored := database.Client.Commitment.GetX(auth.WithInternal(ctx), row.ID)
	if !stored.UserConfirmed || stored.Acceptance != "internally_confirmed" || stored.CurrentEventVersion != 1 {
		t.Fatalf("confirmed commitment = %+v", stored)
	}
	events := database.Client.CommitmentEvent.Query().AllX(auth.WithInternal(ctx))
	if len(events) != 1 || events[0].Kind != "internally_confirmed" || events[0].ActorType != "user" {
		t.Fatalf("confirmation events = %+v", events)
	}
	other := database.Client.User.Create().SetEmail("confirm-other@x.co").SetWorkosUserID("confirm-other").SaveX(auth.WithInternal(ctx))
	otherWorkspace := database.Client.RevenueWorkspace.Create().SetUser(other).SaveX(auth.WithInternal(ctx))
	otherRelationship := database.Client.Relationship.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetKind("company").SetDisplayName("Other Account").SaveX(auth.WithInternal(ctx))
	otherCommitment := database.Client.Commitment.Create().SetWorkspace(otherWorkspace).SetRelationship(otherRelationship).SetUser(other).
		SetDirection("promised_by_them").SetText("Private promise").SetConfidence(1).SaveX(auth.WithInternal(ctx))
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"commitmentId":"`+otherCommitment.ID.String()+`"}`)); err == nil {
		t.Fatal("commitment.confirm accepted another tenant's commitment")
	}
}

func TestCommitmentCorrectCapabilityUsesAppendOnlyLifecycle(t *testing.T) {
	ctx, database, owner, relationship := newWriteToolFixture(t)
	workspace := relationship.QueryWorkspace().OnlyX(auth.WithInternal(ctx))
	row := database.Client.Commitment.Create().SetWorkspace(workspace).SetRelationship(relationship).SetUser(owner).
		SetDirection("promised_by_them").SetText("Old promise").SetConfidence(0.8).SaveX(auth.WithInternal(ctx))

	capability, ok := DefaultCatalog().Get("commitment.correct")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("commitment.correct capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-commitment-correct", TurnSeq: 3, ToolCallIndex: 1}
	dueAt := time.Now().UTC().Add(48 * time.Hour).Truncate(time.Second)
	args := json.RawMessage(`{"commitmentId":"` + row.ID.String() + `","action":"Send the signed renewal","dueAt":"` + dueAt.Format(time.RFC3339) + `"}`)
	first, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("commitment.correct: %v", err)
	}
	retry, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("commitment.correct retry: %v", err)
	}
	if !strings.Contains(string(first), `"action":"Send the signed renewal"`) || string(first) != string(retry) {
		t.Fatalf("unexpected outputs: first=%s retry=%s", first, retry)
	}
	stored := database.Client.Commitment.GetX(auth.WithInternal(ctx), row.ID)
	if stored.Text != "Send the signed renewal" || !stored.DueAt.Equal(dueAt) || !stored.UserConfirmed ||
		stored.Acceptance != "internally_confirmed" || stored.CurrentEventVersion != 1 {
		t.Fatalf("corrected commitment = %+v", stored)
	}
	events := database.Client.CommitmentEvent.Query().AllX(auth.WithInternal(ctx))
	if len(events) != 1 || events[0].Kind != "corrected" || !strings.Contains(events[0].PayloadJSON, "Send the signed renewal") {
		t.Fatalf("correction events = %+v", events)
	}
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"commitmentId":"`+row.ID.String()+`","action":" "}`)); err == nil {
		t.Fatal("commitment.correct accepted empty corrected text")
	}
	other := database.Client.User.Create().SetEmail("correct-other@x.co").SetWorkosUserID("correct-other").SaveX(auth.WithInternal(ctx))
	otherWorkspace := database.Client.RevenueWorkspace.Create().SetUser(other).SaveX(auth.WithInternal(ctx))
	otherRelationship := database.Client.Relationship.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetKind("company").SetDisplayName("Other Account").SaveX(auth.WithInternal(ctx))
	otherCommitment := database.Client.Commitment.Create().SetWorkspace(otherWorkspace).SetRelationship(otherRelationship).SetUser(other).
		SetDirection("promised_by_me").SetText("Private promise").SetConfidence(1).SaveX(auth.WithInternal(ctx))
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"commitmentId":"`+otherCommitment.ID.String()+`","action":"Changed"}`)); err == nil {
		t.Fatal("commitment.correct accepted another tenant's commitment")
	}
}

func TestCommitmentCompleteCapabilityUsesCommitmentLifecycle(t *testing.T) {
	ctx, database, owner, relationship := newWriteToolFixture(t)
	row := database.Client.Commitment.Create().SetWorkspace(relationship.QueryWorkspace().OnlyX(auth.WithInternal(ctx))).
		SetRelationship(relationship).SetUser(owner).SetDirection("promised_by_me").
		SetText("Send the renewal plan").SetConfidence(1).SetAcceptance("internally_confirmed").SaveX(auth.WithInternal(ctx))

	capability, ok := DefaultCatalog().Get("commitment.complete")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("commitment.complete capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-commitment", TurnSeq: 2, ToolCallIndex: 1}
	args := json.RawMessage(`{"commitmentId":"` + row.ID.String() + `","reason":"Delivered to the customer"}`)
	out, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("commitment.complete: %v", err)
	}
	retry, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("commitment.complete retry: %v", err)
	}
	if !strings.Contains(string(out), `"status":"fulfilled"`) ||
		!strings.Contains(string(retry), `"alreadyFulfilled":true`) {
		t.Fatalf("unexpected outputs: first=%s retry=%s", out, retry)
	}
	stored := database.Client.Commitment.GetX(auth.WithInternal(ctx), row.ID)
	if stored.Status != "fulfilled" || stored.CompletedAt == nil || stored.CurrentEventVersion != 1 {
		t.Fatalf("completed commitment = %+v", stored)
	}
	event := database.Client.CommitmentEvent.Query().OnlyX(auth.WithInternal(ctx))
	if event.Kind != "fulfilled" || event.ActorType != "user" || !strings.Contains(event.PayloadJSON, "Delivered to the customer") {
		t.Fatalf("completion event = %+v", event)
	}
	if _, err := tool.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: "wrong-owner"}, args); err == nil {
		t.Fatal("commitment.complete accepted a mismatched workflow owner")
	}
	other := database.Client.User.Create().SetEmail("other@x.co").SetWorkosUserID("other").SaveX(auth.WithInternal(ctx))
	otherWorkspace := database.Client.RevenueWorkspace.Create().SetUser(other).SaveX(auth.WithInternal(ctx))
	otherRelationship := database.Client.Relationship.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetKind("company").SetDisplayName("Other Account").SaveX(auth.WithInternal(ctx))
	otherCommitment := database.Client.Commitment.Create().SetWorkspace(otherWorkspace).SetRelationship(otherRelationship).SetUser(other).
		SetDirection("promised_by_them").SetText("Other tenant promise").SetConfidence(1).
		SetAcceptance("internally_confirmed").SaveX(auth.WithInternal(ctx))
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"commitmentId":"`+otherCommitment.ID.String()+`"}`)); err == nil {
		t.Fatal("commitment.complete accepted another tenant's commitment")
	}
}
