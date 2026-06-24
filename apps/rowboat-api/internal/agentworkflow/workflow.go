// Package agentworkflow is the durable, multi-tenant agent runtime (RFC 027):
// a Temporal/Go analogue of eve. Its single architectural move is lifting the
// reason→act loop out of one activity (RFC 004's ExecuteAPITask) and INTO
// workflow code, so each LLM call and each tool call is its own checkpointed
// activity recorded in Temporal history — yielding per-step durability,
// resume-exactly-where-stopped, multi-turn idle-between-turns sessions, and
// indefinite zero-cost human-in-the-loop pauses.
//
// Determinism is the contract: the loop, transcript accumulation, budget
// counting, and child-workflow orchestration run in workflow code (replayed,
// never re-executed); every LLM call, tool execution, DB read/write, and
// credential resolution runs in an activity. workflow.Now is used for time;
// ids are derived deterministically; no time.Now/uuid/map-iteration drives
// control flow here.
package agentworkflow

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentregistry"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

// Activity timeouts. The per-call StartToCloseTimeout stays below the 5m
// platform activity ceiling and below MaxWallclockPerTurn (the RFC 004 duration
// coupling, re-applied per turn).
const (
	ioActivityTimeout         = 4 * time.Minute
	projectionActivityTimeout = 30 * time.Second
)

// Register installs the session + subagent workflows and all activities on a
// Temporal worker. The replay/integration test env mirrors these registrations
// by name — keep the two lists in lockstep.
func Register(w worker.Worker, a *Activities) {
	w.RegisterWorkflowWithOptions(SessionWorkflow, workflow.RegisterOptions{Name: SessionWorkflowName})
	w.RegisterWorkflowWithOptions(SubagentWorkflow, workflow.RegisterOptions{Name: SubagentWorkflowName})

	w.RegisterActivityWithOptions(a.LLMComplete, activityOpts(ActivityLLMComplete))
	w.RegisterActivityWithOptions(a.ToolInvoke, activityOpts(ActivityToolInvoke))
	w.RegisterActivityWithOptions(a.AppendSessionEvent, activityOpts(ActivityAppendSessionEvent))
	w.RegisterActivityWithOptions(a.PersistSession, activityOpts(ActivityPersistSession))
	w.RegisterActivityWithOptions(a.PersistTurn, activityOpts(ActivityPersistTurn))
	w.RegisterActivityWithOptions(a.PersistToolCall, activityOpts(ActivityPersistToolCall))
	w.RegisterActivityWithOptions(a.PersistApproval, activityOpts(ActivityPersistApproval))
	w.RegisterActivityWithOptions(a.ResolveApproval, activityOpts(ActivityResolveApproval))
	w.RegisterActivityWithOptions(a.ValidateApproval, activityOpts(ActivityValidateApproval))
	w.RegisterActivityWithOptions(a.EnsureSession, activityOpts(ActivityEnsureSession))
	w.RegisterActivityWithOptions(a.ResolveSubagent, activityOpts(ActivityResolveSubagent))
	w.RegisterActivityWithOptions(a.DeliverChannelReply, activityOpts(ActivityDeliverChannelReply))
	w.RegisterActivityWithOptions(a.DeliverApprovalRequest, activityOpts(ActivityDeliverApprovalRequest))
}

func activityOpts(name string) activity.RegisterOptions {
	return activity.RegisterOptions{Name: name}
}

// approvalGate is the in-workflow rendezvous for one HITL pause. It is transient
// within a turn (a turn fully resolves its approvals before completing, so gates
// never cross ContinueAsNew); on replay it is rebuilt and the approveAction
// Update replays into it.
type approvalGate struct {
	resolved   bool
	decision   string
	token      string
	resolvedBy string
}

// exec bundles the per-run workflow execution context so the loop helpers don't
// thread a dozen parameters. state is mutated in place (workflow code is
// single-threaded, so Updates/Signals and the loop share it without races).
type exec struct {
	state          *SessionState
	ioCtx          workflow.Context // LLM/tool/child activities
	projCtx        workflow.Context // projection + event activities
	approvals      map[string]*approvalGate
	closeRequested bool
	closeReason    string
	fanoutThisTurn int // subagent delegations in the current turn (fan-out cap)
}

// SessionWorkflow is the long-lived, idle-between-turns session (RFC 027
// rowboat.agent.session.v1). It accepts validated turns via the submitTurn
// Update, runs each turn's reason→act loop in workflow code, idles at zero cost
// between turns, and ContinueAsNews to bound history — all under a stable
// workflow id the client's continuation token resolves.
func SessionWorkflow(ctx workflow.Context, state SessionState) error {
	e := &exec{
		state:     &state,
		ioCtx:     workflow.WithActivityOptions(ctx, ioActivityOptions()),
		projCtx:   workflow.WithActivityOptions(ctx, projectionActivityOptions()),
		approvals: map[string]*approvalGate{},
	}
	if err := e.registerHandlers(ctx); err != nil {
		return err
	}

	// First run of this session workflow id (EventSeq 0 ⇒ never emitted): bind
	// Temporal ids, mark the projection started, and emit session_started. A run
	// resumed via ContinueAsNew skips this (its state already reflects it).
	if state.EventSeq == 0 {
		info := workflow.GetInfo(ctx)
		_ = workflow.ExecuteActivity(e.projCtx, ActivityEnsureSession, EnsureSessionInput{
			Start:              state.Start,
			TemporalWorkflowID: info.WorkflowExecution.ID,
			TemporalRunID:      info.WorkflowExecution.RunID,
		}).Get(ctx, nil)
		if err := e.emit(ctx, nil, EventSessionStarted, map[string]any{
			"sessionId": state.Start.SessionID, "agent": state.Start.AgentSlug,
		}); err != nil {
			return err
		}
	}

	for {
		ok, err := workflow.AwaitWithTimeout(ctx, state.Start.Limits.IdleTimeout, func() bool {
			return len(state.Pending) > 0 || e.closeRequested
		})
		if err != nil {
			// Workflow cancellation: write the terminal projection on a detached
			// context so it lands even though ctx is already canceled.
			e.closeOnCancel(ctx, "canceled")
			return err
		}
		if !ok {
			// Idle timeout: a session that has gone quiet completes cleanly.
			e.finishSession(ctx, "completed", EventSessionCompleted, "idle_timeout", "")
			return nil
		}
		if e.closeRequested {
			status, event := closeStatus(e.closeReason)
			e.finishSession(ctx, status, event, e.closeReason, "")
			return nil
		}

		next := state.Pending[0]
		state.Pending = state.Pending[1:]

		res := e.runTurn(ctx, next)
		state.CompletedTurns++
		state.CumLLMCalls += res.LLMCalls
		state.CumToolCalls += res.ToolCalls
		state.CumCostUnits += res.CostUnits
		state.Summaries = append(state.Summaries, TurnSummary{Seq: next.Seq, Input: next.Input, Summary: res.Summary})

		// Mirror cumulative counters to the projection.
		_ = workflow.ExecuteActivity(e.projCtx, ActivityPersistSession, SessionPatch{
			UserID: state.Start.UserID, SessionID: state.Start.SessionID,
			SetCounters: true, TurnCount: state.CompletedTurns, LLMCallCount: state.CumLLMCalls,
			ToolCallCount: state.CumToolCalls, CostUnits: state.CumCostUnits, TouchActivity: true,
		}).Get(ctx, nil)

		if res.SessionLimitHit {
			e.finishSession(ctx, "failed", EventSessionFailed, "session_limit_exceeded", res.LimitError)
			return nil
		}

		// ContinueAsNew bounds Temporal history: carry compacted state (summaries
		// + counters), not the full transcript. The workflow id is stable, so the
		// client's continuation token keeps resolving across the new run id.
		if e.shouldContinueAsNew(ctx) {
			return workflow.NewContinueAsNewError(ctx, state.compact())
		}
	}
}

// registerHandlers installs the submitTurn / approveAction Updates and the
// control Signal drain.
func (e *exec) registerHandlers(ctx workflow.Context) error {
	st := e.state

	err := workflow.SetUpdateHandlerWithOptions(ctx, UpdateSubmitTurn,
		func(_ workflow.Context, in TurnInput) (TurnAck, error) {
			seq := st.EnqueuedTurns
			st.EnqueuedTurns++
			st.Pending = append(st.Pending, TurnInput{Seq: seq, Input: in.Input})
			return TurnAck{Accepted: true, TurnSeq: seq}, nil
		},
		workflow.UpdateHandlerOptions{
			Validator: func(_ workflow.Context, in TurnInput) error {
				if e.closeRequested {
					return errors.New("session is closing")
				}
				if strings.TrimSpace(in.Input) == "" {
					return errors.New("turn input is required")
				}
				if max := st.Start.Limits.MaxTurnsPerSession; max > 0 && st.CompletedTurns+len(st.Pending) >= max {
					return fmt.Errorf("session turn limit (%d) reached", max)
				}
				return nil
			},
		})
	if err != nil {
		return err
	}

	err = workflow.SetUpdateHandlerWithOptions(ctx, UpdateApproveAction,
		func(_ workflow.Context, in ApproveAction) (TurnAck, error) {
			gate := e.approvals[in.ApprovalID]
			gate.resolved = true
			gate.decision = in.Decision
			gate.token = in.ApprovalToken
			gate.resolvedBy = in.ResolvedBy
			return TurnAck{Accepted: true}, nil
		},
		workflow.UpdateHandlerOptions{
			Validator: func(_ workflow.Context, in ApproveAction) error {
				gate, ok := e.approvals[in.ApprovalID]
				if !ok {
					return fmt.Errorf("unknown approval %q", in.ApprovalID)
				}
				if gate.resolved {
					return fmt.Errorf("approval %q already resolved", in.ApprovalID)
				}
				if in.Decision != "granted" && in.Decision != "denied" {
					return errors.New("decision must be granted or denied")
				}
				return nil
			},
		})
	if err != nil {
		return err
	}

	// Drain SignalControl so cancel/pause are received from history. cancel is a
	// graceful close (the loop finishes its current step, then writes the
	// terminal projection); pause is logged but not yet honored (v1).
	workflow.Go(ctx, func(gctx workflow.Context) {
		ch := workflow.GetSignalChannel(gctx, SignalControl)
		for {
			var msg ControlSignal
			if !ch.Receive(gctx, &msg) {
				return
			}
			switch msg.Signal {
			case "cancel":
				e.closeRequested = true
				e.closeReason = "canceled"
			case "pause":
				workflow.GetLogger(gctx).Info("agent session pause signal (not yet honored)", "sessionId", st.Start.SessionID)
			}
		}
	})
	return nil
}

// turnResult is the outcome of one reason→act turn.
type turnResult struct {
	Summary         string
	FinishReason    string
	LLMCalls        int
	ToolCalls       int
	CostUnits       int
	SessionLimitHit bool
	LimitError      string
}

// runTurn is the reason→act loop, lifted into workflow code. It is structurally
// the RFC 004 DefaultRuntime.Execute loop — same deny-by-default lookup, same
// truncated tool results — but each LLMComplete/ToolInvoke is now a checkpointed
// activity recorded in history.
func (e *exec) runTurn(ctx workflow.Context, turn TurnInput) turnResult {
	st := e.state
	limits := st.Start.Limits
	turnSeq := turn.Seq

	_ = workflow.ExecuteActivity(e.projCtx, ActivityPersistTurn, TurnPatch{
		UserID: st.Start.UserID, SessionID: st.Start.SessionID, Seq: turnSeq,
		Input: turn.Input, Status: "running", Start: true,
	}).Get(ctx, nil)
	_ = e.emit(ctx, &turnSeq, EventTurnStarted, map[string]any{"turn": turnSeq, "input": backgroundtaskruntime.Truncate(turn.Input, 500)})

	transcript := seedTranscript(st.Start, st.Summaries, turn.Input)
	turnStart := workflow.Now(ctx)
	res := turnResult{FinishReason: "incomplete"}

	for call := 0; call < limits.MaxLLMCallsPerTurn; call++ {
		// Per-turn wall clock (deterministic deadline check between steps; the
		// per-call activity StartToCloseTimeout bounds a single in-flight call).
		if workflow.Now(ctx).Sub(turnStart) >= limits.MaxWallclockPerTurn {
			res.FinishReason = "wallclock_exceeded"
			res.Summary = e.finalizeLimit(ctx, turnSeq, "duration")
			return res
		}
		// Per-session ceilings (cumulative across turns, carried over ContinueAsNew).
		if limits.MaxLLMCallsPerSession > 0 && st.CumLLMCalls+res.LLMCalls >= limits.MaxLLMCallsPerSession {
			return e.sessionLimit(ctx, res, turnSeq, "llm_calls")
		}
		if limits.MaxCostUnitsPerSession > 0 && st.CumCostUnits+res.CostUnits >= limits.MaxCostUnitsPerSession {
			return e.sessionLimit(ctx, res, turnSeq, "cost_units")
		}

		_ = e.emit(ctx, &turnSeq, EventLLMCallStarted, map[string]any{"turn": turnSeq, "callIndex": call, "model": st.Start.Model})
		var llmRes LLMCompleteResult
		err := workflow.ExecuteActivity(e.ioCtx, ActivityLLMComplete, LLMCompleteInput{
			UserID: st.Start.UserID, SessionID: st.Start.SessionID, AgentSlug: st.Start.AgentSlug,
			TurnSeq: turnSeq, CallIndex: call, Model: st.Start.Model, Provider: st.Start.Provider,
			ToolNames: toolNames(st.Start.Tools), Messages: transcript,
		}).Get(ctx, &llmRes)
		if err != nil {
			res.FinishReason = "llm_error"
			res.Summary = "The turn failed during a model call."
			e.failTurn(ctx, turnSeq, err.Error())
			return res
		}
		res.LLMCalls++
		res.CostUnits += llmRes.CostUnits
		_ = e.emit(ctx, &turnSeq, EventLLMCallCompleted, map[string]any{
			"turn": turnSeq, "callIndex": call, "provider": llmRes.Provider,
			"inputTokens": llmRes.InputTokens, "outputTokens": llmRes.OutputTokens,
		})
		transcript = append(transcript, llmRes.Message)

		if len(llmRes.Message.ToolCalls) == 0 {
			res.FinishReason = "stop"
			res.Summary = firstLine(llmRes.Message.Content, 200)
			_ = e.emit(ctx, &turnSeq, EventMessage, map[string]any{"turn": turnSeq, "content": llmRes.Message.Content})
			e.completeTurn(ctx, turnSeq, res)
			e.deliverChannelReply(ctx, llmRes.Message.Content)
			return res
		}

		for _, tc := range llmRes.Message.ToolCalls {
			if limits.MaxToolCallsPerTurn > 0 && res.ToolCalls >= limits.MaxToolCallsPerTurn {
				res.FinishReason = "tool_budget_exceeded"
				res.Summary = e.finalizeLimit(ctx, turnSeq, "tool_calls")
				return res
			}
			res.ToolCalls++
			observation, cost := e.handleToolCall(ctx, turnSeq, res.ToolCalls-1, tc)
			res.CostUnits += cost
			transcript = appendToolResult(transcript, tc.ID, observation)
		}
	}

	res.FinishReason = "llm_budget_exceeded"
	res.Summary = e.finalizeLimit(ctx, turnSeq, "llm_calls")
	return res
}

// handleToolCall dispatches one tool call: hallucinated/denied → observation;
// subagent → child workflow; approval-tier → HITL pause; else → ToolInvoke.
// Returns the observation string fed back to the model and any cost it incurred.
func (e *exec) handleToolCall(ctx workflow.Context, turnSeq, callIndex int, tc backgroundtaskruntime.ToolCallRequest) (string, int) {
	st := e.state
	meta, ok := st.Start.findTool(tc.Name)
	if !ok {
		_ = e.emit(ctx, &turnSeq, EventToolDenied, map[string]any{"turn": turnSeq, "tool": tc.Name, "reason": "not on the allowlist for this session"})
		return fmt.Sprintf(`{"error":"tool %q is not available"}`, tc.Name), 0
	}

	if meta.Kind == agentregistry.KindSubagent {
		if !st.Start.SubagentsEnabled {
			_ = e.emit(ctx, &turnSeq, EventToolDenied, map[string]any{"turn": turnSeq, "tool": tc.Name, "reason": "subagents disabled"})
			return `{"error":"subagents are not enabled"}`, 0
		}
		return e.handleSubagent(ctx, turnSeq, callIndex, tc), 0
	}

	if agentregistry.RequiresApproval(meta.TrustTier) {
		if !st.Start.HITLEnabled {
			_ = e.emit(ctx, &turnSeq, EventToolDenied, map[string]any{"turn": turnSeq, "tool": tc.Name, "reason": "tool requires approval but HITL is disabled"})
			return `{"error":"this action requires human approval, which is not enabled"}`, 0
		}
		granted, tokenRef := e.awaitApproval(ctx, turnSeq, callIndex, tc, meta)
		if !granted {
			return `{"error":"the action was not approved"}`, 0
		}
		_ = tokenRef
	}

	_ = e.emit(ctx, &turnSeq, EventToolCallStarted, map[string]any{"turn": turnSeq, "callIndex": callIndex, "tool": tc.Name})
	_ = workflow.ExecuteActivity(e.projCtx, ActivityPersistToolCall, ToolCallAuditInput{
		UserID: st.Start.UserID, SessionID: st.Start.SessionID, TurnSeq: turnSeq, CallIndex: callIndex,
		ToolName: tc.Name, ArgsJSON: redactArgsJSON(tc.Arguments), TrustTier: meta.TrustTier, Status: "running",
	}).Get(ctx, nil)

	var invoke ToolInvokeResult
	err := workflow.ExecuteActivity(e.ioCtx, ActivityToolInvoke, ToolInvokeInput{
		UserID: st.Start.UserID, SessionID: st.Start.SessionID, TurnSeq: turnSeq, CallIndex: callIndex,
		ToolName: tc.Name, Args: tc.Arguments, AllowedTools: toolNames(st.Start.Tools),
	}).Get(ctx, &invoke)
	if err != nil {
		_ = e.emit(ctx, &turnSeq, EventToolCallCompleted, map[string]any{"turn": turnSeq, "callIndex": callIndex, "tool": tc.Name, "error": backgroundtaskruntime.Truncate(err.Error(), 300)})
		e.auditToolCall(ctx, turnSeq, callIndex, tc.Name, meta.TrustTier, "failed", 0, backgroundtaskruntime.CodeToolInvokeFailed)
		return fmt.Sprintf(`{"error":%q}`, backgroundtaskruntime.Truncate(err.Error(), 300)), 0
	}
	switch {
	case invoke.Denied:
		_ = e.emit(ctx, &turnSeq, EventToolDenied, map[string]any{"turn": turnSeq, "tool": tc.Name, "reason": "denied by registry"})
		e.auditToolCall(ctx, turnSeq, callIndex, tc.Name, meta.TrustTier, "denied", 0, invoke.ErrorCode)
	case invoke.Failed:
		_ = e.emit(ctx, &turnSeq, EventToolCallCompleted, map[string]any{"turn": turnSeq, "callIndex": callIndex, "tool": tc.Name, "errorCode": invoke.ErrorCode})
		e.auditToolCall(ctx, turnSeq, callIndex, tc.Name, meta.TrustTier, "failed", invoke.ResultBytes, invoke.ErrorCode)
	default:
		_ = e.emit(ctx, &turnSeq, EventToolCallCompleted, map[string]any{"turn": turnSeq, "callIndex": callIndex, "tool": tc.Name, "resultBytes": invoke.ResultBytes})
		e.auditToolCall(ctx, turnSeq, callIndex, tc.Name, meta.TrustTier, "completed", invoke.ResultBytes, "")
	}
	return invoke.ResultJSON, 0
}

// awaitApproval persists a pending approval, emits agent.approval_requested, and
// blocks on workflow.Await — indefinitely, consuming no worker slot — until the
// approveAction Update resolves it. A granted decision is then verified by
// ActivityValidateApproval (RFC 012 token/MFA); an invalid token is rejected and
// the action treated as denied.
func (e *exec) awaitApproval(ctx workflow.Context, turnSeq, callIndex int, tc backgroundtaskruntime.ToolCallRequest, meta ToolMeta) (bool, string) {
	st := e.state
	approvalID := ApprovalID(st.Start.SessionID, turnSeq, callIndex)
	redacted := redactArgsJSON(tc.Arguments)

	_ = workflow.ExecuteActivity(e.projCtx, ActivityPersistApproval, ApprovalInput{
		UserID: st.Start.UserID, SessionID: st.Start.SessionID, ApprovalID: approvalID,
		TurnSeq: turnSeq, ToolCallIndex: callIndex, ToolName: tc.Name, TrustTier: meta.TrustTier, ArgsRedacted: redacted,
	}).Get(ctx, nil)
	_ = e.emit(ctx, &turnSeq, EventApprovalRequested, map[string]any{
		"turn": turnSeq, "approvalId": approvalID, "tool": tc.Name, "trustTier": meta.TrustTier, "args": redactedMap(tc.Arguments),
	})
	// Surface the approval as Approve/Deny buttons in the originating Slack
	// thread (RFC 027 HITL in Slack). Guarded on the channel so non-slack
	// sessions add no activity to history (replay-safe); the result is ignored so
	// a delivery outage never blocks the gate (it still resolves via the HTTP
	// approval path). Money-moving still needs the signed token, which a naked
	// button cannot supply — so buttons grant act-tier only.
	if e.state.Start.Channel == "slack" {
		_ = workflow.ExecuteActivity(e.ioCtx, ActivityDeliverApprovalRequest, DeliverApprovalRequestInput{
			UserID: st.Start.UserID, SessionID: st.Start.SessionID, ApprovalID: approvalID,
			Tool: tc.Name, TrustTier: meta.TrustTier, ArgsPreview: backgroundtaskruntime.Truncate(redacted, 300),
		}).Get(ctx, nil)
	}

	gate := &approvalGate{}
	e.approvals[approvalID] = gate
	// Zero-cost indefinite pause: the worker holds no slot while blocked.
	_ = workflow.Await(ctx, func() bool { return gate.resolved })

	if gate.decision != "granted" {
		_ = workflow.ExecuteActivity(e.projCtx, ActivityResolveApproval, ApprovalResolveInput{
			UserID: st.Start.UserID, SessionID: st.Start.SessionID, ApprovalID: approvalID, Status: "denied", ResolvedBy: gate.resolvedBy,
		}).Get(ctx, nil)
		_ = e.emit(ctx, &turnSeq, EventApprovalResolved, map[string]any{"turn": turnSeq, "approvalId": approvalID, "decision": "denied"})
		return false, ""
	}

	// Verify the token / MFA step-up for the grant (RFC 012), bound to this gate.
	verr := workflow.ExecuteActivity(e.ioCtx, ActivityValidateApproval, ValidateApprovalInput{
		UserID: st.Start.UserID, SessionID: st.Start.SessionID, ApprovalID: approvalID,
		TrustTier: meta.TrustTier, ApprovalToken: gate.token,
	}).Get(ctx, nil)
	if verr != nil {
		_ = workflow.ExecuteActivity(e.projCtx, ActivityResolveApproval, ApprovalResolveInput{
			UserID: st.Start.UserID, SessionID: st.Start.SessionID, ApprovalID: approvalID, Status: "denied", ResolvedBy: gate.resolvedBy,
		}).Get(ctx, nil)
		_ = e.emit(ctx, &turnSeq, EventApprovalResolved, map[string]any{"turn": turnSeq, "approvalId": approvalID, "decision": "denied", "reason": "invalid_approval_token"})
		return false, ""
	}

	tokenRef := approvalTokenRef(gate.token)
	_ = workflow.ExecuteActivity(e.projCtx, ActivityResolveApproval, ApprovalResolveInput{
		UserID: st.Start.UserID, SessionID: st.Start.SessionID, ApprovalID: approvalID, Status: "granted",
		ApprovalToken: tokenRef, ResolvedBy: gate.resolvedBy,
	}).Get(ctx, nil)
	_ = e.emit(ctx, &turnSeq, EventApprovalResolved, map[string]any{"turn": turnSeq, "approvalId": approvalID, "decision": "granted"})
	return true, tokenRef
}

// handleSubagent dispatches a delegation to a child workflow with an isolated
// context + narrowed tools (RFC 018), bounded by depth and per-turn fan-out, and
// folds the compact summary back as the tool observation. The child runs under a
// cancelable context so the parent can cancel one subagent without dying.
func (e *exec) handleSubagent(ctx workflow.Context, turnSeq, callIndex int, tc backgroundtaskruntime.ToolCallRequest) string {
	st := e.state
	var args struct {
		Agent string `json:"agent"`
		Task  string `json:"task"`
	}
	_ = jsonUnmarshal(tc.Arguments, &args)
	if args.Agent == "" || args.Task == "" {
		return `{"error":"subagent.delegate requires 'agent' and 'task'"}`
	}
	if st.Start.Depth >= st.Start.Limits.MaxSubagentDepth {
		_ = e.emit(ctx, &turnSeq, EventToolDenied, map[string]any{"turn": turnSeq, "tool": tc.Name, "reason": "max delegation depth"})
		return `{"error":"maximum subagent delegation depth reached"}`
	}
	e.fanoutThisTurn++
	if st.Start.Limits.MaxSubagentFanout > 0 && e.fanoutThisTurn > st.Start.Limits.MaxSubagentFanout {
		_ = e.emit(ctx, &turnSeq, EventToolDenied, map[string]any{"turn": turnSeq, "tool": tc.Name, "reason": "subagent fan-out cap"})
		return `{"error":"subagent fan-out limit reached for this turn"}`
	}

	childSessionID := fmt.Sprintf("%s/sub/%d/%d", st.Start.SessionID, turnSeq, callIndex)
	_ = e.emit(ctx, &turnSeq, EventSubagentStarted, map[string]any{"turn": turnSeq, "agent": args.Agent, "childSessionId": childSessionID})

	childCtx, cancelChild := workflow.WithCancel(ctx)
	defer cancelChild()
	cwo := workflow.ChildWorkflowOptions{
		WorkflowID:        SubagentWorkflowID(st.Start.UserID, st.Start.SessionID, turnSeq, callIndex),
		ParentClosePolicy: enums.PARENT_CLOSE_POLICY_REQUEST_CANCEL,
	}
	childCtx = workflow.WithChildOptions(childCtx, cwo)

	var result SubagentResult
	err := workflow.ExecuteChildWorkflow(childCtx, SubagentWorkflowName, SubagentInput{
		UserID: st.Start.UserID, ParentSlug: st.Start.AgentSlug, ChildSlug: args.Agent, Task: args.Task,
		SessionID: childSessionID, Channel: "subagent", Depth: st.Start.Depth + 1, Limits: st.Start.Limits,
		HITLEnabled: st.Start.HITLEnabled, SubagentsEnabled: st.Start.SubagentsEnabled,
	}).Get(ctx, &result)
	if err != nil {
		_ = e.emit(ctx, &turnSeq, EventSubagentCompleted, map[string]any{"turn": turnSeq, "agent": args.Agent, "error": backgroundtaskruntime.Truncate(err.Error(), 300)})
		return fmt.Sprintf(`{"error":%q}`, backgroundtaskruntime.Truncate(err.Error(), 300))
	}
	_ = e.emit(ctx, &turnSeq, EventSubagentCompleted, map[string]any{"turn": turnSeq, "agent": args.Agent, "summary": result.Summary})
	out, _ := jsonMarshal(map[string]any{"agent": args.Agent, "summary": result.Summary, "artifactRefs": result.ArtifactRefs})
	return string(out)
}

// SubagentWorkflow runs one delegated subtask in isolation (RFC 027
// rowboat.agent.subagent.v1): it resolves+narrows its own spec, creates its own
// session projection, runs a single reason→act turn, and returns a compact
// summary to the parent. Its transcript never merges into the parent's history.
func SubagentWorkflow(ctx workflow.Context, in SubagentInput) (SubagentResult, error) {
	projCtx := workflow.WithActivityOptions(ctx, projectionActivityOptions())

	var spec SubagentSpec
	if err := workflow.ExecuteActivity(projCtx, ActivityResolveSubagent, ResolveSubagentInput{
		UserID: in.UserID, ParentSlug: in.ParentSlug, ChildSlug: in.ChildSlug,
	}).Get(ctx, &spec); err != nil {
		return SubagentResult{Error: err.Error()}, nil // parent decides retry/fallback
	}

	start := SessionStart{
		UserID: in.UserID, SessionID: in.SessionID, AgentSlug: spec.Slug, AgentSource: spec.AgentSource,
		Channel: in.Channel, Instructions: spec.Instructions, Model: spec.Model, Provider: spec.Provider,
		Tools: filterToolMetas(spec.Tools, in.SubagentsEnabled), SubagentRefs: spec.SubagentRefs,
		Limits: in.Limits, HITLEnabled: in.HITLEnabled, SubagentsEnabled: in.SubagentsEnabled, Depth: in.Depth,
	}
	state := SessionState{Start: start}
	e := &exec{
		state:     &state,
		ioCtx:     workflow.WithActivityOptions(ctx, ioActivityOptions()),
		projCtx:   projCtx,
		approvals: map[string]*approvalGate{},
	}

	info := workflow.GetInfo(ctx)
	_ = workflow.ExecuteActivity(projCtx, ActivityEnsureSession, EnsureSessionInput{
		Start: start, TemporalWorkflowID: info.WorkflowExecution.ID, TemporalRunID: info.WorkflowExecution.RunID,
	}).Get(ctx, nil)
	_ = e.emit(ctx, nil, EventSessionStarted, map[string]any{"sessionId": in.SessionID, "agent": spec.Slug, "delegated": true})

	res := e.runTurn(ctx, TurnInput{Seq: 0, Input: in.Task})
	e.finishSession(ctx, "completed", EventSessionCompleted, res.FinishReason, "")
	if res.SessionLimitHit {
		return SubagentResult{Summary: res.Summary, Error: res.LimitError}, nil
	}
	return SubagentResult{Summary: res.Summary}, nil
}

// --- terminal + limit helpers ------------------------------------------------

func (e *exec) sessionLimit(ctx workflow.Context, res turnResult, turnSeq int, limit string) turnResult {
	res.SessionLimitHit = true
	res.FinishReason = "session_" + limit + "_exceeded"
	res.LimitError = fmt.Sprintf("per-session %s ceiling reached", limit)
	res.Summary = e.finalizeLimit(ctx, turnSeq, limit)
	return res
}

func (e *exec) finalizeLimit(ctx workflow.Context, turnSeq int, limit string) string {
	_ = e.emit(ctx, &turnSeq, EventLimitExceeded, map[string]any{"turn": turnSeq, "limit": limit})
	summary := fmt.Sprintf("The turn stopped after reaching the %s limit.", limit)
	e.completeTurn(ctx, turnSeq, turnResult{Summary: summary, FinishReason: "limit_exceeded"})
	return summary
}

func (e *exec) completeTurn(ctx workflow.Context, turnSeq int, res turnResult) {
	st := e.state
	_ = workflow.ExecuteActivity(e.projCtx, ActivityPersistTurn, TurnPatch{
		UserID: st.Start.UserID, SessionID: st.Start.SessionID, Seq: turnSeq,
		Status: "completed", Summary: res.Summary, FinishReason: res.FinishReason,
		LLMCalls: res.LLMCalls, ToolCalls: res.ToolCalls, CostUnits: res.CostUnits, Finish: true,
	}).Get(ctx, nil)
	_ = e.emit(ctx, &turnSeq, EventTurnCompleted, map[string]any{"turn": turnSeq, "summary": res.Summary, "finishReason": res.FinishReason})
}

// deliverChannelReply posts the turn's final assistant message back into the
// session's originating channel thread (RFC 027 channels — the CloudTag
// round-trip). It is guarded on the channel so non-channel sessions
// (http/subagent/schedule) add no activity to history, preserving replay for
// every existing session; the channel value lives in deterministic workflow
// state. The activity result is ignored so a delivery outage never fails the
// turn (the activity itself retries transient errors).
func (e *exec) deliverChannelReply(ctx workflow.Context, content string) {
	if e.state.Start.Channel != "slack" || strings.TrimSpace(content) == "" {
		return
	}
	st := e.state
	_ = workflow.ExecuteActivity(e.ioCtx, ActivityDeliverChannelReply, DeliverChannelReplyInput{
		UserID: st.Start.UserID, SessionID: st.Start.SessionID, Text: content,
	}).Get(ctx, nil)
}

func (e *exec) failTurn(ctx workflow.Context, turnSeq int, errMsg string) {
	st := e.state
	_ = workflow.ExecuteActivity(e.projCtx, ActivityPersistTurn, TurnPatch{
		UserID: st.Start.UserID, SessionID: st.Start.SessionID, Seq: turnSeq, Status: "failed", Finish: true,
	}).Get(ctx, nil)
	_ = e.emit(ctx, &turnSeq, EventTurnFailed, map[string]any{"turn": turnSeq, "error": backgroundtaskruntime.Truncate(errMsg, 300)})
}

func (e *exec) auditToolCall(ctx workflow.Context, turnSeq, callIndex int, tool, tier, status string, resultBytes int, errorCode string) {
	st := e.state
	_ = workflow.ExecuteActivity(e.projCtx, ActivityPersistToolCall, ToolCallAuditInput{
		UserID: st.Start.UserID, SessionID: st.Start.SessionID, TurnSeq: turnSeq, CallIndex: callIndex,
		ToolName: tool, TrustTier: tier, Status: status, ResultBytes: resultBytes, ErrorCode: errorCode,
	}).Get(ctx, nil)
}

// finishSession writes the terminal projection + lifecycle event.
func (e *exec) finishSession(ctx workflow.Context, status, event, reason, errMsg string) {
	st := e.state
	patch := SessionPatch{UserID: st.Start.UserID, SessionID: st.Start.SessionID, Status: status, Terminal: true}
	if errMsg != "" {
		patch.Error = errMsg
		patch.ErrorCode = reason
	}
	_ = workflow.ExecuteActivity(e.projCtx, ActivityPersistSession, patch).Get(ctx, nil)
	_ = e.emit(ctx, nil, event, map[string]any{"status": status, "reason": reason})
}

// closeOnCancel writes the terminal projection on a detached context so it lands
// despite the canceled ctx (the live ctx would reject new commands).
func (e *exec) closeOnCancel(ctx workflow.Context, reason string) {
	dctx, _ := workflow.NewDisconnectedContext(ctx)
	dctx = workflow.WithActivityOptions(dctx, projectionActivityOptions())
	st := e.state
	_ = workflow.ExecuteActivity(dctx, ActivityPersistSession, SessionPatch{
		UserID: st.Start.UserID, SessionID: st.Start.SessionID, Status: "canceled", Terminal: true, ErrorCode: reason,
	}).Get(dctx, nil)
	seq := st.EventSeq
	st.EventSeq++
	payload, _ := jsonMarshal(map[string]any{"status": "canceled", "reason": reason})
	_ = workflow.ExecuteActivity(dctx, ActivityAppendSessionEvent, AppendEventInput{
		UserID: st.Start.UserID, SessionID: st.Start.SessionID, Seq: seq, EventType: EventSessionCanceled, EventJSON: string(payload),
	}).Get(dctx, nil)
}

// emit appends one durable session event at the workflow-owned seq, then teed to
// the live bus inside the activity. Seq assignment is deterministic (replayed in
// order), and the unique (session, seq) index makes the append idempotent.
func (e *exec) emit(ctx workflow.Context, turnSeq *int, eventType string, data map[string]any) error {
	st := e.state
	seq := st.EventSeq
	st.EventSeq++
	payload, err := jsonMarshal(data)
	if err != nil {
		return err
	}
	return workflow.ExecuteActivity(e.projCtx, ActivityAppendSessionEvent, AppendEventInput{
		UserID: st.Start.UserID, SessionID: st.Start.SessionID, Seq: seq, TurnSeq: turnSeq,
		EventType: eventType, EventJSON: string(payload),
	}).Get(ctx, nil)
}

// shouldContinueAsNew bounds history by turn cadence and by the live history
// length crossing a threshold (whichever comes first).
func (e *exec) shouldContinueAsNew(ctx workflow.Context) bool {
	if continueAsNewByTurns(e.state.CompletedTurns, e.state.Start.Limits.ContinueAsNewEveryTurns) {
		return true
	}
	return workflow.GetInfo(ctx).GetCurrentHistoryLength() > continueAsNewHistoryThreshold
}

// continueAsNewByTurns is the per-turn ContinueAsNew cadence (extracted for
// deterministic unit testing).
func continueAsNewByTurns(completedTurns, every int) bool {
	return every > 0 && completedTurns > 0 && completedTurns%every == 0
}

// continueAsNewHistoryThreshold keeps history well under Temporal's ~51.2k-event
// per-workflow ceiling.
const continueAsNewHistoryThreshold = 8000

func ioActivityOptions() workflow.ActivityOptions {
	return workflow.ActivityOptions{
		StartToCloseTimeout: ioActivityTimeout,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval: time.Second, BackoffCoefficient: 2, MaximumInterval: time.Minute, MaximumAttempts: 3,
		},
	}
}

func projectionActivityOptions() workflow.ActivityOptions {
	return workflow.ActivityOptions{
		StartToCloseTimeout: projectionActivityTimeout,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval: time.Second, BackoffCoefficient: 2, MaximumInterval: 30 * time.Second, MaximumAttempts: 5,
		},
	}
}
