package agentworkflow

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentregistry"
	"go.temporal.io/sdk/activity"
)

// TestSessionWorkflowSlackChannelDeliversReply asserts a slack-channel session
// invokes the channel-reply delivery activity with the turn's final assistant
// content (the CloudTag round-trip wiring).
func TestSessionWorkflowSlackChannelDeliversReply(t *testing.T) {
	h := newWFHarness(t)
	var (
		mu        sync.Mutex
		delivered []DeliverChannelReplyInput
	)
	h.env.RegisterActivityWithOptions(
		func(_ context.Context, in DeliverChannelReplyInput) error {
			mu.Lock()
			delivered = append(delivered, in)
			mu.Unlock()
			return nil
		},
		activity.RegisterOptions{Name: ActivityDeliverChannelReply},
	)
	h.llm = func(_ LLMCompleteInput) LLMCompleteResult { return finalMsg("here is your answer") }

	state := baseState("summarize this", []ToolMeta{{Name: "echo", TrustTier: agentregistry.TierRead, Kind: agentregistry.KindTool}})
	state.Start.Channel = "slack"

	h.env.ExecuteWorkflow(SessionWorkflow, state)
	if !h.env.IsWorkflowCompleted() {
		t.Fatal("workflow did not complete")
	}

	mu.Lock()
	defer mu.Unlock()
	if len(delivered) != 1 {
		t.Fatalf("expected 1 delivery, got %d", len(delivered))
	}
	if delivered[0].Text != "here is your answer" {
		t.Fatalf("delivered text = %q", delivered[0].Text)
	}
	if delivered[0].SessionID != state.Start.SessionID {
		t.Fatalf("delivered sessionId = %q, want %q", delivered[0].SessionID, state.Start.SessionID)
	}
}

// TestSessionWorkflowHTTPChannelNoDelivery asserts a non-Slack session adds no
// delivery activity to history — both a feature gate and a determinism guard
// (existing http/subagent/schedule sessions replay unchanged).
func TestSessionWorkflowHTTPChannelNoDelivery(t *testing.T) {
	h := newWFHarness(t)
	var calls int32
	h.env.RegisterActivityWithOptions(
		func(_ context.Context, _ DeliverChannelReplyInput) error {
			atomic.AddInt32(&calls, 1)
			return nil
		},
		activity.RegisterOptions{Name: ActivityDeliverChannelReply},
	)

	state := baseState("hi", []ToolMeta{{Name: "echo", TrustTier: agentregistry.TierRead, Kind: agentregistry.KindTool}})
	// Channel defaults to "http".

	h.env.ExecuteWorkflow(SessionWorkflow, state)
	if !h.env.IsWorkflowCompleted() {
		t.Fatal("workflow did not complete")
	}
	if got := atomic.LoadInt32(&calls); got != 0 {
		t.Fatalf("expected no delivery for http channel, got %d", got)
	}
}
