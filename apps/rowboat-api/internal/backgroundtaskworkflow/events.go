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

	// Cloud runtime transcript events (RFC 004). Appended by the agent loop
	// for debugging/transcript display; the desktop ignores unknown types, so
	// these are additive.
	EventRuntimeLLMCallStarted     = "runtime.llm_call_started"
	EventRuntimeLLMCallCompleted   = "runtime.llm_call_completed"
	EventRuntimeToolCallStarted    = "runtime.tool_call_started"
	EventRuntimeToolCallCompleted  = "runtime.tool_call_completed"
	EventRuntimeToolDenied         = "runtime.tool_denied"
	EventRuntimeLimitExceeded      = "runtime.limit_exceeded"
	EventRuntimeFinalArtifactReady = "runtime.final_artifact_ready"
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

	EventRuntimeLLMCallStarted:     {},
	EventRuntimeLLMCallCompleted:   {},
	EventRuntimeToolCallStarted:    {},
	EventRuntimeToolCallCompleted:  {},
	EventRuntimeToolDenied:         {},
	EventRuntimeLimitExceeded:      {},
	EventRuntimeFinalArtifactReady: {},
}

// IsKnownEventType reports whether t is part of the canonical lifecycle vocabulary.
func IsKnownEventType(t string) bool {
	_, ok := knownEventTypes[t]
	return ok
}
