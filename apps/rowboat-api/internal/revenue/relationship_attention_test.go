package revenue

import (
	"context"
	"fmt"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
)

func TestRelationshipAttentionRunnerPaginatesAllActiveWorkspaces(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 2, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	users := []*ent.User{f.user}
	for i := 1; i < 5; i++ {
		users = append(users, newUser(t, f.client, fmt.Sprintf("attention-%d@example.com", i), fmt.Sprintf("attention_%d", i)))
	}
	for i, owner := range users {
		ownerCtx := auth.WithUser(context.Background(), owner)
		rel, err := f.svc.CreateRelationship(ownerCtx, owner, RelationshipInput{
			Kind: "company", DisplayName: fmt.Sprintf("Account %d", i), AccountDomain: fmt.Sprintf("account-%d.example", i),
		})
		if err != nil {
			t.Fatal(err)
		}
		rel.Update().SetLifecycle("renewal").SetStateVersion(1).SaveX(ownerCtx)
	}

	runner := NewRelationshipAttentionRunner(f.svc, time.Hour, 2, zap.NewNop())
	runner.sweep(context.Background())

	count := f.client.RelationshipAttentionItem.Query().CountX(auth.WithInternalOnly(context.Background()))
	if count != len(users) {
		t.Fatalf("attention runner processed %d of %d workspaces", count, len(users))
	}
}

func TestRelationshipAttentionProjectionIsDeterministicAndMaterialChangesReopenTriage(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	rel := f.relationship(t)
	rel = rel.Update().
		SetLifecycle("evaluation").
		SetHealth("needs_attention").
		SetRisks([]string{"budget approval unresolved"}).
		SetLastTouchAt(now.Add(-35 * 24 * time.Hour)).
		SetStateVersion(4).
		SetResourceRefs([]string{"slack:channel:C123"}).
		SaveX(f.ctx)
	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	f.client.Commitment.Create().SetWorkspace(ws).SetRelationship(rel).SetUser(f.user).
		SetDirection("promised_by_me").SetText("Send revised proposal").SetStatus("open").
		SetDueAt(now.Add(-48 * time.Hour)).SetConfidence(1).SetUserConfirmed(true).SaveX(f.ctx)
	if _, err := f.svc.MarkSourceDisconnected(f.ctx, f.user, "slack", "C123"); err != nil {
		t.Fatal(err)
	}
	action, err := f.svc.CreateAction(f.ctx, f.user, ActionInput{
		RelationshipID: rel.ID, ActionType: "warm_follow_up", Channel: "email", Detector: DetectorManual,
		Reason: "A reviewed follow-up should be sent.", RecipientEmail: "buyer@example.com",
		PriorityScore: 75, PriorityParts: map[string]int{"evidence_quality": 30, "urgency": 45},
	})
	if err != nil {
		t.Fatal(err)
	}
	action, err = f.svc.GetAction(f.ctx, action.ID)
	if err != nil {
		t.Fatal(err)
	}
	action.Update().SetExecutionStatus(ExecAmbiguous).SetReconciliationStatus("manual_review").SaveX(f.ctx)

	if err := f.svc.RefreshRelationshipAttention(f.ctx, f.user); err != nil {
		t.Fatal(err)
	}
	items, err := f.svc.ListRelationshipAttention(f.ctx, f.user, "all", 100)
	if err != nil {
		t.Fatal(err)
	}
	byReason := map[string]bool{}
	for _, item := range items {
		byReason[item.ReasonCode] = true
		if item.MaterialHash == "" || item.RankFactorsJSON == "" || item.RelationshipStateVersion != 4 {
			t.Fatalf("incomplete attention contract: %+v", item)
		}
	}
	for _, reason := range []string{"overdue_commitment", "unresolved_risk", "source_degradation", "action_outcome_review"} {
		if !byReason[reason] {
			t.Fatalf("missing %s detector: %#v", reason, byReason)
		}
	}
	if byReason["quiet_account"] {
		t.Fatalf("stale required source produced a false quiet-account signal: %#v", byReason)
	}

	first := items[0]
	if _, err := f.svc.DecideRelationshipAttention(f.ctx, f.user, first.ID, AttentionDecisionInput{
		Decision: "dismiss", Reason: "Not useful for this unchanged state.", ExpectedVersion: first.Version,
	}); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.RefreshRelationshipAttention(f.ctx, f.user); err != nil {
		t.Fatal(err)
	}
	unchanged := f.client.RelationshipAttentionItem.GetX(f.ctx, first.ID)
	if unchanged.Status != "dismissed" || unchanged.Version != first.Version+1 {
		t.Fatalf("identical refresh erased triage: %+v", unchanged)
	}

	rel.Update().SetStateVersion(5).SaveX(f.ctx)
	if err := f.svc.RefreshRelationshipAttention(f.ctx, f.user); err != nil {
		t.Fatal(err)
	}
	reopened := f.client.RelationshipAttentionItem.GetX(f.ctx, first.ID)
	if reopened.Status != "open" || reopened.Version != first.Version+2 || reopened.RelationshipStateVersion != 5 {
		t.Fatalf("material state change did not reopen attention: %+v", reopened)
	}
}

func TestRelationshipAttentionDecisionUsesOptimisticVersioningAndBoundedSnooze(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 1, 13, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	f.relationship(t).Update().SetLifecycle("renewal").SetStateVersion(2).SaveX(f.ctx)
	if err := f.svc.RefreshRelationshipAttention(f.ctx, f.user); err != nil {
		t.Fatal(err)
	}
	items, err := f.svc.ListRelationshipAttention(f.ctx, f.user, "open", 20)
	if err != nil || len(items) == 0 {
		t.Fatalf("missing projected item: count=%d err=%v", len(items), err)
	}
	item := items[0]
	until := now.Add(24 * time.Hour)
	snoozed, err := f.svc.DecideRelationshipAttention(f.ctx, f.user, item.ID, AttentionDecisionInput{
		Decision: "snooze", ExpectedVersion: item.Version, SnoozedUntil: &until,
	})
	if err != nil || snoozed.Status != "snoozed" {
		t.Fatalf("snooze failed: item=%+v err=%v", snoozed, err)
	}
	if _, err := f.svc.DecideRelationshipAttention(f.ctx, f.user, item.ID, AttentionDecisionInput{
		Decision: "acknowledge", ExpectedVersion: item.Version,
	}); err != ErrConflict {
		t.Fatalf("stale decision should conflict: %v", err)
	}
}
