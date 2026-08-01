package revenue

import (
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
)

func createLearningAction(t *testing.T, f *fixture, relID uuid.UUID, actionType, channel string, n int) uuid.UUID {
	t.Helper()
	action, err := f.svc.CreateAction(f.ctx, f.user, ActionInput{
		RelationshipID: relID, ActionType: actionType, Channel: channel,
		DedupeKey: fmt.Sprintf("learning:%s:%s:%d", actionType, channel, n),
		Reason:    "learning fixture", ProposedMessage: "reviewed recommendation", PriorityScore: 50,
	})
	if err != nil {
		t.Fatalf("create learning action: %v", err)
	}
	return action.ID
}

func TestOutcomeLearningShrinksSmallSamplesAndRewardsRepeatedBusinessResults(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 7, 31, 18, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	rel := f.relationship(t)
	firstID := createLearningAction(t, f, rel.ID, "warm_follow_up", "email", 0)
	if _, err := f.svc.AppendOutcome(f.ctx, f.user, firstID, OutcomeInput{
		Kind: "replied", Source: "gmail", SourceEventID: "reply-0", OccurredAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	ws, _ := f.svc.CurrentWorkspace(f.ctx, f.user)
	one, err := f.svc.outcomeLearningDetails(f.ctx, f.client, ws, "warm_follow_up", "email")
	if err != nil {
		t.Fatal(err)
	}
	if one.Lift != 2 || one.ExactSamples != 1 || one.PositiveSamples != 1 {
		t.Fatalf("one reply should have a small explainable lift: %+v", one)
	}
	for i := 1; i <= 5; i++ {
		id := createLearningAction(t, f, rel.ID, "warm_follow_up", "email", i)
		if _, err := f.svc.AppendOutcome(f.ctx, f.user, id, OutcomeInput{
			Kind: "won", Source: "crm", SourceEventID: fmt.Sprintf("won-%d", i), OccurredAt: now,
		}); err != nil {
			t.Fatal(err)
		}
	}
	many, err := f.svc.outcomeLearningDetails(f.ctx, f.client, ws, "warm_follow_up", "email")
	if err != nil {
		t.Fatal(err)
	}
	if many.Lift <= one.Lift || many.Lift > 15 || many.ExactSamples != 6 {
		t.Fatalf("repeated wins should increase but bound the lift: one=%+v many=%+v", one, many)
	}
}

func TestOutcomeLearningUsesDismissalsAndHierarchicalBackoff(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 7, 31, 19, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	rel := f.relationship(t)
	for i := 0; i < 5; i++ {
		id := createLearningAction(t, f, rel.ID, "proposal_nudge", "email", i)
		if _, err := f.svc.Dismiss(f.ctx, f.user, id, "not useful"); err != nil {
			t.Fatal(err)
		}
	}
	positiveID := createLearningAction(t, f, rel.ID, "warm_follow_up", "slack", 99)
	if _, err := f.svc.AppendOutcome(f.ctx, f.user, positiveID, OutcomeInput{
		Kind: "won", Source: "crm", SourceEventID: "won-slack", OccurredAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	ws, _ := f.svc.CurrentWorkspace(f.ctx, f.user)
	exactNegative, _ := f.svc.outcomeLearningDetails(f.ctx, f.client, ws, "proposal_nudge", "email")
	channelBackoff, _ := f.svc.outcomeLearningDetails(f.ctx, f.client, ws, "meeting_recap", "email")
	exactPositive, _ := f.svc.outcomeLearningDetails(f.ctx, f.client, ws, "warm_follow_up", "slack")
	if exactNegative.Lift >= 0 || exactPositive.Lift <= 0 {
		t.Fatalf("feedback direction was not learned: negative=%+v positive=%+v", exactNegative, exactPositive)
	}
	if channelBackoff.Lift >= 0 && exactNegative.Lift != 0 {
		// Channel-level negative history should carry at most a smaller negative
		// signal; other scope examples may shrink it to neutral.
		t.Fatalf("expected bounded channel backoff, exact=%+v channel=%+v", exactNegative, channelBackoff)
	}
	if absInt(channelBackoff.Lift) >= absInt(exactNegative.Lift) {
		t.Fatalf("backoff must be weaker than exact evidence: exact=%+v channel=%+v", exactNegative, channelBackoff)
	}
}

func absInt(value int) int {
	if value < 0 {
		return -value
	}
	return value
}
