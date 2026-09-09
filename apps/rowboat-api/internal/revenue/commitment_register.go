package revenue

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitment"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
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

// storedStatusesFor maps requested register states onto the statuses actually
// stored, so the database filters what it can and only the derived states need
// a pass in Go.
func storedStatusesFor(states []string) (stored []string, needsDerived bool) {
	seen := map[string]bool{}
	for _, state := range states {
		switch strings.TrimSpace(state) {
		case RegisterMet:
			seen["fulfilled"] = true
		case RegisterMissed:
			seen["missed"] = true
		case RegisterWaived:
			seen["waived"] = true
		case "cancelled":
			seen["cancelled"] = true
		case "superseded":
			seen["superseded"] = true
		case RegisterOpen, RegisterAtRisk, RegisterDisputed:
			// All three live in the "open" row and separate only after the
			// projection above, so the query keeps them together.
			seen["open"] = true
			needsDerived = true
		}
	}
	for status := range seen {
		stored = append(stored, status)
	}
	return stored, needsDerived
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

	stored, needsDerived := storedStatusesFor(f.States)
	if len(stored) > 0 {
		q = q.Where(commitment.StatusIn(stored...))
	}
	q = q.WithRelationship().Order(ent.Asc(commitment.FieldDueAt), ent.Desc(commitment.FieldCreatedAt))

	// A derived state cannot be filtered in SQL, so when one is requested the
	// page is assembled in Go over a bounded window rather than by LIMIT alone.
	//
	// ponytail: the window caps how deep a derived-state filter can page. A
	// workspace with more open commitments than the window will not see the
	// tail. Store at_risk on write, or paginate by keyset, if that ever bites.
	if !needsDerived || len(f.States) == 0 {
		return q.Limit(limit).Offset(f.Offset).All(ctx)
	}
	rows, err := q.Limit(f.Offset + limit*4 + 200).All(ctx)
	if err != nil {
		return nil, err
	}
	want := map[string]bool{}
	for _, state := range f.States {
		want[strings.TrimSpace(state)] = true
	}
	now := s.now().UTC()
	kept := make([]*ent.Commitment, 0, limit)
	skipped := 0
	for _, row := range rows {
		if !want[commitmentRegisterState(row, now)] {
			continue
		}
		if skipped < f.Offset {
			skipped++
			continue
		}
		kept = append(kept, row)
		if len(kept) == limit {
			break
		}
	}
	return kept, nil
}
