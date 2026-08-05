package revenue

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitment"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitmentdependency"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipobservation"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipparticipant"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipreviewacknowledgement"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipsourcestatus"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipstatesnapshot"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueactionrevision"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueevidence"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
)

const relationshipGraphContractVersion = "2026-08-01"

// RelationshipGraphFilter is a bounded read request for the shared graph projection.
type RelationshipGraphFilter struct {
	Scope          string
	RelationshipID *uuid.UUID
	Depth          int
	AsOf           time.Time
}

// RelationshipGraphAggregate is the authorized, eagerly loaded source for one graph response.
type RelationshipGraphAggregate struct {
	Relationships []*ent.Relationship
	Sources       []*ent.RelationshipSourceStatus
	Role          string
	Scope         string
	Depth         int
	AsOf          time.Time
	Historical    bool
}

// RelationshipGraph returns a tenant-scoped graph aggregate. It filters time-bearing
// children at the requested boundary so historical views cannot accidentally include
// evidence or proposed actions that did not exist yet.
func (s *Service) RelationshipGraph(
	ctx context.Context,
	u *ent.User,
	filter RelationshipGraphFilter,
) (*RelationshipGraphAggregate, error) {
	if filter.Scope == "" {
		filter.Scope = "portfolio"
	}
	if filter.Scope != "portfolio" && filter.Scope != "relationship" {
		return nil, fmt.Errorf("%w: graph scope must be portfolio or relationship", ErrInvalidInput)
	}
	if filter.Scope == "relationship" && filter.RelationshipID == nil {
		return nil, fmt.Errorf("%w: relationshipId is required for relationship scope", ErrInvalidInput)
	}
	if filter.Depth == 0 {
		filter.Depth = 2
	}
	if filter.Depth < 1 || filter.Depth > 3 {
		return nil, fmt.Errorf("%w: graph depth must be between 1 and 3", ErrInvalidInput)
	}

	now := s.now().UTC()
	if filter.AsOf.IsZero() {
		filter.AsOf = now
	}
	filter.AsOf = filter.AsOf.UTC()
	if filter.AsOf.After(now.Add(time.Minute)) {
		return nil, fmt.Errorf("%w: graph asOf cannot be in the future", ErrInvalidInput)
	}
	historical := filter.AsOf.Before(now.Add(-time.Second))

	ws, err := s.CurrentWorkspace(ctx, u)
	if err != nil {
		return nil, err
	}
	role, err := s.RequireWorkspaceCapability(ctx, u, ws, WorkspaceView)
	if err != nil {
		return nil, err
	}

	q := s.client.Relationship.Query().
		Where(
			relationship.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			relationship.CreatedAtLTE(filter.AsOf),
		).
		WithParticipants(func(q *ent.RelationshipParticipantQuery) {
			q.Where(relationshipparticipant.CreatedAtLTE(filter.AsOf)).
				// The canonical person is what makes one human one node across
				// accounts, instead of one node per email string.
				WithPerson().
				Order(ent.Asc(relationshipparticipant.FieldDisplayName))
		}).
		WithCommitments(func(q *ent.CommitmentQuery) {
			q.Where(commitment.CreatedAtLTE(filter.AsOf)).
				WithEvidences(func(q *ent.RevenueEvidenceQuery) {
					q.Where(revenueevidence.OccurredAtLTE(filter.AsOf)).Order(ent.Desc(revenueevidence.FieldOccurredAt))
				}).
				Order(ent.Asc(commitment.FieldDueAt), ent.Asc(commitment.FieldID))
		}).
		WithActions(func(q *ent.RevenueActionQuery) {
			q.Where(revenueaction.CreatedAtLTE(filter.AsOf)).
				WithRevisions(func(q *ent.RevenueActionRevisionQuery) {
					q.Where(revenueactionrevision.CreatedAtLTE(filter.AsOf)).Order(ent.Desc(revenueactionrevision.FieldRevision))
				}).
				WithEvidences(func(q *ent.RevenueEvidenceQuery) {
					q.Where(revenueevidence.OccurredAtLTE(filter.AsOf)).Order(ent.Desc(revenueevidence.FieldOccurredAt))
				}).
				Order(ent.Desc(revenueaction.FieldPriorityScore), ent.Asc(revenueaction.FieldID))
		}).
		WithCommitmentDependencies(func(q *ent.CommitmentDependencyQuery) {
			q.Where(commitmentdependency.CreatedAtLTE(filter.AsOf)).WithFromCommitment().WithToCommitment()
		}).
		WithReviewAcknowledgements(func(q *ent.RelationshipReviewAcknowledgementQuery) {
			q.Where(
				relationshipreviewacknowledgement.AcknowledgedAtLTE(filter.AsOf),
				relationshipreviewacknowledgement.HasUserWith(user.IDEQ(u.ID)),
			).Order(ent.Desc(relationshipreviewacknowledgement.FieldStateVersion))
		})

	if filter.Depth >= 2 {
		observationLimit := 500
		if filter.Scope == "relationship" {
			observationLimit = 100
		}
		q.WithObservations(func(q *ent.RelationshipObservationQuery) {
			q.Where(relationshipobservation.OccurredAtLTE(filter.AsOf)).
				Order(ent.Desc(relationshipobservation.FieldOccurredAt)).
				Limit(observationLimit)
		})
	}
	if historical {
		q.WithSnapshots(func(q *ent.RelationshipStateSnapshotQuery) {
			q.Where(relationshipstatesnapshot.EvaluatedAtLTE(filter.AsOf)).
				Order(ent.Desc(relationshipstatesnapshot.FieldEvaluatedAt))
		})
	}
	if filter.RelationshipID != nil {
		q.Where(relationship.IDEQ(*filter.RelationshipID))
	}

	relationships, err := q.Order(ent.Desc(relationship.FieldUpdatedAt)).Limit(relationshipListLimit).All(ctx)
	if err != nil {
		return nil, err
	}
	if filter.Scope == "relationship" && len(relationships) == 0 {
		return nil, ErrNotFound
	}

	sources, err := s.client.RelationshipSourceStatus.Query().
		Where(
			relationshipsourcestatus.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			relationshipsourcestatus.CreatedAtLTE(filter.AsOf),
		).
		Order(ent.Asc(relationshipsourcestatus.FieldSource)).
		All(ctx)
	if err != nil {
		return nil, err
	}

	return &RelationshipGraphAggregate{
		Relationships: relationships,
		Sources:       sources,
		Role:          role,
		Scope:         filter.Scope,
		Depth:         filter.Depth,
		AsOf:          filter.AsOf,
		Historical:    historical,
	}, nil
}

type relationshipGraphPermissionsDTO struct {
	CanView       bool `json:"canView"`
	CanContribute bool `json:"canContribute"`
	CanApprove    bool `json:"canApprove"`
	CanExecute    bool `json:"canExecute"`
	CanSaveViews  bool `json:"canSaveViews"`
}

type relationshipGraphNodeDTO struct {
	ID                 string         `json:"id"`
	Kind               string         `json:"kind"`
	Label              string         `json:"label"`
	RelationshipID     string         `json:"relationshipId,omitempty"`
	RelationshipIDs    []string       `json:"relationshipIds,omitempty"`
	Summary            string         `json:"summary,omitempty"`
	Status             string         `json:"status,omitempty"`
	Role               string         `json:"role,omitempty"`
	Source             string         `json:"source,omitempty"`
	Lifecycle          string         `json:"lifecycle,omitempty"`
	Engagement         string         `json:"engagement,omitempty"`
	Sentiment          string         `json:"sentiment,omitempty"`
	Health             string         `json:"health,omitempty"`
	ApprovalStatus     string         `json:"approvalStatus,omitempty"`
	PolicyStatus       string         `json:"policyStatus,omitempty"`
	ExecutionStatus    string         `json:"executionStatus,omitempty"`
	Freshness          string         `json:"freshness,omitempty"`
	Confidence         *float64       `json:"confidence,omitempty"`
	Priority           int            `json:"priority,omitempty"`
	DueAt              *time.Time     `json:"dueAt,omitempty"`
	OccurredAt         *time.Time     `json:"occurredAt,omitempty"`
	UpdatedAt          *time.Time     `json:"updatedAt,omitempty"`
	ChangedSinceReview bool           `json:"changedSinceReview,omitempty"`
	ChangedDimensions  []string       `json:"changedDimensions,omitempty"`
	EvidenceRefs       []string       `json:"evidenceRefs,omitempty"`
	ResourceRef        string         `json:"resourceRef,omitempty"`
	Metadata           map[string]any `json:"metadata,omitempty"`
}

type relationshipGraphEdgeDTO struct {
	ID           string   `json:"id"`
	Source       string   `json:"source"`
	Target       string   `json:"target"`
	Kind         string   `json:"kind"`
	Label        string   `json:"label"`
	Directed     bool     `json:"directed"`
	Confidence   *float64 `json:"confidence,omitempty"`
	EvidenceRefs []string `json:"evidenceRefs,omitempty"`
}

type relationshipGraphDTO struct {
	ContractVersion string                          `json:"contractVersion"`
	GeneratedAt     time.Time                       `json:"generatedAt"`
	AsOf            time.Time                       `json:"asOf"`
	Historical      bool                            `json:"historical"`
	Scope           string                          `json:"scope"`
	RelationshipID  string                          `json:"relationshipId,omitempty"`
	Depth           int                             `json:"depth"`
	Nodes           []relationshipGraphNodeDTO      `json:"nodes"`
	Edges           []relationshipGraphEdgeDTO      `json:"edges"`
	Permissions     relationshipGraphPermissionsDTO `json:"permissions"`
}

type graphProjectionState struct {
	Lifecycle    string   `json:"lifecycle"`
	Engagement   string   `json:"engagement"`
	Sentiment    string   `json:"sentiment"`
	Health       string   `json:"health"`
	Summary      string   `json:"summary"`
	NextAction   string   `json:"nextAction"`
	Risks        []string `json:"risks"`
	Milestones   []string `json:"milestones"`
	StateVersion int      `json:"stateVersion"`
}

type graphProjectionBoundary struct {
	State             graphProjectionState
	ChangedDimensions []string
	ChangedAt         time.Time
	StateHash         string
	AssertionIDs      []string
}

func graphStableID(value string) string {
	digest := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(value))))
	return hex.EncodeToString(digest[:8])
}

func graphEdgeID(kind, source, target string) string {
	return "edge:" + graphStableID(kind+":"+source+":"+target)
}

func graphFreshness(occurredAt, asOf time.Time) string {
	age := asOf.Sub(occurredAt)
	if age <= 72*time.Hour {
		return "current"
	}
	if age <= 30*24*time.Hour {
		return "aging"
	}
	return "stale"
}

func graphSourceFreshness(status *ent.RelationshipSourceStatus, asOf time.Time) string {
	if status.Status == "disconnected" || status.Status == "revoked" || status.Status == "failed" {
		return "stale"
	}
	if status.LastObservationAt == nil {
		return "unknown"
	}
	return graphFreshness(status.LastObservationAt.UTC(), asOf)
}

func latestGraphState(rel *ent.Relationship, historical bool, asOf time.Time) graphProjectionBoundary {
	state := graphProjectionState{
		Lifecycle: rel.Lifecycle, Engagement: rel.Engagement, Sentiment: rel.Sentiment,
		Health: rel.Health, Summary: rel.Summary, NextAction: rel.NextAction,
		Risks: rel.Risks, Milestones: rel.Milestones, StateVersion: rel.StateVersion,
	}
	boundary := graphProjectionBoundary{State: state, StateHash: rel.StateHash}
	boundary.ChangedAt = rel.UpdatedAt
	if rel.LastChangedAt != nil {
		boundary.ChangedAt = rel.LastChangedAt.UTC()
	}
	if !historical {
		return boundary
	}
	snapshots, err := rel.Edges.SnapshotsOrErr()
	if err != nil || len(snapshots) == 0 {
		if rel.UpdatedAt.After(asOf) {
			boundary.State = graphProjectionState{
				Lifecycle: "unknown", Engagement: "unknown", Sentiment: "unknown", Health: "unknown",
			}
			boundary.ChangedAt = rel.CreatedAt.UTC()
			boundary.StateHash = ""
		}
		return boundary
	}
	latest := snapshots[0]
	for _, snapshot := range snapshots[1:] {
		if snapshot.EvaluatedAt.After(latest.EvaluatedAt) {
			latest = snapshot
		}
	}
	if err := json.Unmarshal([]byte(latest.StateJSON), &state); err == nil {
		boundary.State = state
		boundary.ChangedDimensions = append(boundary.ChangedDimensions, latest.ChangedDimensions...)
		boundary.ChangedAt = latest.EvaluatedAt.UTC()
		boundary.StateHash = latest.StateHash
		boundary.AssertionIDs = append(boundary.AssertionIDs, latest.AssertionIds...)
	}
	return boundary
}

func changedSinceGraphReview(rel *ent.Relationship, stateVersion int) bool {
	acknowledgements, err := rel.Edges.ReviewAcknowledgementsOrErr()
	if err != nil || len(acknowledgements) == 0 {
		return stateVersion > 0
	}
	latestVersion := 0
	for _, acknowledgement := range acknowledgements {
		if acknowledgement.StateVersion > latestVersion {
			latestVersion = acknowledgement.StateVersion
		}
	}
	return stateVersion > latestVersion
}

func buildRelationshipGraphDTO(aggregate *RelationshipGraphAggregate, generatedAt time.Time) relationshipGraphDTO {
	nodes := make(map[string]relationshipGraphNodeDTO)
	edges := make(map[string]relationshipGraphEdgeDTO)
	sourceStatuses := make(map[string]*ent.RelationshipSourceStatus)
	for _, status := range aggregate.Sources {
		key := status.Source + ":" + status.SourceAccountID
		sourceStatuses[key] = status
		if _, ok := sourceStatuses[status.Source]; !ok {
			sourceStatuses[status.Source] = status
		}
	}

	addEdge := func(kind, label, source, target string, directed bool, confidence *float64, evidenceRefs []string) {
		id := graphEdgeID(kind, source, target)
		if _, exists := edges[id]; exists {
			return
		}
		edges[id] = relationshipGraphEdgeDTO{
			ID: id, Source: source, Target: target, Kind: kind, Label: label,
			Directed: directed, Confidence: confidence, EvidenceRefs: evidenceRefs,
		}
	}

	for _, rel := range aggregate.Relationships {
		relationshipID := rel.ID.String()
		relationshipNodeID := "relationship:" + relationshipID
		boundary := latestGraphState(rel, aggregate.Historical, aggregate.AsOf)
		state := boundary.State
		relationshipStatus := rel.Status
		if aggregate.Historical && rel.UpdatedAt.After(aggregate.AsOf) {
			relationshipStatus = "historical_unknown"
		}
		nodes[relationshipNodeID] = relationshipGraphNodeDTO{
			ID: relationshipNodeID, Kind: "relationship", Label: rel.DisplayName,
			RelationshipID: relationshipID, RelationshipIDs: []string{relationshipID},
			Summary: state.Summary, Status: relationshipStatus, Lifecycle: state.Lifecycle,
			Engagement: state.Engagement, Sentiment: state.Sentiment, Health: state.Health,
			UpdatedAt: &boundary.ChangedAt, ChangedSinceReview: changedSinceGraphReview(rel, state.StateVersion),
			ChangedDimensions: boundary.ChangedDimensions, EvidenceRefs: boundary.AssertionIDs, ResourceRef: relationshipID,
			Metadata: map[string]any{
				"kind": rel.Kind, "nextAction": state.NextAction, "stateVersion": state.StateVersion,
				"stateHash": boundary.StateHash, "accountDomain": rel.AccountDomain,
			},
		}

		participantRefs := make(map[string]string)
		participants, _ := rel.Edges.ParticipantsOrErr()
		for _, participant := range participants {
			// Prefer the canonical person id. Keying on the email string forked one
			// human into N nodes whenever an address was missing (falling back to
			// the participant UUID) and silently merged two people who shared a
			// role address. The person layer resolves both cases properly; the
			// string key remains only for rows the backfill has not reached.
			identity := participant.ID.String()
			if linked, err := participant.Edges.PersonOrErr(); err == nil && linked != nil {
				identity = "person-id:" + linked.ID.String()
			} else if strings.TrimSpace(participant.Email) != "" {
				identity = participant.Email
			}
			personNodeID := "person:" + graphStableID(identity)
			node := nodes[personNodeID]
			if node.ID == "" {
				participantStatus := map[bool]string{true: "active", false: "inactive"}[participant.Active]
				participantRole := participant.Role
				participantMetadata := map[string]any{"title": participant.Title}
				if aggregate.Historical && participant.UpdatedAt.After(aggregate.AsOf) {
					participantStatus = "historical_unknown"
					participantRole = ""
					participantMetadata = nil
				}
				node = relationshipGraphNodeDTO{
					ID: personNodeID, Kind: "person", Label: participant.DisplayName,
					Role: participantRole, Status: participantStatus,
					RelationshipID: relationshipID, RelationshipIDs: []string{},
					ResourceRef: participant.ID.String(), Metadata: participantMetadata,
				}
			}
			if !graphContainsString(node.RelationshipIDs, relationshipID) {
				node.RelationshipIDs = append(node.RelationshipIDs, relationshipID)
			}
			nodes[personNodeID] = node
			for _, ref := range append(participant.ExternalRefs, participant.ID.String(), participant.Email, participant.DisplayName) {
				if normalized := strings.ToLower(strings.TrimSpace(ref)); normalized != "" {
					participantRefs[normalized] = personNodeID
				}
			}
			addEdge("participant_of", "participates in", personNodeID, relationshipNodeID, true, nil, nil)
		}

		commitments, _ := rel.Edges.CommitmentsOrErr()
		for _, item := range commitments {
			commitmentNodeID := "commitment:" + item.ID.String()
			confidence := item.Confidence
			confidenceRef := &confidence
			commitmentStatus := item.Status
			commitmentDueAt := item.DueAt
			commitmentUpdatedAt := item.UpdatedAt
			if aggregate.Historical && item.UpdatedAt.After(aggregate.AsOf) {
				commitmentStatus = "historical_unknown"
				commitmentDueAt = nil
				commitmentUpdatedAt = item.CreatedAt
				confidenceRef = nil
			}
			evidenceRefs := []string{}
			if evidences, err := item.Edges.EvidencesOrErr(); err == nil {
				for _, evidence := range evidences {
					evidenceRefs = append(evidenceRefs, evidence.ID.String())
				}
			}
			nodes[commitmentNodeID] = relationshipGraphNodeDTO{
				ID: commitmentNodeID, Kind: "commitment", Label: item.Text,
				RelationshipID: relationshipID, RelationshipIDs: []string{relationshipID},
				Summary: item.SourcePhrase, Status: commitmentStatus, Confidence: confidenceRef,
				DueAt: commitmentDueAt, UpdatedAt: &commitmentUpdatedAt, EvidenceRefs: evidenceRefs,
				ResourceRef: item.ID.String(),
				Metadata: map[string]any{
					"direction": item.Direction, "acceptance": item.Acceptance,
					"blocker": item.Blocker, "userConfirmed": item.UserConfirmed,
				},
			}
			addEdge("has_commitment", "has commitment", relationshipNodeID, commitmentNodeID, true, confidenceRef, evidenceRefs)
			if ownerNodeID := participantRefs[strings.ToLower(strings.TrimSpace(item.OwnerParticipantRef))]; ownerNodeID != "" {
				addEdge("owns", "owns", ownerNodeID, commitmentNodeID, true, &confidence, evidenceRefs)
			}
		}

		dependencies, _ := rel.Edges.CommitmentDependenciesOrErr()
		for _, dependency := range dependencies {
			from, fromErr := dependency.Edges.FromCommitmentOrErr()
			to, toErr := dependency.Edges.ToCommitmentOrErr()
			if fromErr != nil || toErr != nil {
				continue
			}
			addEdge(
				dependency.Kind, strings.ReplaceAll(dependency.Kind, "_", " "),
				"commitment:"+from.ID.String(), "commitment:"+to.ID.String(), true, nil,
				dependency.EvidenceRefs,
			)
		}

		for index, risk := range state.Risks {
			nodeID := fmt.Sprintf("risk:%s:%d", relationshipID, index)
			nodes[nodeID] = relationshipGraphNodeDTO{
				ID: nodeID, Kind: "risk", Label: risk, RelationshipID: relationshipID,
				RelationshipIDs: []string{relationshipID}, Status: state.Health,
				EvidenceRefs: boundary.AssertionIDs, ResourceRef: relationshipID,
			}
			addEdge("has_risk", "has risk", relationshipNodeID, nodeID, true, nil, boundary.AssertionIDs)
		}
		for index, milestone := range state.Milestones {
			nodeID := fmt.Sprintf("milestone:%s:%d", relationshipID, index)
			nodes[nodeID] = relationshipGraphNodeDTO{
				ID: nodeID, Kind: "milestone", Label: milestone, RelationshipID: relationshipID,
				RelationshipIDs: []string{relationshipID}, EvidenceRefs: boundary.AssertionIDs, ResourceRef: relationshipID,
			}
			addEdge("has_milestone", "has milestone", relationshipNodeID, nodeID, true, nil, boundary.AssertionIDs)
		}

		actions, _ := rel.Edges.ActionsOrErr()
		for _, action := range actions {
			actionNodeID := "action:" + action.ID.String()
			evidenceRefs := []string{}
			actionType, actionReason, actionChannel := action.ActionType, action.Reason, action.Channel
			actionRevision, actionRevisionHash := action.Revision, action.RevisionHash
			if revisions, err := action.Edges.RevisionsOrErr(); err == nil && len(revisions) > 0 {
				latestRevision := revisions[0]
				for _, revision := range revisions[1:] {
					if revision.Revision > latestRevision.Revision {
						latestRevision = revision
					}
				}
				actionType, actionReason, actionChannel = latestRevision.ActionType, latestRevision.Reason, latestRevision.Channel
				actionRevision, actionRevisionHash = latestRevision.Revision, latestRevision.RevisionHash
			}
			actionStatus, approvalStatus := action.QueueStatus, action.ApprovalStatus
			policyStatus, executionStatus := action.PolicyStatus, action.ExecutionStatus
			actionDueAt, actionUpdatedAt, actionPriority := action.DueAt, action.UpdatedAt, action.PriorityScore
			if aggregate.Historical && action.UpdatedAt.After(aggregate.AsOf) {
				actionStatus, approvalStatus = "historical_unknown", "historical_unknown"
				policyStatus, executionStatus = "historical_unknown", "historical_unknown"
				actionDueAt, actionUpdatedAt, actionPriority = nil, action.CreatedAt, 0
				if action.ApprovedAt != nil && !action.ApprovedAt.After(aggregate.AsOf) {
					approvalStatus = ApprovalApproved
				}
				if action.ExecutedAt != nil && !action.ExecutedAt.After(aggregate.AsOf) {
					executionStatus = action.ExecutionStatus
				}
			}
			nodes[actionNodeID] = relationshipGraphNodeDTO{
				ID: actionNodeID, Kind: "action", Label: strings.ReplaceAll(actionType, "_", " "),
				RelationshipID: relationshipID, RelationshipIDs: []string{relationshipID},
				Summary: actionReason, Status: actionStatus, ApprovalStatus: approvalStatus,
				PolicyStatus: policyStatus, ExecutionStatus: executionStatus,
				Priority: actionPriority, DueAt: actionDueAt, UpdatedAt: &actionUpdatedAt,
				ResourceRef: action.ID.String(), EvidenceRefs: evidenceRefs,
				Metadata: map[string]any{
					"channel": actionChannel, "executionMode": action.ExecutionMode,
					"revision": actionRevision, "revisionHash": actionRevisionHash,
				},
			}
			if actionEvidence, err := action.Edges.EvidencesOrErr(); err == nil {
				for _, evidence := range actionEvidence {
					evidenceNodeID := "evidence:" + evidence.ID.String()
					sourceNodeID := "source:" + relationshipID + ":" + evidence.Source
					occurredAt := evidence.OccurredAt.UTC()
					nodes[evidenceNodeID] = relationshipGraphNodeDTO{
						ID: evidenceNodeID, Kind: "evidence", Label: evidence.Excerpt,
						RelationshipID: relationshipID, RelationshipIDs: []string{relationshipID},
						Source: evidence.Source, Freshness: graphFreshness(occurredAt, aggregate.AsOf),
						OccurredAt: &occurredAt, EvidenceRefs: []string{evidence.ID.String()},
						ResourceRef: evidence.ID.String(),
					}
					evidenceRefs = append(evidenceRefs, evidence.ID.String())
					addEdge("supports", "supports", evidenceNodeID, actionNodeID, true, nil, []string{evidence.ID.String()})
					ensureGraphSourceNode(nodes, sourceNodeID, relationshipID, evidence.Source, "", sourceStatuses, aggregate.AsOf)
					addEdge("observed_from", "observed from", evidenceNodeID, sourceNodeID, true, nil, []string{evidence.ID.String()})
				}
				actionNode := nodes[actionNodeID]
				actionNode.EvidenceRefs = evidenceRefs
				nodes[actionNodeID] = actionNode
			}
			addEdge("recommended_for", "recommended for", actionNodeID, relationshipNodeID, true, nil, evidenceRefs)
		}

		if aggregate.Depth >= 2 {
			observations, _ := rel.Edges.ObservationsOrErr()
			for _, observation := range observations {
				observationNodeID := "evidence:" + observation.ID.String()
				sourceNodeID := "source:" + relationshipID + ":" + observation.Source
				occurredAt := observation.OccurredAt.UTC()
				label := observation.Summary
				if strings.TrimSpace(label) == "" {
					label = strings.ReplaceAll(observation.EventType, "_", " ")
				}
				nodes[observationNodeID] = relationshipGraphNodeDTO{
					ID: observationNodeID, Kind: "evidence", Label: label,
					RelationshipID: relationshipID, RelationshipIDs: []string{relationshipID},
					Status: observation.EventType, Source: observation.Source,
					Freshness: graphFreshness(occurredAt, aggregate.AsOf), OccurredAt: &occurredAt,
					EvidenceRefs: []string{observation.ID.String()}, ResourceRef: observation.ID.String(),
				}
				addEdge("supports", "supports", observationNodeID, relationshipNodeID, true, nil, []string{observation.ID.String()})
				ensureGraphSourceNode(nodes, sourceNodeID, relationshipID, observation.Source, observation.SourceAccountID, sourceStatuses, aggregate.AsOf)
				addEdge("observed_from", "observed from", observationNodeID, sourceNodeID, true, nil, []string{observation.ID.String()})
			}
		}
	}

	nodeList := make([]relationshipGraphNodeDTO, 0, len(nodes))
	for _, node := range nodes {
		sort.Strings(node.RelationshipIDs)
		nodeList = append(nodeList, node)
	}
	sort.SliceStable(nodeList, func(i, j int) bool {
		if nodeList[i].Kind == nodeList[j].Kind {
			return nodeList[i].Label < nodeList[j].Label
		}
		return nodeList[i].Kind < nodeList[j].Kind
	})
	edgeList := make([]relationshipGraphEdgeDTO, 0, len(edges))
	for _, edge := range edges {
		edgeList = append(edgeList, edge)
	}
	sort.SliceStable(edgeList, func(i, j int) bool { return edgeList[i].ID < edgeList[j].ID })

	permissions := relationshipGraphPermissionsDTO{CanView: true, CanSaveViews: true}
	if capabilities, ok := workspaceRoleCapabilities[aggregate.Role]; ok {
		permissions.CanContribute = capabilities[WorkspaceContribute]
		permissions.CanApprove = capabilities[WorkspaceExecute]
		permissions.CanExecute = capabilities[WorkspaceExecute]
	}
	dto := relationshipGraphDTO{
		ContractVersion: relationshipGraphContractVersion, GeneratedAt: generatedAt.UTC(),
		AsOf: aggregate.AsOf, Historical: aggregate.Historical, Scope: aggregate.Scope,
		Depth: aggregate.Depth, Nodes: nodeList, Edges: edgeList, Permissions: permissions,
	}
	if aggregate.Scope == "relationship" && len(aggregate.Relationships) == 1 {
		dto.RelationshipID = aggregate.Relationships[0].ID.String()
	}
	return dto
}

func ensureGraphSourceNode(
	nodes map[string]relationshipGraphNodeDTO,
	nodeID string,
	relationshipID string,
	source string,
	sourceAccountID string,
	statuses map[string]*ent.RelationshipSourceStatus,
	asOf time.Time,
) {
	if _, exists := nodes[nodeID]; exists {
		return
	}
	status := statuses[source+":"+sourceAccountID]
	if status == nil {
		status = statuses[source]
	}
	node := relationshipGraphNodeDTO{
		ID: nodeID, Kind: "source", Label: strings.ReplaceAll(source, "_", " "),
		RelationshipID: relationshipID, RelationshipIDs: []string{relationshipID}, Source: source,
		ResourceRef: source,
	}
	if status != nil {
		if status.UpdatedAt.After(asOf) {
			node.Status = "historical_unknown"
			node.Freshness = "unknown"
			nodes[nodeID] = node
			return
		}
		node.Status = status.Status
		node.Freshness = graphSourceFreshness(status, asOf)
		node.Metadata = map[string]any{
			"completeness": status.Completeness, "lagSeconds": status.LagSeconds,
			"missingScopes": status.MissingScopes,
		}
	}
	nodes[nodeID] = node
}

func graphContainsString(values []string, candidate string) bool {
	for _, value := range values {
		if value == candidate {
			return true
		}
	}
	return false
}

// RelationshipGraph serves the versioned graph read model shared by web and desktop.
func (h *Handler) RelationshipGraph(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	filter := RelationshipGraphFilter{Scope: strings.TrimSpace(r.URL.Query().Get("scope")), Depth: 2}
	if rawDepth := strings.TrimSpace(r.URL.Query().Get("depth")); rawDepth != "" {
		depth, err := strconv.Atoi(rawDepth)
		if err != nil {
			h.writeServiceError(w, fmt.Errorf("%w: graph depth must be an integer", ErrInvalidInput))
			return
		}
		filter.Depth = depth
	}
	if rawAsOf := strings.TrimSpace(r.URL.Query().Get("asOf")); rawAsOf != "" {
		asOf, err := time.Parse(time.RFC3339, rawAsOf)
		if err != nil {
			h.writeServiceError(w, fmt.Errorf("%w: graph asOf must be RFC3339", ErrInvalidInput))
			return
		}
		filter.AsOf = asOf
	}
	if rawID := strings.TrimSpace(r.URL.Query().Get("relationshipId")); rawID != "" {
		id, err := uuid.Parse(rawID)
		if err != nil {
			h.writeServiceError(w, fmt.Errorf("%w: invalid graph relationshipId", ErrInvalidInput))
			return
		}
		filter.RelationshipID = &id
	}

	aggregate, err := h.svc.RelationshipGraph(r.Context(), u, filter)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, buildRelationshipGraphDTO(aggregate, h.svc.now()))
}
