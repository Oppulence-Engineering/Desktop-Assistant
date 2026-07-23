package backgroundtaskworkflow

import (
	"context"
	"fmt"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/actions"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
)

// actionProposerAdapter bridges the runtime's propose-only action tool to the
// RFC 023 broker: it resolves the run owner and records a pending proposal
// under that owner's tenancy. It never exposes approve or execute.
type actionProposerAdapter struct {
	broker *actions.Broker
	client *ent.Client
}

// NewActionProposer builds the adapter the worker sets on Activities when
// ACTIONS_ENABLED. broker must be non-nil.
func NewActionProposer(broker *actions.Broker, client *ent.Client) backgroundtaskruntime.ActionProposer {
	return &actionProposerAdapter{broker: broker, client: client}
}

// ProposeAction loads the owner and records a pending proposal on their behalf.
func (a *actionProposerAdapter) ProposeAction(ctx context.Context, req backgroundtaskruntime.ActionProposalRequest) (backgroundtaskruntime.ActionProposal, error) {
	owner, err := a.client.User.Get(auth.WithInternal(ctx), req.UserID)
	if err != nil {
		return backgroundtaskruntime.ActionProposal{}, fmt.Errorf("resolve run owner: %w", err)
	}
	vctx := auth.WithUser(ctx, owner)
	p, err := a.broker.Propose(vctx, owner, actions.ProposeInput{
		Target:      req.Target,
		Kind:        req.Kind,
		ParamsJSON:  req.ParamsJSON,
		Financial:   req.Financial,
		Rationale:   req.Rationale,
		EntityID:    req.EntityID,
		OriginRunID: req.RunID,
	})
	if err != nil {
		return backgroundtaskruntime.ActionProposal{}, err
	}
	return backgroundtaskruntime.ActionProposal{
		ProposalID:    p.ID.String(),
		CorrelationID: p.CorrelationID,
		Status:        p.Status,
	}, nil
}
