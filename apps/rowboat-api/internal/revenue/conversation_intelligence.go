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
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/commitment"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipassertion"
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

type ConversationReviewItem struct {
	ID             string  `json:"id"`
	Kind           string  `json:"kind"`
	Label          string  `json:"label"`
	CurrentValue   string  `json:"currentValue"`
	Confidence     float64 `json:"confidence"`
	ObservationID  string  `json:"observationId"`
	ClaimID        string  `json:"claimId,omitempty"`
	StateDimension string  `json:"stateDimension,omitempty"`
	ExactQuote     string  `json:"exactQuote,omitempty"`
}

type conversationReviewCorrection struct {
	CorrectedValue string
}

type RelationshipDeltaItem struct {
	Dimension    string   `json:"dimension"`
	Before       any      `json:"before,omitempty"`
	After        any      `json:"after,omitempty"`
	Reason       string   `json:"reason,omitempty"`
	AssertionIDs []string `json:"assertionIds"`
}

type RelationshipContradiction struct {
	Dimension               string `json:"dimension"`
	CurrentValue            string `json:"currentValue"`
	ContradictedValue       string `json:"contradictedValue"`
	CurrentAssertionID      string `json:"currentAssertionId"`
	ContradictedAssertionID string `json:"contradictedAssertionId"`
}

type RelationshipDelta struct {
	FromVersion          int                         `json:"fromVersion"`
	ToVersion            int                         `json:"toVersion"`
	Changes              []RelationshipDeltaItem     `json:"changes"`
	UncertainClaimIDs    []string                    `json:"uncertainClaimIds"`
	Contradictions       []RelationshipContradiction `json:"contradictions"`
	RecommendationReason string                      `json:"recommendationReason,omitempty"`
}

type RelationshipLiveCue struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Title      string `json:"title"`
	Detail     string `json:"detail"`
	Severity   string `json:"severity"`
	EvidenceID string `json:"evidenceId,omitempty"`
}

type RelationshipIntelligence struct {
	Claims             []ConversationClaim             `json:"claims"`
	ReviewItems        []ConversationReviewItem        `json:"reviewItems"`
	GovernanceReceipts []ConversationGovernanceReceipt `json:"governanceReceipts"`
	Delta              RelationshipDelta               `json:"delta"`
	LiveCues           []RelationshipLiveCue           `json:"liveCues"`
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

func exactQuotesInPayload(payload json.RawMessage) map[string]bool {
	var body struct {
		Envelope struct {
			Segments []struct {
				Text string `json:"text"`
			} `json:"segments"`
		} `json:"envelope"`
	}
	quotes := map[string]bool{}
	if json.Unmarshal(payload, &body) != nil {
		return quotes
	}
	for _, segment := range body.Envelope.Segments {
		quotes[strings.TrimSpace(segment.Text)] = true
	}
	return quotes
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
	if len(claims) == 0 && len(proposals) == 0 {
		return s.applyCommitmentUpdates(ctx, client, rel, input)
	}

	quotes := exactQuotesInPayload(input.Payload)
	evidenceByClaim := make(map[string]*ent.RevenueEvidence, len(claims))
	for index := range claims {
		claim := &claims[index]
		claim.ID = strings.TrimSpace(claim.ID)
		claim.ExactQuote = strings.TrimSpace(claim.ExactQuote)
		if claim.ID == "" || claim.ExactQuote == "" || !quotes[claim.ExactQuote] {
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
	return s.applyCommitmentUpdates(ctx, client, rel, input)
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
	rel *ent.Relationship,
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
		row, err := client.Commitment.Query().
			Where(
				commitment.HasRelationshipWith(relationship.IDEQ(rel.ID)),
				commitment.HasEvidencesWith(revenueevidence.SourceRecordIDEQ("commitment:"+update.CommitmentID)),
			).
			Only(ctx)
		if ent.IsNotFound(err) {
			return fmt.Errorf("%w: commitment", ErrNotFound)
		}
		if err != nil {
			return err
		}
		builder := row.Update()
		switch update.Status {
		case "open", "fulfilled", "cancelled", "superseded":
			builder.SetStatus(update.Status)
		case "":
		default:
			return fmt.Errorf("%w: invalid commitment status", ErrInvalidInput)
		}
		if strings.TrimSpace(update.Text) != "" {
			builder.SetText(strings.TrimSpace(update.Text))
		}
		if update.DueAt != "" {
			dueAt, parseErr := time.Parse(time.RFC3339, update.DueAt)
			if parseErr != nil {
				return fmt.Errorf("%w: invalid commitment dueAt", ErrInvalidInput)
			}
			builder.SetDueAt(dueAt.UTC())
		}
		if _, err := builder.Save(ctx); err != nil {
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
		LiveCues: []RelationshipLiveCue{},
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

	assertions, err := s.client.RelationshipAssertion.Query().
		Where(relationshipassertion.HasRelationshipWith(relationship.IDEQ(rel.ID))).
		All(ctx)
	if err != nil {
		return result, err
	}
	sort.SliceStable(assertions, func(i, j int) bool {
		left, right := assertions[i], assertions[j]
		if assertionPriority(left.SourceType) != assertionPriority(right.SourceType) {
			return assertionPriority(left.SourceType) > assertionPriority(right.SourceType)
		}
		return left.ValidFrom.After(right.ValidFrom)
	})
	byDimension := map[string][]*ent.RelationshipAssertion{}
	for _, assertion := range assertions {
		byDimension[assertion.Dimension] = append(byDimension[assertion.Dimension], assertion)
	}
	for dimension, rows := range byDimension {
		if len(rows) < 2 {
			continue
		}
		currentAssertion := rows[0]
		for _, prior := range rows[1:] {
			if prior.Value == currentAssertion.Value {
				continue
			}
			result.Delta.Contradictions = append(result.Delta.Contradictions, RelationshipContradiction{
				Dimension: dimension, CurrentValue: currentAssertion.Value,
				ContradictedValue: prior.Value, CurrentAssertionID: currentAssertion.ID.String(),
				ContradictedAssertionID: prior.ID.String(),
			})
			break
		}
	}

	commitments, err := s.client.Commitment.Query().
		Where(commitment.HasRelationshipWith(relationship.IDEQ(rel.ID))).
		All(ctx)
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
	if len(result.Delta.Contradictions) > 0 {
		contradiction := result.Delta.Contradictions[0]
		result.LiveCues = append(result.LiveCues, RelationshipLiveCue{
			ID: "contradiction:" + contradiction.CurrentAssertionID, Kind: "contradiction",
			Title: "Relationship evidence conflicts", Detail: fmt.Sprintf("%s changed from %q to %q", contradiction.Dimension, contradiction.ContradictedValue, contradiction.CurrentValue),
			Severity: "attention",
		})
	}
	return result, nil
}

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
