package backgroundtaskruntime

import (
	"errors"
	"fmt"
)

// RuntimeError is a classified, NON-retryable runtime failure. The workflow
// maps it to a non-retryable Temporal ApplicationError carrying Code (see
// backgroundtaskworkflow.mapRuntimeError) so it lands in error_code /
// cloud_runs_failed_total{error_code} unchanged.
type RuntimeError struct {
	Code    string // one of the Code* constants (codes.go)
	Message string
	Cause   error
}

func (e *RuntimeError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("%s: %s: %v", e.Code, e.Message, e.Cause)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func (e *RuntimeError) Unwrap() error { return e.Cause }

// ErrToolNotAllowed is the registry's deny-by-default sentinel.
var ErrToolNotAllowed = &RuntimeError{
	Code:    CodeToolNotAllowed,
	Message: "tool is not on the allowlist or the run's scope does not permit it",
}

// limitError builds the breach error for one limit, named for the
// cloud_runtime_limit_exceeded_total{limit} label.
func limitError(code, limit string, value, maxVal any) *RuntimeError {
	return &RuntimeError{
		Code:    code,
		Message: fmt.Sprintf("%s limit exceeded (%v > %v)", limit, value, maxVal),
	}
}

// AsRuntimeError extracts a *RuntimeError from an error chain.
func AsRuntimeError(err error) (*RuntimeError, bool) {
	var re *RuntimeError
	ok := errors.As(err, &re)
	return re, ok
}
