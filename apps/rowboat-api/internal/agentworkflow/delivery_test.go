package agentworkflow

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentregistry"
	"go.temporal.io/sdk/activity"
)

// approvalDeliveryHarness wires capturing fakes for both channel-delivery
// activities and runs a single-turn slack session whose first model call invokes
// the given tool (at the given tier, HITL-enabled), auto-approving it. It returns
// the captured approval-button deliveries.
func approvalDeliveryHarness(t *testing.T, toolName, tier string) []DeliverApprovalRequestInput {
	t.Helper()
	h := newWFHarness(t)
	var (
		mu        sync.Mutex
		approvals []DeliverApprovalRequestInput
	)
	h.env.RegisterActivityWithOptions(
		func(_ context.Context, in DeliverApprovalRequestInput) error {
			mu.Lock()
			approvals = append(approvals, in)
			mu.Unlock()
			return nil
		},
		activity.RegisterOptions{Name: ActivityDeliverApprovalRequest},
	)
	h.env.RegisterActivityWithOptions(
		func(_ context.Context, _ DeliverChannelReplyInput) error { return nil },
		activity.RegisterOptions{Name: ActivityDeliverChannelReply},
	)
	h.llm = func(in LLMCompleteInput) LLMCompleteResult {
		if in.CallIndex == 0 {
			return toolCallMsg("c1", toolName, `{}`)
		}
		return finalMsg("done.")
	}
	state := baseState("do it", []ToolMeta{{Name: toolName, TrustTier: tier, Kind: agentregistry.KindTool}})
	state.Start.Channel = "slack"
	state.Start.HITLEnabled = true
	state.Start.InitiatorRef = "U_REQ"

	approvalID := ApprovalID(state.Start.SessionID, 0, 0)
	h.env.RegisterDelayedCallback(func() {
		h.env.UpdateWorkflowNoRejection(UpdateApproveAction, "u-appr", t, ApproveAction{
			ApprovalID: approvalID, Decision: "granted", ApprovalToken: "appr_validtoken123", ResolvedBy: "tester",
		})
	}, 10*time.Millisecond)

	h.env.ExecuteWorkflow(SessionWorkflow, state)
	if err := h.env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	return append([]DeliverApprovalRequestInput(nil), approvals...)
}

// TestApprovalButtonsDeliveredForActTier asserts an act-tier approval surfaces
// Slack buttons carrying the initiator (so only the requester can approve).
func TestApprovalButtonsDeliveredForActTier(t *testing.T) {
	got := approvalDeliveryHarness(t, "slack.post_message", agentregistry.TierAct)
	if len(got) != 1 {
		t.Fatalf("expected 1 approval-button delivery, got %d", len(got))
	}
	if got[0].InitiatorRef != "U_REQ" {
		t.Fatalf("initiator not threaded to delivery: %q", got[0].InitiatorRef)
	}
	if got[0].TrustTier != agentregistry.TierAct {
		t.Fatalf("tier = %q", got[0].TrustTier)
	}
}

// TestApprovalButtonsNotDeliveredForMoneyMoving asserts money-moving approvals do
// NOT get Slack buttons (a naked button can't carry the signed token, so the
// confirmation would be misleading) — they stay on the app/token path.
func TestApprovalButtonsNotDeliveredForMoneyMoving(t *testing.T) {
	got := approvalDeliveryHarness(t, "demo.payment", agentregistry.TierMoneyMoving)
	if len(got) != 0 {
		t.Fatalf("money-moving must not post Slack approval buttons, got %d", len(got))
	}
}

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
