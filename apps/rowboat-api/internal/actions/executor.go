package actions

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// ExecRequest is one approved, token-verified action handed to the product Act
// seam (RFC 013/020). The broker has already verified and consumed the
// single-use approval token before an executor is ever called, so an Executor
// implementation may treat the request as authorized — but it must still scope
// every product call to exactly UserID's own connected account.
type ExecRequest struct {
	UserID     uuid.UUID
	Kind       string // product action kind, e.g. "conduit.dunning.advance"
	Target     string // resourceRef, e.g. "conduit:invoice:inv_456"
	ParamsJSON string // validated params
	// CorrelationID is echoed to the product so its resulting state-change
	// CloudEvent can be matched back to this proposal on the Watch leg.
	CorrelationID string
}

// ExecResult reports the product's immediate response to a successful action.
type ExecResult struct {
	// ResultRef is the product's id for the resulting object/step (e.g. the new
	// dunning step id), recorded on the proposal and linked to the return event.
	ResultRef string
}

// ErrAmbiguous marks a failure where the action MAY have reached the product
// (a timeout or 5xx). Like the revenue executor, the broker never auto-retries
// an ambiguous action: retry is a fresh proposal after reconciling by product
// state, so money can never move twice from one approval.
var ErrAmbiguous = errors.New("actions: execution outcome is ambiguous")

// Executor is the product Act seam. Concrete implementations (a product MCP
// server, the native action engine of RFC 020) execute one approved action
// against the product. The broker owns the token contract; the Executor owns
// the product call. A nil Executor means execution is not configured and the
// broker fails closed (no token is consumed).
type Executor interface {
	Execute(ctx context.Context, req ExecRequest) (*ExecResult, error)
}
