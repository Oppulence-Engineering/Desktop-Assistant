package backgroundtaskworkflow

import (
	"errors"

	"go.temporal.io/sdk/temporal"
)

// Granular error-code taxonomy for API-native background task runs. These codes
// are stable machine identifiers persisted on background_task_run.error_code and
// surfaced to the desktop UI; the accompanying error_details holds the
// human-readable specifics. Keep this list and the desktop's mirror in sync.
const (
	// Control-plane (handler) failures, set when a trigger/retry cannot start.
	ErrCodeTemporalUnavailable  = "temporal_unavailable"   // Temporal not configured.
	ErrCodeTemporalStartFailed  = "temporal_start_failed"  // ExecuteWorkflow rejected the start.
	ErrCodeTemporalCancelFailed = "temporal_cancel_failed" // CancelWorkflow failed.
	ErrCodeTemporalSignalFailed = "temporal_signal_failed" // SignalWorkflow failed.

	// Execution (worker/activity) failures, set on the failed run row.
	ErrCodeWorkflowCanceled    = "workflow_canceled"     // The workflow was canceled mid-run.
	ErrCodeActivityTimeout     = "activity_timeout"      // An activity exceeded its start-to-close timeout.
	ErrCodeActivityFailed      = "activity_failed"       // Uncategorized activity failure.
	ErrCodeTaskNotFound        = "task_not_found"        // The task row vanished during execution.
	ErrCodeTaskInvalid         = "task_invalid"          // The task/run identifiers were unparseable.
	ErrCodeArtifactWriteFailed = "artifact_write_failed" // Persisting the artifact failed.
	ErrCodeDBError             = "db_error"              // A database read/write failed.
	ErrCodeInternal            = "internal"              // Fallback for anything unclassified.
)

// knownErrorCodes lets the handler and tests assert a code is part of the taxonomy.
var knownErrorCodes = map[string]struct{}{
	ErrCodeTemporalUnavailable:  {},
	ErrCodeTemporalStartFailed:  {},
	ErrCodeTemporalCancelFailed: {},
	ErrCodeTemporalSignalFailed: {},
	ErrCodeWorkflowCanceled:     {},
	ErrCodeActivityTimeout:      {},
	ErrCodeActivityFailed:       {},
	ErrCodeTaskNotFound:         {},
	ErrCodeTaskInvalid:          {},
	ErrCodeArtifactWriteFailed:  {},
	ErrCodeDBError:              {},
	ErrCodeInternal:             {},
}

// IsKnownErrorCode reports whether code belongs to the taxonomy.
func IsKnownErrorCode(code string) bool {
	_, ok := knownErrorCodes[code]
	return ok
}

// taggedError wraps an activity failure with a granular code so the workflow can
// recover it from the (otherwise opaque) Temporal error chain.
func taggedError(code, message string, cause error) error {
	// The ApplicationError "type" carries our code across the workflow boundary;
	// these failures are non-retryable because retrying won't change the outcome.
	return temporal.NewNonRetryableApplicationError(message, code, cause)
}

// ClassifyRunError maps an error returned from a workflow activity into a stable
// (code, details) pair. Activity errors tagged via taggedError keep their code;
// cancellation and timeout are recognized from the Temporal error chain; anything
// else degrades to activity_failed.
func ClassifyRunError(err error) (code, details string) {
	if err == nil {
		return "", ""
	}
	details = err.Error()
	switch {
	case temporal.IsCanceledError(err):
		return ErrCodeWorkflowCanceled, details
	case temporal.IsTimeoutError(err):
		return ErrCodeActivityTimeout, details
	}
	var appErr *temporal.ApplicationError
	if errors.As(err, &appErr) {
		if t := appErr.Type(); IsKnownErrorCode(t) {
			return t, details
		}
		return ErrCodeActivityFailed, details
	}
	return ErrCodeActivityFailed, details
}
