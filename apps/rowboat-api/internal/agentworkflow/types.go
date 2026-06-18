package agentworkflow

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
)

// Workflow + activity type names (Temporal registration identities).
const (
	// SessionWorkflowName is the long-lived, idle-between-turns session workflow.
	SessionWorkflowName = "rowboat.agent.session.v1"
	// SubagentWorkflowName is the child workflow a delegation dispatches to.
	SubagentWorkflowName = "rowboat.agent.subagent.v1"

	ActivityLLMComplete        = "rowboat.agent.llm_complete.v1"
	ActivityToolInvoke         = "rowboat.agent.tool_invoke.v1"
	ActivityAppendSessionEvent = "rowboat.agent.append_event.v1"
	ActivityPersistTurn        = "rowboat.agent.persist_turn.v1"
	ActivityPersistSession     = "rowboat.agent.persist_session.v1"
	ActivityPersistApproval    = "rowboat.agent.persist_approval.v1"
	ActivityResolveApproval    = "rowboat.agent.resolve_approval.v1"
	ActivityValidateApproval   = "rowboat.agent.validate_approval.v1"
	ActivityPersistToolCall    = "rowboat.agent.persist_tool_call.v1"
	ActivityEnsureSession      = "rowboat.agent.ensure_session.v1"
	ActivityResolveSubagent    = "rowboat.agent.resolve_subagent.v1"

	// SignalControl carries fire-and-forget control (cancel/pause), retained
	// alongside the validated submitTurn/approveAction Updates.
	SignalControl = "rowboat.agent.control.v1"

	// UpdateSubmitTurn submits a validated turn (synchronous ack + turn seq).
	UpdateSubmitTurn = "submitTurn"
	// UpdateApproveAction resolves a pending HITL approval.
	UpdateApproveAction = "approveAction"
)

// ToolMeta is the deterministic per-tool descriptor carried in workflow state.
// The loop branches on it (subagent? approval-required?) WITHOUT reading the
// non-deterministic capability registry inside workflow code — the registry is
// touched only inside activities. Captured at session start from the resolved
// AgentDefinition; stable across ContinueAsNew.
type ToolMeta struct {
	Name      string `json:"name"`
	TrustTier string `json:"trustTier"`
	Kind      string `json:"kind"` // "tool" | "subagent"
}

// Limits bounds turns and sessions (RFC 027). Per-call activity
// StartToCloseTimeout stays below MaxWallclockPerTurn (the 5m coupling).
type Limits struct {
	MaxLLMCallsPerTurn      int           `json:"maxLlmCallsPerTurn"`
	MaxToolCallsPerTurn     int           `json:"maxToolCallsPerTurn"`
	MaxWallclockPerTurn     time.Duration `json:"maxWallclockPerTurn"`
	MaxTurnsPerSession      int           `json:"maxTurnsPerSession"`
	MaxLLMCallsPerSession   int           `json:"maxLlmCallsPerSession"`
	MaxCostUnitsPerSession  int           `json:"maxCostUnitsPerSession"`
	IdleTimeout             time.Duration `json:"idleTimeout"`
	ContinueAsNewEveryTurns int           `json:"continueAsNewEveryTurns"`
	MaxSubagentDepth        int           `json:"maxSubagentDepth"`
	MaxSubagentFanout       int           `json:"maxSubagentFanout"`
}

// SessionStart is the immutable per-session configuration set once at creation
// and carried (unchanged) through every ContinueAsNew.
type SessionStart struct {
	UserID      string `json:"userId"`
	SessionID   string `json:"sessionId"`
	AgentSlug   string `json:"agentSlug"`
	AgentSource string `json:"agentSource"`
	Channel     string `json:"channel"`

	Instructions string     `json:"instructions"`
	Model        string     `json:"model"`
	Provider     string     `json:"provider"`
	Tools        []ToolMeta `json:"tools"`        // resolved, effective allowlist
	SubagentRefs []string   `json:"subagentRefs"` // slugs delegable to (RFC 018)
	Limits       Limits     `json:"limits"`

	HITLEnabled      bool `json:"hitlEnabled"`
	SubagentsEnabled bool `json:"subagentsEnabled"`
	StreamingEnabled bool `json:"streamingEnabled"`

	// Depth is the delegation depth (0 for a root session, >0 for a subagent
	// child). Bounds recursive credit burn against Limits.MaxSubagentDepth.
	Depth int `json:"depth,omitempty"`
}

// TurnInput is one submitted turn. Seq is assigned at enqueue time so the
// submitTurn Update can return it synchronously.
type TurnInput struct {
	Seq   int    `json:"seq"`
	Input string `json:"input"`
}

// TurnAck is the synchronous submitTurn Update result.
type TurnAck struct {
	Accepted bool   `json:"accepted"`
	TurnSeq  int    `json:"turnSeq"`
	Error    string `json:"error,omitempty"`
}

// ApproveAction is the approveAction Update input (HITL resolution).
type ApproveAction struct {
	ApprovalID    string `json:"approvalId"`
	Decision      string `json:"decision"` // "granted" | "denied"
	ApprovalToken string `json:"approvalToken,omitempty"`
	ResolvedBy    string `json:"resolvedBy,omitempty"`
}

// ControlSignal is the fire-and-forget control payload (cancel/pause).
type ControlSignal struct {
	Signal  string         `json:"signal"` // "cancel" | "pause"
	Payload map[string]any `json:"payload,omitempty"`
}

// TurnSummary is the compacted record of a completed prior turn, seeded into the
// next turn's transcript instead of the full message history (history bounding).
type TurnSummary struct {
	Seq     int    `json:"seq"`
	Input   string `json:"input"`
	Summary string `json:"summary"`
}

// SessionState is the workflow's input + ContinueAsNew carrier. On a fresh
// start the starter passes one with Start populated and TurnSeq/EventSeq = 0;
// ContinueAsNew passes a compacted copy (summaries, not full transcripts).
type SessionState struct {
	Start SessionStart `json:"start"`

	// EnqueuedTurns counts every turn ever accepted (assigns turn seqs).
	EnqueuedTurns int `json:"enqueuedTurns"`
	// CompletedTurns counts turns that have run (per-session MaxTurns governor).
	CompletedTurns int `json:"completedTurns"`
	// EventSeq is the next durable event sequence — owned by the workflow so the
	// unique (session, seq) index makes the at-least-once append idempotent.
	EventSeq int `json:"eventSeq"`

	// Cumulative governors carried across ContinueAsNew.
	CumLLMCalls  int `json:"cumLlmCalls"`
	CumToolCalls int `json:"cumToolCalls"`
	CumCostUnits int `json:"cumCostUnits"`

	// Summaries are compacted prior turns seeded into each new turn's transcript.
	Summaries []TurnSummary `json:"summaries,omitempty"`

	// Pending is the FIFO queue of accepted-but-unrun turns.
	Pending []TurnInput `json:"pending,omitempty"`
}

// summaryWindow bounds how many prior-turn summaries are seeded + carried.
const summaryWindow = 12

// compact returns the state to carry across ContinueAsNew: cumulative counters
// and a bounded window of prior-turn summaries, never the full transcript.
func (s SessionState) compact() SessionState {
	out := s
	if len(out.Summaries) > summaryWindow {
		out.Summaries = append([]TurnSummary(nil), out.Summaries[len(out.Summaries)-summaryWindow:]...)
	}
	return out
}

// SubagentInput is the child workflow input for a delegated subtask. The child
// resolves+validates its own (narrowed) spec at start, so the parent only
// passes identity, the task, and the inherited governors.
type SubagentInput struct {
	UserID     string `json:"userId"`
	ParentSlug string `json:"parentSlug"`
	ChildSlug  string `json:"childSlug"`
	Task       string `json:"task"`
	SessionID  string `json:"sessionId"` // child's deterministic session id
	Channel    string `json:"channel"`
	Depth      int    `json:"depth"`
	Limits     Limits `json:"limits"`

	HITLEnabled      bool `json:"hitlEnabled"`
	SubagentsEnabled bool `json:"subagentsEnabled"`
}

// SubagentResult is the compact result folded back into the parent's transcript
// as the tool observation (the child transcript never merges into the parent).
type SubagentResult struct {
	Summary      string   `json:"summary"`
	ArtifactRefs []string `json:"artifactRefs,omitempty"`
	Error        string   `json:"error,omitempty"`
}

// SubagentSpec is the narrowed child configuration a delegation runs under
// (tools ⊆ parent, validated against parent.subagentRefs).
type SubagentSpec struct {
	Slug         string     `json:"slug"`
	AgentSource  string     `json:"agentSource"`
	Instructions string     `json:"instructions"`
	Model        string     `json:"model"`
	Provider     string     `json:"provider"`
	Tools        []ToolMeta `json:"tools"`
	SubagentRefs []string   `json:"subagentRefs"`
}

// EnsureSessionInput upserts the AgentSession projection row (idempotent by
// session id) and binds the Temporal ids. Used by the root workflow (row also
// pre-created by the HTTP starter) and by subagent child workflows (no starter).
type EnsureSessionInput struct {
	Start              SessionStart `json:"start"`
	TemporalWorkflowID string       `json:"temporalWorkflowId"`
	TemporalRunID      string       `json:"temporalRunId"`
}

// ResolveSubagentInput resolves + validates a child agent within the parent's
// tenant scope (childSlug must be in the parent's subagent_refs).
type ResolveSubagentInput struct {
	UserID     string `json:"userId"`
	ParentSlug string `json:"parentSlug"`
	ChildSlug  string `json:"childSlug"`
}

// --- deterministic ids -------------------------------------------------------

// WorkflowID is the stable session workflow id (survives ContinueAsNew; only
// the Temporal run id changes). Analogue of backgroundtaskworkflow.WorkflowID.
func WorkflowID(userID, sessionID string) string {
	return fmt.Sprintf("agent-session/%s/%s", userID, sessionID)
}

// SubagentWorkflowID is the deterministic child workflow id for one delegation.
func SubagentWorkflowID(userID, sessionID string, turnSeq, callIndex int) string {
	return fmt.Sprintf("agent-subagent/%s/%s/turn/%d/call/%d", userID, sessionID, turnSeq, callIndex)
}

// ApprovalID is the deterministic id for one approval gate.
func ApprovalID(sessionID string, turnSeq, callIndex int) string {
	return fmt.Sprintf("%s/turn/%d/approval/%d", sessionID, turnSeq, callIndex)
}

// findTool returns the ToolMeta for name, if advertised to this session.
func (s SessionStart) findTool(name string) (ToolMeta, bool) {
	for _, t := range s.Tools {
		if t.Name == name {
			return t, true
		}
	}
	return ToolMeta{}, false
}

// --- activity payloads -------------------------------------------------------

// LLMCompleteInput is one durable, billed model call.
type LLMCompleteInput struct {
	UserID    string                          `json:"userId"`
	SessionID string                          `json:"sessionId"`
	AgentSlug string                          `json:"agentSlug"`
	TurnSeq   int                             `json:"turnSeq"`
	CallIndex int                             `json:"callIndex"`
	Model     string                          `json:"model"`
	Provider  string                          `json:"provider"`
	ToolNames []string                        `json:"toolNames"`
	Messages  []backgroundtaskruntime.Message `json:"messages"`
}

// LLMCompleteResult is the final ChatResult the workflow durably records.
type LLMCompleteResult struct {
	Message      backgroundtaskruntime.Message `json:"message"`
	Provider     string                        `json:"provider"`
	Model        string                        `json:"model"`
	InputTokens  int                           `json:"inputTokens"`
	OutputTokens int                           `json:"outputTokens"`
	CostUnits    int                           `json:"costUnits"`
}

// ToolInvokeInput is one tool execution. AllowedTools is the deny-by-default
// allowlist re-checked inside the activity (the authoritative Lookup boundary).
type ToolInvokeInput struct {
	UserID       string          `json:"userId"`
	SessionID    string          `json:"sessionId"`
	TurnSeq      int             `json:"turnSeq"`
	CallIndex    int             `json:"callIndex"`
	ToolName     string          `json:"toolName"`
	Args         json.RawMessage `json:"args"`
	AllowedTools []string        `json:"allowedTools"`
}

// ToolInvokeResult carries the (truncated) tool result or a classified failure.
type ToolInvokeResult struct {
	ResultJSON  string `json:"resultJson"`
	ResultBytes int    `json:"resultBytes"`
	Denied      bool   `json:"denied"`
	Failed      bool   `json:"failed"`
	ErrorCode   string `json:"errorCode,omitempty"`
}

// AppendEventInput appends one durable session event at a workflow-owned seq.
type AppendEventInput struct {
	UserID    string `json:"userId"`
	SessionID string `json:"sessionId"`
	Seq       int    `json:"seq"`
	TurnSeq   *int   `json:"turnSeq,omitempty"`
	EventType string `json:"eventType"`
	EventJSON string `json:"eventJson"`
}

// SessionPatch updates the AgentSession projection (status/counters/ids/error).
type SessionPatch struct {
	UserID    string `json:"userId"`
	SessionID string `json:"sessionId"`

	Status             string `json:"status,omitempty"`
	TemporalWorkflowID string `json:"temporalWorkflowId,omitempty"`
	TemporalRunID      string `json:"temporalRunId,omitempty"`

	SetCounters   bool `json:"setCounters,omitempty"`
	TurnCount     int  `json:"turnCount,omitempty"`
	LLMCallCount  int  `json:"llmCallCount,omitempty"`
	ToolCallCount int  `json:"toolCallCount,omitempty"`
	CostUnits     int  `json:"costUnits,omitempty"`

	TouchActivity bool   `json:"touchActivity,omitempty"`
	MarkStarted   bool   `json:"markStarted,omitempty"`
	Terminal      bool   `json:"terminal,omitempty"`
	Error         string `json:"error,omitempty"`
	ErrorCode     string `json:"errorCode,omitempty"`
}

// TurnPatch upserts the AgentTurn projection (create-then-update by (session,seq)).
type TurnPatch struct {
	UserID    string `json:"userId"`
	SessionID string `json:"sessionId"`
	Seq       int    `json:"seq"`

	Input        string `json:"input,omitempty"`
	Status       string `json:"status,omitempty"`
	Summary      string `json:"summary,omitempty"`
	FinishReason string `json:"finishReason,omitempty"`
	LLMCalls     int    `json:"llmCalls,omitempty"`
	ToolCalls    int    `json:"toolCalls,omitempty"`
	CostUnits    int    `json:"costUnits,omitempty"`
	Start        bool   `json:"start,omitempty"`
	Finish       bool   `json:"finish,omitempty"`
}

// ApprovalInput persists a pending approval row (HITL).
type ApprovalInput struct {
	UserID        string `json:"userId"`
	SessionID     string `json:"sessionId"`
	ApprovalID    string `json:"approvalId"`
	TurnSeq       int    `json:"turnSeq"`
	ToolCallIndex int    `json:"toolCallIndex"`
	ToolName      string `json:"toolName"`
	TrustTier     string `json:"trustTier"`
	ArgsRedacted  string `json:"argsRedacted,omitempty"`
}

// ApprovalResolveInput records the terminal approval state.
type ApprovalResolveInput struct {
	UserID        string `json:"userId"`
	SessionID     string `json:"sessionId"`
	ApprovalID    string `json:"approvalId"`
	Status        string `json:"status"` // granted | denied | expired
	ApprovalToken string `json:"approvalTokenRef,omitempty"`
	ResolvedBy    string `json:"resolvedBy,omitempty"`
}

// ValidateApprovalInput is the RFC 012 token/MFA step-up check. The session and
// approval ids let the activity verify the signed token is bound to THIS gate.
type ValidateApprovalInput struct {
	UserID        string `json:"userId"`
	SessionID     string `json:"sessionId"`
	ApprovalID    string `json:"approvalId"`
	TrustTier     string `json:"trustTier"`
	ApprovalToken string `json:"approvalToken"`
}

// ToolCallAuditInput records one AgentToolCall audit row.
type ToolCallAuditInput struct {
	UserID      string `json:"userId"`
	SessionID   string `json:"sessionId"`
	TurnSeq     int    `json:"turnSeq"`
	CallIndex   int    `json:"callIndex"`
	ToolName    string `json:"toolName"`
	ArgsJSON    string `json:"argsJson,omitempty"`
	TrustTier   string `json:"trustTier,omitempty"`
	Status      string `json:"status"`
	ResultBytes int    `json:"resultBytes,omitempty"`
	ErrorCode   string `json:"errorCode,omitempty"`
}
