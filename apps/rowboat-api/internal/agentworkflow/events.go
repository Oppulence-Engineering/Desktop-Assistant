package agentworkflow

// Canonical lifecycle/transcript event types appended to agent_session_events
// (RFC 027), mirroring backgroundtaskworkflow's vocabulary. event_json stays
// free-form for forward-compatibility; the NDJSON stream forwards unknown types
// so newer clients still receive them.
const (
	EventSessionStarted   = "agent.session_started"
	EventSessionCompleted = "agent.session_completed"
	EventSessionFailed    = "agent.session_failed"
	EventSessionCanceled  = "agent.session_canceled"
	EventSessionPaused    = "agent.session_paused"

	EventTurnStarted   = "agent.turn_started"
	EventTurnCompleted = "agent.turn_completed"
	EventTurnFailed    = "agent.turn_failed"

	EventLLMCallStarted   = "agent.llm_call_started"
	EventLLMCallCompleted = "agent.llm_call_completed"
	EventMessage          = "agent.message" // assistant final content for a turn

	EventToolCallStarted   = "agent.tool_call_started"
	EventToolCallCompleted = "agent.tool_call_completed"
	EventToolDenied        = "agent.tool_denied"

	EventApprovalRequested = "agent.approval_requested"
	EventApprovalResolved  = "agent.approval_resolved"

	EventSubagentStarted   = "agent.subagent_started"
	EventSubagentCompleted = "agent.subagent_completed"

	EventLimitExceeded = "agent.limit_exceeded"
)
