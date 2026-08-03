package revenue

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	entsql "entgo.io/ent/dialect/sql"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitment"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitmentdependency"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitmentevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/conversationintelligenceartifact"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mailthread"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipassertion"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipidentity"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipidentitycandidate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipidentitydecision"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshiplineageevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipobservation"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipparticipant"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueevidence"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/google/uuid"
)

const (
	identityPending   = "pending"
	identityDeferred  = "deferred"
	identityResolving = "resolving"
	identityResolved  = "resolved"
	identityUndone    = "undone"
)

// IdentityCandidateFilter bounds the workspace inbox without exposing raw
// anchor hashes in query parameters.
type IdentityCandidateFilter struct {
	Status         string
	Source         string
	RelationshipID uuid.UUID
	Limit          int
}

// IdentityDecisionInput is an optimistic, idempotent identity command.
type IdentityDecisionInput struct {
	Decision        string
	Reason          string
	ExpectedVersion int
	IdempotencyKey  string
}

type identityImpact struct {
	Observations int `json:"observations"`
	Assertions   int `json:"assertions"`
	Participants int `json:"participants"`
	Commitments  int `json:"commitments"`
	Actions      int `json:"actions"`
	Evidence     int `json:"evidence"`
}

// createIdentityCandidate makes ambiguity durable in the same transaction as
// ingestion. Advisory confidence never chooses or mutates an anchor owner.
func createIdentityCandidate(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	proposed *ent.Relationship,
	existing *ent.Relationship,
	signal relationshipIdentitySignal,
	candidateType string,
	seenAt time.Time,
) (*ent.RelationshipIdentityCandidate, error) {
	if proposed.ID == existing.ID {
		return nil, nil
	}
	if candidateType == "" {
		candidateType = "anchor_collision"
	}
	ids := []string{proposed.ID.String(), existing.ID.String()}
	sort.Strings(ids)
	sum := sha256.Sum256([]byte(strings.Join(ids, ":") + ":" + signal.KeyHash))
	dedupe := hex.EncodeToString(sum[:])
	existingCandidate, err := client.RelationshipIdentityCandidate.Query().
		Where(
			relationshipidentitycandidate.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			relationshipidentitycandidate.DedupeKeyEQ(dedupe),
		).
		WithProposedRelationship().
		WithExistingRelationship().
		Only(ctx)
	if err == nil {
		return existingCandidate, nil
	}
	if !ent.IsNotFound(err) {
		return nil, err
	}
	impact, err := relationshipIdentityImpact(ctx, client, proposed.ID)
	if err != nil {
		return nil, err
	}
	impactJSON, err := json.Marshal(impact)
	if err != nil {
		return nil, err
	}
	anchorLabel := signal.Kind
	if signal.Provider != "" {
		anchorLabel += ":" + signal.Provider
	}
	if seenAt.IsZero() {
		seenAt = time.Now().UTC()
	}
	candidateID := uuid.New()
	err = client.RelationshipIdentityCandidate.Create().
		SetID(candidateID).
		SetWorkspace(ws).
		SetProposedRelationship(proposed).
		SetExistingRelationship(existing).
		SetUser(u).
		SetDedupeKey(dedupe).
		SetCandidateType(candidateType).
		SetAnchorKind(signal.Kind).
		SetAnchorProvider(signal.Provider).
		SetAnchorKeyHash(signal.KeyHash).
		SetAnchorPreview(signal.Value).
		SetMatchingAnchors([]string{anchorLabel}).
		SetConflictingAnchors([]string{anchorLabel}).
		SetEvidenceFrom(seenAt).
		SetEvidenceTo(seenAt).
		SetImpactJSON(string(impactJSON)).
		SetRecommendedDecision("defer").
		SetConfidence(signal.Confidence).
		OnConflict(
			entsql.ConflictColumns(
				relationshipidentitycandidate.FieldDedupeKey,
				relationshipidentitycandidate.WorkspaceColumn,
			),
			entsql.DoNothing(),
		).Exec(ctx)
	if err != nil {
		return nil, err
	}
	candidate, err := client.RelationshipIdentityCandidate.Query().
		Where(
			relationshipidentitycandidate.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			relationshipidentitycandidate.DedupeKeyEQ(dedupe),
		).
		WithProposedRelationship().WithExistingRelationship().Only(ctx)
	if err != nil {
		return nil, err
	}
	if candidate.ID != candidateID {
		return candidate, nil
	}
	_, err = appendIdentityLineage(ctx, client, ws, u, candidate, "candidate_created", "", nil, nil,
		[]string{proposed.ID.String(), existing.ID.String()}, []string{proposed.ID.String(), existing.ID.String()})
	return candidate, err
}

func relationshipIdentityImpact(ctx context.Context, client *ent.Client, relationshipID uuid.UUID) (identityImpact, error) {
	var out identityImpact
	queries := []struct {
		dst *int
		fn  func() (int, error)
	}{
		{&out.Observations, func() (int, error) {
			return client.RelationshipObservation.Query().Where(relationshipobservation.HasRelationshipWith(relationship.IDEQ(relationshipID))).Count(ctx)
		}},
		{&out.Assertions, func() (int, error) {
			return client.RelationshipAssertion.Query().Where(relationshipassertion.HasRelationshipWith(relationship.IDEQ(relationshipID))).Count(ctx)
		}},
		{&out.Participants, func() (int, error) {
			return client.RelationshipParticipant.Query().Where(relationshipparticipant.HasRelationshipWith(relationship.IDEQ(relationshipID))).Count(ctx)
		}},
		{&out.Commitments, func() (int, error) {
			return client.Commitment.Query().Where(commitment.HasRelationshipWith(relationship.IDEQ(relationshipID))).Count(ctx)
		}},
		{&out.Actions, func() (int, error) {
			return client.RevenueAction.Query().Where(revenueaction.HasRelationshipWith(relationship.IDEQ(relationshipID))).Count(ctx)
		}},
		{&out.Evidence, func() (int, error) {
			return client.RevenueEvidence.Query().Where(revenueevidence.HasRelationshipsWith(relationship.IDEQ(relationshipID))).Count(ctx)
		}},
	}
	for _, query := range queries {
		value, err := query.fn()
		if err != nil {
			return out, err
		}
		*query.dst = value
	}
	return out, nil
}

func appendIdentityLineage(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	candidate *ent.RelationshipIdentityCandidate,
	kind string,
	reason string,
	observationIDs, identityIDs, beforeIDs, afterIDs []string,
	movedRefs ...[]string,
) (*ent.RelationshipLineageEvent, error) {
	create := client.RelationshipLineageEvent.Create().
		SetWorkspace(ws).SetCandidate(candidate).SetUser(u).
		SetKind(kind).SetActorID(u.ID).SetReason(reason).
		SetObservationIds(observationIDs).SetIdentityIds(identityIDs).
		SetBeforeRelationshipIds(beforeIDs).SetAfterRelationshipIds(afterIDs).
		SetOccurredAt(time.Now().UTC())
	if len(movedRefs) > 0 {
		create.SetMovedObjectRefs(movedRefs[0])
	}
	return create.Save(ctx)
}

// attachObservationToIdentityCandidates adds the accepted evidence reference
// after the observation exists, without ever copying its raw content.
func attachObservationToIdentityCandidates(
	ctx context.Context,
	client *ent.Client,
	proposed *ent.Relationship,
	observation *ent.RelationshipObservation,
) error {
	candidates, err := client.RelationshipIdentityCandidate.Query().
		Where(
			relationshipidentitycandidate.StatusIn(identityPending, identityDeferred),
			relationshipidentitycandidate.HasProposedRelationshipWith(relationship.IDEQ(proposed.ID)),
		).
		All(ctx)
	if err != nil {
		return err
	}
	ref := "relationship-observation:" + observation.ID.String()
	for _, candidate := range candidates {
		refs := append([]string{}, candidate.EvidenceRefs...)
		if !containsString(refs, ref) {
			refs = append(refs, ref)
			sort.Strings(refs)
		}
		impact, err := relationshipIdentityImpact(ctx, client, proposed.ID)
		if err != nil {
			return err
		}
		impactJSON, _ := json.Marshal(impact)
		update := candidate.Update().
			SetEvidenceRefs(refs).
			SetEvidenceCount(len(refs)).
			SetImpactJSON(string(impactJSON))
		if candidate.EvidenceFrom == nil || observation.OccurredAt.Before(*candidate.EvidenceFrom) {
			update.SetEvidenceFrom(observation.OccurredAt.UTC())
		}
		if candidate.EvidenceTo == nil || observation.OccurredAt.After(*candidate.EvidenceTo) {
			update.SetEvidenceTo(observation.OccurredAt.UTC())
		}
		if _, err := update.Save(ctx); err != nil {
			return err
		}
	}
	return nil
}

func containsString(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}

// ListIdentityCandidates returns the durable workspace inbox.
func (s *Service) ListIdentityCandidates(ctx context.Context, u *ent.User, filter IdentityCandidateFilter) ([]*ent.RelationshipIdentityCandidate, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceView)
	if err != nil {
		return nil, err
	}
	limit := filter.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	q := s.client.RelationshipIdentityCandidate.Query().
		Where(relationshipidentitycandidate.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID))).
		WithProposedRelationship().WithExistingRelationship().WithLineageEvents().WithDecisions()
	if filter.Status != "" && filter.Status != "all" {
		q.Where(relationshipidentitycandidate.StatusEQ(filter.Status))
	}
	if filter.Source != "" {
		q.Where(relationshipidentitycandidate.AnchorProviderEQ(strings.ToLower(strings.TrimSpace(filter.Source))))
	}
	if filter.RelationshipID != uuid.Nil {
		q.Where(relationshipidentitycandidate.Or(
			relationshipidentitycandidate.HasProposedRelationshipWith(relationship.IDEQ(filter.RelationshipID)),
			relationshipidentitycandidate.HasExistingRelationshipWith(relationship.IDEQ(filter.RelationshipID)),
		))
	}
	return q.Order(ent.Desc(relationshipidentitycandidate.FieldCreatedAt)).Limit(limit).All(ctx)
}

// GetIdentityCandidate returns one tenant-scoped ambiguity with its impact,
// lineage, and immutable decision history.
func (s *Service) GetIdentityCandidate(ctx context.Context, u *ent.User, id uuid.UUID) (*ent.RelationshipIdentityCandidate, error) {
	_, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceView)
	if err != nil {
		return nil, err
	}
	candidate, err := s.client.RelationshipIdentityCandidate.Query().
		Where(relationshipidentitycandidate.IDEQ(id)).
		WithProposedRelationship().WithExistingRelationship().WithLineageEvents().WithDecisions().
		Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrNotFound
	}
	return candidate, err
}

// recordIdentityCandidateViewed is kept at the HTTP boundary so idempotency
// and post-decision reloads do not masquerade as deliberate inbox reviews.
func (s *Service) recordIdentityCandidateViewed(ctx context.Context, u *ent.User, candidate *ent.RelationshipIdentityCandidate) {
	if candidate == nil {
		return
	}
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceView)
	if err != nil {
		return
	}
	_ = appendTrustEvent(ctx, s.client, ws, u, TrustEventInput{
		Name: "identity_candidate_viewed", Outcome: "viewed", ReasonCode: "identity_review",
		CorrelationID: "identity-candidate:" + candidate.ID.String(), OccurredAt: s.now().UTC(),
		Relationship: candidate.Edges.ProposedRelationship,
	})
}

// DecideIdentityCandidate performs exactly one graph transition at the
// expected version. The reservation CAS occurs before any graph mutation, so
// concurrent reviewers cannot partially apply two decisions.
func (s *Service) DecideIdentityCandidate(ctx context.Context, u *ent.User, id uuid.UUID, input IdentityDecisionInput) (*ent.RelationshipIdentityCandidate, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceContribute)
	if err != nil {
		return nil, err
	}
	input.Decision = strings.ToLower(strings.TrimSpace(input.Decision))
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.ExpectedVersion <= 0 || input.IdempotencyKey == "" {
		return nil, fmt.Errorf("%w: expectedVersion and idempotencyKey are required", ErrInvalidInput)
	}
	switch input.Decision {
	case "merge", "keep_separate", "move_evidence", "split", "defer", "undo":
	default:
		return nil, fmt.Errorf("%w: unsupported identity decision", ErrInvalidInput)
	}
	if previous, err := s.client.RelationshipIdentityDecision.Query().
		Where(relationshipidentitydecision.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)), relationshipidentitydecision.IdempotencyKeyEQ(input.IdempotencyKey)).
		WithCandidate().Only(ctx); err == nil {
		return s.GetIdentityCandidate(ctx, u, previous.Edges.Candidate.ID)
	} else if !ent.IsNotFound(err) {
		return nil, err
	}

	tx, err := s.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	txc := tx.Client()
	candidate, err := txc.RelationshipIdentityCandidate.Query().
		Where(relationshipidentitycandidate.IDEQ(id)).
		WithProposedRelationship().WithExistingRelationship().Only(ctx)
	if err != nil {
		_ = tx.Rollback()
		if ent.IsNotFound(err) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	allowedStatuses := []string{identityPending, identityDeferred}
	if input.Decision == "split" || input.Decision == "undo" {
		allowedStatuses = []string{identityResolved}
	}
	n, err := txc.RelationshipIdentityCandidate.Update().
		Where(
			relationshipidentitycandidate.IDEQ(candidate.ID),
			relationshipidentitycandidate.VersionEQ(input.ExpectedVersion),
			relationshipidentitycandidate.StatusIn(allowedStatuses...),
		).
		SetStatus(identityResolving).
		SetVersion(input.ExpectedVersion + 1).
		Save(ctx)
	if err != nil || n != 1 {
		_ = tx.Rollback()
		if err != nil {
			return nil, err
		}
		return nil, ErrConflict
	}
	proposed, err := candidate.Edges.ProposedRelationshipOrErr()
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	existing, err := candidate.Edges.ExistingRelationshipOrErr()
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}

	var lineageKind string
	var moved relationshipMoveSet
	switch input.Decision {
	case "defer":
		lineageKind = "deferred"
	case "keep_separate":
		lineageKind = "kept_separate"
	case "move_evidence":
		lineageKind = "evidence_moved"
		moved, err = moveRelationshipGraph(ctx, txc, proposed, existing, false)
	case "merge":
		lineageKind = "merged"
		moved, err = moveRelationshipGraph(ctx, txc, proposed, existing, true)
		if err == nil {
			_, err = proposed.Update().SetStatus("archived").Save(ctx)
		}
	case "split", "undo":
		lineageKind = input.Decision
		moved, err = compensateIdentityDecision(ctx, txc, candidate, existing, proposed)
	}
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}

	nextStatus := identityResolved
	switch input.Decision {
	case "defer":
		nextStatus = identityDeferred
	case "split", "undo":
		nextStatus = identityUndone
	}
	now := s.now().UTC()
	_, err = txc.RelationshipIdentityCandidate.Update().
		Where(relationshipidentitycandidate.IDEQ(candidate.ID), relationshipidentitycandidate.StatusEQ(identityResolving)).
		SetStatus(nextStatus).
		SetDecision(input.Decision).
		SetDecisionReason(input.Reason).
		SetDecisionActorID(u.ID).
		SetDecidedAt(now).
		Save(ctx)
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	decisionCreate := txc.RelationshipIdentityDecision.Create().
		SetWorkspace(ws).SetCandidate(candidate).SetUser(u).
		SetIdempotencyKey(input.IdempotencyKey).
		SetDecision(input.Decision).
		SetCandidateVersion(input.ExpectedVersion + 1).
		SetActorID(u.ID).SetReason(input.Reason).SetDecidedAt(now)
	if input.Decision == "split" || input.Decision == "undo" {
		previous, previousErr := txc.RelationshipIdentityDecision.Query().
			Where(
				relationshipidentitydecision.HasCandidateWith(relationshipidentitycandidate.IDEQ(candidate.ID)),
				relationshipidentitydecision.DecisionIn("merge", "move_evidence"),
			).
			Order(ent.Desc(relationshipidentitydecision.FieldDecidedAt)).First(ctx)
		if previousErr == nil {
			decisionCreate.SetCompensatesDecisionID(previous.ID)
		}
	}
	if _, err = decisionCreate.Save(ctx); err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	before := []string{proposed.ID.String(), existing.ID.String()}
	after := append([]string{}, before...)
	if input.Decision == "merge" || input.Decision == "move_evidence" {
		after = []string{existing.ID.String()}
	}
	if input.Decision == "split" || input.Decision == "undo" {
		after = before
	}
	if _, err = appendIdentityLineage(ctx, txc, ws, u, candidate, lineageKind, input.Reason,
		moved.ObservationIDs, moved.IdentityIDs, before, after, moved.ObjectRefs); err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	_ = appendTrustEvent(ctx, s.client, ws, u, TrustEventInput{
		Name: "identity_candidate_decided", Outcome: "accepted", ReasonCode: boundedIdentityDecision(input.Decision),
		CorrelationID: "identity-candidate:" + candidate.ID.String(), OccurredAt: now,
		Relationship: existing,
	})
	if input.Decision == "merge" || input.Decision == "move_evidence" || input.Decision == "split" || input.Decision == "undo" {
		// Projection is durable elsewhere; decision correctness does not depend
		// on this low-latency refresh succeeding.
		existing = existing.Unwrap()
		proposed = proposed.Unwrap()
		_, _ = projectRelationshipStateAt(ctx, s.client, ws, u, existing, now)
		_, _ = projectRelationshipStateAt(ctx, s.client, ws, u, proposed, now)
	}
	return s.GetIdentityCandidate(ctx, u, id)
}

func boundedIdentityDecision(decision string) string {
	switch decision {
	case "merge", "keep_separate", "move_evidence", "split", "defer", "undo":
		return decision
	default:
		return "other"
	}
}

type relationshipMoveSet struct {
	ObservationIDs []string
	IdentityIDs    []string
	ObjectRefs     []string
}

func idsAndRefs[T any](rows []*T, id func(*T) uuid.UUID, prefix string) ([]uuid.UUID, []string) {
	ids := make([]uuid.UUID, 0, len(rows))
	refs := make([]string, 0, len(rows))
	for _, row := range rows {
		rowID := id(row)
		ids = append(ids, rowID)
		refs = append(refs, prefix+":"+rowID.String())
	}
	return ids, refs
}

// moveRelationshipGraph moves source records, not audit records or snapshots.
// Child action outcomes and revisions remain attached to their moved action.
func moveRelationshipGraph(ctx context.Context, client *ent.Client, from, to *ent.Relationship, includeOperational bool) (relationshipMoveSet, error) {
	var moved relationshipMoveSet
	observations, err := client.RelationshipObservation.Query().Where(relationshipobservation.HasRelationshipWith(relationship.IDEQ(from.ID))).All(ctx)
	if err != nil {
		return moved, err
	}
	observationIDs, refs := idsAndRefs(observations, func(v *ent.RelationshipObservation) uuid.UUID { return v.ID }, "relationship-observation")
	if len(observationIDs) > 0 {
		if _, err = client.RelationshipObservation.Update().Where(relationshipobservation.IDIn(observationIDs...)).SetRelationshipID(to.ID).Save(ctx); err != nil {
			return moved, err
		}
	}
	moved.ObservationIDs = uuidStrings(observationIDs)
	moved.ObjectRefs = append(moved.ObjectRefs, refs...)

	assertions, err := client.RelationshipAssertion.Query().Where(relationshipassertion.HasRelationshipWith(relationship.IDEQ(from.ID))).All(ctx)
	if err != nil {
		return moved, err
	}
	assertionIDs, refs := idsAndRefs(assertions, func(v *ent.RelationshipAssertion) uuid.UUID { return v.ID }, "relationship-assertion")
	if len(assertionIDs) > 0 {
		if _, err = client.RelationshipAssertion.Update().Where(relationshipassertion.IDIn(assertionIDs...)).SetRelationshipID(to.ID).Save(ctx); err != nil {
			return moved, err
		}
	}
	moved.ObjectRefs = append(moved.ObjectRefs, refs...)

	evidences, err := client.RevenueEvidence.Query().Where(revenueevidence.HasRelationshipsWith(relationship.IDEQ(from.ID))).All(ctx)
	if err != nil {
		return moved, err
	}
	for _, evidence := range evidences {
		if _, err = evidence.Update().RemoveRelationshipIDs(from.ID).AddRelationshipIDs(to.ID).Save(ctx); err != nil {
			return moved, err
		}
		moved.ObjectRefs = append(moved.ObjectRefs, "revenue-evidence:"+evidence.ID.String())
	}
	if !includeOperational {
		sort.Strings(moved.ObjectRefs)
		return moved, nil
	}

	identities, err := client.RelationshipIdentity.Query().Where(relationshipidentity.HasRelationshipWith(relationship.IDEQ(from.ID))).All(ctx)
	if err != nil {
		return moved, err
	}
	identityIDs, refs := idsAndRefs(identities, func(v *ent.RelationshipIdentity) uuid.UUID { return v.ID }, "relationship-identity")
	if len(identityIDs) > 0 {
		if _, err = client.RelationshipIdentity.Update().Where(relationshipidentity.IDIn(identityIDs...)).SetRelationshipID(to.ID).Save(ctx); err != nil {
			return moved, err
		}
	}
	moved.IdentityIDs = uuidStrings(identityIDs)
	moved.ObjectRefs = append(moved.ObjectRefs, refs...)

	participants, err := client.RelationshipParticipant.Query().Where(relationshipparticipant.HasRelationshipWith(relationship.IDEQ(from.ID))).All(ctx)
	if err != nil {
		return moved, err
	}
	for _, participant := range participants {
		if participant.Email != "" {
			duplicate, findErr := client.RelationshipParticipant.Query().Where(
				relationshipparticipant.HasRelationshipWith(relationship.IDEQ(to.ID)),
				relationshipparticipant.EmailEQ(participant.Email),
			).Exist(ctx)
			if findErr != nil {
				return moved, findErr
			}
			if duplicate {
				continue
			}
		}
		if _, err = participant.Update().SetRelationshipID(to.ID).Save(ctx); err != nil {
			return moved, err
		}
		moved.ObjectRefs = append(moved.ObjectRefs, "relationship-participant:"+participant.ID.String())
	}

	type moveBatch struct {
		prefix string
		ids    []uuid.UUID
		move   func([]uuid.UUID) error
	}
	commitments, err := client.Commitment.Query().Where(commitment.HasRelationshipWith(relationship.IDEQ(from.ID))).All(ctx)
	if err != nil {
		return moved, err
	}
	commitmentIDs, _ := idsAndRefs(commitments, func(v *ent.Commitment) uuid.UUID { return v.ID }, "commitment")
	events, err := client.CommitmentEvent.Query().Where(commitmentevent.HasRelationshipWith(relationship.IDEQ(from.ID))).All(ctx)
	if err != nil {
		return moved, err
	}
	eventIDs, _ := idsAndRefs(events, func(v *ent.CommitmentEvent) uuid.UUID { return v.ID }, "commitment-event")
	dependencies, err := client.CommitmentDependency.Query().Where(commitmentdependency.HasRelationshipWith(relationship.IDEQ(from.ID))).All(ctx)
	if err != nil {
		return moved, err
	}
	dependencyIDs, _ := idsAndRefs(dependencies, func(v *ent.CommitmentDependency) uuid.UUID { return v.ID }, "commitment-dependency")
	actions, err := client.RevenueAction.Query().Where(revenueaction.HasRelationshipWith(relationship.IDEQ(from.ID))).All(ctx)
	if err != nil {
		return moved, err
	}
	actionIDs, _ := idsAndRefs(actions, func(v *ent.RevenueAction) uuid.UUID { return v.ID }, "revenue-action")
	artifacts, err := client.ConversationIntelligenceArtifact.Query().Where(conversationintelligenceartifact.HasRelationshipWith(relationship.IDEQ(from.ID))).All(ctx)
	if err != nil {
		return moved, err
	}
	artifactIDs, _ := idsAndRefs(artifacts, func(v *ent.ConversationIntelligenceArtifact) uuid.UUID { return v.ID }, "conversation-artifact")
	threads, err := client.MailThread.Query().Where(mailthread.HasRelationshipWith(relationship.IDEQ(from.ID))).All(ctx)
	if err != nil {
		return moved, err
	}
	threadIDs, _ := idsAndRefs(threads, func(v *ent.MailThread) uuid.UUID { return v.ID }, "mail-thread")
	batches := []moveBatch{
		{"commitment", commitmentIDs, func(ids []uuid.UUID) error {
			_, e := client.Commitment.Update().Where(commitment.IDIn(ids...)).SetRelationshipID(to.ID).Save(ctx)
			return e
		}},
		{"commitment-event", eventIDs, func(ids []uuid.UUID) error {
			_, e := client.CommitmentEvent.Update().Where(commitmentevent.IDIn(ids...)).SetRelationshipID(to.ID).Save(ctx)
			return e
		}},
		{"commitment-dependency", dependencyIDs, func(ids []uuid.UUID) error {
			_, e := client.CommitmentDependency.Update().Where(commitmentdependency.IDIn(ids...)).SetRelationshipID(to.ID).Save(ctx)
			return e
		}},
		{"revenue-action", actionIDs, func(ids []uuid.UUID) error {
			_, e := client.RevenueAction.Update().Where(revenueaction.IDIn(ids...)).SetRelationshipID(to.ID).Save(ctx)
			return e
		}},
		{"conversation-artifact", artifactIDs, func(ids []uuid.UUID) error {
			_, e := client.ConversationIntelligenceArtifact.Update().Where(conversationintelligenceartifact.IDIn(ids...)).SetRelationshipID(to.ID).Save(ctx)
			return e
		}},
		{"mail-thread", threadIDs, func(ids []uuid.UUID) error {
			_, e := client.MailThread.Update().Where(mailthread.IDIn(ids...)).SetRelationshipID(to.ID).Save(ctx)
			return e
		}},
	}
	for _, batch := range batches {
		if len(batch.ids) == 0 {
			continue
		}
		if err = batch.move(batch.ids); err != nil {
			return moved, err
		}
		for _, id := range batch.ids {
			moved.ObjectRefs = append(moved.ObjectRefs, batch.prefix+":"+id.String())
		}
	}
	sort.Strings(moved.ObjectRefs)
	return moved, nil
}

func uuidStrings(ids []uuid.UUID) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		out = append(out, id.String())
	}
	return out
}

func compensateIdentityDecision(ctx context.Context, client *ent.Client, candidate *ent.RelationshipIdentityCandidate, from, to *ent.Relationship) (relationshipMoveSet, error) {
	lineage, err := client.RelationshipLineageEvent.Query().
		Where(
			relationshiplineageevent.HasCandidateWith(relationshipidentitycandidate.IDEQ(candidate.ID)),
			relationshiplineageevent.KindIn("merged", "evidence_moved"),
		).
		Order(ent.Desc(relationshiplineageevent.FieldOccurredAt)).First(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return relationshipMoveSet{}, fmt.Errorf("%w: no merge or move to compensate", ErrConflict)
		}
		return relationshipMoveSet{}, err
	}
	refs := lineage.MovedObjectRefs
	idsByPrefix := map[string][]uuid.UUID{}
	for _, ref := range refs {
		parts := strings.SplitN(ref, ":", 2)
		if len(parts) != 2 {
			continue
		}
		id, parseErr := uuid.Parse(parts[1])
		if parseErr == nil {
			idsByPrefix[parts[0]] = append(idsByPrefix[parts[0]], id)
		}
	}
	if ids := idsByPrefix["revenue-action"]; len(ids) > 0 {
		unsafe, err := client.RevenueAction.Query().Where(revenueaction.IDIn(ids...), revenueaction.ExecutionStatusNEQ(ExecPending)).Exist(ctx)
		if err != nil {
			return relationshipMoveSet{}, err
		}
		if unsafe {
			return relationshipMoveSet{}, fmt.Errorf("%w: executed or in-flight actions make compensation unsafe", ErrConflict)
		}
	}
	move := func(prefix string, fn func([]uuid.UUID) error) error {
		ids := idsByPrefix[prefix]
		if len(ids) == 0 {
			return nil
		}
		return fn(ids)
	}
	operations := []struct {
		prefix string
		fn     func([]uuid.UUID) error
	}{
		{"relationship-observation", func(ids []uuid.UUID) error {
			_, e := client.RelationshipObservation.Update().Where(relationshipobservation.IDIn(ids...)).SetRelationshipID(to.ID).Save(ctx)
			return e
		}},
		{"relationship-assertion", func(ids []uuid.UUID) error {
			_, e := client.RelationshipAssertion.Update().Where(relationshipassertion.IDIn(ids...)).SetRelationshipID(to.ID).Save(ctx)
			return e
		}},
		{"relationship-identity", func(ids []uuid.UUID) error {
			_, e := client.RelationshipIdentity.Update().Where(relationshipidentity.IDIn(ids...)).SetRelationshipID(to.ID).Save(ctx)
			return e
		}},
		{"relationship-participant", func(ids []uuid.UUID) error {
			_, e := client.RelationshipParticipant.Update().Where(relationshipparticipant.IDIn(ids...)).SetRelationshipID(to.ID).Save(ctx)
			return e
		}},
		{"commitment", func(ids []uuid.UUID) error {
			_, e := client.Commitment.Update().Where(commitment.IDIn(ids...)).SetRelationshipID(to.ID).Save(ctx)
			return e
		}},
		{"commitment-event", func(ids []uuid.UUID) error {
			_, e := client.CommitmentEvent.Update().Where(commitmentevent.IDIn(ids...)).SetRelationshipID(to.ID).Save(ctx)
			return e
		}},
		{"commitment-dependency", func(ids []uuid.UUID) error {
			_, e := client.CommitmentDependency.Update().Where(commitmentdependency.IDIn(ids...)).SetRelationshipID(to.ID).Save(ctx)
			return e
		}},
		{"revenue-action", func(ids []uuid.UUID) error {
			_, e := client.RevenueAction.Update().Where(revenueaction.IDIn(ids...)).SetRelationshipID(to.ID).Save(ctx)
			return e
		}},
		{"conversation-artifact", func(ids []uuid.UUID) error {
			_, e := client.ConversationIntelligenceArtifact.Update().Where(conversationintelligenceartifact.IDIn(ids...)).SetRelationshipID(to.ID).Save(ctx)
			return e
		}},
		{"mail-thread", func(ids []uuid.UUID) error {
			_, e := client.MailThread.Update().Where(mailthread.IDIn(ids...)).SetRelationshipID(to.ID).Save(ctx)
			return e
		}},
	}
	for _, operation := range operations {
		if err := move(operation.prefix, operation.fn); err != nil {
			return relationshipMoveSet{}, err
		}
	}
	for _, id := range idsByPrefix["revenue-evidence"] {
		evidence, err := client.RevenueEvidence.Get(ctx, id)
		if err != nil {
			return relationshipMoveSet{}, err
		}
		if _, err = evidence.Update().RemoveRelationshipIDs(from.ID).AddRelationshipIDs(to.ID).Save(ctx); err != nil {
			return relationshipMoveSet{}, err
		}
	}
	if _, err := to.Update().SetStatus("active").Save(ctx); err != nil {
		return relationshipMoveSet{}, err
	}
	return relationshipMoveSet{
		ObservationIDs: uuidStrings(idsByPrefix["relationship-observation"]),
		IdentityIDs:    uuidStrings(idsByPrefix["relationship-identity"]),
		ObjectRefs:     append([]string{}, refs...),
	}, nil
}

func (s *Service) relationshipHasUnresolvedIdentity(ctx context.Context, relationshipID uuid.UUID) (bool, error) {
	return s.client.RelationshipIdentityCandidate.Query().Where(
		relationshipidentitycandidate.StatusIn(identityPending, identityDeferred, identityResolving),
		relationshipidentitycandidate.Or(
			relationshipidentitycandidate.HasProposedRelationshipWith(relationship.IDEQ(relationshipID)),
			relationshipidentitycandidate.HasExistingRelationshipWith(relationship.IDEQ(relationshipID)),
		),
	).Exist(ctx)
}

func (s *Service) ensureActionIdentityResolved(ctx context.Context, action *ent.RevenueAction) error {
	rel, err := action.Edges.RelationshipOrErr()
	if err != nil {
		return err
	}
	unresolved, err := s.relationshipHasUnresolvedIdentity(ctx, rel.ID)
	if err != nil {
		return err
	}
	if unresolved {
		return ErrIdentityUnresolved
	}
	return nil
}
