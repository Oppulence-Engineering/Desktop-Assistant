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
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/actionoutcome"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitment"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitmentdependency"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitmentevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/conversationintelligenceartifact"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/policydecisionsnapshot"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipassertion"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipobservation"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipstatesnapshot"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueactionrevision"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueevidence"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/google/uuid"
)

// ConversationDeletionTargetOutcome reports verified work for one storage boundary.
type ConversationDeletionTargetOutcome struct {
	Target           string `json:"target"`
	Status           string `json:"status"`
	VerificationHash string `json:"verificationHash,omitempty"`
	ErrorCode        string `json:"errorCode,omitempty"`
	Attempts         int    `json:"attempts"`
}

// ConversationDeletionReceipt is an immutable, per-target deletion audit record.
type ConversationDeletionReceipt struct {
	ReceiptID   string                              `json:"receiptId"`
	RequestedAt string                              `json:"requestedAt"`
	ScopeRef    string                              `json:"scopeRef"`
	LegalHold   bool                                `json:"legalHold"`
	Status      string                              `json:"status"`
	Targets     []ConversationDeletionTargetOutcome `json:"targets"`
	CompletedAt string                              `json:"completedAt,omitempty"`
}

var conversationArtifactContentKinds = []string{
	"extraction_run", "claim_candidate", "review_batch", "review_decision",
	"contradiction_case", "recovery_evaluation", "mutual_action_plan",
	"mutual_action_plan_revision", "recommendation_evaluation",
}

func deletionVerificationHash(receiptID, target string, affected int) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s:%s:%d:absent", receiptID, target, affected)))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func deletionReceiptFor(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	receiptID string,
) (ConversationDeletionReceipt, bool, error) {
	row, err := client.ConversationIntelligenceArtifact.Query().Where(
		conversationintelligenceartifact.KindEQ("deletion_receipt"),
		conversationintelligenceartifact.StableIDEQ(receiptID),
		conversationintelligenceartifact.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
	).Order(ent.Desc(conversationintelligenceartifact.FieldVersion)).First(ctx)
	if ent.IsNotFound(err) {
		return ConversationDeletionReceipt{}, false, nil
	}
	if err != nil {
		return ConversationDeletionReceipt{}, false, err
	}
	var receipt ConversationDeletionReceipt
	if err := json.Unmarshal([]byte(row.PayloadJSON), &receipt); err != nil {
		return ConversationDeletionReceipt{}, false, err
	}
	return receipt, true, nil
}

func conversationDeletionReceiptsFor(
	ctx context.Context,
	client *ent.Client,
	rel *ent.Relationship,
) ([]ConversationDeletionReceipt, error) {
	rows, err := latestConversationArtifacts(ctx, client, rel.ID.String(), "deletion_receipt")
	if err != nil {
		return nil, err
	}
	receipts := make([]ConversationDeletionReceipt, 0, len(rows))
	for _, row := range rows {
		var receipt ConversationDeletionReceipt
		if err := json.Unmarshal([]byte(row.PayloadJSON), &receipt); err != nil {
			return nil, err
		}
		receipts = append(receipts, receipt)
	}
	sort.Slice(receipts, func(i, j int) bool { return receipts[i].RequestedAt > receipts[j].RequestedAt })
	return receipts, nil
}

func defaultStateValue(dimension string) string {
	switch dimension {
	case "lifecycle":
		return "prospect"
	case "engagement", "sentiment", "health":
		return "unknown"
	default:
		return ""
	}
}

// RequestConversationDeletion executes legal-hold-aware server deletion idempotently.
func (s *Service) RequestConversationDeletion(
	ctx context.Context,
	u *ent.User,
	relationshipID uuid.UUID,
	receiptID string,
) (ConversationDeletionReceipt, error) {
	receiptID = strings.TrimSpace(receiptID)
	if receiptID == "" || len(receiptID) > 160 {
		return ConversationDeletionReceipt{}, fmt.Errorf("%w: deletion requestId is required", ErrInvalidInput)
	}
	ws, err := s.CurrentWorkspace(ctx, u)
	if err != nil {
		return ConversationDeletionReceipt{}, err
	}
	if existing, ok, err := deletionReceiptFor(ctx, s.client, ws, receiptID); err != nil || ok {
		if ok && existing.ScopeRef != relationshipID.String() {
			return ConversationDeletionReceipt{}, fmt.Errorf("%w: deletion request id is already bound to another scope", ErrReviewRequired)
		}
		return existing, err
	}
	rel, err := s.GetRelationship(ctx, relationshipID)
	if err != nil {
		return ConversationDeletionReceipt{}, err
	}

	tx, err := s.client.Tx(ctx)
	if err != nil {
		return ConversationDeletionReceipt{}, err
	}
	defer func() { _ = tx.Rollback() }()
	txc := tx.Client()
	txws, err := txc.RevenueWorkspace.Get(ctx, ws.ID)
	if err != nil {
		return ConversationDeletionReceipt{}, err
	}
	txu, err := txc.User.Get(ctx, u.ID)
	if err != nil {
		return ConversationDeletionReceipt{}, err
	}
	txrel, err := txc.Relationship.Get(ctx, rel.ID)
	if err != nil {
		return ConversationDeletionReceipt{}, err
	}
	now := s.now().UTC()
	layers, err := s.conversationPolicyLayersFor(ctx, txc, txws, txrel)
	if err != nil {
		return ConversationDeletionReceipt{}, err
	}
	policy := resolveConversationPolicyLayers(layers, now)
	decision := evaluateGovernanceDecision(policy, "retention_deletion", "none", receiptID, now)
	if _, err := appendConversationArtifact(ctx, txc, txws, txu, txrel, conversationArtifactInput{
		Kind: "governance_decision", StableID: decision.DecisionID,
		Status:     map[bool]string{true: "allowed", false: "blocked"}[decision.Allowed],
		SubjectRef: relationshipID.String(), EffectiveAt: now, Payload: decision,
	}); err != nil {
		return ConversationDeletionReceipt{}, err
	}
	receipt := ConversationDeletionReceipt{
		ReceiptID: receiptID, RequestedAt: now.Format(time.RFC3339),
		ScopeRef: relationshipID.String(), LegalHold: policy.LegalHold,
		Status: "blocked",
	}
	if !decision.Allowed {
		receipt.Targets = []ConversationDeletionTargetOutcome{{
			Target: "api_evidence", Status: "blocked", ErrorCode: "legal_hold", Attempts: 1,
		}}
		if _, err := appendConversationArtifact(ctx, txc, txws, txu, txrel, conversationArtifactInput{
			Kind: "deletion_receipt", StableID: receiptID, Status: receipt.Status,
			SubjectRef: relationshipID.String(), EffectiveAt: now, Payload: receipt,
		}); err != nil {
			return ConversationDeletionReceipt{}, err
		}
		if err := tx.Commit(); err != nil {
			return ConversationDeletionReceipt{}, err
		}
		return receipt, nil
	}

	observations, err := txc.RelationshipObservation.Query().Where(
		relationshipobservation.HasRelationshipWith(relationship.IDEQ(relationshipID)),
		relationshipobservation.SourceIn("meeting", "desktop_note", "voice_note", "browser"),
	).All(ctx)
	if err != nil {
		return ConversationDeletionReceipt{}, err
	}
	observationIDs := make([]uuid.UUID, 0, len(observations))
	for _, observation := range observations {
		observationIDs = append(observationIDs, observation.ID)
	}
	deletedDimensions := map[string]bool{}
	if len(observationIDs) > 0 {
		assertions, queryErr := txc.RelationshipAssertion.Query().Where(
			relationshipassertion.HasObservationWith(relationshipobservation.IDIn(observationIDs...)),
		).All(ctx)
		if queryErr != nil {
			return ConversationDeletionReceipt{}, queryErr
		}
		assertionIDs := make([]uuid.UUID, 0, len(assertions))
		for _, assertion := range assertions {
			assertionIDs = append(assertionIDs, assertion.ID)
			deletedDimensions[assertion.Dimension] = true
		}
		if len(assertionIDs) > 0 {
			if _, err := txc.RelationshipAssertion.Delete().Where(relationshipassertion.IDIn(assertionIDs...)).Exec(ctx); err != nil {
				return ConversationDeletionReceipt{}, err
			}
		}
		if _, err := txc.RelationshipObservation.Update().Where(
			relationshipobservation.IDIn(observationIDs...),
		).ClearSummary().SetNormalizedFactsJSON("{}").ClearPayloadCiphertext().Save(ctx); err != nil {
			return ConversationDeletionReceipt{}, err
		}
	}

	evidenceCount, err := txc.RevenueEvidence.Query().Where(
		revenueevidence.HasRelationshipsWith(relationship.IDEQ(relationshipID)),
		revenueevidence.SourceEQ("meeting"),
	).Count(ctx)
	if err != nil {
		return ConversationDeletionReceipt{}, err
	}
	if _, err := txc.RevenueEvidence.Update().Where(
		revenueevidence.HasRelationshipsWith(relationship.IDEQ(relationshipID)),
		revenueevidence.SourceEQ("meeting"),
	).ClearExcerpt().ClearPayloadCiphertext().ClearSourceURI().ClearSourceMessageID().Save(ctx); err != nil {
		return ConversationDeletionReceipt{}, err
	}

	planArtifactCount, err := txc.ConversationIntelligenceArtifact.Query().Where(
		conversationintelligenceartifact.HasRelationshipWith(relationship.IDEQ(relationshipID)),
		conversationintelligenceartifact.KindIn("mutual_action_plan", "mutual_action_plan_revision"),
	).Count(ctx)
	if err != nil {
		return ConversationDeletionReceipt{}, err
	}
	artifactCount, err := txc.ConversationIntelligenceArtifact.Delete().Where(
		conversationintelligenceartifact.HasRelationshipWith(relationship.IDEQ(relationshipID)),
		conversationintelligenceartifact.KindIn(conversationArtifactContentKinds...),
	).Exec(ctx)
	if err != nil {
		return ConversationDeletionReceipt{}, err
	}

	actions, err := txc.RevenueAction.Query().Where(
		revenueaction.HasRelationshipWith(relationship.IDEQ(relationshipID)),
		revenueaction.Or(
			revenueaction.DetectorIn("conversation_action_pack", "commitment_due"),
			revenueaction.DedupeKeyHasPrefix("meeting_commitment:"),
			revenueaction.DedupeKeyHasPrefix("mutual-action-plan:"),
		),
	).All(ctx)
	if err != nil {
		return ConversationDeletionReceipt{}, err
	}
	actionIDs := make([]uuid.UUID, 0, len(actions))
	for _, action := range actions {
		actionIDs = append(actionIDs, action.ID)
	}
	if len(actionIDs) > 0 {
		if _, err := txc.ActionOutcome.Delete().Where(actionoutcome.HasActionWith(revenueaction.IDIn(actionIDs...))).Exec(ctx); err != nil {
			return ConversationDeletionReceipt{}, err
		}
		if _, err := txc.PolicyDecisionSnapshot.Delete().Where(policydecisionsnapshot.HasActionWith(revenueaction.IDIn(actionIDs...))).Exec(ctx); err != nil {
			return ConversationDeletionReceipt{}, err
		}
		if _, err := txc.RevenueActionRevision.Delete().Where(revenueactionrevision.HasActionWith(revenueaction.IDIn(actionIDs...))).Exec(ctx); err != nil {
			return ConversationDeletionReceipt{}, err
		}
		if _, err := txc.RevenueAction.Delete().Where(revenueaction.IDIn(actionIDs...)).Exec(ctx); err != nil {
			return ConversationDeletionReceipt{}, err
		}
	}

	commitments, err := txc.Commitment.Query().Where(
		commitment.HasRelationshipWith(relationship.IDEQ(relationshipID)),
	).All(ctx)
	if err != nil {
		return ConversationDeletionReceipt{}, err
	}
	commitmentIDs := make([]uuid.UUID, 0, len(commitments))
	for _, item := range commitments {
		commitmentIDs = append(commitmentIDs, item.ID)
	}
	if len(commitmentIDs) > 0 {
		if _, err := txc.CommitmentDependency.Delete().Where(
			commitmentdependency.HasRelationshipWith(relationship.IDEQ(relationshipID)),
		).Exec(ctx); err != nil {
			return ConversationDeletionReceipt{}, err
		}
		if _, err := txc.CommitmentEvent.Delete().Where(
			commitmentevent.HasRelationshipWith(relationship.IDEQ(relationshipID)),
		).Exec(ctx); err != nil {
			return ConversationDeletionReceipt{}, err
		}
		if _, err := txc.Commitment.Delete().Where(commitment.IDIn(commitmentIDs...)).Exec(ctx); err != nil {
			return ConversationDeletionReceipt{}, err
		}
	}

	if _, err := txc.RelationshipStateSnapshot.Delete().Where(
		relationshipstatesnapshot.HasRelationshipWith(relationship.IDEQ(relationshipID)),
	).Exec(ctx); err != nil {
		return ConversationDeletionReceipt{}, err
	}
	remaining, err := txc.RelationshipAssertion.Query().Where(
		relationshipassertion.HasRelationshipWith(relationship.IDEQ(relationshipID)),
	).All(ctx)
	if err != nil {
		return ConversationDeletionReceipt{}, err
	}
	sort.SliceStable(remaining, func(i, j int) bool {
		left, right := remaining[i], remaining[j]
		if assertionPriority(left.SourceType) != assertionPriority(right.SourceType) {
			return assertionPriority(left.SourceType) > assertionPriority(right.SourceType)
		}
		return left.ValidFrom.After(right.ValidFrom)
	})
	selected := map[string]*ent.RelationshipAssertion{}
	for _, assertion := range remaining {
		if selected[assertion.Dimension] == nil {
			selected[assertion.Dimension] = assertion
		}
	}
	update := txrel.Update().SetStateVersion(txrel.StateVersion + 1).SetLastChangedAt(now).
		SetStateReason("Conversation-derived content deleted under " + policy.PolicyVersion)
	for dimension := range deletedDimensions {
		value := defaultStateValue(dimension)
		if assertion := selected[dimension]; assertion != nil {
			value = assertion.Value
		}
		switch dimension {
		case "lifecycle":
			update.SetLifecycle(value)
		case "engagement":
			update.SetEngagement(value)
		case "sentiment":
			update.SetSentiment(value)
		case "health":
			update.SetHealth(value)
		case "summary":
			update.SetSummary(value)
		case "next_action":
			update.SetNextAction(value)
		case "risk":
			if value == "" {
				update.SetRisks([]string{})
			} else {
				update.SetRisks([]string{value})
			}
		case "milestone":
			if value == "" {
				update.SetMilestones([]string{})
			} else {
				update.SetMilestones([]string{value})
			}
		}
	}
	if _, err := update.Save(ctx); err != nil {
		return ConversationDeletionReceipt{}, err
	}

	apiAffected := len(observations) + evidenceCount + artifactCount + len(commitments)
	receipt.Status = "partial"
	receipt.Targets = []ConversationDeletionTargetOutcome{
		{Target: "local_recording", Status: "pending", Attempts: 0},
		{Target: "local_note", Status: "pending", Attempts: 0},
		{Target: "outbox", Status: map[bool]string{true: "deleted", false: "not_found"}[len(actions) > 0], VerificationHash: deletionVerificationHash(receiptID, "outbox", len(actions)), Attempts: 1},
		{Target: "api_evidence", Status: "deleted", VerificationHash: deletionVerificationHash(receiptID, "api_evidence", apiAffected), Attempts: 1},
		{Target: "embedding", Status: "not_found", VerificationHash: deletionVerificationHash(receiptID, "embedding", 0), Attempts: 1},
		{Target: "plan_share", Status: map[bool]string{true: "deleted", false: "not_found"}[planArtifactCount > 0], VerificationHash: deletionVerificationHash(receiptID, "plan_share", planArtifactCount), Attempts: 1},
		{Target: "provider", Status: "pending", Attempts: 0},
	}
	if _, err := appendConversationArtifact(ctx, txc, txws, txu, txrel, conversationArtifactInput{
		Kind: "deletion_receipt", StableID: receiptID, Status: receipt.Status,
		SubjectRef: relationshipID.String(), EffectiveAt: now, Payload: receipt,
	}); err != nil {
		return ConversationDeletionReceipt{}, err
	}
	if err := tx.Commit(); err != nil {
		return ConversationDeletionReceipt{}, err
	}
	return receipt, nil
}
