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
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipobservation"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipstatesnapshot"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueevidence"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/google/uuid"
)

// ConversationClaim is a material, quote-backed candidate extracted from a
// recorder-neutral transcript envelope. The canonical projector consumes the
// accompanying assertions; this structure exists to explain and correct them.
type ConversationClaim struct {
	ID                string   `json:"id"`
	Kind              string   `json:"kind"`
	Value             string   `json:"value"`
	ExactQuote        string   `json:"exactQuote"`
	StartMS           int      `json:"startMs"`
	EndMS             int      `json:"endMs"`
	SpeakerID         string   `json:"speakerId"`
	SpeakerLabel      string   `json:"speakerLabel"`
	SpeakerConfidence float64  `json:"speakerConfidence"`
	Confidence        float64  `json:"confidence"`
	CaptureCaveats    []string `json:"captureCaveats"`
	Material          bool     `json:"material"`
	StateDimension    string   `json:"stateDimension,omitempty"`
	ContradictionOf   string   `json:"contradictionOf,omitempty"`
	ObservationID     string   `json:"observationId,omitempty"`
}

// ConversationActionProposal describes one independently approvable follow-through action.
type ConversationActionProposal struct {
	ID               string   `json:"id"`
	ActionType       string   `json:"actionType"`
	Channel          string   `json:"channel"`
	Reason           string   `json:"reason"`
	ProposedSubject  string   `json:"proposedSubject"`
	ProposedMessage  string   `json:"proposedMessage"`
	DueAt            string   `json:"dueAt"`
	EvidenceClaimIDs []string `json:"evidenceClaimIds"`
	Confidence       float64  `json:"confidence"`
}

// ConversationGovernanceReceipt records capture, routing, retention, and deletion policy.
type ConversationGovernanceReceipt struct {
	ReceiptID             string `json:"receiptId"`
	CapturedAt            string `json:"capturedAt"`
	CapturePolicy         string `json:"capturePolicy"`
	Routing               string `json:"routing"`
	Region                string `json:"region"`
	Retention             string `json:"retention"`
	ParticipantDisclosure string `json:"participantDisclosure"`
	LegalHold             bool   `json:"legalHold"`
	DeletionOutcome       string `json:"deletionOutcome"`
	EvidenceClip          string `json:"evidenceClip"`
}

// ConversationReviewItem identifies a focused human verification task for conversation evidence.
type ConversationReviewItem struct {
	ID                 string   `json:"id"`
	Kind               string   `json:"kind"`
	Label              string   `json:"label"`
	CurrentValue       string   `json:"currentValue"`
	Confidence         float64  `json:"confidence"`
	ObservationID      string   `json:"observationId"`
	ClaimID            string   `json:"claimId,omitempty"`
	StateDimension     string   `json:"stateDimension,omitempty"`
	ExactQuote         string   `json:"exactQuote,omitempty"`
	BatchID            string   `json:"batchId,omitempty"`
	Status             string   `json:"status,omitempty"`
	Before             any      `json:"before,omitempty"`
	ProposedAfter      any      `json:"proposedAfter,omitempty"`
	Caveats            []string `json:"caveats,omitempty"`
	DependentActionIDs []string `json:"dependentActionIds,omitempty"`
	BaselineVersion    int      `json:"baselineVersion,omitempty"`
}

type conversationReviewCorrection struct {
	CorrectedValue string
}

type conversationCandidateEvidence struct {
	ExactQuote string `json:"exactQuote"`
}

type conversationClaimCandidate struct {
	CandidateID     string                          `json:"candidateId"`
	Kind            string                          `json:"kind"`
	NormalizedValue any                             `json:"normalizedValue"`
	DisplayValue    string                          `json:"displayValue"`
	Evidence        []conversationCandidateEvidence `json:"evidence"`
	StateDimension  string                          `json:"stateDimension"`
	Confidence      float64                         `json:"confidence"`
	Caveats         []string                        `json:"caveats"`
	DueAt           string                          `json:"dueAt"`
}

type conversationReviewMetadata struct {
	BatchID            string `json:"batch_id"`
	BaselineSnapshotID string `json:"baseline_snapshot_id"`
	BaselineVersion    int    `json:"baseline_version"`
}

type conversationReviewDecisionRecord struct {
	ItemID         string `json:"item_id"`
	Kind           string `json:"kind"`
	CorrectedValue string `json:"corrected_value"`
	DeferUntil     string `json:"defer_until"`
}

// prepareConversationReview pins semantic candidates to the state visible before
// ingestion and strips every unreviewed state/action effect at the server boundary.
func prepareConversationReview(
	ctx context.Context,
	client *ent.Client,
	rel *ent.Relationship,
	input *RelationshipObservationInput,
) error {
	if input.Facts == nil {
		input.Facts = map[string]any{}
	}
	if _, ok := input.Facts["conversation_claim_candidates"]; !ok {
		return nil
	}
	var snapshotID string
	snapshot, err := client.RelationshipStateSnapshot.Query().
		Where(relationshipstatesnapshot.HasRelationshipWith(relationship.IDEQ(rel.ID))).
		Order(ent.Desc(relationshipstatesnapshot.FieldVersion)).
		First(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return err
	}
	if snapshot != nil {
		snapshotID = snapshot.ID.String()
	}
	sum := sha256.Sum256([]byte(input.ExternalID + ":" + input.SourceVersion + ":conversation-review-v1"))
	input.Facts["conversation_review"] = conversationReviewMetadata{
		BatchID:            "review:" + hex.EncodeToString(sum[:12]),
		BaselineSnapshotID: snapshotID,
		BaselineVersion:    rel.StateVersion,
	}
	if actionPack, ok := input.Facts["action_pack"]; ok {
		input.Facts["legacy_shadow_action_pack"] = actionPack
	}
	input.Facts["action_pack"] = []any{}
	input.Assertions = nil
	return nil
}

// RelationshipDeltaItem describes one canonical relationship state change.
type RelationshipDeltaItem struct {
	Dimension    string   `json:"dimension"`
	Before       any      `json:"before,omitempty"`
	After        any      `json:"after,omitempty"`
	Reason       string   `json:"reason,omitempty"`
	AssertionIDs []string `json:"assertionIds"`
}

// RelationshipContradiction captures conflicting assertions within a state dimension.
type RelationshipContradiction struct {
	Dimension               string `json:"dimension"`
	CurrentValue            string `json:"currentValue"`
	ContradictedValue       string `json:"contradictedValue"`
	CurrentAssertionID      string `json:"currentAssertionId"`
	ContradictedAssertionID string `json:"contradictedAssertionId"`
}

type ConversationContradictionEvidenceSide struct {
	AssertionID        string         `json:"assertionId"`
	SourceType         string         `json:"sourceType"`
	Source             string         `json:"source"`
	Value              map[string]any `json:"value"`
	ValidFrom          string         `json:"validFrom"`
	ObservedAt         string         `json:"observedAt"`
	EvidenceRefs       []string       `json:"evidenceRefs"`
	IdentityConfidence float64        `json:"identityConfidence"`
}

type ConversationContradictionCase struct {
	CaseID                string                                  `json:"caseId"`
	RelationshipID        string                                  `json:"relationshipId"`
	SubjectRef            string                                  `json:"subjectRef"`
	Dimension             string                                  `json:"dimension"`
	Status                string                                  `json:"status"`
	Reason                string                                  `json:"reason"`
	Sides                 []ConversationContradictionEvidenceSide `json:"sides"`
	OpenedAt              string                                  `json:"openedAt"`
	ResolvedAt            string                                  `json:"resolvedAt,omitempty"`
	ResolutionAssertionID string                                  `json:"resolutionAssertionId,omitempty"`
}

// RelationshipDelta summarizes state changes and uncertainty between projections.
type RelationshipDelta struct {
	FromVersion          int                         `json:"fromVersion"`
	ToVersion            int                         `json:"toVersion"`
	Changes              []RelationshipDeltaItem     `json:"changes"`
	UncertainClaimIDs    []string                    `json:"uncertainClaimIds"`
	Contradictions       []RelationshipContradiction `json:"contradictions"`
	RecommendationReason string                      `json:"recommendationReason,omitempty"`
}

// RelationshipLiveCue is an evidence-backed prompt for an active or upcoming meeting.
type RelationshipLiveCue struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Title      string `json:"title"`
	Detail     string `json:"detail"`
	Severity   string `json:"severity"`
	EvidenceID string `json:"evidenceId,omitempty"`
}

// RelationshipIntelligence is the derived trust and follow-through surface for a relationship.
type RelationshipIntelligence struct {
	Claims                    []ConversationClaim              `json:"claims"`
	ReviewItems               []ConversationReviewItem         `json:"reviewItems"`
	GovernanceReceipts        []ConversationGovernanceReceipt  `json:"governanceReceipts"`
	Delta                     RelationshipDelta                `json:"delta"`
	LiveCues                  []RelationshipLiveCue            `json:"liveCues"`
	ContradictionCases        []ConversationContradictionCase  `json:"contradictionCases"`
	RecoveryEvaluations       []CommitmentRecoveryEvaluation   `json:"recoveryEvaluations"`
	RecommendationEvaluations []RecommendationEvaluation       `json:"recommendationEvaluations"`
	MutualActionPlans         []MutualActionPlan               `json:"mutualActionPlans"`
	EffectivePolicy           ResolvedConversationPolicy       `json:"effectivePolicy"`
	GovernanceDecisions       []ConversationGovernanceDecision `json:"governanceDecisions"`
	DeletionReceipts          []ConversationDeletionReceipt    `json:"deletionReceipts"`
}

type commitmentUpdate struct {
	CommitmentID string `json:"commitmentId"`
	Status       string `json:"status"`
	DueAt        string `json:"dueAt"`
	Text         string `json:"text"`
}

func decodeFact[T any](facts map[string]any, key string, target *T) error {
	value, ok := facts[key]
	if !ok || value == nil {
		return nil
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, target)
}

func transcriptTextInPayload(payload json.RawMessage) (map[string]bool, string) {
	var body struct {
		Envelope struct {
			Segments []struct {
				Text string `json:"text"`
			} `json:"segments"`
		} `json:"envelope"`
	}
	quotes := map[string]bool{}
	if json.Unmarshal(payload, &body) != nil {
		return quotes, ""
	}
	segments := make([]string, 0, len(body.Envelope.Segments))
	for _, segment := range body.Envelope.Segments {
		text := strings.Join(strings.Fields(segment.Text), " ")
		quotes[text] = true
		segments = append(segments, text)
	}
	return quotes, strings.Join(segments, " ")
}

func payloadSupportsQuote(exactSegments map[string]bool, transcript, quote string) bool {
	normalized := strings.Join(strings.Fields(quote), " ")
	return normalized != "" && (exactSegments[normalized] || strings.Contains(transcript, normalized))
}

func evidenceSource(source string) string {
	switch source {
	case "gmail", "calendar", "meeting", "slack", "crm":
		return source
	default:
		return "meeting"
	}
}

var conversationActionTypes = map[string]bool{
	"meeting_recap": true, "crm_update": true, "follow_up_task": true,
	"calendar_hold": true, "commitment_rescue": true,
}

var conversationChannels = map[string]bool{
	"email": true, "slack": true, "crm": true, "task": true, "calendar": true,
}

// materializeConversationEvidence turns compiled facts into the existing governed
// evidence/action graph. It runs in the observation transaction, so a partial action
// pack can never escape and every independently approvable action keeps evidence edges.
func (s *Service) materializeConversationEvidence(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	rel *ent.Relationship,
	observation *ent.RelationshipObservation,
	input RelationshipObservationInput,
) error {
	if strings.TrimSpace(input.EventType) == "conversation_evidence_compiled" {
		var receipt ConversationGovernanceReceipt
		if err := decodeFact(input.Facts, "governance_receipt", &receipt); err != nil {
			return fmt.Errorf("%w: governance receipt: %v", ErrInvalidInput, err)
		}
		required := []string{
			receipt.ReceiptID, receipt.CapturedAt, receipt.CapturePolicy, receipt.Routing,
			receipt.Region, receipt.Retention, receipt.ParticipantDisclosure,
			receipt.DeletionOutcome, receipt.EvidenceClip,
		}
		for _, value := range required {
			if strings.TrimSpace(value) == "" {
				return fmt.Errorf("%w: compiled conversations require a complete governance receipt", ErrInvalidInput)
			}
		}
		if receipt.EvidenceClip != "not_retained" && receipt.EvidenceClip != "encrypted" {
			return fmt.Errorf("%w: retained conversation evidence clips must be encrypted", ErrInvalidInput)
		}
	}
	var claims []ConversationClaim
	if err := decodeFact(input.Facts, "conversation_claims", &claims); err != nil {
		return fmt.Errorf("%w: conversation claims: %v", ErrInvalidInput, err)
	}
	var proposals []ConversationActionProposal
	if err := decodeFact(input.Facts, "action_pack", &proposals); err != nil {
		return fmt.Errorf("%w: action pack: %v", ErrInvalidInput, err)
	}
	// Defense in depth for older clients: the presence of semantic candidates means
	// this observation is review-only, even if a legacy action pack was also supplied.
	if _, reviewOnly := input.Facts["conversation_claim_candidates"]; reviewOnly {
		proposals = nil
	}
	exactSegments, transcript := transcriptTextInPayload(input.Payload)
	var candidates []conversationClaimCandidate
	if err := decodeFact(input.Facts, "conversation_claim_candidates", &candidates); err != nil {
		return fmt.Errorf("%w: conversation claim candidates: %v", ErrInvalidInput, err)
	}
	for _, candidate := range candidates {
		if strings.TrimSpace(candidate.CandidateID) == "" || len(candidate.Evidence) == 0 {
			return fmt.Errorf("%w: every conversation candidate requires an id and transcript evidence", ErrInvalidInput)
		}
		for _, evidence := range candidate.Evidence {
			if !payloadSupportsQuote(exactSegments, transcript, evidence.ExactQuote) {
				return fmt.Errorf("%w: every conversation candidate must cite an exact transcript span", ErrInvalidInput)
			}
		}
	}
	if len(claims) == 0 && len(proposals) == 0 {
		return s.applyCommitmentUpdates(ctx, client, ws, u, rel, observation, input)
	}

	evidenceByClaim := make(map[string]*ent.RevenueEvidence, len(claims))
	for index := range claims {
		claim := &claims[index]
		claim.ID = strings.TrimSpace(claim.ID)
		claim.ExactQuote = strings.TrimSpace(claim.ExactQuote)
		if claim.ID == "" || !payloadSupportsQuote(exactSegments, transcript, claim.ExactQuote) {
			return fmt.Errorf("%w: every conversation claim must cite an exact transcript segment", ErrInvalidInput)
		}
		hash := sha256.Sum256([]byte(claim.ExactQuote))
		recordID := fmt.Sprintf("%s:claim:%s", input.ExternalID, claim.ID)
		evidence, err := client.RevenueEvidence.Create().
			SetWorkspace(ws).
			SetUser(u).
			SetSource(evidenceSource(input.Source)).
			SetSourceAccountID(input.SourceAccountID).
			SetSourceRecordID(recordID).
			SetContentHash("sha256:" + hex.EncodeToString(hash[:])).
			SetExcerpt(truncateRunes(claim.ExactQuote, excerptMaxRunes)).
			SetOccurredAt(input.OccurredAt.UTC()).
			SetObservedAt(input.ReceivedAt.UTC()).
			SetExternalEvidenceRefs([]string{
				"relationship-observation:" + observation.ID.String(),
				fmt.Sprintf("timestamp:%d-%d", claim.StartMS, claim.EndMS),
				"speaker:" + claim.SpeakerID,
			}).
			AddRelationships(rel).
			Save(ctx)
		if err != nil {
			return err
		}
		evidenceByClaim[claim.ID] = evidence
	}

	for _, proposal := range proposals {
		if !conversationActionTypes[proposal.ActionType] || !conversationChannels[proposal.Channel] {
			return fmt.Errorf("%w: unsupported conversation action", ErrInvalidInput)
		}
		evidences := make([]*ent.RevenueEvidence, 0, len(proposal.EvidenceClaimIDs))
		for _, claimID := range proposal.EvidenceClaimIDs {
			if evidence := evidenceByClaim[claimID]; evidence != nil {
				evidences = append(evidences, evidence)
			}
		}
		if len(evidences) == 0 {
			return fmt.Errorf("%w: conversation actions require supporting claim ids", ErrInvalidInput)
		}
		if err := s.createConversationAction(ctx, client, ws, u, rel, input, proposal, evidences); err != nil {
			return err
		}
	}
	return s.applyCommitmentUpdates(ctx, client, ws, u, rel, observation, input)
}

func (s *Service) outcomeLearningLift(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	actionType, channel string,
) (int, error) {
	actions, err := client.RevenueAction.Query().
		Where(
			revenueaction.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			revenueaction.ActionTypeEQ(actionType),
			revenueaction.ChannelEQ(channel),
		).
		WithOutcomes().
		Limit(200).
		All(ctx)
	if err != nil {
		return 0, err
	}
	positive, negative := 0, 0
	for _, action := range actions {
		outcomes, _ := action.Edges.OutcomesOrErr()
		for _, outcome := range outcomes {
			switch outcome.Kind {
			case "delivered", "replied", "meeting_booked", "won", "deal_advanced", "onboarding_progressed", "renewed":
				positive++
			case "bounced", "lost", "dismissed", "bad_recommendation", "escalated", "churned", "corrected":
				negative++
			}
		}
	}
	lift := (positive - negative) * 3
	if lift > 15 {
		lift = 15
	}
	if lift < -15 {
		lift = -15
	}
	return lift, nil
}

func (s *Service) createConversationAction(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	rel *ent.Relationship,
	input RelationshipObservationInput,
	proposal ConversationActionProposal,
	evidences []*ent.RevenueEvidence,
) error {
	lift, err := s.outcomeLearningLift(ctx, client, ws, proposal.ActionType, proposal.Channel)
	if err != nil {
		return err
	}
	confidence := int(proposal.Confidence * 20)
	priority := 55 + confidence + lift
	if priority < 0 {
		priority = 0
	}
	if priority > 100 {
		priority = 100
	}
	parts := map[string]int{
		"evidence_quality":   confidence,
		"relationship_value": 20,
		"recency_signal":     15,
		"outcome_learning":   lift,
	}
	partsJSON, err := json.Marshal(parts)
	if err != nil {
		return err
	}
	recipient := ""
	if proposal.Channel == "email" {
		recipient = strings.ToLower(strings.TrimSpace(input.PrimaryEmail))
		if recipient == "" {
			recipient = strings.ToLower(strings.TrimSpace(rel.PrimaryEmail))
		}
	}
	actionInput := ActionInput{
		ActionType:      proposal.ActionType,
		Channel:         proposal.Channel,
		RecipientEmail:  recipient,
		ProposedSubject: proposal.ProposedSubject,
		ProposedMessage: proposal.ProposedMessage,
		ExecutionMode:   ExecModeDraft,
	}
	dedupeKey := fmt.Sprintf("conversation:%s:%s:%s", input.ExternalID, input.SourceVersion, proposal.ID)
	create := client.RevenueAction.Create().
		SetWorkspace(ws).
		SetRelationship(rel).
		SetUser(u).
		SetActionType(proposal.ActionType).
		SetChannel(proposal.Channel).
		SetDetector("conversation_action_pack").
		SetDedupeKey(dedupeKey).
		SetRevision(1).
		SetRevisionHash(actionInput.content(u.ID).Hash()).
		SetReason(proposal.Reason).
		SetProposedSubject(proposal.ProposedSubject).
		SetProposedMessage(proposal.ProposedMessage).
		SetExecutionMode(ExecModeDraft).
		SetExecutionOwner(OwnerRowboat).
		SetAssignedUserID(u.ID).
		SetPriorityScore(priority).
		SetPriorityComponentsJSON(string(partsJSON)).
		AddEvidences(evidences...)
	if recipient != "" {
		create.SetRecipientEmail(recipient)
	}
	if proposal.DueAt != "" {
		if dueAt, parseErr := time.Parse(time.RFC3339, proposal.DueAt); parseErr == nil {
			create.SetDueAt(dueAt.UTC())
		} else {
			return fmt.Errorf("%w: invalid action dueAt", ErrInvalidInput)
		}
	}
	action, err := create.Save(ctx)
	if err != nil {
		return err
	}
	return s.snapshotRevision(ctx, client, action, u)
}

func (s *Service) applyCommitmentUpdates(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	rel *ent.Relationship,
	observation *ent.RelationshipObservation,
	input RelationshipObservationInput,
) error {
	var updates []commitmentUpdate
	if err := decodeFact(input.Facts, "commitment_updates", &updates); err != nil {
		return fmt.Errorf("%w: commitment updates: %v", ErrInvalidInput, err)
	}
	for _, update := range updates {
		if update.CommitmentID == "" {
			return fmt.Errorf("%w: commitment update requires commitmentId", ErrInvalidInput)
		}
		query := client.Commitment.Query().
			Where(
				commitment.HasRelationshipWith(relationship.IDEQ(rel.ID)),
				commitment.HasEvidencesWith(revenueevidence.SourceRecordIDEQ("commitment:"+update.CommitmentID)),
			)
		row, err := query.Only(ctx)
		if ent.IsNotFound(err) {
			if rowID, parseErr := uuid.Parse(update.CommitmentID); parseErr == nil {
				row, err = client.Commitment.Query().Where(
					commitment.IDEQ(rowID), commitment.HasRelationshipWith(relationship.IDEQ(rel.ID)),
				).Only(ctx)
			}
		}
		if ent.IsNotFound(err) {
			return fmt.Errorf("%w: commitment", ErrNotFound)
		}
		if err != nil {
			return err
		}
		builder := row.Update()
		eventKind := ""
		payload := map[string]any{}
		switch update.Status {
		case "open", "fulfilled", "cancelled", "superseded":
			if update.Status != row.Status {
				if update.Status == "open" {
					return fmt.Errorf("%w: terminal commitments cannot be reopened without a renegotiation", ErrInvalidInput)
				}
				eventKind = update.Status
				builder.SetStatus(update.Status)
				payload["status"] = update.Status
				if update.Status == "fulfilled" {
					completedAt := input.OccurredAt.UTC()
					builder.SetCompletedAt(completedAt)
					payload["completedAt"] = completedAt.Format(time.RFC3339)
				}
			}
		case "":
		default:
			return fmt.Errorf("%w: invalid commitment status", ErrInvalidInput)
		}
		if strings.TrimSpace(update.Text) != "" {
			text := strings.TrimSpace(update.Text)
			if text != row.Text {
				if eventKind == "" {
					eventKind = "renegotiated"
				}
				builder.SetText(text)
				payload["action"] = text
			}
		}
		if update.DueAt != "" {
			dueAt, parseErr := time.Parse(time.RFC3339, update.DueAt)
			if parseErr != nil {
				return fmt.Errorf("%w: invalid commitment dueAt", ErrInvalidInput)
			}
			dueAt = dueAt.UTC()
			if row.DueAt == nil || !row.DueAt.Equal(dueAt) {
				if eventKind == "" {
					eventKind = "due_date_changed"
				}
				builder.SetDueAt(dueAt)
				payload["dueAt"] = dueAt.Format(time.RFC3339)
			}
		}
		if eventKind == "" {
			continue
		}
		nextVersion := row.CurrentEventVersion + 1
		builder.SetCurrentEventVersion(nextVersion)
		if _, err := builder.Save(ctx); err != nil {
			return err
		}
		payloadJSON, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		sourceRef := "relationship-observation:" + observation.ID.String()
		if _, err := client.CommitmentEvent.Create().
			SetWorkspace(ws).SetRelationship(rel).SetUser(u).SetCommitment(row).
			SetSourceEventID(fmt.Sprintf("%s:commitment-event:%s:%s", input.ExternalID, row.ID, eventKind)).
			SetVersion(nextVersion).SetKind(eventKind).SetActorType("source_fact").
			SetActorRef(input.Source).SetOccurredAt(input.OccurredAt.UTC()).
			SetSourceObservationID(observation.ID.String()).SetEvidenceRefs([]string{sourceRef}).
			SetPayloadJSON(string(payloadJSON)).Save(ctx); err != nil {
			return err
		}
	}
	return nil
}

func reviewItemID(observationID, claimID, kind string) string {
	sum := sha256.Sum256([]byte(observationID + ":" + claimID + ":" + kind))
	return "review:" + hex.EncodeToString(sum[:8])
}

func stateMap(snapshot *ent.RelationshipStateSnapshot) map[string]any {
	state := map[string]any{}
	if snapshot != nil {
		_ = json.Unmarshal([]byte(snapshot.StateJSON), &state)
	}
	return state
}

// RelationshipIntelligenceFor builds the correction queue, exact delta, governance
// receipts, contradictions, and live cue cards from immutable current evidence.
func (s *Service) RelationshipIntelligenceFor(
	ctx context.Context,
	rel *ent.Relationship,
) (RelationshipIntelligence, error) {
	result := RelationshipIntelligence{
		Claims:             []ConversationClaim{},
		ReviewItems:        []ConversationReviewItem{},
		GovernanceReceipts: []ConversationGovernanceReceipt{},
		Delta: RelationshipDelta{
			Changes:           []RelationshipDeltaItem{},
			UncertainClaimIDs: []string{},
			Contradictions:    []RelationshipContradiction{},
		},
		LiveCues:                  []RelationshipLiveCue{},
		ContradictionCases:        []ConversationContradictionCase{},
		RecoveryEvaluations:       []CommitmentRecoveryEvaluation{},
		RecommendationEvaluations: []RecommendationEvaluation{},
		MutualActionPlans:         []MutualActionPlan{},
		GovernanceDecisions:       []ConversationGovernanceDecision{},
		DeletionReceipts:          []ConversationDeletionReceipt{},
	}
	observations, err := s.client.RelationshipObservation.Query().
		Where(relationshipobservation.HasRelationshipWith(relationship.IDEQ(rel.ID))).
		Order(ent.Desc(relationshipobservation.FieldOccurredAt)).
		Limit(200).
		All(ctx)
	if err != nil {
		return result, err
	}
	resolved := map[string]conversationReviewCorrection{}
	decisions := map[string]conversationReviewDecisionRecord{}
	for _, observation := range observations {
		facts := map[string]any{}
		_ = json.Unmarshal([]byte(observation.NormalizedFactsJSON), &facts)
		if correction, ok := facts["review_correction"].(map[string]any); ok {
			if id, ok := correction["review_item_id"].(string); ok {
				if _, alreadyResolved := resolved[id]; !alreadyResolved {
					correctedValue, _ := correction["corrected_value"].(string)
					resolved[id] = conversationReviewCorrection{
						CorrectedValue: correctedValue,
					}
				}
			}
		}
		if rawDecision, ok := facts["review_decision"]; ok {
			var decision conversationReviewDecisionRecord
			if decodeFact(map[string]any{"decision": rawDecision}, "decision", &decision) == nil && decision.ItemID != "" {
				if _, alreadyDecided := decisions[decision.ItemID]; !alreadyDecided {
					decisions[decision.ItemID] = decision
				}
			}
		}
	}
	for _, observation := range observations {
		facts := map[string]any{}
		_ = json.Unmarshal([]byte(observation.NormalizedFactsJSON), &facts)
		var claims []ConversationClaim
		_ = decodeFact(facts, "conversation_claims", &claims)
		for index := range claims {
			claim := claims[index]
			claim.ObservationID = observation.ID.String()
			claimReviewID := reviewItemID(observation.ID.String(), claim.ID, "claim")
			speakerReviewID := reviewItemID(observation.ID.String(), claim.ID, "speaker")
			entityReviewID := reviewItemID(observation.ID.String(), claim.ID, "entity")
			wordReviewID := reviewItemID(observation.ID.String(), claim.ID, "word")
			if correction, ok := resolved[claimReviewID]; ok {
				claim.Value = correction.CorrectedValue
				claim.Confidence = 1
			}
			if correction, ok := resolved[speakerReviewID]; ok {
				claim.SpeakerLabel = correction.CorrectedValue
				claim.SpeakerConfidence = 1
			}
			if correction, ok := resolved[entityReviewID]; ok {
				claim.Value = correction.CorrectedValue
				claim.Confidence = 1
			}
			if correction, ok := resolved[wordReviewID]; ok {
				// Preserve ExactQuote as immutable source evidence; the corrected reading
				// is the derived value that projection and recommendations consume.
				claim.Value = correction.CorrectedValue
				claim.Confidence = 1
			}
			result.Claims = append(result.Claims, claim)
			if claim.Confidence < 0.75 {
				if _, isResolved := resolved[claimReviewID]; !isResolved {
					result.ReviewItems = append(result.ReviewItems, ConversationReviewItem{
						ID: claimReviewID, Kind: "claim", Label: "Low-confidence material claim",
						CurrentValue: claim.Value, Confidence: claim.Confidence,
						ObservationID: observation.ID.String(), ClaimID: claim.ID,
						StateDimension: claim.StateDimension, ExactQuote: claim.ExactQuote,
					})
				}
			}
			if claim.SpeakerConfidence < 0.75 {
				if _, isResolved := resolved[speakerReviewID]; !isResolved {
					result.ReviewItems = append(result.ReviewItems, ConversationReviewItem{
						ID: speakerReviewID, Kind: "speaker", Label: "Resolve the speaker for a material statement",
						CurrentValue: claim.SpeakerLabel, Confidence: claim.SpeakerConfidence,
						ObservationID: observation.ID.String(), ClaimID: claim.ID,
						StateDimension: claim.StateDimension, ExactQuote: claim.ExactQuote,
					})
				}
			}
			if claim.Kind == "stakeholder" && claim.Confidence < 0.85 {
				if _, isResolved := resolved[entityReviewID]; !isResolved {
					result.ReviewItems = append(result.ReviewItems, ConversationReviewItem{
						ID: entityReviewID, Kind: "entity", Label: "Confirm the stakeholder identity or role",
						CurrentValue: claim.Value, Confidence: claim.Confidence,
						ObservationID: observation.ID.String(), ClaimID: claim.ID,
						ExactQuote: claim.ExactQuote,
					})
				}
			}
			if claim.Confidence < 0.65 {
				if _, isResolved := resolved[wordReviewID]; !isResolved {
					result.ReviewItems = append(result.ReviewItems, ConversationReviewItem{
						ID: wordReviewID, Kind: "word", Label: "Confirm the low-confidence wording",
						CurrentValue: claim.ExactQuote, Confidence: claim.Confidence,
						ObservationID: observation.ID.String(), ClaimID: claim.ID,
						StateDimension: claim.StateDimension, ExactQuote: claim.ExactQuote,
					})
				}
			}
		}
		var candidates []conversationClaimCandidate
		_ = decodeFact(facts, "conversation_claim_candidates", &candidates)
		var review conversationReviewMetadata
		_ = decodeFact(facts, "conversation_review", &review)
		baselineState := map[string]any{}
		if review.BaselineSnapshotID != "" {
			if snapshotID, parseErr := uuid.Parse(review.BaselineSnapshotID); parseErr == nil {
				if baseline, getErr := s.client.RelationshipStateSnapshot.Get(ctx, snapshotID); getErr == nil {
					_ = json.Unmarshal([]byte(baseline.StateJSON), &baselineState)
				}
			}
		}
		for _, candidate := range candidates {
			itemID := reviewItemID(observation.ID.String(), candidate.CandidateID, "candidate")
			decision, decided := decisions[itemID]
			if decided && decision.Kind != "defer" {
				continue
			}
			exactQuote := ""
			if len(candidate.Evidence) > 0 {
				exactQuote = candidate.Evidence[0].ExactQuote
			}
			status := "pending_review"
			if decided && decision.Kind == "defer" {
				status = "deferred"
			}
			result.ReviewItems = append(result.ReviewItems, ConversationReviewItem{
				ID: itemID, Kind: "claim", Label: "Review proposed " + candidate.Kind,
				CurrentValue: candidate.DisplayValue, Confidence: candidate.Confidence,
				ObservationID: observation.ID.String(), ClaimID: candidate.CandidateID,
				StateDimension: candidate.StateDimension, ExactQuote: exactQuote,
				BatchID: review.BatchID, Status: status,
				Before: baselineState[candidate.StateDimension], ProposedAfter: candidate.NormalizedValue,
				Caveats: candidate.Caveats, DependentActionIDs: []string{},
				BaselineVersion: review.BaselineVersion,
			})
		}
		var receipt ConversationGovernanceReceipt
		_ = decodeFact(facts, "governance_receipt", &receipt)
		if receipt.ReceiptID != "" {
			result.GovernanceReceipts = append(result.GovernanceReceipts, receipt)
		}
	}

	snapshots, err := s.client.RelationshipStateSnapshot.Query().
		Where(relationshipstatesnapshot.HasRelationshipWith(relationship.IDEQ(rel.ID))).
		Order(ent.Desc(relationshipstatesnapshot.FieldVersion)).
		Limit(2).
		All(ctx)
	if err != nil {
		return result, err
	}
	var current, previous *ent.RelationshipStateSnapshot
	if len(snapshots) > 0 {
		current = snapshots[0]
		result.Delta.ToVersion = current.Version
	}
	if len(snapshots) > 1 {
		previous = snapshots[1]
		result.Delta.FromVersion = previous.Version
	}
	before, after := stateMap(previous), stateMap(current)
	if current != nil {
		for _, dimension := range current.ChangedDimensions {
			key := strings.TrimSuffix(dimension, "s")
			if dimension == "risks" || dimension == "milestones" {
				key = dimension
			}
			result.Delta.Changes = append(result.Delta.Changes, RelationshipDeltaItem{
				Dimension: dimension, Before: before[key], After: after[key],
				Reason: rel.StateReason, AssertionIDs: append([]string(nil), current.AssertionIds...),
			})
		}
	}
	for _, claim := range result.Claims {
		if claim.Confidence < 0.75 || claim.SpeakerConfidence < 0.75 {
			result.Delta.UncertainClaimIDs = append(result.Delta.UncertainClaimIDs, claim.ID)
		}
	}
	result.Delta.RecommendationReason = rel.StateReason

	commitments, err := s.client.Commitment.Query().
		Where(commitment.HasRelationshipWith(relationship.IDEQ(rel.ID))).
		All(ctx)
	if err != nil {
		return result, err
	}
	result.ContradictionCases, err = contradictionCasesFor(ctx, s.client, rel)
	if err != nil {
		return result, err
	}
	for _, contradiction := range result.ContradictionCases {
		if len(contradiction.Sides) < 2 {
			continue
		}
		current, prior := contradiction.Sides[0], contradiction.Sides[1]
		result.Delta.Contradictions = append(result.Delta.Contradictions, RelationshipContradiction{
			Dimension:               contradiction.Dimension,
			CurrentValue:            fmt.Sprint(current.Value["value"]),
			ContradictedValue:       fmt.Sprint(prior.Value["value"]),
			CurrentAssertionID:      current.AssertionID,
			ContradictedAssertionID: prior.AssertionID,
		})
	}
	result.RecoveryEvaluations, err = recoveryEvaluationsFor(ctx, s.client, rel)
	if err != nil {
		return result, err
	}
	result.RecommendationEvaluations, err = recommendationEvaluationsFor(ctx, s.client, rel)
	if err != nil {
		return result, err
	}
	result.MutualActionPlans, err = mutualActionPlansFor(ctx, s.client, rel)
	if err != nil {
		return result, err
	}
	owner, err := rel.QueryUser().Only(ctx)
	if err != nil {
		return result, err
	}
	result.EffectivePolicy, err = s.ResolveConversationPolicy(ctx, owner, rel)
	if err != nil {
		return result, err
	}
	result.GovernanceDecisions, err = governanceDecisionsFor(ctx, s.client, rel)
	if err != nil {
		return result, err
	}
	result.DeletionReceipts, err = conversationDeletionReceiptsFor(ctx, s.client, rel)
	if err != nil {
		return result, err
	}
	for _, row := range commitments {
		if row.Status == "open" && row.DueAt != nil && row.DueAt.Before(s.now()) {
			result.LiveCues = append(result.LiveCues, RelationshipLiveCue{
				ID: "commitment:" + row.ID.String(), Kind: "overdue_commitment",
				Title: "Overdue promise", Detail: row.Text, Severity: "critical",
			})
		}
	}
	for _, claim := range result.Claims {
		if claim.Kind == "objection" || claim.Kind == "risk" {
			result.LiveCues = append(result.LiveCues, RelationshipLiveCue{
				ID: "claim:" + claim.ID, Kind: "unresolved_objection", Title: "Unresolved objection",
				Detail: claim.Value, Severity: "attention", EvidenceID: claim.ObservationID,
			})
			break
		}
	}
	if rel.Lifecycle == "renewal" {
		result.LiveCues = append(result.LiveCues, RelationshipLiveCue{
			ID: "renewal:" + rel.ID.String(), Kind: "renewal_context", Title: "Renewal context",
			Detail: rel.Summary, Severity: "attention",
		})
	}
	if strings.TrimSpace(rel.NextAction) == "" {
		result.LiveCues = append(result.LiveCues, RelationshipLiveCue{
			ID: "missing-next:" + rel.ID.String(), Kind: "missing_next_step",
			Title: "No next step", Detail: "Agree on an owner and a dated next step before the meeting ends.", Severity: "attention",
		})
	}
	for _, contradiction := range result.ContradictionCases {
		if contradiction.Status != "open" || len(contradiction.Sides) < 2 {
			continue
		}
		result.LiveCues = append(result.LiveCues, RelationshipLiveCue{
			ID: contradiction.CaseID, Kind: "contradiction", Title: "Relationship evidence conflicts",
			Detail:   fmt.Sprintf("Which %s value should be current?", contradiction.Dimension),
			Severity: "attention", EvidenceID: contradiction.CaseID,
		})
	}
	return result, nil
}

// ConversationReviewCorrectionInput contains a focused human correction to reviewed evidence.
type ConversationReviewCorrectionInput struct {
	ReviewItemID   string
	Kind           string
	CorrectedValue string
	Reason         string
	StateDimension string
}

// CorrectConversationReview appends a correction observation. State-affecting
// corrections also emit a user_correction assertion, which deterministically outranks
// source facts and all model inference on every later projection.
func (s *Service) CorrectConversationReview(
	ctx context.Context,
	u *ent.User,
	relationshipID uuid.UUID,
	input ConversationReviewCorrectionInput,
) (*ent.Relationship, RelationshipIntelligence, error) {
	if strings.TrimSpace(input.ReviewItemID) == "" || strings.TrimSpace(input.CorrectedValue) == "" {
		return nil, RelationshipIntelligence{}, fmt.Errorf("%w: reviewItemId and correctedValue are required", ErrInvalidInput)
	}
	rel, err := s.GetRelationship(ctx, relationshipID)
	if err != nil {
		return nil, RelationshipIntelligence{}, err
	}
	current, err := s.RelationshipIntelligenceFor(ctx, rel)
	if err != nil {
		return nil, RelationshipIntelligence{}, err
	}
	found := false
	var matchedItem ConversationReviewItem
	for _, item := range current.ReviewItems {
		if item.ID == input.ReviewItemID {
			found = true
			matchedItem = item
			break
		}
	}
	if !found {
		return nil, RelationshipIntelligence{}, fmt.Errorf("%w: review item", ErrNotFound)
	}
	// The server owns the review item's kind and dimension. A client cannot turn a
	// speaker-attribution correction into an arbitrary canonical-state mutation.
	input.Kind = matchedItem.Kind
	input.StateDimension = ""
	if matchedItem.Kind == "claim" || matchedItem.Kind == "word" {
		input.StateDimension = matchedItem.StateDimension
	}
	reason := strings.TrimSpace(input.Reason)
	if reason == "" {
		reason = "User corrected focused conversation evidence."
	}
	correctedAt := s.now()
	assertions := []RelationshipAssertionInput{}
	if input.StateDimension != "" {
		assertions = append(assertions, RelationshipAssertionInput{
			Dimension: input.StateDimension, Value: strings.TrimSpace(input.CorrectedValue),
			SourceType: "user_correction", Confidence: 1,
			Reason: reason, ValidFrom: correctedAt,
		})
	}
	results, err := s.IngestRelationshipObservations(ctx, u, []RelationshipObservationInput{{
		RelationshipID: relationshipID,
		Source:         "user", ExternalID: "review-correction:" + uuid.NewString(), SourceVersion: "1",
		EventType: "conversation_evidence_corrected", OccurredAt: correctedAt, ReceivedAt: correctedAt,
		Summary: "User corrected reviewed conversation evidence.",
		Facts: map[string]any{"review_correction": map[string]any{
			"review_item_id": input.ReviewItemID, "kind": input.Kind,
			"corrected_value": strings.TrimSpace(input.CorrectedValue), "reason": reason,
			"claim_id": matchedItem.ClaimID, "observation_id": matchedItem.ObservationID,
		}},
		Assertions: assertions,
	}})
	if err != nil {
		return nil, RelationshipIntelligence{}, err
	}
	// A correction is also an outcome for every recommendation supported by the
	// corrected claim. This closes claim → action → outcome without letting learning
	// mutate canonical relationship state.
	if matchedItem.ClaimID != "" {
		ws, workspaceErr := s.CurrentWorkspace(ctx, u)
		if workspaceErr != nil {
			return nil, RelationshipIntelligence{}, workspaceErr
		}
		evidences, evidenceErr := s.client.RevenueEvidence.Query().
			Where(
				revenueevidence.HasRelationshipsWith(relationship.IDEQ(relationshipID)),
				revenueevidence.SourceRecordIDHasSuffix(":claim:"+matchedItem.ClaimID),
			).
			WithActions().
			All(ctx)
		if evidenceErr != nil {
			return nil, RelationshipIntelligence{}, evidenceErr
		}
		metadata, _ := json.Marshal(map[string]any{
			"reviewItemId": input.ReviewItemID, "kind": input.Kind,
			"correctedValue": input.CorrectedValue,
		})
		for _, evidence := range evidences {
			actions, _ := evidence.Edges.ActionsOrErr()
			for _, action := range actions {
				_, outcomeErr := s.client.ActionOutcome.Create().
					SetWorkspace(ws).SetAction(action).SetUser(u).
					SetKind("corrected").SetSource("user").
					SetSourceEventID(input.ReviewItemID).
					SetOccurredAt(s.now()).SetMetadataJSON(string(metadata)).Save(ctx)
				if outcomeErr != nil && !ent.IsConstraintError(outcomeErr) {
					return nil, RelationshipIntelligence{}, outcomeErr
				}
			}
		}
	}
	updated := results[0].Relationship
	updated, err = s.GetRelationship(ctx, updated.ID)
	if err != nil {
		return nil, RelationshipIntelligence{}, err
	}
	intelligence, err := s.RelationshipIntelligenceFor(ctx, updated)
	return updated, intelligence, err
}

// ConversationReviewDecisionInput is one immutable approve/correct/reject/defer decision.
type ConversationReviewDecisionInput struct {
	ReviewItemID   string
	Kind           string
	CorrectedValue string
	Reason         string
	DeferUntil     time.Time
}

type ContradictionResolutionInput struct {
	CaseID              string
	SelectedAssertionID string
	Reason              string
}

// ResolveContradiction records a provenance-bearing user correction referencing every
// evidence side. It never edits the original assertions or case version.
func (s *Service) ResolveContradiction(
	ctx context.Context,
	u *ent.User,
	relationshipID uuid.UUID,
	input ContradictionResolutionInput,
) (*ent.Relationship, RelationshipIntelligence, error) {
	rel, err := s.GetRelationship(ctx, relationshipID)
	if err != nil {
		return nil, RelationshipIntelligence{}, err
	}
	cases, err := contradictionCasesFor(ctx, s.client, rel)
	if err != nil {
		return nil, RelationshipIntelligence{}, err
	}
	var selectedCase ConversationContradictionCase
	var selectedSide ConversationContradictionEvidenceSide
	found := false
	for _, candidate := range cases {
		if candidate.CaseID != strings.TrimSpace(input.CaseID) || candidate.Status != "open" {
			continue
		}
		for _, side := range candidate.Sides {
			if side.AssertionID == strings.TrimSpace(input.SelectedAssertionID) {
				selectedCase, selectedSide, found = candidate, side, true
				break
			}
		}
	}
	if !found {
		return nil, RelationshipIntelligence{}, fmt.Errorf("%w: open contradiction side", ErrNotFound)
	}
	value := fmt.Sprint(selectedSide.Value["value"])
	if value == "" {
		return nil, RelationshipIntelligence{}, fmt.Errorf("%w: selected contradiction value", ErrInvalidInput)
	}
	resolvedAt := s.now().UTC()
	reason := strings.TrimSpace(input.Reason)
	if reason == "" {
		reason = "User selected the current value from a focused contradiction case."
	}
	resolutionAssertionID := uuid.NewString()
	selectedCase.Status = "user_resolved"
	selectedCase.Reason = reason
	selectedCase.ResolvedAt = resolvedAt.Format(time.RFC3339)
	selectedCase.ResolutionAssertionID = resolutionAssertionID
	results, err := s.IngestRelationshipObservations(ctx, u, []RelationshipObservationInput{{
		RelationshipID: relationshipID, Source: "user",
		ExternalID:    "contradiction-resolution:" + selectedCase.CaseID,
		SourceVersion: "1", EventType: "relationship_contradiction_resolved",
		OccurredAt: resolvedAt, ReceivedAt: resolvedAt,
		Summary: "User resolved a typed relationship contradiction.",
		Facts:   map[string]any{"contradiction_resolution": selectedCase},
		Assertions: []RelationshipAssertionInput{{
			ID:        uuid.MustParse(resolutionAssertionID),
			Dimension: selectedCase.Dimension, Value: value, SourceType: "user_correction",
			Confidence: 1, Reason: reason, ValidFrom: resolvedAt,
		}},
	}})
	if err != nil {
		return nil, RelationshipIntelligence{}, err
	}
	updated, err := s.GetRelationship(ctx, results[0].Relationship.ID)
	if err != nil {
		return nil, RelationshipIntelligence{}, err
	}
	intelligence, err := s.RelationshipIntelligenceFor(ctx, updated)
	return updated, intelligence, err
}

// DecideConversationReview applies the authority boundary transactionally through the
// same append-only observation path as every other relationship change.
func (s *Service) DecideConversationReview(
	ctx context.Context,
	u *ent.User,
	relationshipID uuid.UUID,
	input ConversationReviewDecisionInput,
) (*ent.Relationship, RelationshipIntelligence, error) {
	input.ReviewItemID = strings.TrimSpace(input.ReviewItemID)
	input.Kind = strings.TrimSpace(input.Kind)
	if input.ReviewItemID == "" {
		return nil, RelationshipIntelligence{}, fmt.Errorf("%w: reviewItemId is required", ErrInvalidInput)
	}
	switch input.Kind {
	case "approve", "correct", "reject", "defer":
	default:
		return nil, RelationshipIntelligence{}, fmt.Errorf("%w: invalid review decision", ErrInvalidInput)
	}
	if input.Kind == "correct" && strings.TrimSpace(input.CorrectedValue) == "" {
		return nil, RelationshipIntelligence{}, fmt.Errorf("%w: a correction requires correctedValue", ErrInvalidInput)
	}
	if input.Kind == "defer" && !input.DeferUntil.After(s.now()) {
		return nil, RelationshipIntelligence{}, fmt.Errorf("%w: deferUntil must be in the future", ErrInvalidInput)
	}

	rel, err := s.GetRelationship(ctx, relationshipID)
	if err != nil {
		return nil, RelationshipIntelligence{}, err
	}
	intelligence, err := s.RelationshipIntelligenceFor(ctx, rel)
	if err != nil {
		return nil, RelationshipIntelligence{}, err
	}
	var item ConversationReviewItem
	found := false
	for _, candidate := range intelligence.ReviewItems {
		if candidate.ID == input.ReviewItemID && candidate.BatchID != "" {
			item = candidate
			found = true
			break
		}
	}
	if !found {
		return nil, RelationshipIntelligence{}, fmt.Errorf("%w: review item", ErrNotFound)
	}
	if rel.StateVersion != item.BaselineVersion {
		return nil, RelationshipIntelligence{}, fmt.Errorf(
			"%w: review baseline %d is stale; current state is %d",
			ErrReviewRequired, item.BaselineVersion, rel.StateVersion,
		)
	}

	decidedAt := s.now().UTC()
	value := strings.TrimSpace(item.CurrentValue)
	if input.Kind == "correct" {
		value = strings.TrimSpace(input.CorrectedValue)
	}
	reason := strings.TrimSpace(input.Reason)
	if reason == "" {
		reason = "User decided a proposed conversation change."
	}
	decision := map[string]any{
		"item_id": item.ID, "batch_id": item.BatchID, "kind": input.Kind,
		"corrected_value": input.CorrectedValue, "reason": reason,
		"baseline_version": item.BaselineVersion, "candidate_id": item.ClaimID,
		"observation_id": item.ObservationID, "decided_at": decidedAt.Format(time.RFC3339Nano),
	}
	if input.Kind == "defer" {
		decision["defer_until"] = input.DeferUntil.UTC().Format(time.RFC3339Nano)
	}
	facts := map[string]any{"review_decision": decision}
	assertions := []RelationshipAssertionInput{}
	eventType := "conversation_review_decided"
	if input.Kind == "approve" || input.Kind == "correct" {
		if proposed, ok := item.ProposedAfter.(map[string]any); ok {
			kind, _ := proposed["kind"].(string)
			if kind == "commitment" {
				owner, _ := proposed["ownerSpeakerId"].(string)
				direction := "promised_by_them"
				if owner == "local-user" {
					direction = "promised_by_me"
				}
				if input.Kind != "correct" {
					if action, ok := proposed["action"].(string); ok && strings.TrimSpace(action) != "" {
						value = strings.TrimSpace(action)
					}
				}
				facts["commitment_id"] = item.ClaimID
				facts["commitment_owner"] = owner
				facts["commitment_direction"] = direction
				facts["commitment_text"] = value
				facts["commitment_status"] = "open"
				facts["user_confirmed"] = true
				facts["evidence_quote"] = item.ExactQuote
				if duePhrase, ok := proposed["duePhrase"].(string); ok {
					facts["commitment_due_phrase"] = duePhrase
				}
				if dueAt, ok := proposed["dueAt"].(string); ok {
					facts["commitment_due_at"] = dueAt
				}
				eventType = "commitment_confirmed"
			} else if item.StateDimension != "" {
				sourceType := "ai_inference"
				if input.Kind == "correct" {
					sourceType = "user_correction"
				}
				assertions = append(assertions, RelationshipAssertionInput{
					Dimension: item.StateDimension, Value: value, SourceType: sourceType,
					Confidence: item.Confidence, Reason: reason, ValidFrom: decidedAt,
				})
			}
		}
	}
	sum := sha256.Sum256([]byte(item.ID + ":" + input.Kind + ":" + value + ":" + u.ID.String()))
	results, err := s.IngestRelationshipObservations(ctx, u, []RelationshipObservationInput{{
		RelationshipID: relationshipID,
		Source:         "user", ExternalID: "conversation-review-decision:" + hex.EncodeToString(sum[:16]),
		SourceVersion: "1", EventType: eventType, OccurredAt: decidedAt, ReceivedAt: decidedAt,
		Summary: "User decided a proposed conversation change.", Facts: facts,
		Assertions: assertions,
	}})
	if err != nil {
		return nil, RelationshipIntelligence{}, err
	}
	updated, err := s.GetRelationship(ctx, results[0].Relationship.ID)
	if err != nil {
		return nil, RelationshipIntelligence{}, err
	}
	updatedIntelligence, err := s.RelationshipIntelligenceFor(ctx, updated)
	return updated, updatedIntelligence, err
}
