package agentregistry

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/revenue"
	"go.uber.org/zap"
)

func TestActionAuditCapabilityReturnsEvidenceAndHistoryWithoutMutation(t *testing.T) {
	ctx, database, owner, relationship := newWriteToolFixture(t)
	internal := auth.WithInternal(ctx)
	workspace := relationship.QueryWorkspace().OnlyX(internal)
	service := revenue.NewService(database.Client, nil, nil, zap.NewNop())
	action, err := service.CreateAction(auth.WithUser(ctx, owner), owner, revenue.ActionInput{
		RelationshipID: relationship.ID, ActionType: "warm_follow_up", Channel: "email",
		Reason: "Follow up after the renewal call", RecipientEmail: "buyer@example.com",
		ProposedSubject: "Renewal follow-up", ProposedMessage: "Here are the next steps.", PriorityScore: 50,
	})
	if err != nil {
		t.Fatalf("create action: %v", err)
	}
	now := time.Now().UTC().Truncate(time.Second)
	evidence := database.Client.RevenueEvidence.Create().SetWorkspace(workspace).AddRelationships(relationship).SetUser(owner).
		SetSource("gmail").SetSourceRecordID("audit-thread").SetContentHash("sha256:audit").
		SetExcerpt("Please send the renewal steps.").SetOccurredAt(now).SetObservedAt(now).SaveX(internal)
	database.Client.RevenueAction.UpdateOneID(action.ID).AddEvidences(evidence).ExecX(internal)
	database.Client.ActionOutcome.Create().SetWorkspace(workspace).SetAction(action).SetUser(owner).
		SetKind("replied").SetSource("gmail").SetSourceEventID("audit-reply").SetOccurredAt(now).SaveX(internal)
	unchangedAt := database.Client.RevenueAction.GetX(internal, action.ID).UpdatedAt

	capability, ok := DefaultCatalog().Get("action.audit")
	if !ok || capability.TrustTier != TierRead || RequiresApproval(capability.TrustTier) {
		t.Fatalf("action.audit capability = %+v, want read tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String()}
	out, err := tool.Invoke(ctx, scope, json.RawMessage(`{"actionId":"`+action.ID.String()+`"}`))
	if err != nil {
		t.Fatalf("action.audit: %v", err)
	}
	for _, want := range []string{"Follow up after the renewal call", "Renewal follow-up", "Here are the next steps.", "Please send the renewal steps.", "sha256:audit", `"revisions":[{`, `"outcomes":[{`, `"kind":"replied"`} {
		if !strings.Contains(string(out), want) {
			t.Fatalf("action.audit output missing %q: %s", want, out)
		}
	}
	if _, err := tool.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: "wrong-owner"}, json.RawMessage(`{"actionId":"`+action.ID.String()+`"}`)); err == nil {
		t.Fatal("action.audit accepted a mismatched workflow owner")
	}
	other := database.Client.User.Create().SetEmail("audit-other@x.co").SetWorkosUserID("audit-other").SaveX(internal)
	otherWorkspace := database.Client.RevenueWorkspace.Create().SetUser(other).SaveX(internal)
	otherRelationship := database.Client.Relationship.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetKind("company").SetDisplayName("Other Account").SaveX(internal)
	otherAction := database.Client.RevenueAction.Create().SetWorkspace(otherWorkspace).SetRelationship(otherRelationship).SetUser(other).
		SetActionType("warm_follow_up").SetChannel("email").SetDetector("manual").SetDedupeKey("other-audit").
		SetRevisionHash("other").SetReason("Private action").SetPriorityScore(1).SetExecutionOwner("rowboat").SaveX(internal)
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"actionId":"`+otherAction.ID.String()+`"}`)); err == nil {
		t.Fatal("action.audit returned another tenant's action")
	}
	if got := database.Client.RevenueAction.GetX(internal, action.ID).UpdatedAt; !got.Equal(unchangedAt) {
		t.Fatalf("action.audit mutated the action: updatedAt=%v want %v", got, unchangedAt)
	}
}

func TestActionOutcomeRecordCapabilityIsRetrySafeAndTenantScoped(t *testing.T) {
	ctx, database, owner, relationship := newWriteToolFixture(t)
	internal := auth.WithInternal(ctx)
	service := revenue.NewService(database.Client, nil, nil, zap.NewNop())
	action, err := service.CreateAction(auth.WithUser(ctx, owner), owner, revenue.ActionInput{
		RelationshipID: relationship.ID, ActionType: "warm_follow_up", Channel: "email",
		Reason: "Follow up after the renewal call", PriorityScore: 50,
	})
	if err != nil {
		t.Fatalf("create action: %v", err)
	}

	capability, ok := DefaultCatalog().Get("action.outcome.record")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("action.outcome.record capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-outcome", TurnSeq: 4, ToolCallIndex: 2}
	args := json.RawMessage(`{"actionId":"` + action.ID.String() + `","outcome":"replied"}`)
	first, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("action.outcome.record: %v", err)
	}
	retry, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("action.outcome.record retry: %v", err)
	}
	if string(first) != string(retry) || !strings.Contains(string(first), `"outcome":"replied"`) || !strings.Contains(string(first), `"source":"user"`) {
		t.Fatalf("unexpected action.outcome.record outputs: first=%s retry=%s", first, retry)
	}
	if got := database.Client.ActionOutcome.Query().CountX(internal); got != 1 {
		t.Fatalf("outcome count = %d, want 1", got)
	}
	timeline, err := service.RelationshipTimeline(auth.WithUser(ctx, owner), relationship.ID, 50)
	if err != nil || len(timeline) != 1 || timeline[0].EventType != "action.outcome.replied" {
		t.Fatalf("outcome timeline = %+v err=%v", timeline, err)
	}
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"actionId":"`+action.ID.String()+`","outcome":"invented"}`)); err == nil {
		t.Fatal("action.outcome.record accepted an unsupported outcome")
	}
	if _, err := tool.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: "wrong-owner"}, args); err == nil {
		t.Fatal("action.outcome.record accepted a mismatched workflow owner")
	}
	other := database.Client.User.Create().SetEmail("outcome-other@x.co").SetWorkosUserID("outcome-other").SaveX(internal)
	otherWorkspace := database.Client.RevenueWorkspace.Create().SetUser(other).SaveX(internal)
	otherRelationship := database.Client.Relationship.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetKind("company").SetDisplayName("Other Account").SaveX(internal)
	otherService := revenue.NewService(database.Client, nil, nil, zap.NewNop())
	otherAction, err := otherService.CreateAction(auth.WithUser(ctx, other), other, revenue.ActionInput{
		RelationshipID: otherRelationship.ID, ActionType: "warm_follow_up", Channel: "email",
		Reason: "Private action", PriorityScore: 1,
	})
	if err != nil {
		t.Fatalf("create other action: %v", err)
	}
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"actionId":"`+otherAction.ID.String()+`","outcome":"won"}`)); err == nil {
		t.Fatal("action.outcome.record accepted another tenant's action")
	}
}

func TestRecommendationCreateCapabilityUsesReviewQueueLifecycle(t *testing.T) {
	ctx, database, owner, relationship := newWriteToolFixture(t)
	database.Client.Relationship.UpdateOneID(relationship.ID).SetPrimaryEmail("Buyer@Example.com").ExecX(auth.WithInternal(ctx))

	capability, ok := DefaultCatalog().Get("recommendation.create")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("recommendation.create capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-create", TurnSeq: 2, ToolCallIndex: 0}
	args := json.RawMessage(`{"relationshipId":"` + relationship.ID.String() + `","actionType":"proposal_nudge","reason":"  Follow up on proposal  ","subject":"Checking in","message":"Any questions?","priority":70}`)
	out, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("recommendation.create: %v", err)
	}
	retry, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("recommendation.create retry: %v", err)
	}
	if !strings.Contains(string(out), `"status":"open"`) || string(out) != string(retry) {
		t.Fatalf("unexpected recommendation.create outputs: first=%s retry=%s", out, retry)
	}
	stored := database.Client.RevenueAction.Query().OnlyX(auth.WithInternal(ctx))
	if stored.ActionType != "proposal_nudge" || stored.Channel != "email" || stored.Detector != revenue.DetectorManual || stored.ExecutionMode != revenue.ExecModeDraft || stored.DedupeKey != "agent-recommendation:run-create:2:0" {
		t.Fatalf("created recommendation lifecycle = %+v", stored)
	}
	if stored.Reason != "Follow up on proposal" || stored.RecipientEmail != "buyer@example.com" || stored.ProposedSubject != "Checking in" || stored.ProposedMessage != "Any questions?" || stored.PriorityScore != 70 {
		t.Fatalf("created recommendation content = %+v", stored)
	}
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"relationshipId":"`+relationship.ID.String()+`","actionType":"follow_up_task","reason":"No"}`)); err == nil {
		t.Fatal("recommendation.create accepted a task action type")
	}
	if _, err := tool.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: "wrong-owner", RunID: "run-create"}, args); err == nil {
		t.Fatal("recommendation.create accepted a mismatched workflow owner")
	}
	if got := database.Client.RevenueAction.Query().CountX(auth.WithInternal(ctx)); got != 1 {
		t.Fatalf("recommendation count = %d, want 1", got)
	}
}

func TestRecommendationDismissCapabilityUsesSafeQueueLifecycle(t *testing.T) {
	ctx, database, owner, relationship := newWriteToolFixture(t)
	service := revenue.NewService(database.Client, nil, nil, zap.NewNop())
	action, err := service.CreateAction(auth.WithUser(ctx, owner), owner, revenue.ActionInput{
		RelationshipID: relationship.ID, ActionType: "warm_follow_up", Channel: "email",
		Reason: "Send renewal note", PriorityScore: 30,
	})
	if err != nil {
		t.Fatalf("create recommendation: %v", err)
	}

	capability, ok := DefaultCatalog().Get("recommendation.dismiss")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("recommendation.dismiss capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-dismiss", TurnSeq: 2, ToolCallIndex: 0}
	args := json.RawMessage(`{"recommendationId":"` + action.ID.String() + `","reason":"  No longer relevant  "}`)
	out, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("recommendation.dismiss: %v", err)
	}
	retry, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("recommendation.dismiss retry: %v", err)
	}
	if !strings.Contains(string(out), `"status":"dismissed"`) || !strings.Contains(string(retry), `"alreadyDismissed":true`) {
		t.Fatalf("unexpected recommendation.dismiss outputs: first=%s retry=%s", out, retry)
	}
	stored := database.Client.RevenueAction.GetX(auth.WithInternal(ctx), action.ID)
	if stored.DismissReason != "No longer relevant" {
		t.Fatalf("dismiss reason = %q, want trimmed reason", stored.DismissReason)
	}
	if got := database.Client.ActionOutcome.Query().CountX(auth.WithInternal(ctx)); got != 1 {
		t.Fatalf("dismiss outcome count = %d, want 1", got)
	}

	task, err := service.CreateAction(auth.WithUser(ctx, owner), owner, revenue.ActionInput{
		RelationshipID: relationship.ID, ActionType: "follow_up_task", Channel: "task",
		Reason: "Review renewal", PriorityScore: 30,
	})
	if err != nil {
		t.Fatalf("create task: %v", err)
	}
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"recommendationId":"`+task.ID.String()+`","reason":"Done"}`)); err == nil {
		t.Fatal("recommendation.dismiss accepted a task")
	}

	started, err := service.CreateAction(auth.WithUser(ctx, owner), owner, revenue.ActionInput{
		RelationshipID: relationship.ID, ActionType: "proposal_nudge", Channel: "email",
		Reason: "Send proposal reminder", PriorityScore: 50,
	})
	if err != nil {
		t.Fatalf("create started recommendation: %v", err)
	}
	database.Client.RevenueAction.UpdateOneID(started.ID).SetExecutionStatus(revenue.ExecRequested).ExecX(auth.WithInternal(ctx))
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"recommendationId":"`+started.ID.String()+`","reason":"Stop"}`)); err == nil {
		t.Fatal("recommendation.dismiss accepted a started recommendation")
	}
	if got := database.Client.RevenueAction.GetX(auth.WithInternal(ctx), started.ID).QueueStatus; got != revenue.QueueOpen {
		t.Fatalf("started recommendation queue status = %q, want open", got)
	}
	approved, err := service.CreateAction(auth.WithUser(ctx, owner), owner, revenue.ActionInput{
		RelationshipID: relationship.ID, ActionType: "customer_risk", Channel: "email",
		Reason: "Send risk follow-up", PriorityScore: 60,
	})
	if err != nil {
		t.Fatalf("create approved recommendation: %v", err)
	}
	database.Client.RevenueAction.UpdateOneID(approved.ID).SetApprovalStatus(revenue.ApprovalApproved).ExecX(auth.WithInternal(ctx))
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"recommendationId":"`+approved.ID.String()+`","reason":"Stop"}`)); err == nil {
		t.Fatal("recommendation.dismiss accepted an approved recommendation")
	}
	if _, err := tool.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: "wrong-owner"}, args); err == nil {
		t.Fatal("recommendation.dismiss accepted a mismatched workflow owner")
	}
}

func TestRecommendationSnoozeCapabilityUsesSafeQueueLifecycle(t *testing.T) {
	ctx, database, owner, relationship := newWriteToolFixture(t)
	service := revenue.NewService(database.Client, nil, nil, zap.NewNop())
	action, err := service.CreateAction(auth.WithUser(ctx, owner), owner, revenue.ActionInput{
		RelationshipID: relationship.ID, ActionType: "warm_follow_up", Channel: "email",
		Reason: "Send renewal note", PriorityScore: 30,
	})
	if err != nil {
		t.Fatalf("create recommendation: %v", err)
	}

	capability, ok := DefaultCatalog().Get("recommendation.snooze")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("recommendation.snooze capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-snooze", TurnSeq: 2, ToolCallIndex: 0}
	until := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Second)
	args := json.RawMessage(`{"recommendationId":"` + action.ID.String() + `","until":"` + until.Format(time.RFC3339) + `"}`)
	out, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("recommendation.snooze: %v", err)
	}
	retry, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("recommendation.snooze retry: %v", err)
	}
	if !strings.Contains(string(out), `"status":"snoozed"`) || !strings.Contains(string(retry), `"alreadySnoozed":true`) {
		t.Fatalf("unexpected recommendation.snooze outputs: first=%s retry=%s", out, retry)
	}
	stored := database.Client.RevenueAction.GetX(auth.WithInternal(ctx), action.ID)
	if stored.SnoozedUntil == nil || !stored.SnoozedUntil.Equal(until) {
		t.Fatalf("snoozed until = %v, want %v", stored.SnoozedUntil, until)
	}

	task, err := service.CreateAction(auth.WithUser(ctx, owner), owner, revenue.ActionInput{
		RelationshipID: relationship.ID, ActionType: "follow_up_task", Channel: "task",
		Reason: "Review renewal", PriorityScore: 30,
	})
	if err != nil {
		t.Fatalf("create task: %v", err)
	}
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"recommendationId":"`+task.ID.String()+`","until":"`+until.Format(time.RFC3339)+`"}`)); err == nil {
		t.Fatal("recommendation.snooze accepted a task")
	}

	started, err := service.CreateAction(auth.WithUser(ctx, owner), owner, revenue.ActionInput{
		RelationshipID: relationship.ID, ActionType: "proposal_nudge", Channel: "email",
		Reason: "Send proposal reminder", PriorityScore: 50,
	})
	if err != nil {
		t.Fatalf("create started recommendation: %v", err)
	}
	database.Client.RevenueAction.UpdateOneID(started.ID).SetExecutionStatus(revenue.ExecRequested).ExecX(auth.WithInternal(ctx))
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"recommendationId":"`+started.ID.String()+`","until":"`+until.Format(time.RFC3339)+`"}`)); err == nil {
		t.Fatal("recommendation.snooze accepted a started recommendation")
	}

	approved, err := service.CreateAction(auth.WithUser(ctx, owner), owner, revenue.ActionInput{
		RelationshipID: relationship.ID, ActionType: "customer_risk", Channel: "email",
		Reason: "Send risk follow-up", PriorityScore: 60,
	})
	if err != nil {
		t.Fatalf("create approved recommendation: %v", err)
	}
	database.Client.RevenueAction.UpdateOneID(approved.ID).SetApprovalStatus(revenue.ApprovalApproved).ExecX(auth.WithInternal(ctx))
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"recommendationId":"`+approved.ID.String()+`","until":"`+until.Format(time.RFC3339)+`"}`)); err == nil {
		t.Fatal("recommendation.snooze accepted an approved recommendation")
	}
	if _, err := tool.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: "wrong-owner"}, args); err == nil {
		t.Fatal("recommendation.snooze accepted a mismatched workflow owner")
	}
}

func TestRecommendationUpdateCapabilityUsesRevisionLifecycle(t *testing.T) {
	ctx, database, owner, relationship := newWriteToolFixture(t)
	service := revenue.NewService(database.Client, nil, nil, zap.NewNop())
	action, err := service.CreateAction(auth.WithUser(ctx, owner), owner, revenue.ActionInput{
		RelationshipID: relationship.ID, ActionType: "warm_follow_up", Channel: "email",
		Reason: "Send renewal note", ProposedSubject: "Original subject",
		ProposedMessage: "Original message", PriorityScore: 30,
	})
	if err != nil {
		t.Fatalf("create recommendation: %v", err)
	}
	database.Client.RevenueAction.UpdateOneID(action.ID).
		SetPolicyStatus(revenue.PolicyPassed).SetApprovalStatus(revenue.ApprovalApproved).
		ExecX(auth.WithInternal(ctx))

	capability, ok := DefaultCatalog().Get("recommendation.update")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("recommendation.update capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-update", TurnSeq: 2, ToolCallIndex: 0}
	args := json.RawMessage(`{"recommendationId":"` + action.ID.String() + `","subject":"Updated subject"}`)
	out, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("recommendation.update: %v", err)
	}
	retry, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("recommendation.update retry: %v", err)
	}
	if !strings.Contains(string(out), `"revisionChanged":true`) || !strings.Contains(string(retry), `"revisionChanged":false`) {
		t.Fatalf("unexpected recommendation.update outputs: first=%s retry=%s", out, retry)
	}
	stored := database.Client.RevenueAction.GetX(auth.WithInternal(ctx), action.ID)
	if stored.Revision != 2 || stored.ProposedSubject != "Updated subject" || stored.ProposedMessage != "Original message" {
		t.Fatalf("updated recommendation = %+v", stored)
	}
	if stored.PolicyStatus != revenue.PolicyPending || stored.ApprovalStatus != revenue.ApprovalPending {
		t.Fatalf("update did not invalidate policy and approval: %+v", stored)
	}
	if got := database.Client.RevenueActionRevision.Query().CountX(auth.WithInternal(ctx)); got != 2 {
		t.Fatalf("recommendation revision count = %d, want 2", got)
	}
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"recommendationId":"`+action.ID.String()+`"}`)); err == nil {
		t.Fatal("recommendation.update accepted an empty edit")
	}

	task, err := service.CreateAction(auth.WithUser(ctx, owner), owner, revenue.ActionInput{
		RelationshipID: relationship.ID, ActionType: "follow_up_task", Channel: "task",
		Reason: "Review renewal", PriorityScore: 30,
	})
	if err != nil {
		t.Fatalf("create task: %v", err)
	}
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"recommendationId":"`+task.ID.String()+`","message":"Done"}`)); err == nil {
		t.Fatal("recommendation.update accepted a task")
	}

	started, err := service.CreateAction(auth.WithUser(ctx, owner), owner, revenue.ActionInput{
		RelationshipID: relationship.ID, ActionType: "proposal_nudge", Channel: "email",
		Reason: "Send proposal reminder", PriorityScore: 50,
	})
	if err != nil {
		t.Fatalf("create started recommendation: %v", err)
	}
	database.Client.RevenueAction.UpdateOneID(started.ID).SetExecutionStatus(revenue.ExecRequested).ExecX(auth.WithInternal(ctx))
	if _, err := tool.Invoke(ctx, scope, json.RawMessage(`{"recommendationId":"`+started.ID.String()+`","message":"Stop"}`)); err == nil {
		t.Fatal("recommendation.update accepted a started recommendation")
	}
	if _, err := tool.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: "wrong-owner"}, args); err == nil {
		t.Fatal("recommendation.update accepted a mismatched workflow owner")
	}
}
