package backgroundtaskruntime

// Error codes and event types emitted by the runtime. These are string
// duplicates of the backgroundtaskworkflow vocabulary — duplicated, not
// imported, because backgroundtaskworkflow imports THIS package (the
// Activities.Runtime seam) and Go forbids the cycle. The workflow package's
// vocabulary test asserts the two sets stay identical.
const (
	CodeRuntimeDeadlineExceeded   = "runtime_deadline_exceeded"
	CodeRuntimeLLMBudgetExceeded  = "runtime_llm_budget_exceeded"
	CodeRuntimeToolBudgetExceeded = "runtime_tool_budget_exceeded"
	CodeRuntimeArtifactTooLarge   = "runtime_artifact_too_large"
	CodeRuntimeEventTooLarge      = "runtime_event_too_large"
	CodeLLMCallFailed             = "llm_call_failed"
	CodeToolNotAllowed            = "tool_not_allowed"
	CodeToolInvokeFailed          = "tool_invoke_failed"
	CodeConnectorUnavailable      = "connector_unavailable"
)

// Event types the runtime appends (temporal.* lifecycle types it reuses plus
// its own runtime.* transcript vocabulary).
const (
	eventProgress        = "temporal.progress"
	eventArtifactUpdated = "temporal.artifact_updated"

	eventLLMCallStarted        = "runtime.llm_call_started"
	eventLLMCallCompleted      = "runtime.llm_call_completed"
	eventToolCallStarted       = "runtime.tool_call_started"
	eventToolCallCompleted     = "runtime.tool_call_completed"
	eventToolApprovalRequested = "runtime.tool_approval_requested"
	eventToolApprovalResolved  = "runtime.tool_approval_resolved"
	eventToolDenied            = "runtime.tool_denied"
	eventLimitExceeded         = "runtime.limit_exceeded"
	eventFinalArtifactReady    = "runtime.final_artifact_ready"
)
