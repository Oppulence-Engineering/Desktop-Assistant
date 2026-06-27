package backgroundtaskworkflow

// Canonical lifecycle event types appended to background_task_run_event. The
// event_json column stays free-form for forward-compatibility, but emitters
// should use these constants and consumers can rely on the set. AppendRunEvents
// logs (does not reject) unknown types so newer desktops can still sync.
const (
	EventQueued          = "temporal.queued"
	EventRunning         = "temporal.running"
	EventProgress        = "temporal.progress"
	EventArtifactUpdated = "temporal.artifact_updated"
	EventCompleted       = "temporal.completed"
	EventFailed          = "temporal.failed"
	EventCancelRequested = "temporal.cancel_requested"
	EventStopped         = "temporal.stopped"
	EventSignal          = "temporal.signal"
	EventRetryRequested  = "temporal.retry_requested"
	EventDeadLettered    = "temporal.dead_lettered"

	// Cloud runtime transcript events (RFC 004). Appended by the agent loop
	// for debugging/transcript display; the desktop ignores unknown types, so
	// these are additive.
	EventRuntimeLLMCallStarted        = "runtime.llm_call_started"
	EventRuntimeLLMCallCompleted      = "runtime.llm_call_completed"
	EventRuntimeToolCallStarted       = "runtime.tool_call_started"
	EventRuntimeToolCallCompleted     = "runtime.tool_call_completed"
	EventRuntimeToolApprovalRequested = "runtime.tool_approval_requested"
	EventRuntimeToolApprovalResolved  = "runtime.tool_approval_resolved"
	EventRuntimeToolDenied            = "runtime.tool_denied"
	EventRuntimeLimitExceeded         = "runtime.limit_exceeded"
	EventRuntimeFinalArtifactReady    = "runtime.final_artifact_ready"

	// Desktop transcript events mirror the local Electron run log. They are
	// separate from temporal.* lifecycle events because desktop runs are not
	// Temporal-backed, but the cloud still stores their transcript.
	EventDesktopRunProcessingStart         = "desktop.run_processing_start"
	EventDesktopRunProcessingEnd           = "desktop.run_processing_end"
	EventDesktopStart                      = "desktop.start"
	EventDesktopSpawnSubflow               = "desktop.spawn_subflow"
	EventDesktopLLMStream                  = "desktop.llm_stream_event"
	EventDesktopMessage                    = "desktop.message"
	EventDesktopToolInvocation             = "desktop.tool_invocation"
	EventDesktopToolResult                 = "desktop.tool_result"
	EventDesktopToolOutputStream           = "desktop.tool_output_stream"
	EventDesktopAskHumanRequest            = "desktop.ask_human_request"
	EventDesktopAskHumanResponse           = "desktop.ask_human_response"
	EventDesktopToolPermissionRequest      = "desktop.tool_permission_request"
	EventDesktopToolPermissionResponse     = "desktop.tool_permission_response"
	EventDesktopCodeRun                    = "desktop.code_run_event"
	EventDesktopCodeRunPermissionRequest   = "desktop.code_run_permission_request"
	EventDesktopToolPermissionAutoDecision = "desktop.tool_permission_auto_decision"
	EventDesktopError                      = "desktop.error"
	EventDesktopStopped                    = "desktop.run_stopped"
)

var knownEventTypes = map[string]struct{}{
	EventQueued:          {},
	EventRunning:         {},
	EventProgress:        {},
	EventArtifactUpdated: {},
	EventCompleted:       {},
	EventFailed:          {},
	EventCancelRequested: {},
	EventStopped:         {},
	EventSignal:          {},
	EventRetryRequested:  {},
	EventDeadLettered:    {},

	EventRuntimeLLMCallStarted:        {},
	EventRuntimeLLMCallCompleted:      {},
	EventRuntimeToolCallStarted:       {},
	EventRuntimeToolCallCompleted:     {},
	EventRuntimeToolApprovalRequested: {},
	EventRuntimeToolApprovalResolved:  {},
	EventRuntimeToolDenied:            {},
	EventRuntimeLimitExceeded:         {},
	EventRuntimeFinalArtifactReady:    {},

	EventDesktopRunProcessingStart:         {},
	EventDesktopRunProcessingEnd:           {},
	EventDesktopStart:                      {},
	EventDesktopSpawnSubflow:               {},
	EventDesktopLLMStream:                  {},
	EventDesktopMessage:                    {},
	EventDesktopToolInvocation:             {},
	EventDesktopToolResult:                 {},
	EventDesktopToolOutputStream:           {},
	EventDesktopAskHumanRequest:            {},
	EventDesktopAskHumanResponse:           {},
	EventDesktopToolPermissionRequest:      {},
	EventDesktopToolPermissionResponse:     {},
	EventDesktopCodeRun:                    {},
	EventDesktopCodeRunPermissionRequest:   {},
	EventDesktopToolPermissionAutoDecision: {},
	EventDesktopError:                      {},
	EventDesktopStopped:                    {},
}

// IsKnownEventType reports whether t is part of the canonical lifecycle vocabulary.
func IsKnownEventType(t string) bool {
	_, ok := knownEventTypes[t]
	return ok
}
