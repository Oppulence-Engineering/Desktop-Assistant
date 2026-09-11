package revenue

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitment"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/predicate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueevidence"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
)

// The commitment register is the cross-account list of obligations. Every other
// commitment route in this service is scoped to one relationship, which answers
// "what does this account owe" and cannot answer "what do we owe anyone". The
// register answers the second question, which is the product.

// AtRiskWindow is how long before a due date an open commitment reads as at
// risk.
//
// At risk is derived here, never stored: it is a fact about the clock, not a
// decision anyone made, so storing it would need a sweeper job to keep true.
//
// ponytail: 72h is a placeholder. Tune it with the first design partner; it is
// the only number in the register that is a guess.
const AtRiskWindow = 72 * time.Hour

// Register states. These are the seven states of the one-pager §4, as the user
// reads them, which is not the same vocabulary the database stores: "met" is
// stored as "fulfilled", "at risk" is derived, and "renegotiated" is an event
// rather than a resting status.
const (
	RegisterOpen     = "open"
	RegisterAtRisk   = "at_risk"
	RegisterMet      = "met"
	RegisterMissed   = "missed"
	RegisterWaived   = "waived"
	RegisterDisputed = "disputed"
)

// CommitmentFilter bounds one page of the register.
type CommitmentFilter struct {
	Direction      string
	States         []string
	Owner          string
	RelationshipID uuid.UUID
	DueBefore      time.Time
	ChangedSince   time.Time
	EvidenceSince  time.Time
	Limit          int
	Offset         int

	// IncludeCandidates admits unconfirmed extractions into the results.
	//
	// One-pager §6: "Low-confidence extractions enter a review queue rather
	// than the register." A candidate is a model's opinion that no human has
	// confirmed, so it stays out of the register by default. The review queue
	// sets this to see them.
	IncludeCandidates bool
}

// commitmentRegisterState projects a stored commitment onto the state the user
// reads in the register.
func commitmentRegisterState(row *ent.Commitment, now time.Time) string {
	switch row.Status {
	case "fulfilled":
		return RegisterMet
	case "missed":
		return RegisterMissed
	case "waived":
		return RegisterWaived
	case "cancelled", "superseded":
		return row.Status
	}
	if row.Acceptance == "disputed" {
		return RegisterDisputed
	}
	// One-pager §4: absence of fulfilment evidence produces *at risk*, which
	// prompts a human. It never produces missed on its own.
	if row.DueAt != nil && row.DueAt.Before(now.Add(AtRiskWindow)) {
		return RegisterAtRisk
	}
	return RegisterOpen
}

// registerStatePredicates maps reader-facing states onto their exact stored
// representation. Keeping the clock projection in SQL makes pagination exact.
func registerStatePredicates(states []string, now time.Time) ([]predicate.Commitment, error) {
	cutoff := now.Add(AtRiskWindow)
	predicates := make([]predicate.Commitment, 0, len(states))
	for _, raw := range states {
		switch state := strings.TrimSpace(raw); state {
		case "":
			continue
		case RegisterMet:
			predicates = append(predicates, commitment.StatusEQ("fulfilled"))
		case RegisterMissed, RegisterWaived, "cancelled", "superseded":
			predicates = append(predicates, commitment.StatusEQ(state))
		case RegisterDisputed:
			predicates = append(predicates, commitment.And(
				commitment.StatusEQ("open"),
				commitment.AcceptanceEQ("disputed"),
			))
		case RegisterAtRisk:
			predicates = append(predicates, commitment.And(
				commitment.StatusEQ("open"),
				commitment.AcceptanceNEQ("disputed"),
				commitment.DueAtNotNil(),
				commitment.DueAtLT(cutoff),
			))
		case RegisterOpen:
			predicates = append(predicates, commitment.And(
				commitment.StatusEQ("open"),
				commitment.AcceptanceNEQ("disputed"),
				commitment.Or(commitment.DueAtIsNil(), commitment.DueAtGTE(cutoff)),
			))
		default:
			return nil, fmt.Errorf("%w: unknown state %q", ErrInvalidInput, state)
		}
	}
	return predicates, nil
}

// ListCommitments returns one page of the register for the caller's workspace.
func (s *Service) ListCommitments(
	ctx context.Context,
	u *ent.User,
	f CommitmentFilter,
) ([]*ent.Commitment, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	if f.Offset < 0 {
		f.Offset = 0
	}
	if f.Direction != "" &&
		f.Direction != "promised_by_me" &&
		f.Direction != "promised_by_them" &&
		f.Direction != "mutual" {
		return nil, fmt.Errorf("%w: unknown direction %q", ErrInvalidInput, f.Direction)
	}
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceView)
	if err != nil {
		return nil, err
	}
	q := s.client.Commitment.Query().Where(
		commitment.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
	)
	if !f.IncludeCandidates {
		q = q.Where(commitment.AcceptanceNEQ("candidate"))
	}
	if f.Direction != "" {
		q = q.Where(commitment.DirectionEQ(f.Direction))
	}
	if f.RelationshipID != uuid.Nil {
		q = q.Where(commitment.HasRelationshipWith(relationship.IDEQ(f.RelationshipID)))
	}
	if owner := strings.TrimSpace(f.Owner); owner != "" {
		q = q.Where(commitment.OwnerParticipantRefEQ(owner))
	}
	if !f.DueBefore.IsZero() {
		q = q.Where(commitment.DueAtNotNil(), commitment.DueAtLT(f.DueBefore.UTC()))
	}
	if !f.ChangedSince.IsZero() {
		q = q.Where(commitment.UpdatedAtGTE(f.ChangedSince.UTC()))
	}
	if !f.EvidenceSince.IsZero() {
		since := f.EvidenceSince.UTC()
		q = q.Where(commitment.HasEvidencesWith(
			revenueevidence.OccurredAtGTE(since),
		)).WithEvidences(func(evidenceQuery *ent.RevenueEvidenceQuery) {
			evidenceQuery.Where(revenueevidence.OccurredAtGTE(since)).Order(ent.Asc(revenueevidence.FieldOccurredAt))
		})
	}
	statePredicates, err := registerStatePredicates(f.States, s.now().UTC())
	if err != nil {
		return nil, err
	}
	if len(statePredicates) > 0 {
		q = q.Where(commitment.Or(statePredicates...))
	}
	q = q.WithRelationship().Order(ent.Asc(commitment.FieldDueAt), ent.Desc(commitment.FieldCreatedAt))
	return q.Limit(limit).Offset(f.Offset).All(ctx)
}
