package revenue

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitment"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitmentdependency"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitmentevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/google/uuid"
)

type CommitmentTransitionInput struct {
	Kind           string
	IdempotencyKey string
	ActorType      string
	Reason         string
	DueAt          time.Time
	Action         string
	Blocker        string
	EvidenceRefs   []string
}

type CommitmentDependencyInput struct {
	FromCommitmentID uuid.UUID
	ToCommitmentID   uuid.UUID
	Kind             string
	EvidenceRefs     []string
}

func validCommitmentDependencyKind(kind string) bool {
	return kind == "blocks" || kind == "requires" || kind == "supersedes"
}

func commitmentDependencyCycle(edges [][2]uuid.UUID) bool {
	graph := make(map[uuid.UUID][]uuid.UUID)
	for _, edge := range edges {
		if edge[0] == edge[1] {
			return true
		}
		graph[edge[0]] = append(graph[edge[0]], edge[1])
	}
	visiting := make(map[uuid.UUID]bool)
	visited := make(map[uuid.UUID]bool)
	var visit func(uuid.UUID) bool
	visit = func(id uuid.UUID) bool {
		if visiting[id] {
			return true
		}
		if visited[id] {
			return false
		}
		visiting[id] = true
		for _, next := range graph[id] {
			if visit(next) {
				return true
			}
		}
		visiting[id] = false
		visited[id] = true
		return false
	}
	for id := range graph {
		if visit(id) {
			return true
		}
	}
	return false
}

// CreateCommitmentDependency persists one evidence-backed graph edge after checking
// tenant/relationship scope and the complete relationship graph for cycles.
func (s *Service) CreateCommitmentDependency(
	ctx context.Context,
	u *ent.User,
	relationshipID uuid.UUID,
	input CommitmentDependencyInput,
) (*ent.CommitmentDependency, error) {
	input.Kind = strings.TrimSpace(input.Kind)
	if !validCommitmentDependencyKind(input.Kind) || input.FromCommitmentID == uuid.Nil ||
		input.ToCommitmentID == uuid.Nil || input.FromCommitmentID == input.ToCommitmentID {
		return nil, fmt.Errorf("%w: invalid commitment dependency", ErrInvalidInput)
	}
	if len(input.EvidenceRefs) == 0 {
		return nil, fmt.Errorf("%w: dependency evidence is required", ErrInvalidInput)
	}
	for _, ref := range input.EvidenceRefs {
		if strings.TrimSpace(ref) == "" {
			return nil, fmt.Errorf("%w: dependency evidence is required", ErrInvalidInput)
		}
	}
	ws, err := s.CurrentWorkspace(ctx, u)
	if err != nil {
		return nil, err
	}
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	txc := tx.Client()
	txws, err := txc.RevenueWorkspace.Get(ctx, ws.ID)
	if err != nil {
		return nil, err
	}
	txu, err := txc.User.Get(ctx, u.ID)
	if err != nil {
		return nil, err
	}
	txrel, err := txc.Relationship.Query().Where(
		relationship.IDEQ(relationshipID),
		relationship.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
	).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	commitments, err := txc.Commitment.Query().Where(
		commitment.IDIn(input.FromCommitmentID, input.ToCommitmentID),
		commitment.HasRelationshipWith(relationship.IDEQ(relationshipID)),
		commitment.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
	).All(ctx)
	if err != nil {
		return nil, err
	}
	if len(commitments) != 2 {
		return nil, fmt.Errorf("%w: dependencies must connect commitments in one relationship", ErrInvalidInput)
	}
	existing, err := txc.CommitmentDependency.Query().Where(
		commitmentdependency.HasRelationshipWith(relationship.IDEQ(relationshipID)),
	).WithFromCommitment().WithToCommitment().All(ctx)
	if err != nil {
		return nil, err
	}
	edges := make([][2]uuid.UUID, 0, len(existing)+1)
	for _, dependency := range existing {
		from, fromErr := dependency.Edges.FromCommitmentOrErr()
		to, toErr := dependency.Edges.ToCommitmentOrErr()
		if fromErr != nil || toErr != nil {
			return nil, fmt.Errorf("commitment dependency edge is incomplete")
		}
		if from.ID == input.FromCommitmentID && to.ID == input.ToCommitmentID && dependency.Kind == input.Kind {
			id := dependency.ID
			_ = tx.Rollback()
			return s.client.CommitmentDependency.Query().Where(commitmentdependency.IDEQ(id)).
				WithFromCommitment().WithToCommitment().Only(ctx)
		}
		edges = append(edges, [2]uuid.UUID{from.ID, to.ID})
	}
	edges = append(edges, [2]uuid.UUID{input.FromCommitmentID, input.ToCommitmentID})
	if commitmentDependencyCycle(edges) {
		return nil, fmt.Errorf("%w: commitment dependency cycle", ErrInvalidInput)
	}
	byID := make(map[uuid.UUID]*ent.Commitment, len(commitments))
	for _, row := range commitments {
		byID[row.ID] = row
	}
	created, err := txc.CommitmentDependency.Create().SetWorkspace(txws).SetRelationship(txrel).SetUser(txu).
		SetFromCommitment(byID[input.FromCommitmentID]).SetToCommitment(byID[input.ToCommitmentID]).
		SetKind(input.Kind).SetEvidenceRefs(input.EvidenceRefs).Save(ctx)
	if err != nil {
		return nil, err
	}
	createdID := created.ID
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.client.CommitmentDependency.Query().Where(commitmentdependency.IDEQ(createdID)).
		WithFromCommitment().WithToCommitment().Only(ctx)
}

func (s *Service) CommitmentDependencies(
	ctx context.Context,
	relationshipID uuid.UUID,
) ([]*ent.CommitmentDependency, error) {
	return s.client.CommitmentDependency.Query().Where(
		commitmentdependency.HasRelationshipWith(relationship.IDEQ(relationshipID)),
	).WithFromCommitment().WithToCommitment().All(ctx)
}

func commitmentState(row *ent.Commitment) string {
	if row.Status != "open" {
		return row.Status
	}
	if strings.TrimSpace(row.Blocker) != "" {
		return "blocked"
	}
	switch row.Acceptance {
	case "candidate", "internally_confirmed", "offered", "disputed":
		return row.Acceptance
	default:
		return "open"
	}
}

func permittedCommitmentTransition(state, kind string) bool {
	allowed := map[string]map[string]bool{
		"candidate":            {"internally_confirmed": true, "cancelled": true, "superseded": true},
		"internally_confirmed": {"offered": true, "accepted": true, "due_date_changed": true, "renegotiated": true, "fulfilled": true, "cancelled": true, "superseded": true},
		"offered":              {"accepted": true, "disputed": true, "due_date_changed": true, "renegotiated": true, "cancelled": true, "superseded": true},
		"open":                 {"disputed": true, "blocked": true, "due_date_changed": true, "renegotiated": true, "fulfilled": true, "cancelled": true, "superseded": true},
		"blocked":              {"unblocked": true, "due_date_changed": true, "renegotiated": true, "fulfilled": true, "cancelled": true, "superseded": true},
		"renegotiated":         {"accepted": true, "fulfilled": true, "cancelled": true, "superseded": true},
		"disputed":             {"accepted": true, "cancelled": true, "superseded": true},
	}
	return allowed[state][kind]
}

func (s *Service) AppendCommitmentTransition(
	ctx context.Context,
	u *ent.User,
	relationshipID, commitmentID uuid.UUID,
	input CommitmentTransitionInput,
) (*ent.Commitment, error) {
	input.Kind = strings.TrimSpace(input.Kind)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.IdempotencyKey == "" || input.Kind == "" {
		return nil, fmt.Errorf("%w: kind and idempotencyKey are required", ErrInvalidInput)
	}
	if input.ActorType == "" {
		input.ActorType = "user"
	}
	if input.ActorType != "user" && input.ActorType != "source_fact" && input.ActorType != "deterministic_rule" {
		return nil, fmt.Errorf("%w: invalid commitment actor", ErrInvalidInput)
	}
	if input.Kind == "blocked" && strings.TrimSpace(input.Blocker) == "" {
		return nil, fmt.Errorf("%w: blocked transition requires blocker", ErrInvalidInput)
	}
	if input.Kind == "due_date_changed" && input.DueAt.IsZero() {
		return nil, fmt.Errorf("%w: due-date change requires dueAt", ErrInvalidInput)
	}
	if input.Kind == "renegotiated" && input.DueAt.IsZero() && strings.TrimSpace(input.Action) == "" {
		return nil, fmt.Errorf("%w: renegotiation requires action or dueAt", ErrInvalidInput)
	}
	if len(input.EvidenceRefs) == 0 {
		input.EvidenceRefs = []string{"user-transition:" + input.IdempotencyKey}
	}
	ws, err := s.CurrentWorkspace(ctx, u)
	if err != nil {
		return nil, err
	}
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	txc := tx.Client()
	if existing, lookupErr := txc.CommitmentEvent.Query().Where(
		commitmentevent.SourceEventIDEQ(input.IdempotencyKey),
	).WithCommitment().Only(ctx); lookupErr == nil {
		row, edgeErr := existing.Edges.CommitmentOrErr()
		if edgeErr != nil || row.ID != commitmentID {
			_ = tx.Rollback()
			return nil, fmt.Errorf("%w: commitment transition idempotency key", ErrReviewRequired)
		}
		_ = tx.Rollback()
		return s.client.Commitment.Get(ctx, commitmentID)
	} else if !ent.IsNotFound(lookupErr) {
		_ = tx.Rollback()
		return nil, lookupErr
	}
	row, err := txc.Commitment.Query().Where(
		commitment.IDEQ(commitmentID),
		commitment.HasRelationshipWith(relationship.IDEQ(relationshipID)),
	).WithRelationship().Only(ctx)
	if ent.IsNotFound(err) {
		_ = tx.Rollback()
		return nil, ErrNotFound
	}
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	state := commitmentState(row)
	if !permittedCommitmentTransition(state, input.Kind) {
		_ = tx.Rollback()
		return nil, fmt.Errorf("%w: invalid commitment transition %s -> %s", ErrInvalidInput, state, input.Kind)
	}
	payload := map[string]any{"reason": strings.TrimSpace(input.Reason)}
	update := txc.Commitment.Update().Where(
		commitment.IDEQ(row.ID), commitment.CurrentEventVersionEQ(row.CurrentEventVersion),
	).SetCurrentEventVersion(row.CurrentEventVersion + 1)
	switch input.Kind {
	case "internally_confirmed", "offered", "accepted", "disputed":
		update.SetAcceptance(input.Kind)
	case "blocked":
		update.SetBlocker(strings.TrimSpace(input.Blocker))
		payload["blocker"] = strings.TrimSpace(input.Blocker)
	case "unblocked":
		update.ClearBlocker()
	case "fulfilled":
		update.SetStatus("fulfilled").SetCompletedAt(s.now().UTC())
	case "cancelled", "superseded":
		update.SetStatus(input.Kind)
	}
	if !input.DueAt.IsZero() {
		update.SetDueAt(input.DueAt.UTC())
		payload["dueAt"] = input.DueAt.UTC().Format(time.RFC3339)
	}
	if strings.TrimSpace(input.Action) != "" {
		update.SetText(strings.TrimSpace(input.Action))
		payload["action"] = strings.TrimSpace(input.Action)
	}
	changed, err := update.Save(ctx)
	if err != nil || changed != 1 {
		_ = tx.Rollback()
		if err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("%w: commitment changed concurrently", ErrReviewRequired)
	}
	payloadJSON, _ := json.Marshal(payload)
	rel, err := row.Edges.RelationshipOrErr()
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	_, err = txc.CommitmentEvent.Create().SetWorkspace(ws).SetRelationship(rel).SetUser(u).
		SetCommitment(row).SetSourceEventID(input.IdempotencyKey).
		SetVersion(row.CurrentEventVersion + 1).SetKind(input.Kind).SetActorType(input.ActorType).
		SetActorRef(u.ID.String()).SetOccurredAt(s.now().UTC()).SetEvidenceRefs(input.EvidenceRefs).
		SetPayloadJSON(string(payloadJSON)).Save(ctx)
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.client.Commitment.Get(ctx, commitmentID)
}

func (s *Service) CommitmentEventHistory(
	ctx context.Context,
	relationshipID, commitmentID uuid.UUID,
) ([]*ent.CommitmentEvent, error) {
	exists, err := s.client.Commitment.Query().Where(
		commitment.IDEQ(commitmentID), commitment.HasRelationshipWith(relationship.IDEQ(relationshipID)),
	).Exist(ctx)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}
	return s.client.CommitmentEvent.Query().Where(
		commitmentevent.HasCommitmentWith(commitment.IDEQ(commitmentID)),
	).Order(ent.Asc(commitmentevent.FieldVersion)).All(ctx)
}
