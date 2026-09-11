package revenue

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/person"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personattribute"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personidentity"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personinteractionstat"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personmergecandidate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
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
	SurvivorID       string                          `json:"survivorId"`
	MergedID         string                          `json:"mergedId"`
	MergeDecision    personMergeDecisionSnapshot     `json:"mergeDecision"`
	IdentityIDs      []string                        `json:"identityIds"`
	AttributeIDs     []string                        `json:"attributeIds"`
	ParticipantIDs   []string                        `json:"participantIds"`
	InteractionStats []personInteractionCompensation `json:"interactionStats"`
}

type personMergeDecisionSnapshot struct {
	Reason    string    `json:"reason"`
	ActorID   string    `json:"actorId"`
	DecidedAt time.Time `json:"decidedAt"`
}

type personInteractionCompensation struct {
	StatID           string                     `json:"statId"`
	RelationshipID   string                     `json:"relationshipId"`
	Moved            bool                       `json:"moved"`
	MergedIntoStatID string                     `json:"mergedIntoStatId,omitempty"`
	Before           personInteractionSnapshot  `json:"before"`
	MergedIntoBefore *personInteractionSnapshot `json:"mergedIntoBefore,omitempty"`
	After            personInteractionSnapshot  `json:"after"`
}

type personInteractionSnapshot struct {
	CreatedAt          time.Time      `json:"createdAt"`
	UpdatedAt          time.Time      `json:"updatedAt"`
	FirstInteractionAt time.Time      `json:"firstInteractionAt"`
	LastInteractionAt  time.Time      `json:"lastInteractionAt"`
	LastInboundAt      *time.Time     `json:"lastInboundAt,omitempty"`
	LastOutboundAt     *time.Time     `json:"lastOutboundAt,omitempty"`
	InteractionCount   int            `json:"interactionCount"`
	InboundCount       int            `json:"inboundCount"`
	OutboundCount      int            `json:"outboundCount"`
	MeetingCount       int            `json:"meetingCount"`
	ChannelCounts      map[string]int `json:"channelCounts"`
	SourceCounts       map[string]int `json:"sourceCounts"`
	LastChannel        string         `json:"lastChannel,omitempty"`
	LastDirection      string         `json:"lastDirection,omitempty"`
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
	decision := strings.ToLower(strings.TrimSpace(input.Decision))
	reason := strings.TrimSpace(input.Reason)
	idempotencyKey := strings.TrimSpace(input.IdempotencyKey)
	if input.ExpectedVersion <= 0 || reason == "" || idempotencyKey == "" {
		return nil, fmt.Errorf("%w: expectedVersion, reason, and idempotencyKey are required", ErrInvalidInput)
	}
	switch decision {
	case "merge", "keep_separate", "defer", "undo":
	default:
		return nil, fmt.Errorf("%w: decision must be merge, keep_separate, defer, or undo", ErrInvalidInput)
	}

	if replay, replayErr := s.client.PersonMergeCandidate.Query().
		Where(
			personmergecandidate.IDEQ(candidateID),
			personmergecandidate.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			personmergecandidate.IdempotencyKeyEQ(idempotencyKey),
		).
		WithProposedPerson().
		WithExistingPerson().
		Only(ctx); replayErr == nil {
		return replay, nil
	} else if !ent.IsNotFound(replayErr) {
		return nil, replayErr
	}

	tx, err := s.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	txc := tx.Client()
	candidate, err := txc.PersonMergeCandidate.Query().
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
	if candidate.IdempotencyKey == idempotencyKey {
		return candidate.Unwrap(), nil
	}
	if decision == "undo" && (candidate.Status != "resolved" || candidate.Decision != "merge") {
		return nil, fmt.Errorf("%w: only a resolved person merge can be undone", ErrConflict)
	}
	if decision != "undo" && (candidate.Status == "resolved" || candidate.Status == "undone") {
		return nil, fmt.Errorf("%w: candidate is already resolved", ErrConflict)
	}
	reserve := txc.PersonMergeCandidate.Update().Where(
		personmergecandidate.IDEQ(candidate.ID),
		personmergecandidate.VersionEQ(input.ExpectedVersion),
	)
	if decision == "undo" {
		reserve.Where(personmergecandidate.StatusEQ("resolved"), personmergecandidate.DecisionEQ("merge"))
	} else {
		reserve.Where(personmergecandidate.StatusIn("pending", "deferred"))
	}
	n, err := reserve.SetStatus("resolving").SetVersion(input.ExpectedVersion + 1).Save(ctx)
	if err != nil {
		return nil, err
	}
	if n != 1 {
		return nil, ErrConflict
	}

	now := s.now().UTC().Truncate(time.Microsecond)
	update := txc.PersonMergeCandidate.Update().Where(
		personmergecandidate.IDEQ(candidate.ID),
		personmergecandidate.VersionEQ(input.ExpectedVersion+1),
		personmergecandidate.StatusEQ("resolving"),
	).
		SetDecision(decision).
		SetDecisionActorID(u.ID).
		SetDecidedAt(now).
		SetDecisionReason(reason).
		SetIdempotencyKey(idempotencyKey)

	switch decision {
	case "defer":
		update.SetStatus("deferred")
	case "keep_separate":
		// Both people stand. The candidate is closed so it stops being asked.
		update.SetStatus("resolved")
	case "merge":
		compensation, mergeErr := s.mergePersons(ctx, txc, candidate, now)
		if mergeErr != nil {
			return nil, mergeErr
		}
		compensation.MergeDecision = personMergeDecisionSnapshot{
			Reason: reason, ActorID: u.ID.String(), DecidedAt: now,
		}
		encoded, encodeErr := json.Marshal(compensation)
		if encodeErr != nil {
			return nil, encodeErr
		}
		update.SetStatus("resolved").SetPreviousStateJSON(string(encoded))
	case "undo":
		if undoErr := s.undoPersonMerge(ctx, txc, ws.ID, candidate, now); undoErr != nil {
			return nil, undoErr
		}
		update.SetStatus("undone")
	}
	if n, err = update.Save(ctx); err != nil || n != 1 {
		if err != nil {
			return nil, err
		}
		return nil, ErrConflict
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.client.PersonMergeCandidate.Query().
		Where(
			personmergecandidate.IDEQ(candidateID),
			personmergecandidate.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		).
		WithProposedPerson().
		WithExistingPerson().
		Only(ctx)
}

// mergePersons folds the proposed person into the existing one.
//
// Moves all person-owned profile and interaction facts and tombstones the loser.
// previous_state_json records exact moved ids and both sides of combined rollups,
// so a later undo never has to reconstruct prior state from current data.
func (s *Service) mergePersons(
	ctx context.Context,
	client *ent.Client,
	candidate *ent.PersonMergeCandidate,
	now time.Time,
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
	if proposed.Status != "active" || survivor.Status != "active" {
		return out, fmt.Errorf("%w: both people must be active to merge", ErrConflict)
	}
	out.SurvivorID = survivor.ID.String()
	out.MergedID = proposed.ID.String()

	identities, err := client.PersonIdentity.Query().
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

	attributes, err := client.PersonAttribute.Query().
		Where(personattribute.HasPersonWith(person.IDEQ(proposed.ID))).All(ctx)
	if err != nil {
		return out, err
	}
	for _, attribute := range attributes {
		if _, err := attribute.Update().SetPersonID(survivor.ID).Save(ctx); err != nil {
			return out, err
		}
		out.AttributeIDs = append(out.AttributeIDs, attribute.ID.String())
	}

	stats, err := client.PersonInteractionStat.Query().
		Where(personinteractionstat.HasPersonWith(person.IDEQ(proposed.ID))).
		WithRelationship().All(ctx)
	if err != nil {
		return out, err
	}
	for _, stat := range stats {
		rel, edgeErr := stat.Edges.RelationshipOrErr()
		if edgeErr != nil {
			return out, edgeErr
		}
		change := personInteractionCompensation{
			StatID: stat.ID.String(), RelationshipID: rel.ID.String(),
			Before: snapshotPersonInteraction(stat),
		}
		existing, findErr := client.PersonInteractionStat.Query().Where(
			personinteractionstat.HasPersonWith(person.IDEQ(survivor.ID)),
			personinteractionstat.HasRelationshipWith(relationship.IDEQ(rel.ID)),
		).Only(ctx)
		if ent.IsNotFound(findErr) {
			updated, err := stat.Update().SetPersonID(survivor.ID).SetUpdatedAt(now).Save(ctx)
			if err != nil {
				return out, err
			}
			change.Moved = true
			change.After = snapshotPersonInteraction(updated)
			out.InteractionStats = append(out.InteractionStats, change)
			continue
		}
		if findErr != nil {
			return out, findErr
		}
		before := snapshotPersonInteraction(existing)
		change.MergedIntoStatID = existing.ID.String()
		change.MergedIntoBefore = &before

		first, last := existing.FirstInteractionAt, existing.LastInteractionAt
		lastChannel, lastDirection := existing.LastChannel, existing.LastDirection
		if stat.FirstInteractionAt.Before(first) {
			first = stat.FirstInteractionAt
		}
		if stat.LastInteractionAt.After(last) {
			last = stat.LastInteractionAt
			lastChannel, lastDirection = stat.LastChannel, stat.LastDirection
		}
		update := existing.Update().
			SetFirstInteractionAt(first).
			SetLastInteractionAt(last).
			SetInteractionCount(existing.InteractionCount + stat.InteractionCount).
			SetInboundCount(existing.InboundCount + stat.InboundCount).
			SetOutboundCount(existing.OutboundCount + stat.OutboundCount).
			SetMeetingCount(existing.MeetingCount + stat.MeetingCount).
			SetChannelCounts(sumCounts(existing.ChannelCounts, stat.ChannelCounts)).
			SetSourceCounts(sumCounts(existing.SourceCounts, stat.SourceCounts))
		if inbound := laterTime(existing.LastInboundAt, stat.LastInboundAt); inbound != nil {
			update.SetLastInboundAt(*inbound)
		} else {
			update.ClearLastInboundAt()
		}
		if outbound := laterTime(existing.LastOutboundAt, stat.LastOutboundAt); outbound != nil {
			update.SetLastOutboundAt(*outbound)
		} else {
			update.ClearLastOutboundAt()
		}
		if lastChannel == "" {
			update.ClearLastChannel()
		} else {
			update.SetLastChannel(lastChannel)
		}
		if lastDirection == "" {
			update.ClearLastDirection()
		} else {
			update.SetLastDirection(lastDirection)
		}
		updated, err := update.SetUpdatedAt(now).Save(ctx)
		if err != nil {
			return out, err
		}
		change.After = snapshotPersonInteraction(updated)
		if err := client.PersonInteractionStat.DeleteOne(stat).Exec(ctx); err != nil {
			return out, err
		}
		out.InteractionStats = append(out.InteractionStats, change)
	}

	participants, err := client.RelationshipParticipant.Query().
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
		SetMergedAt(now).
		Save(ctx); err != nil {
		return out, err
	}
	if _, err := projectPersonAttributes(ctx, client, survivor, now); err != nil {
		return out, err
	}
	return out, refreshPersonInteractionRollup(ctx, client, survivor)
}

func (s *Service) undoPersonMerge(
	ctx context.Context,
	client *ent.Client,
	workspaceID uuid.UUID,
	candidate *ent.PersonMergeCandidate,
	now time.Time,
) error {
	var state personMergeCompensation
	if err := json.Unmarshal([]byte(candidate.PreviousStateJSON), &state); err != nil {
		return fmt.Errorf("%w: invalid person merge compensation: %w", ErrConflict, err)
	}
	survivorID, err := compensationUUID(state.SurvivorID, "survivorId")
	if err != nil {
		return err
	}
	mergedID, err := compensationUUID(state.MergedID, "mergedId")
	if err != nil {
		return err
	}
	proposed, proposedErr := candidate.Edges.ProposedPersonOrErr()
	existing, existingErr := candidate.Edges.ExistingPersonOrErr()
	forward := survivorID == proposed.ID && mergedID == existing.ID
	reverse := survivorID == existing.ID && mergedID == proposed.ID
	if proposedErr != nil || existingErr != nil || (!forward && !reverse) {
		return fmt.Errorf("%w: person merge compensation does not match the candidate", ErrConflict)
	}
	survivor, err := client.Person.Query().Where(
		person.IDEQ(survivorID), person.HasWorkspaceWith(revenueworkspace.IDEQ(workspaceID)),
	).Only(ctx)
	if ent.IsNotFound(err) {
		return fmt.Errorf("%w: merge survivor is unavailable", ErrConflict)
	}
	if err != nil {
		return err
	}
	merged, err := client.Person.Query().Where(
		person.IDEQ(mergedID), person.HasWorkspaceWith(revenueworkspace.IDEQ(workspaceID)),
	).Only(ctx)
	if ent.IsNotFound(err) {
		return fmt.Errorf("%w: merged person is unavailable", ErrConflict)
	}
	if err != nil {
		return err
	}
	if survivor.Status != "active" || merged.Status != "merged" || merged.MergedIntoPersonID == nil || *merged.MergedIntoPersonID != survivor.ID {
		return fmt.Errorf("%w: people changed since this merge", ErrConflict)
	}

	validatedStats := make(map[string]*ent.PersonInteractionStat, len(state.InteractionStats))
	for _, change := range state.InteractionStats {
		statID := change.StatID
		if !change.Moved {
			if change.MergedIntoBefore == nil {
				return fmt.Errorf("%w: incomplete person merge compensation", ErrConflict)
			}
			statID = change.MergedIntoStatID
		}
		currentID, parseErr := compensationUUID(statID, "interaction stat id")
		if parseErr != nil {
			return parseErr
		}
		relationshipID, parseErr := compensationUUID(change.RelationshipID, "relationshipId")
		if parseErr != nil {
			return parseErr
		}
		current, findErr := client.PersonInteractionStat.Query().Where(
			personinteractionstat.IDEQ(currentID),
			personinteractionstat.HasPersonWith(person.IDEQ(survivor.ID)),
			personinteractionstat.HasRelationshipWith(relationship.IDEQ(relationshipID)),
		).Only(ctx)
		if ent.IsNotFound(findErr) || (findErr == nil && !matchesPersonInteraction(current, change.After)) {
			return fmt.Errorf("%w: interaction history changed since this merge", ErrConflict)
		}
		if findErr != nil {
			return findErr
		}
		validatedStats[statID] = current
	}

	for _, rawID := range state.IdentityIDs {
		id, parseErr := compensationUUID(rawID, "identity id")
		if parseErr != nil {
			return parseErr
		}
		n, moveErr := client.PersonIdentity.Update().Where(
			personidentity.IDEQ(id), personidentity.HasPersonWith(person.IDEQ(survivor.ID)),
		).SetPersonID(merged.ID).Save(ctx)
		if moveErr != nil {
			return moveErr
		}
		if n != 1 {
			return fmt.Errorf("%w: a merged identity changed after review", ErrConflict)
		}
	}
	for _, rawID := range state.AttributeIDs {
		id, parseErr := compensationUUID(rawID, "attribute id")
		if parseErr != nil {
			return parseErr
		}
		n, moveErr := client.PersonAttribute.Update().Where(
			personattribute.IDEQ(id), personattribute.HasPersonWith(person.IDEQ(survivor.ID)),
		).SetPersonID(merged.ID).Save(ctx)
		if moveErr != nil {
			return moveErr
		}
		if n != 1 {
			return fmt.Errorf("%w: a merged profile fact changed after review", ErrConflict)
		}
	}
	for _, rawID := range state.ParticipantIDs {
		id, parseErr := compensationUUID(rawID, "participant id")
		if parseErr != nil {
			return parseErr
		}
		n, moveErr := client.RelationshipParticipant.Update().Where(
			relationshipparticipant.IDEQ(id), relationshipparticipant.HasPersonWith(person.IDEQ(survivor.ID)),
		).SetPersonID(merged.ID).Save(ctx)
		if moveErr != nil {
			return moveErr
		}
		if n != 1 {
			return fmt.Errorf("%w: a merged participant changed after review", ErrConflict)
		}
	}

	for _, change := range state.InteractionStats {
		relationshipID, parseErr := compensationUUID(change.RelationshipID, "relationshipId")
		if parseErr != nil {
			return parseErr
		}
		if change.Moved {
			stat := validatedStats[change.StatID]
			if _, err := restorePersonInteraction(stat.Update().SetPersonID(merged.ID), change.Before).Save(ctx); err != nil {
				return err
			}
			continue
		}
		target := validatedStats[change.MergedIntoStatID]
		if _, err := restorePersonInteraction(target.Update().SetPersonID(survivor.ID), *change.MergedIntoBefore).Save(ctx); err != nil {
			return err
		}
		sourceID, parseErr := compensationUUID(change.StatID, "interaction stat id")
		if parseErr != nil {
			return parseErr
		}
		create := client.PersonInteractionStat.Create().
			SetID(sourceID).SetCreatedAt(change.Before.CreatedAt).SetUpdatedAt(change.Before.UpdatedAt).
			SetWorkspaceID(workspaceID).SetPersonID(merged.ID).SetRelationshipID(relationshipID).
			SetFirstInteractionAt(change.Before.FirstInteractionAt).SetLastInteractionAt(change.Before.LastInteractionAt).
			SetInteractionCount(change.Before.InteractionCount).SetInboundCount(change.Before.InboundCount).
			SetOutboundCount(change.Before.OutboundCount).SetMeetingCount(change.Before.MeetingCount).
			SetChannelCounts(change.Before.ChannelCounts).SetSourceCounts(change.Before.SourceCounts)
		if change.Before.LastInboundAt != nil {
			create.SetLastInboundAt(*change.Before.LastInboundAt)
		}
		if change.Before.LastOutboundAt != nil {
			create.SetLastOutboundAt(*change.Before.LastOutboundAt)
		}
		if change.Before.LastChannel != "" {
			create.SetLastChannel(change.Before.LastChannel)
		}
		if change.Before.LastDirection != "" {
			create.SetLastDirection(change.Before.LastDirection)
		}
		if _, err := create.Save(ctx); err != nil {
			return err
		}
	}

	merged, err = merged.Update().SetStatus("active").ClearMergedIntoPersonID().ClearMergedAt().Save(ctx)
	if err != nil {
		return err
	}
	if _, err := projectPersonAttributes(ctx, client, survivor, now); err != nil {
		return err
	}
	if _, err := projectPersonAttributes(ctx, client, merged, now); err != nil {
		return err
	}
	if err := refreshPersonInteractionRollup(ctx, client, survivor); err != nil {
		return err
	}
	return refreshPersonInteractionRollup(ctx, client, merged)
}

func compensationUUID(raw, field string) (uuid.UUID, error) {
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, fmt.Errorf("%w: invalid %s in person merge compensation", ErrConflict, field)
	}
	return id, nil
}

func restorePersonInteraction(update *ent.PersonInteractionStatUpdateOne, state personInteractionSnapshot) *ent.PersonInteractionStatUpdateOne {
	update.SetUpdatedAt(state.UpdatedAt).
		SetFirstInteractionAt(state.FirstInteractionAt).SetLastInteractionAt(state.LastInteractionAt).
		SetInteractionCount(state.InteractionCount).SetInboundCount(state.InboundCount).
		SetOutboundCount(state.OutboundCount).SetMeetingCount(state.MeetingCount).
		SetChannelCounts(state.ChannelCounts).SetSourceCounts(state.SourceCounts)
	if state.LastInboundAt == nil {
		update.ClearLastInboundAt()
	} else {
		update.SetLastInboundAt(*state.LastInboundAt)
	}
	if state.LastOutboundAt == nil {
		update.ClearLastOutboundAt()
	} else {
		update.SetLastOutboundAt(*state.LastOutboundAt)
	}
	if state.LastChannel == "" {
		update.ClearLastChannel()
	} else {
		update.SetLastChannel(state.LastChannel)
	}
	if state.LastDirection == "" {
		update.ClearLastDirection()
	} else {
		update.SetLastDirection(state.LastDirection)
	}
	return update
}

func matchesPersonInteraction(stat *ent.PersonInteractionStat, state personInteractionSnapshot) bool {
	return stat != nil && stat.CreatedAt.Equal(state.CreatedAt) && stat.UpdatedAt.Equal(state.UpdatedAt) &&
		stat.FirstInteractionAt.Equal(state.FirstInteractionAt) && stat.LastInteractionAt.Equal(state.LastInteractionAt) &&
		equalOptionalTime(stat.LastInboundAt, state.LastInboundAt) && equalOptionalTime(stat.LastOutboundAt, state.LastOutboundAt) &&
		stat.InteractionCount == state.InteractionCount && stat.InboundCount == state.InboundCount &&
		stat.OutboundCount == state.OutboundCount && stat.MeetingCount == state.MeetingCount &&
		maps.Equal(stat.ChannelCounts, state.ChannelCounts) && maps.Equal(stat.SourceCounts, state.SourceCounts) &&
		stat.LastChannel == state.LastChannel && stat.LastDirection == state.LastDirection
}

func equalOptionalTime(a, b *time.Time) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && a.Equal(*b))
}

func snapshotPersonInteraction(stat *ent.PersonInteractionStat) personInteractionSnapshot {
	return personInteractionSnapshot{
		CreatedAt: stat.CreatedAt, UpdatedAt: stat.UpdatedAt,
		FirstInteractionAt: stat.FirstInteractionAt, LastInteractionAt: stat.LastInteractionAt,
		LastInboundAt: stat.LastInboundAt, LastOutboundAt: stat.LastOutboundAt,
		InteractionCount: stat.InteractionCount, InboundCount: stat.InboundCount,
		OutboundCount: stat.OutboundCount, MeetingCount: stat.MeetingCount,
		ChannelCounts: copyCounts(stat.ChannelCounts), SourceCounts: copyCounts(stat.SourceCounts),
		LastChannel: stat.LastChannel, LastDirection: stat.LastDirection,
	}
}

func laterTime(a, b *time.Time) *time.Time {
	if a == nil {
		return b
	}
	if b != nil && b.After(*a) {
		return b
	}
	return a
}

func sumCounts(a, b map[string]int) map[string]int {
	out := copyCounts(a)
	for key, value := range b {
		out[key] += value
	}
	return out
}
