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
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/conversationintelligenceartifact"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipassertion"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/google/uuid"
)

const maxConversationArtifactBytes = 256 * 1024

type conversationArtifactInput struct {
	Kind         string
	StableID     string
	Version      int
	Status       string
	SubjectRef   string
	EffectiveAt  time.Time
	EvidenceRefs []string
	Payload      any
}

// appendConversationArtifact is the idempotent append seam for versioned RFC 037
// records. A repeated logical version must have the same hash; divergent replays fail.
func appendConversationArtifact(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	rel *ent.Relationship,
	input conversationArtifactInput,
) (*ent.ConversationIntelligenceArtifact, error) {
	if input.Version == 0 {
		input.Version = 1
	}
	if input.EffectiveAt.IsZero() {
		input.EffectiveAt = time.Now().UTC()
	}
	payload, err := json.Marshal(input.Payload)
	if err != nil {
		return nil, fmt.Errorf("%w: conversation artifact payload: %v", ErrInvalidInput, err)
	}
	if len(payload) > maxConversationArtifactBytes {
		return nil, fmt.Errorf("%w: conversation artifact payload exceeds %d bytes", ErrInvalidInput, maxConversationArtifactBytes)
	}
	sum := sha256.Sum256(payload)
	hash := hex.EncodeToString(sum[:])
	existing, err := client.ConversationIntelligenceArtifact.Query().Where(
		conversationintelligenceartifact.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		conversationintelligenceartifact.KindEQ(input.Kind),
		conversationintelligenceartifact.StableIDEQ(input.StableID),
		conversationintelligenceartifact.VersionEQ(input.Version),
	).Only(ctx)
	if err == nil {
		if existing.PayloadHash != hash {
			return nil, fmt.Errorf("%w: divergent conversation artifact replay", ErrReviewRequired)
		}
		return existing, nil
	}
	if !ent.IsNotFound(err) {
		return nil, err
	}
	create := client.ConversationIntelligenceArtifact.Create().
		SetWorkspace(ws).SetUser(u).
		SetKind(input.Kind).SetStableID(input.StableID).SetVersion(input.Version).
		SetEffectiveAt(input.EffectiveAt.UTC()).SetEvidenceRefs(input.EvidenceRefs).
		SetPayloadJSON(string(payload)).SetPayloadHash(hash)
	if rel != nil {
		create.SetRelationship(rel)
	}
	if input.Status != "" {
		create.SetStatus(input.Status)
	}
	if input.SubjectRef != "" {
		create.SetSubjectRef(input.SubjectRef)
	}
	return create.Save(ctx)
}

func persistConversationObservationArtifacts(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	rel *ent.Relationship,
	observation *ent.RelationshipObservation,
	input RelationshipObservationInput,
) error {
	evidence := []string{"relationship-observation:" + observation.ID.String()}
	if extraction, ok := input.Facts["conversation_extraction"]; ok {
		if _, err := appendConversationArtifact(ctx, client, ws, u, rel, conversationArtifactInput{
			Kind: "extraction_run", StableID: input.ExternalID + ":" + input.SourceVersion,
			Status: "completed", SubjectRef: observation.ID.String(), EffectiveAt: input.ReceivedAt,
			EvidenceRefs: evidence, Payload: extraction,
		}); err != nil {
			return err
		}
	}
	var candidates []conversationClaimCandidate
	if err := decodeFact(input.Facts, "conversation_claim_candidates", &candidates); err != nil {
		return fmt.Errorf("%w: conversation claim candidates: %v", ErrInvalidInput, err)
	}
	for _, candidate := range candidates {
		quotes := make([]string, 0, len(candidate.Evidence))
		for _, span := range candidate.Evidence {
			hash := sha256.Sum256([]byte(span.ExactQuote))
			quotes = append(quotes, "quote-sha256:"+hex.EncodeToString(hash[:]))
		}
		if _, err := appendConversationArtifact(ctx, client, ws, u, rel, conversationArtifactInput{
			Kind: "claim_candidate", StableID: observation.ID.String() + ":" + candidate.CandidateID,
			Status: "pending_review", SubjectRef: candidate.StateDimension,
			EffectiveAt: input.ReceivedAt, EvidenceRefs: append(evidence, quotes...), Payload: candidate,
		}); err != nil {
			return err
		}
	}
	var review conversationReviewMetadata
	if err := decodeFact(input.Facts, "conversation_review", &review); err != nil {
		return fmt.Errorf("%w: conversation review metadata: %v", ErrInvalidInput, err)
	}
	if review.BatchID != "" {
		if _, err := appendConversationArtifact(ctx, client, ws, u, rel, conversationArtifactInput{
			Kind: "review_batch", StableID: review.BatchID, Status: "pending_review",
			SubjectRef: observation.ID.String(), EffectiveAt: input.ReceivedAt,
			EvidenceRefs: evidence, Payload: map[string]any{
				"batchId": review.BatchID, "baselineSnapshotId": review.BaselineSnapshotID,
				"baselineVersion": review.BaselineVersion, "candidateCount": len(candidates),
			},
		}); err != nil {
			return err
		}
	}
	var decision conversationReviewDecisionRecord
	if err := decodeFact(input.Facts, "review_decision", &decision); err != nil {
		return fmt.Errorf("%w: conversation review decision: %v", ErrInvalidInput, err)
	}
	if decision.ItemID != "" {
		if _, err := appendConversationArtifact(ctx, client, ws, u, rel, conversationArtifactInput{
			Kind: "review_decision", StableID: decision.ItemID, Status: decision.Kind,
			SubjectRef: decision.ItemID, EffectiveAt: input.ReceivedAt,
			EvidenceRefs: evidence, Payload: decision,
		}); err != nil {
			return err
		}
	}
	if rawResolution, ok := input.Facts["contradiction_resolution"]; ok {
		payload, err := json.Marshal(rawResolution)
		if err != nil {
			return fmt.Errorf("%w: contradiction resolution: %v", ErrInvalidInput, err)
		}
		var resolution ConversationContradictionCase
		if err := json.Unmarshal(payload, &resolution); err != nil || resolution.CaseID == "" {
			return fmt.Errorf("%w: invalid contradiction resolution", ErrInvalidInput)
		}
		refs := append([]string{}, evidence...)
		for _, side := range resolution.Sides {
			refs = append(refs, side.EvidenceRefs...)
		}
		if _, err := appendConversationArtifact(ctx, client, ws, u, rel, conversationArtifactInput{
			Kind: "contradiction_case", StableID: resolution.CaseID, Version: 2,
			Status: resolution.Status, SubjectRef: resolution.SubjectRef,
			EffectiveAt: input.ReceivedAt, EvidenceRefs: refs, Payload: resolution,
		}); err != nil {
			return err
		}
	}
	var governance ConversationGovernanceDecision
	if err := decodeFact(input.Facts, "conversation_governance_decision", &governance); err != nil {
		return fmt.Errorf("%w: conversation governance decision: %v", ErrInvalidInput, err)
	}
	if governance.DecisionID != "" {
		if _, err := appendConversationArtifact(ctx, client, ws, u, rel, conversationArtifactInput{
			Kind: "governance_decision", StableID: governance.DecisionID,
			Status:     map[bool]string{true: "allowed", false: "blocked"}[governance.Allowed],
			SubjectRef: observation.ID.String(), EffectiveAt: input.ReceivedAt,
			EvidenceRefs: evidence, Payload: governance,
		}); err != nil {
			return err
		}
	}
	return nil
}

func latestConversationArtifacts(
	ctx context.Context,
	client *ent.Client,
	relationshipID string,
	kind string,
) ([]*ent.ConversationIntelligenceArtifact, error) {
	relID, err := uuid.Parse(relationshipID)
	if err != nil {
		return nil, err
	}
	rows, err := client.ConversationIntelligenceArtifact.Query().Where(
		conversationintelligenceartifact.HasRelationshipWith(relationship.IDEQ(relID)),
		conversationintelligenceartifact.KindEQ(kind),
	).Order(ent.Desc(conversationintelligenceartifact.FieldVersion)).All(ctx)
	if err != nil {
		return nil, err
	}
	latest := map[string]*ent.ConversationIntelligenceArtifact{}
	for _, row := range rows {
		if latest[row.StableID] == nil {
			latest[row.StableID] = row
		}
	}
	result := make([]*ent.ConversationIntelligenceArtifact, 0, len(latest))
	for _, row := range latest {
		result = append(result, row)
	}
	return result, nil
}

func comparableAssertionValue(dimension, value string) (map[string]any, bool) {
	switch dimension {
	case "lifecycle", "engagement", "sentiment", "health":
		return map[string]any{"kind": "enum", "value": strings.ToLower(strings.TrimSpace(value))}, true
	default:
		// Summaries, risks, milestones, and next-action prose are not safe exact-string
		// comparisons. Typed source adapters can add additional comparable kinds later.
		return nil, false
	}
}

func assertionEvidenceSide(row *ent.RelationshipAssertion) ConversationContradictionEvidenceSide {
	source := row.SourceType
	evidenceRefs := append([]string(nil), row.SupportingObservationIds...)
	if observation, err := row.Edges.ObservationOrErr(); err == nil {
		source = observation.Source
		evidenceRefs = append(evidenceRefs, "relationship-observation:"+observation.ID.String())
	}
	if len(evidenceRefs) == 0 {
		evidenceRefs = []string{"relationship-assertion:" + row.ID.String()}
	}
	value, _ := comparableAssertionValue(row.Dimension, row.Value)
	return ConversationContradictionEvidenceSide{
		AssertionID: row.ID.String(), SourceType: row.SourceType, Source: source, Value: value,
		ValidFrom:  row.ValidFrom.UTC().Format(time.RFC3339),
		ObservedAt: row.CreatedAt.UTC().Format(time.RFC3339), EvidenceRefs: evidenceRefs,
		IdentityConfidence: row.Confidence,
	}
}

// persistContradictionArtifacts creates stable typed cases after projection. It ignores
// free-form text and explicit supersession so a legitimate state change is not mislabeled.
func persistContradictionArtifacts(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	rel *ent.Relationship,
	_ time.Time,
) error {
	assertions, err := client.RelationshipAssertion.Query().
		Where(relationshipassertion.HasRelationshipWith(relationship.IDEQ(rel.ID))).
		WithObservation().All(ctx)
	if err != nil {
		return err
	}
	byDimension := map[string][]*ent.RelationshipAssertion{}
	for _, assertion := range assertions {
		if _, comparable := comparableAssertionValue(assertion.Dimension, assertion.Value); comparable {
			byDimension[assertion.Dimension] = append(byDimension[assertion.Dimension], assertion)
		}
	}
	for dimension, rows := range byDimension {
		sort.Slice(rows, func(i, j int) bool {
			if !rows[i].ValidFrom.Equal(rows[j].ValidFrom) {
				return rows[i].ValidFrom.After(rows[j].ValidFrom)
			}
			return rows[i].ID.String() > rows[j].ID.String()
		})
		for i := 0; i < len(rows); i++ {
			for j := i + 1; j < len(rows); j++ {
				left, right := rows[i], rows[j]
				leftValue, _ := comparableAssertionValue(dimension, left.Value)
				rightValue, _ := comparableAssertionValue(dimension, right.Value)
				if leftValue["value"] == rightValue["value"] ||
					left.SupersedesAssertionID == right.ID.String() ||
					right.SupersedesAssertionID == left.ID.String() {
					continue
				}
				ids := []string{left.ID.String(), right.ID.String()}
				sort.Strings(ids)
				sum := sha256.Sum256([]byte(rel.ID.String() + ":" + dimension + ":" + strings.Join(ids, ":")))
				caseID := "contradiction:" + hex.EncodeToString(sum[:12])
				status := "open"
				reason := "equally authoritative typed evidence overlaps with different values"
				openedAt := left.ValidFrom.UTC()
				resolvedAt := ""
				if assertionPriority(left.SourceType) != assertionPriority(right.SourceType) {
					status = "auto_resolved_by_authority"
					reason = "deterministic assertion authority selected the current value"
					resolvedAt = openedAt.Format(time.RFC3339)
				}
				sides := []ConversationContradictionEvidenceSide{
					assertionEvidenceSide(left), assertionEvidenceSide(right),
				}
				refs := append(append([]string{}, sides[0].EvidenceRefs...), sides[1].EvidenceRefs...)
				artifact := ConversationContradictionCase{
					CaseID: caseID, RelationshipID: rel.ID.String(), SubjectRef: rel.ID.String(),
					Dimension: dimension, Status: status, Reason: reason, Sides: sides,
					OpenedAt: openedAt.Format(time.RFC3339), ResolvedAt: resolvedAt,
				}
				if _, err := appendConversationArtifact(ctx, client, ws, u, rel, conversationArtifactInput{
					Kind: "contradiction_case", StableID: caseID, Status: status,
					SubjectRef: rel.ID.String(), EffectiveAt: openedAt, EvidenceRefs: refs, Payload: artifact,
				}); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func contradictionCasesFor(
	ctx context.Context,
	client *ent.Client,
	rel *ent.Relationship,
) ([]ConversationContradictionCase, error) {
	rows, err := latestConversationArtifacts(ctx, client, rel.ID.String(), "contradiction_case")
	if err != nil {
		return nil, err
	}
	result := make([]ConversationContradictionCase, 0, len(rows))
	for _, row := range rows {
		var contradiction ConversationContradictionCase
		if err := json.Unmarshal([]byte(row.PayloadJSON), &contradiction); err != nil {
			return nil, err
		}
		result = append(result, contradiction)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].OpenedAt > result[j].OpenedAt })
	return result, nil
}
