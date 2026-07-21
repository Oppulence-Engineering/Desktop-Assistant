package agentworkflow

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentregistry"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"
)

// wfHarness wires the REAL session + subagent workflows against stub activities
// in a Temporal test environment. The workflow dispatches activities by the
// rowboat.agent.*.v1 name constants, so the stubs are registered by name — the
// Register-by-name mirror the RFC test plan calls for, kept in lockstep with
// Register (workflow.go).
type wfHarness struct {
	env *testsuite.TestWorkflowEnvironment

	mu     sync.Mutex
	events []AppendEventInput

	llm         func(in LLMCompleteInput) LLMCompleteResult
	validateErr error
}

func newWFHarness(t *testing.T) *wfHarness {
	t.Helper()
	var ts testsuite.WorkflowTestSuite
	h := &wfHarness{env: ts.NewTestWorkflowEnvironment()}
	h.env.SetTestTimeout(30 * time.Second)
	// Default LLM: end the turn immediately with a final message.
	h.llm = func(_ LLMCompleteInput) LLMCompleteResult {
		return finalMsg("done.")
	}

	h.env.RegisterWorkflowWithOptions(SessionWorkflow, workflow.RegisterOptions{Name: SessionWorkflowName})
	h.env.RegisterWorkflowWithOptions(SubagentWorkflow, workflow.RegisterOptions{Name: SubagentWorkflowName})

	reg := func(name string, fn interface{}) {
		h.env.RegisterActivityWithOptions(fn, activity.RegisterOptions{Name: name})
	}
	reg(ActivityLLMComplete, func(_ context.Context, in LLMCompleteInput) (LLMCompleteResult, error) {
		return h.llm(in), nil
	})
	reg(ActivityToolInvoke, func(_ context.Context, in ToolInvokeInput) (ToolInvokeResult, error) {
		a := &Activities{Catalog: agentregistry.DefaultCatalog()}
		return a.ToolInvoke(context.Background(), in)
	})
	reg(ActivityAppendSessionEvent, func(_ context.Context, in AppendEventInput) error {
		h.mu.Lock()
		h.events = append(h.events, in)
		h.mu.Unlock()
		return nil
	})
	reg(ActivityPersistSession, func(_ context.Context, _ SessionPatch) error { return nil })
	reg(ActivityPersistTurn, func(_ context.Context, _ TurnPatch) error { return nil })
	reg(ActivityPersistToolCall, func(_ context.Context, _ ToolCallAuditInput) error { return nil })
	reg(ActivityPersistApproval, func(_ context.Context, _ ApprovalInput) error { return nil })
	reg(ActivityResolveApproval, func(_ context.Context, _ ApprovalResolveInput) error { return nil })
	reg(ActivityValidateApproval, func(_ context.Context, _ ValidateApprovalInput) error {
		if h.validateErr != nil {
			return h.validateErr
		}
		// Token cryptography is covered by Activities tests. Workflow tests stub
		// a successful validation unless a case explicitly injects validateErr.
		return nil
	})
	reg(ActivityEnsureSession, func(_ context.Context, _ EnsureSessionInput) error { return nil })
	reg(ActivityResolveSubagent, func(_ context.Context, in ResolveSubagentInput) (SubagentSpec, error) {
		return SubagentSpec{
			Slug: in.ChildSlug, AgentSource: "builtin", Instructions: "subagent",
			Tools: []ToolMeta{{Name: "echo", TrustTier: agentregistry.TierRead, Kind: agentregistry.KindTool}},
		}, nil
	})
	return h
}

func (h *wfHarness) eventTypes() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]string, 0, len(h.events))
	for _, e := range h.events {
		out = append(out, e.EventType)
	}
	return out
}

func (h *wfHarness) hasEvent(t string) bool {
	for _, e := range h.eventTypes() {
		if e == t {
			return true
		}
	}
	return false
}

func finalMsg(content string) LLMCompleteResult {
	return LLMCompleteResult{
		Message:  backgroundtaskruntime.Message{Role: "assistant", Content: content},
		Provider: "test", Model: "test", InputTokens: 10, OutputTokens: 5, CostUnits: 15,
	}
}

func toolCallMsg(id, name, args string) LLMCompleteResult {
	return LLMCompleteResult{
		Message: backgroundtaskruntime.Message{Role: "assistant", ToolCalls: []backgroundtaskruntime.ToolCallRequest{
			{ID: id, Name: name, Arguments: []byte(args)},
		}},
		Provider: "test", Model: "test", InputTokens: 10, OutputTokens: 5, CostUnits: 15,
	}
}

func baseLimits() Limits {
	return Limits{
		MaxLLMCallsPerTurn: 6, MaxToolCallsPerTurn: 6, MaxWallclockPerTurn: 4 * time.Minute,
		MaxTurnsPerSession: 50, MaxLLMCallsPerSession: 200, MaxCostUnitsPerSession: 1_000_000,
		IdleTimeout: time.Hour, ContinueAsNewEveryTurns: 0, MaxSubagentDepth: 3, MaxSubagentFanout: 8,
	}
}

func baseState(firstTurn string, tools []ToolMeta) SessionState {
	st := SessionState{Start: SessionStart{
		UserID: "00000000-0000-0000-0000-000000000001", SessionID: "sess-test", AgentSlug: "assistant",
		AgentSource: "builtin", Channel: "http", Instructions: "be helpful", Model: "test",
		Tools: tools, Limits: baseLimits(),
	}}
	if firstTurn != "" {
		st.EnqueuedTurns = 1
		st.Pending = []TurnInput{{Seq: 0, Input: firstTurn}}
	}
	return st
}

// TestSessionWorkflowSingleTurnCompletes is the P1/replay gate: the real loop
// runs in workflow code, a single turn finalizes on a no-tool message, and the
// idle timeout then closes the session cleanly. The test env replays the
// workflow, so passing also asserts determinism (no time.Now/uuid/map-order
// leaking into workflow code).
func TestSessionWorkflowSingleTurnCompletes(t *testing.T) {
	h := newWFHarness(t)
	state := baseState("hello", []ToolMeta{{Name: "echo", TrustTier: agentregistry.TierRead, Kind: agentregistry.KindTool}})

	h.env.ExecuteWorkflow(SessionWorkflow, state)

	if !h.env.IsWorkflowCompleted() {
		t.Fatal("workflow did not complete")
	}
	if err := h.env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	for _, want := range []string{EventSessionStarted, EventTurnStarted, EventMessage, EventTurnCompleted, EventSessionCompleted} {
		if !h.hasEvent(want) {
			t.Fatalf("missing event %q; got %v", want, h.eventTypes())
		}
	}
}

// TestSessionWorkflowSubmitTurnViaUpdate is the P2 multi-turn gate: a session
// started with no seeded turn idles, then a submitTurn Update delivers a turn
// that the loop picks up, runs, and completes — after which the session idles to
// completion.
func TestSessionWorkflowSubmitTurnViaUpdate(t *testing.T) {
	h := newWFHarness(t)
	state := baseState("", []ToolMeta{{Name: "echo", TrustTier: agentregistry.TierRead, Kind: agentregistry.KindTool}})

	h.env.RegisterDelayedCallback(func() {
		h.env.UpdateWorkflowNoRejection(UpdateSubmitTurn, "u-turn", t, TurnInput{Input: "hello via update"})
	}, 10*time.Millisecond)

	h.env.ExecuteWorkflow(SessionWorkflow, state)

	if err := h.env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	if !h.hasEvent(EventTurnStarted) || !h.hasEvent(EventTurnCompleted) {
		t.Fatalf("submitted turn did not run; events: %v", h.eventTypes())
	}
}

// TestSessionWorkflowToolCallTurn exercises the reason→act loop: the model calls
// a read-tier tool (echo), the loop runs ToolInvoke as an activity, feeds the
// observation back, and the next model turn finalizes.
func TestSessionWorkflowToolCallTurn(t *testing.T) {
	h := newWFHarness(t)
	h.llm = func(in LLMCompleteInput) LLMCompleteResult {
		if in.CallIndex == 0 {
			return toolCallMsg("c1", "echo", `{"text":"hi"}`)
		}
		return finalMsg("used the tool and finished.")
	}
	state := baseState("use echo", []ToolMeta{{Name: "echo", TrustTier: agentregistry.TierRead, Kind: agentregistry.KindTool}})

	h.env.ExecuteWorkflow(SessionWorkflow, state)

	if err := h.env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	if !h.hasEvent(EventToolCallCompleted) {
		t.Fatalf("expected a completed tool call; got %v", h.eventTypes())
	}
}

// TestContinueAsNewByTurns is the history-bounding cadence: ContinueAsNew fires
// every N completed turns (and never before the first turn).
func TestContinueAsNewByTurns(t *testing.T) {
	if continueAsNewByTurns(0, 1) {
		t.Fatal("must not continue-as-new before any turn completes")
	}
	if !continueAsNewByTurns(1, 1) || !continueAsNewByTurns(20, 20) || !continueAsNewByTurns(40, 20) {
		t.Fatal("expected continue-as-new at the cadence boundary")
	}
	if continueAsNewByTurns(3, 20) {
		t.Fatal("must not continue-as-new mid-cadence")
	}
	if continueAsNewByTurns(5, 0) {
		t.Fatal("cadence 0 disables turn-based continue-as-new")
	}
}

// TestWorkflowIDStableAcrossSession asserts the session workflow id depends only
// on (user, session) — so it is stable across ContinueAsNew (only the run id
// changes) and the client's continuation token keeps resolving. Deterministic
// ids for turns/approvals/subagents are likewise content-derived.
func TestWorkflowIDStableAcrossSession(t *testing.T) {
	a := WorkflowID("user-1", "sess-1")
	if a != WorkflowID("user-1", "sess-1") {
		t.Fatal("workflow id must be stable for the same (user, session)")
	}
	if a == WorkflowID("user-1", "sess-2") {
		t.Fatal("different sessions must have different workflow ids")
	}
	if ApprovalID("sess-1", 0, 0) == ApprovalID("sess-1", 0, 1) {
		t.Fatal("approval ids must be unique per tool-call index")
	}
	if SubagentWorkflowID("u", "s", 1, 0) == SubagentWorkflowID("u", "s", 1, 1) {
		t.Fatal("subagent workflow ids must be unique per call index")
	}
}

func TestApprovalIDScopeValidation(t *testing.T) {
	st := baseState("hello", []ToolMeta{{Name: "demo.payment", TrustTier: agentregistry.TierMoneyMoving, Kind: agentregistry.KindTool}})
	e := &exec{state: &st}

	if err := e.validateApprovalID(ApprovalID(st.Start.SessionID, 0, 0)); err != nil {
		t.Fatalf("accepted turn approval rejected: %v", err)
	}
	if err := e.validateApprovalID(ApprovalID("other-session", 0, 0)); err == nil {
		t.Fatal("foreign approval id must be rejected")
	}
	if err := e.validateApprovalID(ApprovalID(st.Start.SessionID, 1, 0)); err == nil {
		t.Fatal("future turn approval id must be rejected")
	}
	if err := e.validateApprovalID(st.Start.SessionID + "/turn/not-a-number/approval/0"); err == nil {
		t.Fatal("malformed approval id must be rejected")
	}

	st.CompletedTurns = 1
	if err := e.validateApprovalID(ApprovalID(st.Start.SessionID, 0, 0)); err == nil {
		t.Fatal("completed turn approval id must be rejected")
	}
}

// TestSessionWorkflowHITLApproved is the P3 gate: a money-moving tool pauses on
// workflow.Await (zero worker slot); an approveAction Update carrying a valid
// X-Approval-Token resolves it; ValidateApproval passes; the tool then runs.
func TestSessionWorkflowHITLApproved(t *testing.T) {
	h := newWFHarness(t)
	h.llm = func(in LLMCompleteInput) LLMCompleteResult {
		if in.CallIndex == 0 {
			return toolCallMsg("c1", "demo.payment", `{"amount":10,"recipient":"acme"}`)
		}
		return finalMsg("payment sent.")
	}
	state := baseState("pay acme", []ToolMeta{{Name: "demo.payment", TrustTier: agentregistry.TierMoneyMoving, Kind: agentregistry.KindTool}})
	state.Start.HITLEnabled = true

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
	if !h.hasEvent(EventApprovalRequested) {
		t.Fatalf("expected approval_requested event; got %v", h.eventTypes())
	}
	if !h.hasEvent(EventApprovalResolved) {
		t.Fatalf("expected approval_resolved event; got %v", h.eventTypes())
	}
	if !h.hasEvent(EventToolCallCompleted) {
		t.Fatalf("expected the approved tool to run; got %v", h.eventTypes())
	}
}

// TestSessionWorkflowHITLInvalidToken asserts the validator rejects a money-moving
// grant whose X-Approval-Token is invalid: the action is treated as denied and
// the tool never runs.
func TestSessionWorkflowHITLInvalidToken(t *testing.T) {
	h := newWFHarness(t)
	h.validateErr = errors.New("invalid approval token")
	h.llm = func(in LLMCompleteInput) LLMCompleteResult {
		if in.CallIndex == 0 {
			return toolCallMsg("c1", "demo.payment", `{"amount":10,"recipient":"acme"}`)
		}
		return finalMsg("could not complete payment.")
	}
	state := baseState("pay acme", []ToolMeta{{Name: "demo.payment", TrustTier: agentregistry.TierMoneyMoving, Kind: agentregistry.KindTool}})
	state.Start.HITLEnabled = true

	approvalID := ApprovalID(state.Start.SessionID, 0, 0)
	h.env.RegisterDelayedCallback(func() {
		h.env.UpdateWorkflowNoRejection(UpdateApproveAction, "u-appr", t, ApproveAction{
			ApprovalID: approvalID, Decision: "granted", ApprovalToken: "bogus", ResolvedBy: "tester",
		})
	}, 10*time.Millisecond)

	h.env.ExecuteWorkflow(SessionWorkflow, state)

	if err := h.env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	if h.hasEvent(EventToolCallCompleted) {
		t.Fatalf("invalid token must not run the tool; events: %v", h.eventTypes())
	}
}

// TestSubagentDelegation is the P4 gate: the parent delegates via
// subagent.delegate, the child runs in isolation and returns a summary, which
// the parent folds back and finalizes.
func TestSubagentDelegation(t *testing.T) {
	h := newWFHarness(t)
	h.llm = func(in LLMCompleteInput) LLMCompleteResult {
		isChild := containsSub(in.SessionID)
		if isChild {
			return finalMsg("child summary: did the subtask.")
		}
		if in.CallIndex == 0 {
			return toolCallMsg("c1", "subagent.delegate", `{"agent":"assistant","task":"do the subtask"}`)
		}
		return finalMsg("parent finished using the subagent result.")
	}
	tools := []ToolMeta{{Name: "subagent.delegate", TrustTier: agentregistry.TierWrite, Kind: agentregistry.KindSubagent}}
	state := baseState("delegate something", tools)
	state.Start.SubagentsEnabled = true
	state.Start.SubagentRefs = []string{"assistant"}

	h.env.ExecuteWorkflow(SessionWorkflow, state)

	if err := h.env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	if !h.hasEvent(EventSubagentStarted) || !h.hasEvent(EventSubagentCompleted) {
		t.Fatalf("expected subagent lifecycle events; got %v", h.eventTypes())
	}
}

func containsSub(sessionID string) bool {
	for i := 0; i+4 <= len(sessionID); i++ {
		if sessionID[i:i+4] == "/sub" {
			return true
		}
	}
	return false
}
