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
	ErrCodeTemporalUnavailable   = "temporal_unavailable"   // Temporal not configured.
	ErrCodeTemporalStartFailed   = "temporal_start_failed"  // ExecuteWorkflow rejected the start.
	ErrCodeTemporalCancelFailed  = "temporal_cancel_failed" // CancelWorkflow failed.
	ErrCodeTemporalSignalFailed  = "temporal_signal_failed" // SignalWorkflow failed.
	ErrCodeAdmissionBackpressure = "admission_backpressure" // Queue depth guard rejected the run before Temporal start.
	ErrCodeAdmissionRateLimited  = "admission_rate_limited" // Run-start rate guard rejected the run before Temporal start.
	ErrCodeInsufficientCredits   = "insufficient_credits"   // Credit preflight found the user cannot afford the run.
	ErrCodeDailyCreditLimit      = "daily_credit_limit_exceeded"
	ErrCodeMonthlyCreditLimit    = "monthly_credit_limit_exceeded"

	// Execution (worker/activity) failures, set on the failed run row.
	ErrCodeWorkflowCanceled    = "workflow_canceled"     // The workflow was canceled mid-run.
	ErrCodeActivityTimeout     = "activity_timeout"      // An activity exceeded its start-to-close timeout.
	ErrCodeActivityFailed      = "activity_failed"       // Uncategorized activity failure.
	ErrCodeTaskNotFound        = "task_not_found"        // The task row vanished during execution.
	ErrCodeTaskInvalid         = "task_invalid"          // The task/run identifiers were unparseable.
	ErrCodeArtifactWriteFailed = "artifact_write_failed" // Persisting the artifact failed.
	ErrCodeDBError             = "db_error"              // A database read/write failed.
	ErrCodeInternal            = "internal"              // Fallback for anything unclassified.

	// Cloud runtime failures (RFC 004), set on the failed run row. All are
	// NON-retryable: budgets/validation don't change on retry, and an LLM
	// transcript cannot be resumed across activity attempts. They are mapped
	// via mapRuntimeError (NewNonRetryableApplicationError), NOT taggedError,
	// whose retryable-default policy covers only the transient classes above.
	ErrCodeRuntimeDeadlineExceeded   = "runtime_deadline_exceeded"    // Run hit CLOUD_RUNTIME_MAX_DURATION.
	ErrCodeRuntimeLLMBudgetExceeded  = "runtime_llm_budget_exceeded"  // Run hit CLOUD_RUNTIME_MAX_LLM_CALLS.
	ErrCodeRuntimeToolBudgetExceeded = "runtime_tool_budget_exceeded" // Run hit CLOUD_RUNTIME_MAX_TOOL_CALLS.
	ErrCodeRuntimeArtifactTooLarge   = "runtime_artifact_too_large"   // Final artifact over CLOUD_RUNTIME_MAX_ARTIFACT_BYTES.
	ErrCodeRuntimeEventTooLarge      = "runtime_event_too_large"      // Emitted event over CLOUD_RUNTIME_MAX_EVENT_BYTES.
	ErrCodeLLMCallFailed             = "llm_call_failed"              // Gateway/upstream/quota failure during a runtime LLM call.
	ErrCodeToolNotAllowed            = "tool_not_allowed"             // Registry denied a tool (terminal escalation only).
	ErrCodeToolInvokeFailed          = "tool_invoke_failed"           // A permitted tool's implementation failed terminally.
	ErrCodeConnectorUnavailable      = "connector_unavailable"        // Connector token missing/expired/unscoped.
)

// knownErrorCodes lets the handler and tests assert a code is part of the taxonomy.
var knownErrorCodes = map[string]struct{}{
	ErrCodeTemporalUnavailable:   {},
	ErrCodeTemporalStartFailed:   {},
	ErrCodeTemporalCancelFailed:  {},
	ErrCodeTemporalSignalFailed:  {},
	ErrCodeAdmissionBackpressure: {},
	ErrCodeAdmissionRateLimited:  {},
	ErrCodeInsufficientCredits:   {},
	ErrCodeDailyCreditLimit:      {},
	ErrCodeMonthlyCreditLimit:    {},
	ErrCodeWorkflowCanceled:      {},
	ErrCodeActivityTimeout:       {},
	ErrCodeActivityFailed:        {},
	ErrCodeTaskNotFound:          {},
	ErrCodeTaskInvalid:           {},
	ErrCodeArtifactWriteFailed:   {},
	ErrCodeDBError:               {},
	ErrCodeInternal:              {},

	ErrCodeRuntimeDeadlineExceeded:   {},
	ErrCodeRuntimeLLMBudgetExceeded:  {},
	ErrCodeRuntimeToolBudgetExceeded: {},
	ErrCodeRuntimeArtifactTooLarge:   {},
	ErrCodeRuntimeEventTooLarge:      {},
	ErrCodeLLMCallFailed:             {},
	ErrCodeToolNotAllowed:            {},
	ErrCodeToolInvokeFailed:          {},
	ErrCodeConnectorUnavailable:      {},
}

// IsKnownErrorCode reports whether code belongs to the taxonomy.
func IsKnownErrorCode(code string) bool {
	_, ok := knownErrorCodes[code]
	return ok
}

// taggedError wraps an activity failure with a granular code so the workflow can
// recover it from the (otherwise opaque) Temporal error chain. The "type" of the
// ApplicationError carries our code across the workflow boundary in both cases.
//
// Only PERMANENT failures are marked non-retryable: retrying an unparseable id or
// a vanished task cannot change the outcome. Transient classes (db_error,
// artifact_write_failed) are returned RETRYABLE so a momentary DB blip or write
// contention is absorbed by the activity's retry budget instead of failing the
// run on the first attempt.
func taggedError(code, message string, cause error) error {
	switch code {
	case ErrCodeTaskNotFound, ErrCodeTaskInvalid:
		return temporal.NewNonRetryableApplicationError(message, code, cause)
	default:
		return temporal.NewApplicationError(message, code, cause)
	}
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
