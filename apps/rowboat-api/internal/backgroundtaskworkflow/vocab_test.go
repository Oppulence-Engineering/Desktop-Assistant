package backgroundtaskworkflow

import (
	"errors"
	"testing"

	"go.temporal.io/sdk/temporal"
)

// TestRuntimeErrorCodesAreKnown locks the RFC 004 taxonomy additions into the
// known set (the desktop surfaces these codes raw; an unknown code would be
// re-bucketed as activity_failed by MarkRunFailed's cardinality guard).
func TestRuntimeErrorCodesAreKnown(t *testing.T) {
	for _, code := range []string{
		ErrCodeRuntimeDeadlineExceeded,
		ErrCodeRuntimeLLMBudgetExceeded,
		ErrCodeRuntimeToolBudgetExceeded,
		ErrCodeRuntimeArtifactTooLarge,
		ErrCodeRuntimeEventTooLarge,
		ErrCodeLLMCallFailed,
		ErrCodeToolNotAllowed,
		ErrCodeToolInvokeFailed,
		ErrCodeConnectorUnavailable,
	} {
		if !IsKnownErrorCode(code) {
			t.Fatalf("runtime code %q missing from knownErrorCodes", code)
		}
	}
}

// TestTaggedErrorRetryPolicyUnchanged guards the legacy taxonomy's documented
// retryable-default: runtime codes must NOT be routed through taggedError (they
// get NewNonRetryableApplicationError via mapRuntimeError instead), so
// taggedError's behavior for the transient classes stays as-is.
func TestTaggedErrorRetryPolicyUnchanged(t *testing.T) {
	var appErr *temporal.ApplicationError

	if err := taggedError(ErrCodeDBError, "x", nil); !errors.As(err, &appErr) || appErr.NonRetryable() {
		t.Fatalf("db_error must remain retryable through taggedError")
	}
	if err := taggedError(ErrCodeTaskNotFound, "x", nil); !errors.As(err, &appErr) || !appErr.NonRetryable() {
		t.Fatalf("task_not_found must remain non-retryable through taggedError")
	}
}

// TestRuntimeEventTypesAreKnown locks the runtime.* transcript vocabulary in.
func TestRuntimeEventTypesAreKnown(t *testing.T) {
	for _, et := range []string{
		EventRuntimeLLMCallStarted,
		EventRuntimeLLMCallCompleted,
		EventRuntimeToolCallStarted,
		EventRuntimeToolCallCompleted,
		EventRuntimeToolDenied,
		EventRuntimeLimitExceeded,
		EventRuntimeFinalArtifactReady,
	} {
		if !IsKnownEventType(et) {
			t.Fatalf("runtime event type %q missing from knownEventTypes", et)
		}
	}
	if IsKnownEventType("runtime.shell_executed") {
		t.Fatal("unknown event types must not be known")
	}
}
