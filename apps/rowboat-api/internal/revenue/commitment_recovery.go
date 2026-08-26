package revenue

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitment"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitmentevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/predicate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipobservation"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipsourcestatus"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/google/uuid"
)

// CommitmentRecoveryEvidence is a fresh source fact considered by reconciliation.
type CommitmentRecoveryEvidence struct {
	CommitmentID string `json:"commitmentId"`
	EvidenceRef  string `json:"evidenceRef"`
	Source       string `json:"source"`
	Fresh        bool   `json:"fresh"`
	Kind         string `json:"kind"`
	OccurredAt   string `json:"occurredAt"`
}

// CommitmentRecoveryEvaluation records one immutable due-commitment classification.
type CommitmentRecoveryEvaluation struct {
	EvaluationID       string   `json:"evaluationId"`
	CommitmentID       string   `json:"commitmentId"`
	CommitmentVersion  int      `json:"commitmentVersion"`
	RecoveryWindow     string   `json:"recoveryWindow"`
	ReconcilerVersion  string   `json:"reconcilerVersion"`
	Classification     string   `json:"classification"`
	EvidenceRefs       []string `json:"evidenceRefs"`
	StaleSources       []string `json:"staleSources"`
	RequiresReview     bool     `json:"requiresReview"`
	ProposedActionType string   `json:"proposedActionType,omitempty"`
	Explanation        string   `json:"explanation"`
	EvaluatedAt        string   `json:"evaluatedAt"`
}

// RecommendationFactor exposes one inspectable ranking input.
type RecommendationFactor struct {
	Factor       string `json:"factor"`
	Value        any    `json:"value"`
	Contribution int    `json:"contribution"`
	Reason       string `json:"reason"`
}

// RecommendationEvaluation records the selected recovery action and ranking factors.
type RecommendationEvaluation struct {
	EvaluationID     string                 `json:"evaluationId"`
	RecommendationID string                 `json:"recommendationId"`
	RankerVersion    string                 `json:"rankerVersion"`
	BaselineScore    int                    `json:"baselineScore"`
	FinalScore       int                    `json:"finalScore"`
	Factors          []RecommendationFactor `json:"factors"`
	EvaluatedAt      string                 `json:"evaluatedAt"`
	SampleScope      string                 `json:"sampleScope"`
}

func recoveryID(row *ent.Commitment, window string) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s:%d:%s:commitment-recovery-v1", row.ID, row.CurrentEventVersion, window)))
	return "recovery:" + hex.EncodeToString(sum[:12])
}

func recoveryEvidenceFromObservations(
	ctx context.Context,
	client *ent.Client,
	rel *ent.Relationship,
	row *ent.Commitment,
	since time.Time,
) ([]CommitmentRecoveryEvidence, error) {
	observations, err := client.RelationshipObservation.Query().Where(
		relationshipobservation.HasRelationshipWith(relationship.IDEQ(rel.ID)),
		relationshipobservation.OccurredAtGTE(since),
	).All(ctx)
	if err != nil {
		return nil, err
	}
	result := []CommitmentRecoveryEvidence{}
	for _, observation := range observations {
		facts := map[string]any{}
		_ = json.Unmarshal([]byte(observation.NormalizedFactsJSON), &facts)
		var entries []CommitmentRecoveryEvidence
		if decodeFact(facts, "commitment_recovery_evidence", &entries) != nil {
			continue
		}
		for _, entry := range entries {
			if entry.CommitmentID != row.ID.String() {
				continue
			}
			entry.Source = observation.Source
			entry.Fresh = true
			if entry.EvidenceRef == "" {
				entry.EvidenceRef = "relationship-observation:" + observation.ID.String()
			}
			if entry.OccurredAt == "" {
				entry.OccurredAt = observation.OccurredAt.UTC().Format(time.RFC3339)
			}
			result = append(result, entry)
		}
	}
	return result, nil
}

func recoverySourceFreshness(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	now time.Time,
) (float64, []string, error) {
	statuses, err := client.RelationshipSourceStatus.Query().Where(
		relationshipsourcestatus.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
	).All(ctx)
	if err != nil {
		return 0, nil, err
	}
	if len(statuses) == 0 {
		return 0, []string{"no_connected_sources"}, nil
	}
	fresh, stale := 0, []string{}
	for _, status := range statuses {
		if status.Status == "live" && status.LastSuccessAt != nil && status.LastSuccessAt.After(now.Add(-48*time.Hour)) {
			fresh++
		} else {
			stale = append(stale, status.Source)
		}
	}
	return float64(fresh) / float64(len(statuses)), stale, nil
}

func classifyRecovery(
	row *ent.Commitment,
	evidence []CommitmentRecoveryEvidence,
	stale []string,
	now time.Time,
) (string, string, bool) {
	if len(stale) > 0 {
		return "unknown_stale_sources", "internal_task", true
	}
	for _, item := range evidence {
		switch item.Kind {
		case "explicit_fulfilled":
			return "fulfilled", "", false
		case "superseded":
			return "superseded", "renegotiation", false
		case "renegotiated":
			return "renegotiated", "renegotiation", true
		case "blocked":
			return "blocked", "escalation", true
		case "likely_fulfilled":
			return "likely_fulfilled", "", true
		}
	}
	if row.DueAt != nil && row.DueAt.Before(now) {
		return "forgotten", "reminder", true
	}
	return "unknown_stale_sources", "", true
}

func rankRecoveryRecommendation(
	recommendationID string,
	row *ent.Commitment,
	completeness float64,
	learningLift int,
	now time.Time,
) RecommendationEvaluation {
	factors := []RecommendationFactor{}
	if row.DueAt != nil && row.DueAt.Before(now) {
		factors = append(factors, RecommendationFactor{
			Factor: "commitment_due_state", Value: "overdue", Contribution: 12,
			Reason: "An accepted commitment is overdue.",
		})
	}
	completenessContribution := int((completeness - 0.5) * 10)
	factors = append(factors, RecommendationFactor{
		Factor: "source_completeness", Value: completeness, Contribution: completenessContribution,
		Reason: "Fresh source coverage changes confidence in the queue position.",
	})
	if learningLift > 20 {
		learningLift = 20
	}
	if learningLift < -20 {
		learningLift = -20
	}
	factors = append(factors, RecommendationFactor{
		Factor: "outcome_learning", Value: learningLift, Contribution: learningLift,
		Reason: "Bounded prior decisions and outcomes adjust ordering, never authority.",
	})
	final := 60
	for _, factor := range factors {
		final += factor.Contribution
	}
	if final < 0 {
		final = 0
	}
	if final > 100 {
		final = 100
	}
	sum := sha256.Sum256([]byte(recommendationID + ":contextual-v1"))
	return RecommendationEvaluation{
		EvaluationID: "rank:" + hex.EncodeToString(sum[:12]), RecommendationID: recommendationID,
		RankerVersion: "contextual-v1", BaselineScore: 60, FinalScore: final,
		Factors: factors, EvaluatedAt: now.UTC().Format(time.RFC3339), SampleScope: "workspace",
	}
}

func (s *Service) createRecoveryAction(
	ctx context.Context,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	rel *ent.Relationship,
	row *ent.Commitment,
	evaluation CommitmentRecoveryEvaluation,
	completeness float64,
) error {
	if evaluation.ProposedActionType == "" {
		return nil
	}
	dedupe := "commitment-recovery:" + evaluation.EvaluationID
	if exists, err := s.client.RevenueAction.Query().Where(
		revenueaction.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)), revenueaction.DedupeKeyEQ(dedupe),
	).Exist(ctx); err != nil || exists {
		return err
	}
	channel := "task"
	recipient := ""
	if evaluation.ProposedActionType == "reminder" && strings.TrimSpace(rel.PrimaryEmail) != "" {
		channel, recipient = "email", strings.ToLower(strings.TrimSpace(rel.PrimaryEmail))
	}
	message := evaluation.Explanation + " Review the evidence before taking action on: " + row.Text
	actionInput := ActionInput{
		ActionType: "commitment_rescue", Channel: channel, RecipientEmail: recipient,
		ProposedSubject: "Commitment follow-through", ProposedMessage: message, ExecutionMode: ExecModeDraft,
	}
	lift, err := s.outcomeLearningLift(ctx, s.client, ws, "commitment_rescue", channel)
	if err != nil {
		return err
	}
	ranking := rankRecoveryRecommendation(evaluation.EvaluationID, row, completeness, lift, s.now())
	partsJSON, _ := json.Marshal(ranking.Factors)
	evidences, err := row.QueryEvidences().All(ctx)
	if err != nil || len(evidences) == 0 {
		if err != nil {
			return err
		}
		return fmt.Errorf("%w: recovery action requires commitment evidence", ErrInvalidInput)
	}
	create := s.client.RevenueAction.Create().SetWorkspace(ws).SetRelationship(rel).SetUser(u).
		SetActionType("commitment_rescue").SetChannel(channel).SetDetector("commitment_due").
		SetDedupeKey(dedupe).SetRevision(1).SetRevisionHash(actionInput.content(u.ID).Hash()).
		SetReason(evaluation.Explanation).SetProposedSubject(actionInput.ProposedSubject).
		SetProposedMessage(message).SetExecutionMode(ExecModeDraft).SetExecutionOwner(OwnerRowboat).
		SetAssignedUserID(u.ID).SetPriorityScore(ranking.FinalScore).
		SetPriorityComponentsJSON(string(partsJSON)).AddEvidences(evidences...)
	if recipient != "" {
		create.SetRecipientEmail(recipient)
	}
	action, err := create.Save(ctx)
	if err != nil {
		return err
	}
	if err := s.snapshotRevision(ctx, s.client, action, u); err != nil {
		return err
	}
	_, err = appendConversationArtifact(ctx, s.client, ws, u, rel, conversationArtifactInput{
		Kind: "recommendation_evaluation", StableID: ranking.EvaluationID,
		Status: "ranked", SubjectRef: action.ID.String(), EffectiveAt: s.now(),
		EvidenceRefs: evaluation.EvidenceRefs, Payload: ranking,
	})
	return err
}

// ReconcileDueCommitments is bounded and idempotent, and is safe for the API-owned
// scheduler while desktop clients are closed. relationshipID=nil scans the workspace.
func (s *Service) ReconcileDueCommitments(
	ctx context.Context,
	u *ent.User,
	relationshipID *uuid.UUID,
) ([]CommitmentRecoveryEvaluation, error) {
	ws, err := s.CurrentWorkspace(ctx, u)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	predicates := []predicate.Commitment{
		commitment.StatusEQ("open"), commitment.DueAtLTE(now.Add(72 * time.Hour)),
		commitment.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
	}
	if relationshipID != nil {
		predicates = append(predicates, commitment.HasRelationshipWith(relationship.IDEQ(*relationshipID)))
	}
	rows, err := s.client.Commitment.Query().Where(predicates...).WithRelationship().Limit(200).All(ctx)
	if err != nil {
		return nil, err
	}
	completeness, staleSources, err := recoverySourceFreshness(ctx, s.client, ws, now)
	if err != nil {
		return nil, err
	}
	result := make([]CommitmentRecoveryEvaluation, 0, len(rows))
	for _, row := range rows {
		rel, edgeErr := row.Edges.RelationshipOrErr()
		if edgeErr != nil {
			return nil, edgeErr
		}
		since := row.CreatedAt
		if event, eventErr := s.client.CommitmentEvent.Query().Where(
			commitmentevent.HasCommitmentWith(commitment.IDEQ(row.ID)),
		).Order(ent.Desc(commitmentevent.FieldVersion)).First(ctx); eventErr == nil {
			since = event.OccurredAt
		}
		evidence, err := recoveryEvidenceFromObservations(ctx, s.client, rel, row, since)
		if err != nil {
			return nil, err
		}
		classification, actionType, review := classifyRecovery(row, evidence, staleSources, now)
		refs := []string{}
		for _, item := range evidence {
			refs = append(refs, item.EvidenceRef)
		}
		window := now.Format("2006-01-02")
		evaluation := CommitmentRecoveryEvaluation{
			EvaluationID: recoveryID(row, window), CommitmentID: row.ID.String(),
			CommitmentVersion: row.CurrentEventVersion, RecoveryWindow: window,
			ReconcilerVersion: "commitment-recovery-v1", Classification: classification,
			EvidenceRefs: refs, StaleSources: append([]string(nil), staleSources...),
			RequiresReview: review, ProposedActionType: actionType, EvaluatedAt: now.Format(time.RFC3339),
		}
		switch {
		case len(staleSources) > 0:
			evaluation.Explanation = "Evidence is incomplete; stale sources: " + strings.Join(staleSources, ", ") + "."
		case classification == "fulfilled":
			evaluation.Explanation = "Fresh explicit source evidence proves fulfillment."
		default:
			evaluation.Explanation = "Fresh evidence suggests " + classification + "; human review is required."
		}
		if _, err := appendConversationArtifact(ctx, s.client, ws, u, rel, conversationArtifactInput{
			Kind: "recovery_evaluation", StableID: evaluation.EvaluationID, Status: classification,
			SubjectRef: row.ID.String(), EffectiveAt: now, EvidenceRefs: refs, Payload: evaluation,
		}); err != nil {
			return nil, err
		}
		if classification == "fulfilled" && !review {
			_, err := s.ingestTrustedRelationshipObservations(ctx, u, []RelationshipObservationInput{{
				RelationshipID: rel.ID, Source: "user", ExternalID: evaluation.EvaluationID + ":fulfilled",
				EventType: "commitment_status_changed", OccurredAt: now, ReceivedAt: now,
				Facts: map[string]any{"commitment_updates": []map[string]any{{
					"commitmentId": row.ID.String(), "status": "fulfilled",
				}}},
			}})
			if err != nil {
				return nil, err
			}
		} else if err := s.createRecoveryAction(ctx, ws, u, rel, row, evaluation, completeness); err != nil {
			return nil, err
		}
		result = append(result, evaluation)
	}
	return result, nil
}

func recoveryEvaluationsFor(
	ctx context.Context,
	client *ent.Client,
	rel *ent.Relationship,
) ([]CommitmentRecoveryEvaluation, error) {
	rows, err := latestConversationArtifacts(ctx, client, rel.ID.String(), "recovery_evaluation")
	if err != nil {
		return nil, err
	}
	result := make([]CommitmentRecoveryEvaluation, 0, len(rows))
	for _, row := range rows {
		var evaluation CommitmentRecoveryEvaluation
		if err := json.Unmarshal([]byte(row.PayloadJSON), &evaluation); err != nil {
			return nil, err
		}
		result = append(result, evaluation)
	}
	return result, nil
}

func recommendationEvaluationsFor(
	ctx context.Context,
	client *ent.Client,
	rel *ent.Relationship,
) ([]RecommendationEvaluation, error) {
	rows, err := latestConversationArtifacts(ctx, client, rel.ID.String(), "recommendation_evaluation")
	if err != nil {
		return nil, err
	}
	result := make([]RecommendationEvaluation, 0, len(rows))
	for _, row := range rows {
		var evaluation RecommendationEvaluation
		if err := json.Unmarshal([]byte(row.PayloadJSON), &evaluation); err != nil {
			return nil, err
		}
		result = append(result, evaluation)
	}
	return result, nil
}
