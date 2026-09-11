package agentregistry

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/revenue"
	"go.uber.org/zap"
)

func TestTaskCreateCapabilityUsesWorkspaceTaskModel(t *testing.T) {
	ctx, database, owner, relationship := newWriteToolFixture(t)

	capability, ok := DefaultCatalog().Get("task.create")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("task.create capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-task", TurnSeq: 4, ToolCallIndex: 2}
	args := json.RawMessage(`{"relationshipId":"` + relationship.ID.String() + `","title":"  Review renewal plan  ","dueAt":"2026-09-10T17:00:00Z"}`)
	out, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("task.create: %v", err)
	}
	if _, err := tool.Invoke(ctx, scope, args); err != nil {
		t.Fatalf("task.create retry: %v", err)
	}
	if !strings.Contains(string(out), `"status":"open"`) || !strings.Contains(string(out), `"priority":30`) {
		t.Fatalf("unexpected task.create output: %s", out)
	}
	stored := database.Client.RevenueAction.Query().OnlyX(auth.WithInternal(ctx))
	if stored.ActionType != "follow_up_task" || stored.Channel != "task" || stored.DedupeKey != "agent-task:run-task:4:2" || stored.Reason != "Review renewal plan" || stored.PriorityScore != 30 || stored.DueAt == nil {
		t.Fatalf("stored task does not match Tasks UI model: %+v", stored)
	}
	if _, err := tool.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: "wrong-owner"}, json.RawMessage(`{"relationshipId":"`+relationship.ID.String()+`","title":"Must not write"}`)); err == nil {
		t.Fatal("task.create accepted a mismatched workflow owner")
	}
	if got := database.Client.RevenueAction.Query().CountX(auth.WithInternal(ctx)); got != 1 {
		t.Fatalf("task count = %d, want 1", got)
	}
}

func TestTaskUpdateCapabilityUsesWorkspaceTaskLifecycle(t *testing.T) {
	ctx, database, owner, relationship := newWriteToolFixture(t)
	create := TaskCreateCapability().Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	dueAt := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Second)
	if _, err := create.Invoke(ctx, backgroundtaskruntime.ToolScope{
		UserID: owner.ID.String(), RunID: "run-update-create", TurnSeq: 1, ToolCallIndex: 0,
	}, json.RawMessage(`{"relationshipId":"`+relationship.ID.String()+`","title":"Review renewal","dueAt":"`+dueAt.Format(time.RFC3339)+`"}`)); err != nil {
		t.Fatalf("task.create: %v", err)
	}
	task := database.Client.RevenueAction.Query().OnlyX(auth.WithInternal(ctx))

	capability, ok := DefaultCatalog().Get("task.update")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("task.update capability = %+v, want internal write tier", capability)
	}
	update := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	args := json.RawMessage(`{"taskId":"` + task.ID.String() + `","title":"  Review revised renewal  ","dueAt":null,"priority":60}`)
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-update", TurnSeq: 2, ToolCallIndex: 0}
	out, err := update.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("task.update: %v", err)
	}
	retry, err := update.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("task.update retry: %v", err)
	}
	if !strings.Contains(string(out), `"title":"Review revised renewal"`) || !strings.Contains(string(retry), `"priority":60`) {
		t.Fatalf("unexpected task.update outputs: first=%s retry=%s", out, retry)
	}
	stored := database.Client.RevenueAction.GetX(auth.WithInternal(ctx), task.ID)
	if stored.Reason != "Review revised renewal" || stored.DueAt != nil || stored.PriorityScore != 60 || stored.Revision != 1 {
		t.Fatalf("updated task = %+v", stored)
	}
	if got := database.Client.RevenueActionRevision.Query().CountX(auth.WithInternal(ctx)); got != 1 {
		t.Fatalf("task metadata edit revision count = %d, want 1", got)
	}
	if _, err := update.Invoke(ctx, scope, json.RawMessage(`{"taskId":"`+task.ID.String()+`"}`)); err == nil {
		t.Fatal("task.update accepted an empty edit")
	}
	other, err := revenue.NewService(database.Client, nil, nil, zap.NewNop()).CreateAction(
		auth.WithUser(ctx, owner), owner, revenue.ActionInput{
			RelationshipID: relationship.ID, ActionType: "warm_follow_up", Channel: "email",
			Reason: "Send renewal note", PriorityScore: 30,
		},
	)
	if err != nil {
		t.Fatalf("create non-task action: %v", err)
	}
	if _, err := update.Invoke(ctx, scope, json.RawMessage(`{"taskId":"`+other.ID.String()+`","title":"Must not change"}`)); err == nil {
		t.Fatal("task.update accepted a non-task action")
	}
	if got := database.Client.RevenueAction.GetX(auth.WithInternal(ctx), other.ID).Reason; got != "Send renewal note" {
		t.Fatalf("non-task title = %q, want unchanged", got)
	}
	if _, err := update.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: "wrong-owner"}, args); err == nil {
		t.Fatal("task.update accepted a mismatched workflow owner")
	}
}

func TestNoteCreateCapabilityUsesWorkspaceNoteModel(t *testing.T) {
	ctx, database, owner, relationship := newWriteToolFixture(t)
	capability, ok := DefaultCatalog().Get("note.create")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("note.create capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-note", TurnSeq: 5, ToolCallIndex: 7}
	args := json.RawMessage(`{"relationshipId":"` + relationship.ID.String() + `","title":" Renewal context ","body":"Use the updated terms.","meetingLinked":true}`)
	out, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("note.create: %v", err)
	}
	retry, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("note.create retry: %v", err)
	}
	if !strings.Contains(string(out), `"duplicate":false`) || !strings.Contains(string(retry), `"duplicate":true`) {
		t.Fatalf("unexpected note.create outputs: first=%s retry=%s", out, retry)
	}
	stored := database.Client.RelationshipObservation.Query().OnlyX(auth.WithInternal(ctx))
	if stored.Source != "desktop_note" || stored.EventType != "note" || stored.ExternalID != "agent-note:run-note:5:7" || stored.Summary != "Renewal context" {
		t.Fatalf("stored note does not match Notes UI model: %+v", stored)
	}
	var facts map[string]any
	if err := json.Unmarshal([]byte(stored.NormalizedFactsJSON), &facts); err != nil {
		t.Fatalf("decode note facts: %v", err)
	}
	if facts["body"] != "Use the updated terms." || facts["meetingLinked"] != true || facts["liveLinked"] != true || facts["noteId"] == "" {
		t.Fatalf("stored note facts = %+v", facts)
	}
	if _, err := tool.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: "wrong-owner", RunID: "run-note"}, args); err == nil {
		t.Fatal("note.create accepted a mismatched workflow owner")
	}
	if got := database.Client.RelationshipObservation.Query().CountX(auth.WithInternal(ctx)); got != 1 {
		t.Fatalf("note count = %d, want 1", got)
	}
}

func TestNoteUpdateCapabilityPreservesUntouchedFieldsAndHistory(t *testing.T) {
	ctx, database, owner, relationship := newWriteToolFixture(t)
	service := revenue.NewService(database.Client, nil, nil, zap.NewNop())
	if _, err := service.IngestRelationshipObservationCandidates(auth.WithUser(ctx, owner), owner, []revenue.RelationshipObservationInput{{
		RelationshipID: relationship.ID, Source: "desktop_note", ExternalID: "seed-note",
		SourceVersion: "1", EventType: "note", Summary: "Original title",
		Facts: map[string]any{
			"noteId": "note-edit-1", "title": "Original title", "body": "Original body",
			"content":       []any{map[string]any{"type": "p", "children": []any{map[string]any{"text": "Original body"}}}},
			"meetingLinked": true, "liveLinked": false,
		},
	}}); err != nil {
		t.Fatalf("seed note: %v", err)
	}

	capability, ok := DefaultCatalog().Get("note.update")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("note.update capability = %+v, want internal write tier", capability)
	}
	tool := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-note-update", TurnSeq: 3, ToolCallIndex: 1}
	args := json.RawMessage(`{"noteId":"note-edit-1","title":" Updated title "}`)
	out, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("note.update: %v", err)
	}
	retry, err := tool.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("note.update retry: %v", err)
	}
	if !strings.Contains(string(out), `"duplicate":false`) || !strings.Contains(string(retry), `"duplicate":true`) {
		t.Fatalf("unexpected note.update outputs: first=%s retry=%s", out, retry)
	}
	updated := noteObservationByExternalID(t, database, "agent-note-update:run-note-update:3:1")
	var facts map[string]any
	if err := json.Unmarshal([]byte(updated.NormalizedFactsJSON), &facts); err != nil {
		t.Fatalf("decode updated note facts: %v", err)
	}
	if updated.Summary != "Updated title" || facts["body"] != "Original body" || facts["meetingLinked"] != true || facts["liveLinked"] != false || facts["content"] == nil {
		t.Fatalf("title-only update lost note fields: observation=%+v facts=%+v", updated, facts)
	}

	bodyScope := scope
	bodyScope.ToolCallIndex = 2
	if _, err := tool.Invoke(ctx, bodyScope, json.RawMessage(`{"noteId":"note-edit-1","body":"Replacement body"}`)); err != nil {
		t.Fatalf("note.update body: %v", err)
	}
	bodyUpdate := noteObservationByExternalID(t, database, "agent-note-update:run-note-update:3:2")
	facts = map[string]any{}
	if err := json.Unmarshal([]byte(bodyUpdate.NormalizedFactsJSON), &facts); err != nil {
		t.Fatalf("decode body update facts: %v", err)
	}
	if facts["body"] != "Replacement body" || facts["title"] != "Updated title" || facts["content"] != nil {
		t.Fatalf("body update retained stale rich content: %+v", facts)
	}
	if _, err := tool.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: "wrong-owner"}, args); err == nil {
		t.Fatal("note.update accepted a mismatched workflow owner")
	}
	if _, err := tool.Invoke(ctx, bodyScope, json.RawMessage(`{"noteId":"missing-note","title":"No write"}`)); err == nil {
		t.Fatal("note.update accepted an unknown note")
	}
	if got := database.Client.RelationshipObservation.Query().CountX(auth.WithInternal(ctx)); got != 3 {
		t.Fatalf("note observation count = %d, want 3", got)
	}
}

func TestNoteDeleteCapabilityUsesWorkspaceTombstone(t *testing.T) {
	ctx, database, owner, relationship := newWriteToolFixture(t)
	service := revenue.NewService(database.Client, nil, nil, zap.NewNop())
	if _, err := service.IngestRelationshipObservationCandidates(auth.WithUser(ctx, owner), owner, []revenue.RelationshipObservationInput{{
		RelationshipID: relationship.ID, Source: "desktop_note", ExternalID: "seed-delete-note",
		SourceVersion: "1", EventType: "note", Summary: "Delete this note",
		Facts: map[string]any{"noteId": "note-delete-1", "title": "Delete this note", "body": "Private context"},
	}}); err != nil {
		t.Fatalf("seed note: %v", err)
	}

	capability, ok := DefaultCatalog().Get("note.delete")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("note.delete capability = %+v, want internal write tier", capability)
	}
	remove := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-note-delete", TurnSeq: 6, ToolCallIndex: 2}
	args := json.RawMessage(`{"noteId":"note-delete-1"}`)
	out, err := remove.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("note.delete: %v", err)
	}
	retry, err := remove.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("note.delete retry: %v", err)
	}
	if !strings.Contains(string(out), `"alreadyDeleted":false`) || !strings.Contains(string(retry), `"alreadyDeleted":true`) || !strings.Contains(string(retry), `"duplicate":true`) {
		t.Fatalf("unexpected note.delete outputs: first=%s retry=%s", out, retry)
	}
	tombstone := noteObservationByExternalID(t, database, "agent-note-delete:run-note-delete:6:2")
	if tombstone.EventType != "note_deleted" || tombstone.Summary != "Delete this note" {
		t.Fatalf("note tombstone = %+v", tombstone)
	}
	var facts map[string]any
	if err := json.Unmarshal([]byte(tombstone.NormalizedFactsJSON), &facts); err != nil {
		t.Fatalf("decode tombstone facts: %v", err)
	}
	if facts["noteId"] != "note-delete-1" || facts["title"] != nil || facts["body"] != nil || facts["content"] != nil {
		t.Fatalf("tombstone facts = %+v", facts)
	}
	reader := RelationshipReadCapability().Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	visible, err := reader.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"view":"notes"}`))
	if err != nil {
		t.Fatalf("relationship.read notes: %v", err)
	}
	if strings.Contains(string(visible), "note-delete-1") {
		t.Fatalf("deleted note remained visible: %s", visible)
	}
	update := NoteUpdateCapability().Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	if _, err := update.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-update-deleted"}, json.RawMessage(`{"noteId":"note-delete-1","title":"Restore me"}`)); err == nil {
		t.Fatal("note.update accepted a deleted note")
	}
	if _, err := remove.Invoke(ctx, scope, json.RawMessage(`{"noteId":"missing-note"}`)); err == nil {
		t.Fatal("note.delete accepted an unknown note")
	}
	if _, err := remove.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: "wrong-owner"}, args); err == nil {
		t.Fatal("note.delete accepted a mismatched workflow owner")
	}
	if got := database.Client.RelationshipObservation.Query().CountX(auth.WithInternal(ctx)); got != 2 {
		t.Fatalf("note observation count = %d, want 2", got)
	}
}

func TestTaskCompleteCapabilityUsesWorkspaceTaskLifecycle(t *testing.T) {
	ctx, database, owner, relationship := newWriteToolFixture(t)
	create := TaskCreateCapability().Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	if _, err := create.Invoke(ctx, backgroundtaskruntime.ToolScope{
		UserID: owner.ID.String(), RunID: "run-create", TurnSeq: 1, ToolCallIndex: 0,
	}, json.RawMessage(`{"relationshipId":"`+relationship.ID.String()+`","title":"Finish renewal review"}`)); err != nil {
		t.Fatalf("task.create: %v", err)
	}
	task := database.Client.RevenueAction.Query().OnlyX(auth.WithInternal(ctx))

	capability, ok := DefaultCatalog().Get("task.complete")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("task.complete capability = %+v, want internal write tier", capability)
	}
	complete := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	args := json.RawMessage(`{"taskId":"` + task.ID.String() + `"}`)
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-complete", TurnSeq: 2, ToolCallIndex: 0}
	out, err := complete.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("task.complete: %v", err)
	}
	retry, err := complete.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("task.complete retry: %v", err)
	}
	if !strings.Contains(string(out), `"status":"completed"`) || !strings.Contains(string(retry), `"queueStatus":"dismissed"`) {
		t.Fatalf("unexpected task.complete outputs: first=%s retry=%s", out, retry)
	}
	stored := database.Client.RevenueAction.GetX(auth.WithInternal(ctx), task.ID)
	if stored.QueueStatus != revenue.QueueDismissed || stored.DismissReason != "Completed from Assistant" {
		t.Fatalf("completed task = %+v", stored)
	}
	if got := database.Client.ActionOutcome.Query().CountX(auth.WithInternal(ctx)); got != 1 {
		t.Fatalf("completion outcome count = %d, want 1", got)
	}

	other, err := revenue.NewService(database.Client, nil, nil, zap.NewNop()).CreateAction(
		auth.WithUser(ctx, owner), owner, revenue.ActionInput{
			RelationshipID: relationship.ID, ActionType: "warm_follow_up", Channel: "email",
			Reason: "Send renewal note", PriorityScore: 30,
		},
	)
	if err != nil {
		t.Fatalf("create non-task action: %v", err)
	}
	if _, err := complete.Invoke(ctx, scope, json.RawMessage(`{"taskId":"`+other.ID.String()+`"}`)); err == nil {
		t.Fatal("task.complete accepted a non-task action")
	}
	if got := database.Client.RevenueAction.GetX(auth.WithInternal(ctx), other.ID).QueueStatus; got != revenue.QueueOpen {
		t.Fatalf("non-task queue status = %q, want open", got)
	}
	if _, err := complete.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: "wrong-owner"}, args); err == nil {
		t.Fatal("task.complete accepted a mismatched workflow owner")
	}
}

func TestTaskSnoozeCapabilityUsesWorkspaceTaskLifecycle(t *testing.T) {
	ctx, database, owner, relationship := newWriteToolFixture(t)
	create := TaskCreateCapability().Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	if _, err := create.Invoke(ctx, backgroundtaskruntime.ToolScope{
		UserID: owner.ID.String(), RunID: "run-snooze-create", TurnSeq: 1, ToolCallIndex: 0,
	}, json.RawMessage(`{"relationshipId":"`+relationship.ID.String()+`","title":"Revisit renewal plan"}`)); err != nil {
		t.Fatalf("task.create: %v", err)
	}
	task := database.Client.RevenueAction.Query().OnlyX(auth.WithInternal(ctx))

	capability, ok := DefaultCatalog().Get("task.snooze")
	if !ok || capability.TrustTier != TierWrite || RequiresApproval(capability.TrustTier) {
		t.Fatalf("task.snooze capability = %+v, want internal write tier", capability)
	}
	snooze := capability.Build(ToolDeps{Client: database.Client, UserID: owner.ID.String()})
	until := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Second)
	args := json.RawMessage(`{"taskId":"` + task.ID.String() + `","until":"` + until.Format(time.RFC3339) + `"}`)
	scope := backgroundtaskruntime.ToolScope{UserID: owner.ID.String(), RunID: "run-snooze", TurnSeq: 2, ToolCallIndex: 0}
	out, err := snooze.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("task.snooze: %v", err)
	}
	retry, err := snooze.Invoke(ctx, scope, args)
	if err != nil {
		t.Fatalf("task.snooze retry: %v", err)
	}
	if !strings.Contains(string(out), `"status":"snoozed"`) || !strings.Contains(string(retry), until.Format(time.RFC3339)) {
		t.Fatalf("unexpected task.snooze outputs: first=%s retry=%s", out, retry)
	}
	stored := database.Client.RevenueAction.GetX(auth.WithInternal(ctx), task.ID)
	if stored.QueueStatus != revenue.QueueSnoozed || stored.SnoozedUntil == nil || !stored.SnoozedUntil.Equal(until) {
		t.Fatalf("snoozed task = %+v", stored)
	}
	if _, err := snooze.Invoke(ctx, scope, json.RawMessage(`{"taskId":"`+task.ID.String()+`","until":"`+until.Add(time.Hour).Format(time.RFC3339)+`"}`)); err == nil {
		t.Fatal("task.snooze changed an already snoozed task")
	}
	other, err := revenue.NewService(database.Client, nil, nil, zap.NewNop()).CreateAction(
		auth.WithUser(ctx, owner), owner, revenue.ActionInput{
			RelationshipID: relationship.ID, ActionType: "warm_follow_up", Channel: "email",
			Reason: "Send renewal note", PriorityScore: 30,
		},
	)
	if err != nil {
		t.Fatalf("create non-task action: %v", err)
	}
	if _, err := snooze.Invoke(ctx, scope, json.RawMessage(`{"taskId":"`+other.ID.String()+`","until":"`+until.Format(time.RFC3339)+`"}`)); err == nil {
		t.Fatal("task.snooze accepted a non-task action")
	}
	if got := database.Client.RevenueAction.GetX(auth.WithInternal(ctx), other.ID).QueueStatus; got != revenue.QueueOpen {
		t.Fatalf("non-task queue status = %q, want open", got)
	}
	if _, err := snooze.Invoke(ctx, backgroundtaskruntime.ToolScope{UserID: "wrong-owner"}, args); err == nil {
		t.Fatal("task.snooze accepted a mismatched workflow owner")
	}
}

func newWriteToolFixture(t *testing.T) (context.Context, *db.DB, *ent.User, *ent.Relationship) {
	t.Helper()
	ctx := context.Background()
	database, err := db.Open(ctx, appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	owner := database.Client.User.Create().SetEmail("owner@x.co").SetWorkosUserID("owner").SaveX(ctx)
	seedCtx := auth.WithInternal(ctx)
	workspace := database.Client.RevenueWorkspace.Create().SetUser(owner).SaveX(seedCtx)
	relationship := database.Client.Relationship.Create().SetWorkspace(workspace).SetUser(owner).
		SetKind("company").SetDisplayName("Owner Account").SaveX(seedCtx)
	return ctx, database, owner, relationship
}

func noteObservationByExternalID(t *testing.T, database *db.DB, externalID string) *ent.RelationshipObservation {
	t.Helper()
	for _, observation := range database.Client.RelationshipObservation.Query().AllX(auth.WithInternal(context.Background())) {
		if observation.ExternalID == externalID {
			return observation
		}
	}
	t.Fatalf("missing note observation %q", externalID)
	return nil
}
