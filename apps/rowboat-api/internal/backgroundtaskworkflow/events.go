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
}

// IsKnownEventType reports whether t is part of the canonical lifecycle vocabulary.
func IsKnownEventType(t string) bool {
	_, ok := knownEventTypes[t]
	return ok
}
