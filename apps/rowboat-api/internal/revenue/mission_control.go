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

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipassertion"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipidentitycandidate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipobservation"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipprojectionjob"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipreviewacknowledgement"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipstatesnapshot"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/workspacefeaturecontrol"
	"github.com/google/uuid"
)

const (
	missionControlContractVersion = "tfa-2026-07-31"
	missionControlDetectorVersion = 1
)

// MissionControlChange describes one canonical dimension transition since the
// caller's last acknowledged state.
type MissionControlChange struct {
	Dimension    string   `json:"dimension"`
	Before       any      `json:"before,omitempty"`
	After        any      `json:"after,omitempty"`
	AssertionIDs []string `json:"assertionIds"`
}

// MissionControlEvidenceReference identifies immutable supporting evidence
// without embedding its content in the read model.
type MissionControlEvidenceReference struct {
	ObservationID string    `json:"observationId"`
	Source        string    `json:"source"`
	ObservedAt    time.Time `json:"observedAt"`
	EvidencePath  string    `json:"evidencePath"`
	ContentHash   string    `json:"contentHash"`
}

// MissionControlDimensionEvidence explains one projected dimension, its
// authority, freshness, and complete source trail.
type MissionControlDimensionEvidence struct {
	Dimension     string                            `json:"dimension"`
	Value         any                               `json:"value,omitempty"`
	Supported     bool                              `json:"supported"`
	MissingReason string                            `json:"missingReason,omitempty"`
	AssertionID   string                            `json:"assertionId,omitempty"`
	Authority     string                            `json:"authority,omitempty"`
	Confidence    float64                           `json:"confidence,omitempty"`
	Reason        string                            `json:"reason,omitempty"`
	ValidFrom     *time.Time                        `json:"validFrom,omitempty"`
	ValidTo       *time.Time                        `json:"validTo,omitempty"`
	Fresh         bool                              `json:"fresh"`
	Evidence      []MissionControlEvidenceReference `json:"evidence"`
}

// MissionControlSourceCoverage exposes one provider account's contribution and
// repair state to completeness decisions.
type MissionControlSourceCoverage struct {
	Source                 string     `json:"source"`
	SourceAccountID        string     `json:"sourceAccountId"`
	Status                 string     `json:"status"`
	Completeness           string     `json:"completeness"`
	LagSeconds             int64      `json:"lagSeconds"`
	ExpectedCadenceSeconds int64      `json:"expectedCadenceSeconds"`
	LastObservationAt      *time.Time `json:"lastObservationAt,omitempty"`
	MissingScopes          []string   `json:"missingScopes"`
	RepairPath             string     `json:"repairPath,omitempty"`
}

// MissionControlCompleteness explains whether the current account model is
// trustworthy enough for external action.
type MissionControlCompleteness struct {
	Status                    string                         `json:"status"`
	Explanation               string                         `json:"explanation"`
	ExternalActionSafe        bool                           `json:"externalActionSafe"`
	UnresolvedIdentityCount   int                            `json:"unresolvedIdentityCount"`
	MissingMaterialDimensions []string                       `json:"missingMaterialDimensions"`
	Sources                   []MissionControlSourceCoverage `json:"sources"`
}

// MissionControlRecommendation is the active governed action projection.
type MissionControlRecommendation struct {
	ID              string         `json:"id"`
	Revision        int            `json:"revision"`
	ActionType      string         `json:"actionType"`
	Channel         string         `json:"channel"`
	Reason          string         `json:"reason"`
	RankFactors     map[string]int `json:"rankFactors"`
	PolicyStatus    string         `json:"policyStatus"`
	ApprovalStatus  string         `json:"approvalStatus"`
	ExecutionStatus string         `json:"executionStatus"`
}

// MissionControlPendingState counts unresolved work across each control plane.
type MissionControlPendingState struct {
	Corrections    int `json:"corrections"`
	IdentityReview int `json:"identityReview"`
	Approval       int `json:"approval"`
	Execution      int `json:"execution"`
	Reconciliation int `json:"reconciliation"`
}

// MissionControlReadModel is the single server-owned contract for state,
// change, evidence, action, completeness, and control. Clients format it but
// do not recompute winners, freshness, or rank factors.
type MissionControlReadModel struct {
	relationship                 *ent.Relationship                          `json:"-"`
	workspace                    *ent.RevenueWorkspace                      `json:"-"`
	intelligence                 *RelationshipIntelligence                  `json:"-"`
	ContractVersion              string                                     `json:"contractVersion"`
	AggregateHash                string                                     `json:"aggregateHash"`
	AsOf                         time.Time                                  `json:"asOf"`
	StateVersion                 int                                        `json:"stateVersion"`
	StateHash                    string                                     `json:"stateHash"`
	ProjectorVersion             int                                        `json:"projectorVersion"`
	DetectorVersion              int                                        `json:"detectorVersion"`
	FreshnessBoundary            *time.Time                                 `json:"freshnessBoundary,omitempty"`
	PreviousReviewedStateVersion int                                        `json:"previousReviewedStateVersion"`
	ChangedSinceReview           bool                                       `json:"changedSinceReview"`
	Changes                      []MissionControlChange                     `json:"changes"`
	Evidence                     map[string]MissionControlDimensionEvidence `json:"evidence"`
	Completeness                 MissionControlCompleteness                 `json:"completeness"`
	ActiveRecommendation         *MissionControlRecommendation              `json:"activeRecommendation,omitempty"`
	Pending                      MissionControlPendingState                 `json:"pending"`
	Capabilities                 map[string]string                          `json:"capabilities"`
}

// MissionControl builds all four product answers at one explicit as-of time and
// verifies that the relationship projection did not change between the first and
// final read. A racing projection is retried rather than returning a mixed-version
// aggregate to either client.
func (s *Service) MissionControl(ctx context.Context, u *ent.User, relationshipID uuid.UUID) (*MissionControlReadModel, error) {
	previousHash := ""
	for attempt := 0; attempt < 4; attempt++ {
		model, err := s.buildMissionControl(ctx, u, relationshipID)
		if err != nil {
			return nil, err
		}
		stable, err := s.client.Relationship.Query().Where(
			relationship.IDEQ(relationshipID),
			relationship.StateVersionEQ(model.StateVersion),
			relationship.StateHashEQ(model.StateHash),
		).Exist(ctx)
		if err != nil {
			return nil, err
		}
		if !stable {
			previousHash = ""
			continue
		}
		aggregateHash, err := missionControlAggregateHash(model)
		if err != nil {
			return nil, err
		}
		model.AggregateHash = aggregateHash
		if previousHash == aggregateHash {
			return model, nil
		}
		previousHash = aggregateHash
	}
	return nil, fmt.Errorf("%w: relationship changed while Mission Control was loading", ErrConflict)
}

// missionControlAggregateHash excludes the wall-clock asOf value but includes
// every material answer rendered by either client. MissionControl requires two
// consecutive equal hashes, catching source, identity, action, review, and
// projection races rather than validating only the relationship row.
func missionControlAggregateHash(model *MissionControlReadModel) (string, error) {
	payload := struct {
		StateVersion                 int                                        `json:"stateVersion"`
		StateHash                    string                                     `json:"stateHash"`
		ProjectorVersion             int                                        `json:"projectorVersion"`
		PreviousReviewedStateVersion int                                        `json:"previousReviewedStateVersion"`
		ChangedSinceReview           bool                                       `json:"changedSinceReview"`
		Changes                      []MissionControlChange                     `json:"changes"`
		Evidence                     map[string]MissionControlDimensionEvidence `json:"evidence"`
		Completeness                 MissionControlCompleteness                 `json:"completeness"`
		ActiveRecommendation         *MissionControlRecommendation              `json:"activeRecommendation"`
		Pending                      MissionControlPendingState                 `json:"pending"`
		Capabilities                 map[string]string                          `json:"capabilities"`
	}{
		StateVersion: model.StateVersion, StateHash: model.StateHash,
		ProjectorVersion:             model.ProjectorVersion,
		PreviousReviewedStateVersion: model.PreviousReviewedStateVersion,
		ChangedSinceReview:           model.ChangedSinceReview, Changes: model.Changes,
		Evidence: model.Evidence, Completeness: model.Completeness,
		ActiveRecommendation: model.ActiveRecommendation, Pending: model.Pending,
		Capabilities: model.Capabilities,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(digest[:]), nil
}

func (s *Service) buildMissionControl(ctx context.Context, u *ent.User, relationshipID uuid.UUID) (*MissionControlReadModel, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceView)
	if err != nil {
		return nil, err
	}
	rel, err := s.GetRelationship(ctx, relationshipID)
	if err != nil {
		return nil, err
	}
	asOf := s.now().UTC()
	assertions, err := s.client.RelationshipAssertion.Query().
		Where(relationshipassertion.HasRelationshipWith(relationship.IDEQ(rel.ID))).All(ctx)
	if err != nil {
		return nil, err
	}
	winners, err := s.missionControlProjectionWinners(ctx, rel, assertions)
	if err != nil {
		return nil, err
	}
	observations, err := s.client.RelationshipObservation.Query().
		Where(relationshipobservation.HasRelationshipWith(relationship.IDEQ(rel.ID))).All(ctx)
	if err != nil {
		return nil, err
	}
	observationByID := make(map[string]*ent.RelationshipObservation, len(observations))
	for _, observation := range observations {
		observationByID[observation.ID.String()] = observation
	}

	statuses, err := s.RelationshipSourceStatuses(ctx, u)
	if err != nil {
		return nil, err
	}
	dependencies := relationshipSourceDependencies(rel)
	for _, observation := range observations {
		if source := canonicalSource(observation.Source); source == "google" || source == "slack" || source == "hubspot" {
			dependencies = append(dependencies, source)
		}
	}
	actions, _ := rel.Edges.ActionsOrErr()
	var activeAction *ent.RevenueAction
	for _, action := range actions {
		if action.QueueStatus == QueueOpen && (activeAction == nil || action.PriorityScore > activeAction.PriorityScore ||
			(action.PriorityScore == activeAction.PriorityScore && action.ID.String() < activeAction.ID.String())) {
			activeAction = action
		}
	}
	actionScopes := map[string][]string{}
	if activeAction != nil {
		if source, required := betaActionProviderRequirements(activeAction); source != "" {
			dependencies = append(dependencies, source)
			actionScopes[source] = required
		}
	}
	dependencies = normalizeProjectionTriggerRefs(dependencies)
	filtered := make([]*ent.RelationshipSourceStatus, 0, len(statuses))
	for _, status := range statuses {
		if containsString(dependencies, canonicalSource(status.Source)) {
			filtered = append(filtered, status)
		}
	}
	statuses = filtered
	statusByConnection := make(map[string]*ent.RelationshipSourceStatus, len(statuses))
	singleStatusBySource := make(map[string]*ent.RelationshipSourceStatus, len(statuses))
	statusCountBySource := make(map[string]int, len(statuses))
	presentSources := make(map[string]bool, len(statuses))
	coverage := make([]MissionControlSourceCoverage, 0, len(statuses))
	var freshnessBoundary *time.Time
	for _, status := range statuses {
		source := canonicalSource(status.Source)
		presentSources[source] = true
		connectionKey := source + "\x00" + normalizedSourceAccountID(status.SourceAccountID)
		statusByConnection[connectionKey] = status
		singleStatusBySource[source] = status
		statusCountBySource[source]++
		if status.LastSuccessAt != nil {
			boundary := status.LastSuccessAt.UTC().Add(time.Duration(status.ExpectedCadenceSeconds*2) * time.Second)
			if freshnessBoundary == nil || boundary.Before(*freshnessBoundary) {
				freshnessBoundary = &boundary
			}
		}
		repairPath := ""
		if status.Status != "live" || status.Completeness != "complete" {
			repairPath = "/v1/relationship-sources/" + source + "/resync"
		}
		missingScopes := sortedUniqueStrings(append(append([]string{}, status.MissingScopes...), differenceStrings(actionScopes[source], status.GrantedScopes)...))
		coverage = append(coverage, MissionControlSourceCoverage{
			Source: source, SourceAccountID: status.SourceAccountID, Status: status.Status,
			Completeness: status.Completeness, LagSeconds: status.LagSeconds,
			ExpectedCadenceSeconds: status.ExpectedCadenceSeconds,
			LastObservationAt:      status.LastObservationAt, MissingScopes: missingScopes, RepairPath: repairPath,
		})
	}
	for _, source := range dependencies {
		if presentSources[source] {
			continue
		}
		coverage = append(coverage, MissionControlSourceCoverage{
			Source: source, SourceAccountID: "default", Status: "not_connected", Completeness: "partial",
			MissingScopes: sortedUniqueStrings(actionScopes[source]), RepairPath: "/v1/relationship-sources",
		})
	}
	sort.Slice(coverage, func(i, j int) bool {
		if coverage[i].Source != coverage[j].Source {
			return coverage[i].Source < coverage[j].Source
		}
		return coverage[i].SourceAccountID < coverage[j].SourceAccountID
	})
	evidence := make(map[string]MissionControlDimensionEvidence, len(relationshipProjectionDimensions))
	missing := make([]string, 0)
	for _, dimension := range relationshipProjectionDimensions {
		value := missionControlDimensionValue(rel, dimension)
		item := MissionControlDimensionEvidence{
			Dimension: dimension, Value: value, Fresh: true,
			Evidence: []MissionControlEvidenceReference{},
		}
		winner := winners[dimension]
		if winner == nil {
			item.MissingReason = "No active assertion supports this value at the response asOf boundary."
			item.Supported = false
			missing = append(missing, dimension)
			evidence[dimension] = item
			continue
		}
		item.Supported = true
		item.AssertionID = winner.ID.String()
		item.Authority = winner.SourceType
		item.Confidence = winner.Confidence
		item.Reason = winner.Reason
		from := winner.ValidFrom.UTC()
		item.ValidFrom = &from
		item.ValidTo = winner.ValidTo
		refs := append([]string{}, winner.SupportingObservationIds...)
		if linked, edgeErr := winner.QueryObservation().Only(ctx); edgeErr == nil && !containsString(refs, linked.ID.String()) {
			refs = append(refs, linked.ID.String())
		}
		for _, ref := range refs {
			observation := observationByID[ref]
			if observation == nil {
				continue
			}
			source := canonicalSource(observation.Source)
			connectionKey := source + "\x00" + normalizedSourceAccountID(observation.SourceAccountID)
			sourceStatus := statusByConnection[connectionKey]
			// Legacy observations did not always retain the provider account ID.
			// A source-only fallback is safe only when the tenant has exactly one
			// account for that provider; otherwise freshness must remain bound to
			// the exact account that produced the evidence.
			if sourceStatus == nil && statusCountBySource[source] == 1 {
				sourceStatus = singleStatusBySource[source]
			}
			if sourceStatus == nil || sourceStatus.Completeness != "complete" {
				item.Fresh = false
			}
			item.Evidence = append(item.Evidence, MissionControlEvidenceReference{
				ObservationID: observation.ID.String(), Source: source, ObservedAt: observation.OccurredAt,
				EvidencePath: fmt.Sprintf("/v1/relationships/%s/evidence/%s", rel.ID, observation.ID),
				ContentHash:  observation.ContentHash,
			})
		}
		if winner.SourceType != "user_correction" && len(item.Evidence) == 0 {
			item.Supported = false
			item.MissingReason = "The winning assertion has no accessible source evidence reference."
			missing = append(missing, dimension)
		}
		evidence[dimension] = item
	}

	unresolved, err := s.client.RelationshipIdentityCandidate.Query().Where(
		relationshipidentitycandidate.StatusIn(identityPending, identityDeferred, identityResolving),
		relationshipidentitycandidate.Or(
			relationshipidentitycandidate.HasProposedRelationshipWith(relationship.IDEQ(rel.ID)),
			relationshipidentitycandidate.HasExistingRelationshipWith(relationship.IDEQ(rel.ID)),
		),
	).Count(ctx)
	if err != nil {
		return nil, err
	}
	completeness := missionControlCompleteness(coverage, unresolved, missing)
	deadProjection, err := s.client.RelationshipProjectionJob.Query().Where(
		relationshipprojectionjob.HasRelationshipWith(relationship.IDEQ(rel.ID)),
		relationshipprojectionjob.StatusEQ("dead"),
		relationshipprojectionjob.EvaluatedAtLTE(asOf),
	).Exist(ctx)
	if err != nil {
		return nil, err
	}
	dueProjection, err := s.client.RelationshipProjectionJob.Query().Where(
		relationshipprojectionjob.HasRelationshipWith(relationship.IDEQ(rel.ID)),
		relationshipprojectionjob.StatusIn("pending", "running", "failed"),
		relationshipprojectionjob.EvaluatedAtLTE(asOf),
	).Exist(ctx)
	if err != nil {
		return nil, err
	}
	if deadProjection {
		completeness.Status = "rebuilding"
		completeness.Explanation = "Relationship projection requires operator repair before this state is safe to act on."
		completeness.ExternalActionSafe = false
	} else if dueProjection {
		completeness.Status = "rebuilding"
		completeness.Explanation = "Accepted evidence is waiting for the durable relationship projector."
		completeness.ExternalActionSafe = false
	}

	ack, err := s.client.RelationshipReviewAcknowledgement.Query().Where(
		relationshipreviewacknowledgement.HasRelationshipWith(relationship.IDEQ(rel.ID)),
		relationshipreviewacknowledgement.HasUserWith(user.IDEQ(u.ID)),
	).Order(ent.Desc(relationshipreviewacknowledgement.FieldStateVersion)).First(ctx)
	previousVersion := 0
	if err == nil {
		previousVersion = ack.StateVersion
	} else if !ent.IsNotFound(err) {
		return nil, err
	}
	changes, err := s.missionControlChanges(ctx, rel, previousVersion, winners)
	if err != nil {
		return nil, err
	}

	var active *MissionControlRecommendation
	pending := MissionControlPendingState{IdentityReview: unresolved}
	for _, action := range actions {
		if activeAction != nil && action.ID == activeAction.ID {
			factors := map[string]int{}
			_ = json.Unmarshal([]byte(action.PriorityComponentsJSON), &factors)
			active = &MissionControlRecommendation{
				ID: action.ID.String(), Revision: action.Revision, ActionType: action.ActionType, Channel: action.Channel,
				Reason: action.Reason, RankFactors: factors, PolicyStatus: action.PolicyStatus,
				ApprovalStatus: action.ApprovalStatus, ExecutionStatus: action.ExecutionStatus,
			}
		}
		if action.ApprovalStatus == ApprovalPending {
			pending.Approval++
		}
		if action.ExecutionStatus == ExecRequested {
			pending.Execution++
		}
		if action.ExecutionStatus == ExecAmbiguous {
			pending.Reconciliation++
		}
	}
	intelligence, err := s.RelationshipIntelligenceFor(ctx, rel)
	if err != nil {
		return nil, err
	}
	pending.Corrections = len(intelligence.ReviewItems)
	capabilities := map[string]string{
		"correct":      fmt.Sprintf("/v1/relationships/%s/corrections", rel.ID),
		"acknowledge":  fmt.Sprintf("/v1/relationships/%s/acknowledgements", rel.ID),
		"timeline":     fmt.Sprintf("/v1/relationships/%s/timeline", rel.ID),
		"sourceRepair": "/v1/relationship-sources",
	}
	if unresolved > 0 {
		capabilities["identityReview"] = "/v1/relationship-identity-candidates?relationshipId=" + rel.ID.String()
	}
	return &MissionControlReadModel{
		relationship:    rel,
		workspace:       ws,
		intelligence:    &intelligence,
		ContractVersion: missionControlContractVersion, AsOf: asOf,
		StateVersion: rel.StateVersion, StateHash: rel.StateHash, ProjectorVersion: rel.ProjectorVersion,
		DetectorVersion: missionControlDetectorVersion, FreshnessBoundary: freshnessBoundary,
		PreviousReviewedStateVersion: previousVersion, ChangedSinceReview: rel.StateVersion > previousVersion,
		Changes: changes, Evidence: evidence, Completeness: completeness,
		ActiveRecommendation: active, Pending: pending, Capabilities: capabilities,
	}, nil
}

// missionControlProjectionWinners resolves evidence from the exact assertion
// IDs recorded by the current state snapshot. Selecting winners at request
// time would allow newly-valid, expired, or retracted assertions to drift
// ahead of the durable state row while a projection job is pending.
func (s *Service) missionControlProjectionWinners(
	ctx context.Context,
	rel *ent.Relationship,
	assertions []*ent.RelationshipAssertion,
) (map[string]*ent.RelationshipAssertion, error) {
	if rel.StateVersion == 0 {
		boundary := rel.CreatedAt.UTC()
		if rel.ProjectedAt != nil {
			boundary = rel.ProjectedAt.UTC()
		}
		winners, _, err := selectRelationshipAssertionsAt(assertions, boundary)
		return winners, err
	}
	snapshot, err := s.client.RelationshipStateSnapshot.Query().Where(
		relationshipstatesnapshot.HasRelationshipWith(relationship.IDEQ(rel.ID)),
		relationshipstatesnapshot.VersionEQ(rel.StateVersion),
	).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, fmt.Errorf("%w: state version %d has no durable snapshot", ErrReviewRequired, rel.StateVersion)
	}
	if err != nil {
		return nil, err
	}
	byID := make(map[string]*ent.RelationshipAssertion, len(assertions))
	for _, assertion := range assertions {
		byID[assertion.ID.String()] = assertion
	}
	winners := make(map[string]*ent.RelationshipAssertion, len(snapshot.AssertionIds))
	for _, assertionID := range snapshot.AssertionIds {
		assertion := byID[assertionID]
		if assertion == nil {
			return nil, fmt.Errorf("%w: projected assertion %s is unavailable", ErrReviewRequired, assertionID)
		}
		winners[assertion.Dimension] = assertion
	}
	return winners, nil
}

func missionControlDimensionValue(rel *ent.Relationship, dimension string) any {
	switch dimension {
	case "lifecycle":
		return rel.Lifecycle
	case "engagement":
		return rel.Engagement
	case "sentiment":
		return rel.Sentiment
	case "health":
		return rel.Health
	case "summary":
		return rel.Summary
	case "next_action":
		return rel.NextAction
	case "risk":
		return rel.Risks
	case "milestone":
		return rel.Milestones
	default:
		return nil
	}
}

func missionControlCompleteness(sources []MissionControlSourceCoverage, unresolved int, missing []string) MissionControlCompleteness {
	result := MissionControlCompleteness{
		Status: "complete", Explanation: "Required source evidence is current.", ExternalActionSafe: true,
		UnresolvedIdentityCount: unresolved, MissingMaterialDimensions: uniqueSortedStrings(missing), Sources: sources,
	}
	if unresolved > 0 {
		result.Status, result.Explanation, result.ExternalActionSafe = "ambiguous", "Identity review is required before acting on this relationship.", false
		return result
	}
	if len(sources) == 0 {
		result.Status, result.Explanation, result.ExternalActionSafe = "partial", "No source connection has completed its first useful sync.", false
		return result
	}
	for _, source := range sources {
		switch source.Completeness {
		case "rebuilding":
			result.Status, result.Explanation, result.ExternalActionSafe = "rebuilding", "A required source is rebuilding; partial state is visible.", false
			return result
		case "stale", "disconnected":
			result.Status, result.Explanation, result.ExternalActionSafe = "stale", "A required source is stale or disconnected.", false
			return result
		case "partial":
			result.Status, result.Explanation, result.ExternalActionSafe = "partial", "Backfill is incomplete; only partial state is shown.", false
		}
		if len(source.MissingScopes) > 0 {
			result.Status, result.Explanation, result.ExternalActionSafe = "partial", "A required source scope is missing.", false
		}
	}
	if len(result.MissingMaterialDimensions) > 0 {
		result.Status, result.Explanation, result.ExternalActionSafe = "partial", "One or more material values have no accessible supporting evidence.", false
	}
	return result
}

// recordMissionControlOpened is deliberately called by the user-facing GET
// handler, not MissionControl itself. Internal completeness checks also build
// this aggregate and must not inflate product-review telemetry.
func (s *Service) recordMissionControlOpened(ctx context.Context, u *ent.User, model *MissionControlReadModel) {
	if model == nil || model.workspace == nil || model.relationship == nil {
		return
	}
	_ = appendTrustEvent(ctx, s.client, model.workspace, u, TrustEventInput{
		Name: "mission_control_opened", Outcome: "viewed", ReasonCode: "account_review",
		CorrelationID: "relationship:" + model.relationship.ID.String(), StateVersion: model.StateVersion,
		OccurredAt: model.AsOf, Relationship: model.relationship,
	})
}

func uniqueSortedStrings(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	sort.Strings(out)
	return out
}

func (s *Service) missionControlChanges(ctx context.Context, rel *ent.Relationship, fromVersion int, winners map[string]*ent.RelationshipAssertion) ([]MissionControlChange, error) {
	snapshots, err := s.client.RelationshipStateSnapshot.Query().Where(
		relationshipstatesnapshot.HasRelationshipWith(relationship.IDEQ(rel.ID)),
		relationshipstatesnapshot.VersionGT(fromVersion),
	).Order(ent.Asc(relationshipstatesnapshot.FieldVersion)).All(ctx)
	if err != nil {
		return nil, err
	}
	dimensions := []string{}
	for _, snapshot := range snapshots {
		dimensions = append(dimensions, snapshot.ChangedDimensions...)
	}
	dimensions = uniqueSortedStrings(dimensions)
	var before map[string]any
	if fromVersion > 0 {
		baseline, err := s.client.RelationshipStateSnapshot.Query().Where(
			relationshipstatesnapshot.HasRelationshipWith(relationship.IDEQ(rel.ID)),
			relationshipstatesnapshot.VersionEQ(fromVersion),
		).Only(ctx)
		if err == nil {
			_ = json.Unmarshal([]byte(baseline.StateJSON), &before)
		}
	}
	changes := make([]MissionControlChange, 0, len(dimensions))
	for _, dimension := range dimensions {
		key := strings.TrimSuffix(dimension, "s")
		ids := []string{}
		if winner := winners[key]; winner != nil {
			ids = append(ids, winner.ID.String())
		}
		var old any
		if before != nil {
			old = before[missionControlJSONKey(key)]
		}
		changes = append(changes, MissionControlChange{Dimension: key, Before: old, After: missionControlDimensionValue(rel, key), AssertionIDs: ids})
	}
	return changes, nil
}

func missionControlJSONKey(dimension string) string {
	if dimension == "next_action" {
		return "nextAction"
	}
	if dimension == "risk" {
		return "risks"
	}
	if dimension == "milestone" {
		return "milestones"
	}
	return dimension
}

// AcknowledgeMissionControl records the exact version/hash the user reviewed.
func (s *Service) AcknowledgeMissionControl(ctx context.Context, u *ent.User, relationshipID uuid.UUID, stateVersion int, stateHash string) (*ent.RelationshipReviewAcknowledgement, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceContribute)
	if err != nil {
		return nil, err
	}
	rel, err := s.client.Relationship.Get(ctx, relationshipID)
	if ent.IsNotFound(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if rel.StateVersion != stateVersion || rel.StateHash != strings.TrimSpace(stateHash) {
		return nil, fmt.Errorf("%w: relationship state changed; reload before acknowledging", ErrConflict)
	}
	existing, err := s.client.RelationshipReviewAcknowledgement.Query().Where(
		relationshipreviewacknowledgement.HasRelationshipWith(relationship.IDEQ(rel.ID)),
		relationshipreviewacknowledgement.HasUserWith(user.IDEQ(u.ID)),
		relationshipreviewacknowledgement.StateVersionEQ(stateVersion),
	).Only(ctx)
	if err == nil {
		return existing, nil
	}
	if !ent.IsNotFound(err) {
		return nil, err
	}
	ack, err := s.client.RelationshipReviewAcknowledgement.Create().
		SetWorkspace(ws).SetRelationship(rel).SetUser(u).
		SetStateVersion(stateVersion).SetStateHash(rel.StateHash).SetAcknowledgedAt(s.now().UTC()).Save(ctx)
	if err != nil {
		return nil, err
	}
	_ = appendTrustEvent(ctx, s.client, ws, u, TrustEventInput{
		Name: "mission_control_reviewed", Outcome: "accepted", ReasonCode: "acknowledged",
		CorrelationID: "relationship:" + rel.ID.String(), StateVersion: rel.StateVersion,
		OccurredAt: ack.AcknowledgedAt, Relationship: rel,
	})
	return ack, nil
}

func actionRelationshipID(action *ent.RevenueAction) uuid.UUID {
	rel, err := action.Edges.RelationshipOrErr()
	if err != nil {
		return uuid.Nil
	}
	return rel.ID
}

func (s *Service) ensureRelationshipActionCompleteness(ctx context.Context, u *ent.User, ws *ent.RevenueWorkspace, relationshipID uuid.UUID) error {
	beta, err := s.client.WorkspaceFeatureControl.Query().Where(
		workspacefeaturecontrol.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		workspacefeaturecontrol.CapabilityEQ(CapabilityBetaEntitlement),
		workspacefeaturecontrol.EnabledEQ(true),
	).Exist(ctx)
	if err != nil {
		return err
	}
	if !beta {
		return nil
	}
	if relationshipID == uuid.Nil {
		return ErrNotFound
	}
	model, err := s.MissionControl(ctx, u, relationshipID)
	if err != nil {
		return err
	}
	if !model.Completeness.ExternalActionSafe {
		return ErrSourceIncomplete
	}
	return nil
}
