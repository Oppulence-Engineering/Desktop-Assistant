package agentworkflow

import (
	"context"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/client"
)

// StartResult is returned to the HTTP handler after Temporal accepts the start.
type StartResult struct {
	WorkflowID string
	RunID      string
}

// Controller is the Temporal surface the HTTP API uses. It is deliberately small
// so handler tests can fake it without importing the Temporal SDK.
type Controller interface {
	StartSession(ctx context.Context, state SessionState) (StartResult, error)
	SubmitTurn(ctx context.Context, workflowID string, in TurnInput) (TurnAck, error)
	ApproveAction(ctx context.Context, workflowID string, in ApproveAction) (TurnAck, error)
	SignalControl(ctx context.Context, workflowID, signal string, payload map[string]any) error
	CancelSession(ctx context.Context, workflowID string) error
}

// Starter adapts the Temporal SDK client to Controller.
type Starter struct {
	client    client.Client
	taskQueue string
}

// NewStarter builds a Controller for the HTTP API process.
func NewStarter(c client.Client, cfg appconfig.Config) *Starter {
	return &Starter{client: c, taskQueue: cfg.TemporalTaskQueue}
}

// StartSession starts (or no-ops onto) the session workflow under its stable id.
// ALLOW_DUPLICATE lets a new turn on a closed session start a fresh run under the
// same workflow id (the continuation token keeps resolving), while a still-live
// run is reused.
func (s *Starter) StartSession(ctx context.Context, state SessionState) (StartResult, error) {
	workflowID := WorkflowID(state.Start.UserID, state.Start.SessionID)
	run, err := s.client.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:                    workflowID,
		TaskQueue:             s.taskQueue,
		WorkflowIDReusePolicy: enums.WORKFLOW_ID_REUSE_POLICY_ALLOW_DUPLICATE,
	}, SessionWorkflowName, state)
	if err != nil {
		return StartResult{}, err
	}
	return StartResult{WorkflowID: run.GetID(), RunID: run.GetRunID()}, nil
}

// SubmitTurn delivers a validated turn via the submitTurn Update and returns the
// synchronous ack (turn seq). Targeting by workflow id (empty run id) follows
// the latest run, so it survives ContinueAsNew transparently.
func (s *Starter) SubmitTurn(ctx context.Context, workflowID string, in TurnInput) (TurnAck, error) {
	handle, err := s.client.UpdateWorkflow(ctx, client.UpdateWorkflowOptions{
		WorkflowID:   workflowID,
		UpdateName:   UpdateSubmitTurn,
		Args:         []any{in},
		WaitForStage: client.WorkflowUpdateStageCompleted,
	})
	if err != nil {
		return TurnAck{}, err
	}
	var ack TurnAck
	if err := handle.Get(ctx, &ack); err != nil {
		return TurnAck{}, err
	}
	return ack, nil
}

// ApproveAction resolves a pending HITL approval via the approveAction Update.
func (s *Starter) ApproveAction(ctx context.Context, workflowID string, in ApproveAction) (TurnAck, error) {
	handle, err := s.client.UpdateWorkflow(ctx, client.UpdateWorkflowOptions{
		WorkflowID:   workflowID,
		UpdateName:   UpdateApproveAction,
		Args:         []any{in},
		WaitForStage: client.WorkflowUpdateStageCompleted,
	})
	if err != nil {
		return TurnAck{}, err
	}
	var ack TurnAck
	if err := handle.Get(ctx, &ack); err != nil {
		return TurnAck{}, err
	}
	return ack, nil
}

// SignalControl sends a fire-and-forget control signal (cancel/pause).
func (s *Starter) SignalControl(ctx context.Context, workflowID, signal string, payload map[string]any) error {
	return s.client.SignalWorkflow(ctx, workflowID, "", SignalControl, ControlSignal{Signal: signal, Payload: payload})
}

// CancelSession requests a graceful cancel via the control signal so the
// workflow writes its terminal projection cleanly.
func (s *Starter) CancelSession(ctx context.Context, workflowID string) error {
	return s.SignalControl(ctx, workflowID, "cancel", nil)
}
