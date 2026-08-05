package revenue

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/person"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personidentity"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personmergecandidate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipparticipant"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
)

// Human review of person merge candidates.
//
// Persons are never merged automatically, so this is the only path that joins two.
// It is non-destructive: the loser is tombstoned rather than deleted, and the exact
// moved id sets are recorded so the merge can be undone without guessing.

// PersonMergeDecisionInput is a version-bound human decision.
type PersonMergeDecisionInput struct {
	Decision        string `json:"decision"`
	Reason          string `json:"reason"`
	ExpectedVersion int    `json:"expectedVersion"`
	IdempotencyKey  string `json:"idempotencyKey"`
}

type personMergeCompensation struct {
	SurvivorID     string   `json:"survivorId"`
	MergedID       string   `json:"mergedId"`
	IdentityIDs    []string `json:"identityIds"`
	ParticipantIDs []string `json:"participantIds"`
}

// DecidePersonMergeCandidate applies a decision to one candidate.
//
// Uses the same optimistic version check as the relationship identity review: a
// decision is bound to the candidate version the reviewer actually saw, so evidence
// arriving mid-review cannot silently change what they were agreeing to.
func (s *Service) DecidePersonMergeCandidate(
	ctx context.Context,
	u *ent.User,
	candidateID uuid.UUID,
	input PersonMergeDecisionInput,
) (*ent.PersonMergeCandidate, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceContribute)
	if err != nil {
		return nil, err
	}
	decision := strings.TrimSpace(input.Decision)
	switch decision {
	case "merge", "keep_separate", "defer":
	default:
		return nil, fmt.Errorf("%w: decision must be merge, keep_separate, or defer", ErrInvalidInput)
	}

	candidate, err := s.client.PersonMergeCandidate.Query().
		Where(
			personmergecandidate.IDEQ(candidateID),
			personmergecandidate.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		).
		WithProposedPerson().
		WithExistingPerson().
		Only(ctx)
	if ent.IsNotFound(err) {
		return nil, fmt.Errorf("%w: person merge candidate", ErrNotFound)
	}
	if err != nil {
		return nil, err
	}

	// Replay of the same decision returns the stored result rather than merging twice.
	if candidate.Status == "resolved" && candidate.IdempotencyKey != "" &&
		candidate.IdempotencyKey == strings.TrimSpace(input.IdempotencyKey) {
		return candidate, nil
	}
	if candidate.Status == "resolved" {
		return nil, fmt.Errorf("%w: candidate is already resolved", ErrConflict)
	}
	if input.ExpectedVersion != 0 && input.ExpectedVersion != candidate.Version {
		return nil, fmt.Errorf(
			"%w: candidate changed since it was reviewed (version %d, expected %d)",
			ErrConflict, candidate.Version, input.ExpectedVersion,
		)
	}

	update := candidate.Update().
		SetDecision(decision).
		SetDecisionActorID(u.ID).
		SetDecidedAt(s.now().UTC()).
		SetVersion(candidate.Version + 1)
	if strings.TrimSpace(input.Reason) != "" {
		update.SetDecisionReason(input.Reason)
	}
	if key := strings.TrimSpace(input.IdempotencyKey); key != "" {
		update.SetIdempotencyKey(key)
	}

	switch decision {
	case "defer":
		update.SetStatus("deferred")
	case "keep_separate":
		// Both people stand. The candidate is closed so it stops being asked.
		update.SetStatus("resolved")
	case "merge":
		compensation, mergeErr := s.mergePersons(ctx, candidate)
		if mergeErr != nil {
			return nil, mergeErr
		}
		encoded, encodeErr := json.Marshal(compensation)
		if encodeErr != nil {
			return nil, encodeErr
		}
		update.SetStatus("resolved").SetPreviousStateJSON(string(encoded))
	}

	return update.Save(ctx)
}

// mergePersons folds the proposed person into the existing one.
//
// Moves exactly two things -- identity anchors and participant links -- and
// tombstones the loser. That narrowness is why this needs no separate decision
// ledger: nothing is destroyed, and previous_state_json holds everything required
// to reverse it.
func (s *Service) mergePersons(
	ctx context.Context,
	candidate *ent.PersonMergeCandidate,
) (personMergeCompensation, error) {
	out := personMergeCompensation{}
	proposed, err := candidate.Edges.ProposedPersonOrErr()
	if err != nil {
		return out, err
	}
	survivor, err := candidate.Edges.ExistingPersonOrErr()
	if err != nil {
		return out, err
	}
	if proposed.ID == survivor.ID {
		return out, fmt.Errorf("%w: a person cannot be merged into itself", ErrInvalidInput)
	}
	// The older record survives: it carries the longer history and is what existing
	// links already point at.
	if proposed.CreatedAt.Before(survivor.CreatedAt) {
		proposed, survivor = survivor, proposed
	}
	out.SurvivorID = survivor.ID.String()
	out.MergedID = proposed.ID.String()

	identities, err := s.client.PersonIdentity.Query().
		Where(personidentity.HasPersonWith(person.IDEQ(proposed.ID))).All(ctx)
	if err != nil {
		return out, err
	}
	for _, identity := range identities {
		if _, err := identity.Update().SetPersonID(survivor.ID).Save(ctx); err != nil {
			return out, err
		}
		out.IdentityIDs = append(out.IdentityIDs, identity.ID.String())
	}

	participants, err := s.client.RelationshipParticipant.Query().
		Where(relationshipparticipant.HasPersonWith(person.IDEQ(proposed.ID))).All(ctx)
	if err != nil {
		return out, err
	}
	for _, participant := range participants {
		if _, err := participant.Update().SetPersonID(survivor.ID).Save(ctx); err != nil {
			return out, err
		}
		out.ParticipantIDs = append(out.ParticipantIDs, participant.ID.String())
	}

	// Tombstone, never delete: an old link to the merged id must keep resolving.
	if _, err := proposed.Update().
		SetStatus("merged").
		SetMergedIntoPersonID(survivor.ID).
		SetMergedAt(s.now().UTC()).
		Save(ctx); err != nil {
		return out, err
	}
	if _, err := projectPersonAttributes(ctx, s.client, survivor, s.now()); err != nil {
		return out, err
	}
	return out, refreshPersonInteractionRollup(ctx, s.client, survivor)
}
