package revenue

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipassertion"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipidentity"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipobservation"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipparticipant"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipsourcestatus"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipstatesnapshot"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/google/uuid"
)

// RelationshipState is the shared, explainable projection rendered by web and
// desktop. It deliberately has no numeric health score.
type RelationshipState struct {
	Lifecycle    string   `json:"lifecycle"`
	Engagement   string   `json:"engagement"`
	Sentiment    string   `json:"sentiment"`
	Health       string   `json:"health"`
	Summary      string   `json:"summary,omitempty"`
	NextAction   string   `json:"nextAction,omitempty"`
	StateReason  string   `json:"stateReason,omitempty"`
	Risks        []string `json:"risks"`
	Milestones   []string `json:"milestones"`
	StateVersion int      `json:"stateVersion"`
}

// RelationshipParticipantInput identifies a participant observed in a relationship event.
type RelationshipParticipantInput struct {
	DisplayName  string   `json:"displayName"`
	Email        string   `json:"email"`
	Role         string   `json:"role"`
	Title        string   `json:"title"`
	ExternalRefs []string `json:"externalRefs"`
}

// RelationshipAssertionInput describes a sourced candidate value for canonical state.
type RelationshipAssertionInput struct {
	ID         uuid.UUID `json:"-"`
	Dimension  string    `json:"dimension"`
	Value      string    `json:"value"`
	SourceType string    `json:"sourceType"`
	Confidence float64   `json:"confidence"`
	Reason     string    `json:"reason"`
	ValidFrom  time.Time `json:"validFrom"`
}

// RelationshipObservationInput is the provider-neutral adapter contract.
// RelationshipID is preferred; account identity fields support deterministic
// first ingestion when an adapter has not seen the account before.
type RelationshipObservationInput struct {
	RelationshipID  uuid.UUID
	DisplayName     string
	PrimaryEmail    string
	AccountDomain   string
	ResourceRefs    []string
	Source          string
	SourceAccountID string
	ExternalID      string
	SourceVersion   string
	EventType       string
	OccurredAt      time.Time
	ReceivedAt      time.Time
	Summary         string
	Facts           map[string]any
	Payload         json.RawMessage
	Participants    []RelationshipParticipantInput
	Assertions      []RelationshipAssertionInput
}

// RelationshipObservationResult reports the stored observation and projected relationship.
type RelationshipObservationResult struct {
	Observation  *ent.RelationshipObservation
	Relationship *ent.Relationship
	Duplicate    bool
}

// IngestRelationshipObservations appends a batch atomically and reprojects
// each affected relationship once. A provider replay returns the existing
// observation and never duplicates assertions or participants.
func (s *Service) IngestRelationshipObservations(
	ctx context.Context,
	u *ent.User,
	inputs []RelationshipObservationInput,
) ([]RelationshipObservationResult, error) {
	if len(inputs) == 0 {
		return nil, fmt.Errorf("%w: observations are required", ErrInvalidInput)
	}
	if len(inputs) > 100 {
		return nil, fmt.Errorf("%w: at most 100 observations per batch", ErrInvalidInput)
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
	results := make([]RelationshipObservationResult, 0, len(inputs))
	affected := map[uuid.UUID]*ent.Relationship{}

	for _, input := range inputs {
		result, ingestErr := s.ingestRelationshipObservation(ctx, txc, ws, u, input)
		if ingestErr != nil {
			_ = tx.Rollback()
			return nil, ingestErr
		}
		results = append(results, result)
		if !result.Duplicate {
			affected[result.Relationship.ID] = result.Relationship
		}
	}
	for _, rel := range affected {
		if _, err := projectRelationshipState(ctx, txc, ws, u, rel); err != nil {
			_ = tx.Rollback()
			return nil, err
		}
		if err := persistContradictionArtifacts(ctx, txc, ws, u, rel, s.now()); err != nil {
			_ = tx.Rollback()
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return results, nil
}

func (s *Service) ingestRelationshipObservation(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	input RelationshipObservationInput,
) (RelationshipObservationResult, error) {
	input.Source = strings.ToLower(strings.TrimSpace(input.Source))
	input.ExternalID = strings.TrimSpace(input.ExternalID)
	if input.Source == "" || input.ExternalID == "" || strings.TrimSpace(input.EventType) == "" {
		return RelationshipObservationResult{}, fmt.Errorf(
			"%w: source, externalId, and eventType are required", ErrInvalidInput,
		)
	}
	if input.SourceVersion == "" {
		input.SourceVersion = "1"
	}
	if input.OccurredAt.IsZero() {
		input.OccurredAt = s.now()
	}
	if input.ReceivedAt.IsZero() {
		input.ReceivedAt = s.now()
	}

	existing, err := client.RelationshipObservation.Query().
		Where(
			relationshipobservation.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			relationshipobservation.SourceEQ(input.Source),
			relationshipobservation.ExternalIDEQ(input.ExternalID),
			relationshipobservation.SourceVersionEQ(input.SourceVersion),
		).
		WithRelationship().
		Only(ctx)
	if err == nil {
		rel, relErr := existing.Edges.RelationshipOrErr()
		if relErr != nil {
			return RelationshipObservationResult{}, relErr
		}
		return RelationshipObservationResult{
			Observation:  existing,
			Relationship: rel,
			Duplicate:    true,
		}, nil
	}
	if !ent.IsNotFound(err) {
		return RelationshipObservationResult{}, err
	}

	rel, err := resolveObservationRelationship(ctx, client, ws, u, input)
	if err != nil {
		return RelationshipObservationResult{}, err
	}
	if err := prepareConversationReview(ctx, client, rel, &input); err != nil {
		return RelationshipObservationResult{}, err
	}
	if err := enforceConversationObservationPolicy(ctx, client, ws, u, rel, &input, s.now()); err != nil {
		return RelationshipObservationResult{}, err
	}
	factsJSON, err := json.Marshal(input.Facts)
	if err != nil {
		return RelationshipObservationResult{}, fmt.Errorf("%w: normalized facts: %v", ErrInvalidInput, err)
	}
	hashInput := append(append([]byte(input.Summary), factsJSON...), input.Payload...)
	sum := sha256.Sum256(hashInput)
	create := client.RelationshipObservation.Create().
		SetWorkspace(ws).
		SetRelationship(rel).
		SetUser(u).
		SetSource(input.Source).
		SetSourceAccountID(input.SourceAccountID).
		SetExternalID(input.ExternalID).
		SetSourceVersion(input.SourceVersion).
		SetEventType(strings.TrimSpace(input.EventType)).
		SetOccurredAt(input.OccurredAt.UTC()).
		SetReceivedAt(input.ReceivedAt.UTC()).
		SetSummary(input.Summary).
		SetNormalizedFactsJSON(string(factsJSON)).
		SetContentHash(hex.EncodeToString(sum[:]))
	if len(input.Payload) > 0 {
		payload := []byte(input.Payload)
		if s.sealer != nil {
			payload, err = s.sealer.Seal(payload)
			if err != nil {
				return RelationshipObservationResult{}, err
			}
		}
		create.SetPayloadCiphertext(payload)
	}
	observation, err := create.Save(ctx)
	if err != nil {
		if isValidationError(err) {
			return RelationshipObservationResult{}, fmt.Errorf("%w: %v", ErrInvalidInput, err)
		}
		return RelationshipObservationResult{}, err
	}
	if err := persistConversationObservationArtifacts(ctx, client, ws, u, rel, observation, input); err != nil {
		return RelationshipObservationResult{}, err
	}

	for _, participant := range input.Participants {
		if err := upsertRelationshipParticipant(ctx, client, ws, u, rel, participant); err != nil {
			return RelationshipObservationResult{}, err
		}
	}
	for _, assertionInput := range input.Assertions {
		if _, err := createRelationshipAssertion(
			ctx, client, ws, u, rel, observation, assertionInput,
		); err != nil {
			return RelationshipObservationResult{}, err
		}
	}
	commitment, err := createConfirmedCommitment(ctx, client, ws, u, rel, observation, input)
	if err != nil {
		return RelationshipObservationResult{}, err
	}
	evidence, err := createConfirmedCommitmentEvidence(
		ctx, client, ws, u, rel, observation, commitment, input,
	)
	if err != nil {
		return RelationshipObservationResult{}, err
	}
	if err := s.createConfirmedCommitmentAction(ctx, client, ws, u, rel, evidence, input); err != nil {
		return RelationshipObservationResult{}, err
	}
	if err := s.materializeConversationEvidence(ctx, client, ws, u, rel, observation, input); err != nil {
		return RelationshipObservationResult{}, err
	}
	if err := updateRelationshipSourceStatus(ctx, client, ws, u, input); err != nil {
		return RelationshipObservationResult{}, err
	}
	return RelationshipObservationResult{Observation: observation, Relationship: rel}, nil
}

// createConfirmedCommitment promotes only the desktop's explicit human confirmation.
// Model proposals remain observations/proposals and never appear as durable promises.
// Observation deduplication runs before this helper, so an idempotent replay cannot
// create a second commitment.
func createConfirmedCommitment(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	rel *ent.Relationship,
	observation *ent.RelationshipObservation,
	input RelationshipObservationInput,
) (*ent.Commitment, error) {
	if strings.TrimSpace(input.EventType) != "commitment_confirmed" {
		return nil, nil
	}
	confirmed, _ := input.Facts["user_confirmed"].(bool)
	text, _ := input.Facts["commitment_text"].(string)
	direction, _ := input.Facts["commitment_direction"].(string)
	text = strings.TrimSpace(text)
	direction = strings.TrimSpace(direction)
	if !confirmed || text == "" {
		return nil, fmt.Errorf("%w: confirmed commitment requires user_confirmed and commitment_text", ErrInvalidInput)
	}
	switch direction {
	case "promised_by_me", "promised_by_them", "mutual":
	default:
		return nil, fmt.Errorf("%w: invalid commitment_direction", ErrInvalidInput)
	}
	create := client.Commitment.Create().
		SetWorkspace(ws).
		SetRelationship(rel).
		SetUser(u).
		SetDirection(direction).
		SetText(text).
		SetStatus("open").
		SetConfidence(1).
		SetUserConfirmed(true).
		SetAcceptance("internally_confirmed").
		SetCurrentEventVersion(2)
	ownerRef, _ := input.Facts["owner_participant_ref"].(string)
	counterpartyRef, _ := input.Facts["counterparty_participant_ref"].(string)
	beneficiaryRef, _ := input.Facts["beneficiary_participant_ref"].(string)
	if strings.TrimSpace(ownerRef) == "" {
		if direction == "promised_by_me" {
			ownerRef = "local-user"
		} else {
			ownerRef = "meeting-counterparty"
		}
	}
	if strings.TrimSpace(counterpartyRef) == "" {
		if direction == "promised_by_me" {
			counterpartyRef = "meeting-counterparty"
		} else {
			counterpartyRef = "local-user"
		}
	}
	create.SetOwnerParticipantRef(ownerRef).
		SetCounterpartyParticipantRef(counterpartyRef)
	if beneficiaryRef != "" {
		create.SetBeneficiaryParticipantRef(beneficiaryRef)
	}
	sourcePhrase, _ := input.Facts["evidence_quote"].(string)
	duePhrase, _ := input.Facts["commitment_due_phrase"].(string)
	dueTimezone, _ := input.Facts["commitment_due_timezone"].(string)
	if strings.TrimSpace(sourcePhrase) != "" {
		create.SetSourcePhrase(strings.TrimSpace(sourcePhrase))
	}
	if strings.TrimSpace(duePhrase) != "" {
		create.SetDuePhrase(strings.TrimSpace(duePhrase))
	}
	if strings.TrimSpace(dueTimezone) != "" {
		create.SetDueTimezone(strings.TrimSpace(dueTimezone))
	}
	dueAtValue := ""
	if dueAtRaw, _ := input.Facts["commitment_due_at"].(string); strings.TrimSpace(dueAtRaw) != "" {
		dueAt, parseErr := time.Parse(time.RFC3339, dueAtRaw)
		if parseErr != nil {
			return nil, fmt.Errorf("%w: invalid commitment_due_at", ErrInvalidInput)
		}
		create.SetDueAt(dueAt.UTC())
		dueAtValue = dueAt.UTC().Format(time.RFC3339)
	}
	commitment, err := create.Save(ctx)
	if err != nil && isValidationError(err) {
		return nil, fmt.Errorf("%w: %v", ErrInvalidInput, err)
	}
	if err != nil {
		return nil, err
	}
	payload, marshalErr := json.Marshal(map[string]any{
		"ownerParticipantRef": ownerRef, "counterpartyParticipantRef": counterpartyRef,
		"beneficiaryParticipantRef": beneficiaryRef, "action": text,
		"duePhrase": duePhrase, "dueAt": dueAtValue, "dueTimezone": dueTimezone,
	})
	if marshalErr != nil {
		return nil, marshalErr
	}
	evidenceRefs := []string{"relationship-observation:" + observation.ID.String()}
	for version, eventKind := range []string{"proposed", "internally_confirmed"} {
		actorType := "ai_candidate"
		if eventKind == "internally_confirmed" {
			actorType = "user"
		}
		_, eventErr := client.CommitmentEvent.Create().
			SetWorkspace(ws).SetRelationship(rel).SetUser(u).SetCommitment(commitment).
			SetSourceEventID(input.ExternalID + ":" + eventKind).
			SetVersion(version + 1).SetKind(eventKind).SetActorType(actorType).
			SetActorRef(u.ID.String()).SetOccurredAt(input.OccurredAt.UTC()).
			SetSourceObservationID(observation.ID.String()).SetEvidenceRefs(evidenceRefs).
			SetPayloadJSON(string(payload)).Save(ctx)
		if eventErr != nil {
			return nil, eventErr
		}
	}
	return commitment, nil
}

// createConfirmedCommitmentEvidence bridges the append-only relationship observation
// into the governed action system's evidence graph. The exact quote remains a bounded,
// sensitive excerpt; the full structured payload remains sealed on the observation.
func createConfirmedCommitmentEvidence(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	rel *ent.Relationship,
	observation *ent.RelationshipObservation,
	commitment *ent.Commitment,
	input RelationshipObservationInput,
) (*ent.RevenueEvidence, error) {
	if commitment == nil {
		return nil, nil
	}
	excerpt, _ := input.Facts["evidence_quote"].(string)
	if strings.TrimSpace(excerpt) == "" {
		excerpt, _ = input.Facts["commitment_text"].(string)
	}
	return client.RevenueEvidence.Create().
		SetWorkspace(ws).
		SetUser(u).
		SetSource("meeting").
		SetSourceAccountID(input.SourceAccountID).
		SetSourceRecordID(input.ExternalID).
		SetContentHash("sha256:" + observation.ContentHash).
		SetExcerpt(truncateRunes(strings.TrimSpace(excerpt), excerptMaxRunes)).
		SetOccurredAt(input.OccurredAt.UTC()).
		SetObservedAt(input.ReceivedAt.UTC()).
		SetExternalEvidenceRefs([]string{"relationship-observation:" + observation.ID.String()}).
		AddRelationships(rel).
		AddCommitments(commitment).
		Save(ctx)
}

// createConfirmedCommitmentAction closes Recommend → Approve without skipping the
// approval boundary. A promise by the local user becomes an email draft in the normal
// governed queue; a counterparty promise remains tracked evidence and is not rewritten
// as work for the user. Because this runs inside the observation transaction, either the
// observation, commitment, assertion, and action all land or none of them do.
func (s *Service) createConfirmedCommitmentAction(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	rel *ent.Relationship,
	evidence *ent.RevenueEvidence,
	input RelationshipObservationInput,
) error {
	if strings.TrimSpace(input.EventType) != "commitment_confirmed" {
		return nil
	}
	confirmed, _ := input.Facts["user_confirmed"].(bool)
	direction, _ := input.Facts["commitment_direction"].(string)
	text, _ := input.Facts["commitment_text"].(string)
	// Prefer the confirmed meeting's resolved counterparty over a potentially stale
	// account-level primary contact. Falling back preserves person relationships and
	// older adapters that do not supply observation identity.
	recipient := strings.ToLower(strings.TrimSpace(input.PrimaryEmail))
	if recipient == "" {
		recipient = strings.ToLower(strings.TrimSpace(rel.PrimaryEmail))
	}
	text = strings.TrimSpace(text)
	if !confirmed || strings.TrimSpace(direction) != "promised_by_me" || text == "" || recipient == "" {
		return nil
	}

	subject := "Following up on our meeting"
	message := fmt.Sprintf(
		"Hi,\n\nFollowing up on our meeting, I wanted to confirm the next step: %s\n\nBest,",
		strings.TrimSuffix(text, ".")+".",
	)
	reason := fmt.Sprintf(
		"You confirmed this follow-up from source evidence meeting/%s.",
		input.ExternalID,
	)
	learningLift, err := s.outcomeLearningLift(ctx, client, ws, "meeting_follow_up", "email")
	if err != nil {
		return err
	}
	priority := 75 + learningLift
	if priority < 0 {
		priority = 0
	}
	if priority > 100 {
		priority = 100
	}
	dedupeKey := fmt.Sprintf(
		"meeting_commitment:%s:%s:%s",
		input.Source,
		input.ExternalID,
		input.SourceVersion,
	)
	actionInput := ActionInput{
		ActionType:      "meeting_follow_up",
		Channel:         "email",
		Detector:        DetectorManual,
		DedupeKey:       dedupeKey,
		Reason:          reason,
		RecipientEmail:  recipient,
		ProposedSubject: subject,
		ProposedMessage: message,
		ExecutionMode:   ExecModeDraft,
		PriorityScore:   priority,
		PriorityParts: map[string]int{
			"commitment_urgency":  30,
			"relationship_value":  20,
			"evidence_quality":    25,
			"uncertainty_penalty": 0,
			"outcome_learning":    learningLift,
		},
	}
	priorityJSON, err := json.Marshal(actionInput.PriorityParts)
	if err != nil {
		return err
	}
	create := client.RevenueAction.Create().
		SetWorkspace(ws).
		SetRelationship(rel).
		SetUser(u).
		SetActionType(actionInput.ActionType).
		SetChannel(actionInput.Channel).
		SetDetector(actionInput.Detector).
		SetDedupeKey(actionInput.DedupeKey).
		SetRevision(1).
		SetRevisionHash(actionInput.content(u.ID).Hash()).
		SetReason(actionInput.Reason).
		SetRecipientEmail(actionInput.RecipientEmail).
		SetProposedSubject(actionInput.ProposedSubject).
		SetProposedMessage(actionInput.ProposedMessage).
		SetExecutionMode(actionInput.ExecutionMode).
		SetExecutionOwner(OwnerRowboat).
		SetAssignedUserID(u.ID).
		SetPriorityScore(actionInput.PriorityScore).
		SetPriorityComponentsJSON(string(priorityJSON))
	if dueAtRaw, _ := input.Facts["commitment_due_at"].(string); strings.TrimSpace(dueAtRaw) != "" {
		if dueAt, parseErr := time.Parse(time.RFC3339, dueAtRaw); parseErr == nil {
			create.SetDueAt(dueAt.UTC())
		}
	}
	if evidence != nil {
		create.AddEvidences(evidence)
	}
	action, err := create.Save(ctx)
	if err != nil {
		if isValidationError(err) {
			return fmt.Errorf("%w: %v", ErrInvalidInput, err)
		}
		return err
	}
	return s.snapshotRevision(ctx, client, action, u)
}

func resolveObservationRelationship(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	input RelationshipObservationInput,
) (*ent.Relationship, error) {
	refs, err := normalizeResourceRefs(input.ResourceRefs)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidInput, err)
	}
	signals := observationIdentitySignals(input, refs)
	if input.RelationshipID != uuid.Nil {
		rel, err := client.Relationship.Get(ctx, input.RelationshipID)
		if ent.IsNotFound(err) {
			return nil, fmt.Errorf("%w: relationship", ErrNotFound)
		}
		if err != nil {
			return nil, err
		}
		rel, err = mergeRelationshipIdentityFields(ctx, rel, input, refs)
		if err != nil {
			return nil, err
		}
		if err := bindRelationshipIdentities(ctx, client, ws, u, rel, append(signals, relationshipIdentitySignals(rel)...), input.Source, input.ReceivedAt); err != nil {
			return nil, err
		}
		return rel, nil
	}

	domain := strings.ToLower(strings.TrimSpace(input.AccountDomain))
	email := strings.ToLower(strings.TrimSpace(input.PrimaryEmail))
	matches := map[uuid.UUID]*ent.Relationship{}
	if len(signals) > 0 {
		hashes := make([]string, 0, len(signals))
		for _, signal := range signals {
			hashes = append(hashes, signal.KeyHash)
		}
		identities, err := client.RelationshipIdentity.Query().
			Where(
				relationshipidentity.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
				relationshipidentity.KeyHashIn(hashes...),
			).
			WithRelationship().
			All(ctx)
		if err != nil {
			return nil, err
		}
		for _, identity := range identities {
			rel, edgeErr := identity.Edges.RelationshipOrErr()
			if edgeErr != nil {
				return nil, edgeErr
			}
			matches[rel.ID] = rel
		}
	}

	// Backfill compatibility for relationships created before durable identity
	// anchors existed. Public mailbox domains are never account anchors: two
	// unrelated gmail.com people must not collapse into one relationship.
	predicates := []func(*ent.RelationshipQuery){}
	if domain != "" && !isPublicMailboxDomain(domain) {
		predicates = append(predicates, func(q *ent.RelationshipQuery) {
			// Domains identify accounts, not people. Person relationships at the
			// same company must remain distinct and are resolved by their email or
			// provider aliases instead.
			q.Where(relationship.KindEQ("company"), relationship.AccountDomainEQ(domain))
		})
	}
	if email != "" {
		predicates = append(predicates, func(q *ent.RelationshipQuery) {
			q.Where(relationship.PrimaryEmailEQ(email))
		})
	}
	for _, apply := range predicates {
		q := client.Relationship.Query().
			Where(relationship.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)))
		apply(q)
		rows, err := q.All(ctx)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			matches[row.ID] = row
		}
	}
	if len(matches) > 1 {
		return nil, fmt.Errorf("%w: ambiguous relationship identity requires review", ErrConflict)
	}
	for _, rel := range matches {
		rel, err = mergeRelationshipIdentityFields(ctx, rel, input, refs)
		if err != nil {
			return nil, err
		}
		if err := bindRelationshipIdentities(ctx, client, ws, u, rel, append(signals, relationshipIdentitySignals(rel)...), input.Source, input.ReceivedAt); err != nil {
			return nil, err
		}
		return rel, nil
	}

	displayName := strings.TrimSpace(input.DisplayName)
	if displayName == "" {
		displayName = domain
	}
	if displayName == "" {
		displayName = email
	}
	if displayName == "" {
		return nil, fmt.Errorf(
			"%w: relationshipId or account identity is required", ErrInvalidInput,
		)
	}
	create := client.Relationship.Create().
		SetWorkspace(ws).
		SetUser(u).
		SetKind("company").
		SetDisplayName(displayName)
	if domain != "" {
		create.SetAccountDomain(domain)
	}
	if email != "" {
		create.SetPrimaryEmail(email)
	}
	if len(refs) > 0 {
		create.SetResourceRefs(refs)
	}
	rel, err := create.Save(ctx)
	if err != nil {
		return nil, err
	}
	if err := bindRelationshipIdentities(ctx, client, ws, u, rel, signals, input.Source, input.ReceivedAt); err != nil {
		return nil, err
	}
	return rel, nil
}

type relationshipIdentitySignal struct {
	Kind       string
	Provider   string
	Value      string
	KeyHash    string
	Confidence float64
}

func observationIdentitySignals(input RelationshipObservationInput, refs []string) []relationshipIdentitySignal {
	email := strings.ToLower(strings.TrimSpace(input.PrimaryEmail))
	domain := strings.ToLower(strings.TrimSpace(input.AccountDomain))
	out := make([]relationshipIdentitySignal, 0, len(refs)+2)
	if email != "" {
		out = append(out, newRelationshipIdentitySignal("email", "", email, 1))
	}
	if domain != "" && !isPublicMailboxDomain(domain) {
		out = append(out, newRelationshipIdentitySignal("domain", "", domain, 0.9))
	}
	for _, ref := range refs {
		provider := strings.SplitN(ref, ":", 2)[0]
		out = append(out, newRelationshipIdentitySignal("resource_ref", provider, ref, 1))
	}
	return dedupeRelationshipIdentitySignals(out)
}

func relationshipIdentitySignals(rel *ent.Relationship) []relationshipIdentitySignal {
	return observationIdentitySignals(RelationshipObservationInput{
		PrimaryEmail: rel.PrimaryEmail, AccountDomain: rel.AccountDomain,
	}, rel.ResourceRefs)
}

func newRelationshipIdentitySignal(kind, provider, value string, confidence float64) relationshipIdentitySignal {
	sum := sha256.Sum256([]byte(kind + "\x00" + value))
	return relationshipIdentitySignal{
		Kind: kind, Provider: provider, Value: value,
		KeyHash: hex.EncodeToString(sum[:]), Confidence: confidence,
	}
}

func dedupeRelationshipIdentitySignals(in []relationshipIdentitySignal) []relationshipIdentitySignal {
	seen := make(map[string]struct{}, len(in))
	out := make([]relationshipIdentitySignal, 0, len(in))
	for _, signal := range in {
		if _, exists := seen[signal.KeyHash]; exists {
			continue
		}
		seen[signal.KeyHash] = struct{}{}
		out = append(out, signal)
	}
	return out
}

func bindRelationshipIdentities(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	rel *ent.Relationship,
	signals []relationshipIdentitySignal,
	source string,
	seenAt time.Time,
) error {
	signals = dedupeRelationshipIdentitySignals(signals)
	if rel.Kind != "company" {
		// A corporate domain is shared by every person at that account. Binding
		// it to a person would silently collapse coworkers into one relationship.
		signals = slices.DeleteFunc(signals, func(signal relationshipIdentitySignal) bool {
			return signal.Kind == "domain"
		})
	}
	if len(signals) == 0 {
		return nil
	}
	if seenAt.IsZero() {
		seenAt = time.Now().UTC()
	}
	for _, signal := range signals {
		existing, err := client.RelationshipIdentity.Query().
			Where(
				relationshipidentity.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
				relationshipidentity.KeyHashEQ(signal.KeyHash),
			).
			WithRelationship().
			Only(ctx)
		if err == nil {
			owner, edgeErr := existing.Edges.RelationshipOrErr()
			if edgeErr != nil {
				return edgeErr
			}
			if owner.ID != rel.ID {
				return fmt.Errorf("%w: identity %s is already linked to another relationship", ErrConflict, signal.Kind)
			}
			update := existing.Update()
			changed := false
			if seenAt.Before(existing.FirstSeenAt) {
				update.SetFirstSeenAt(seenAt.UTC())
				changed = true
			}
			if seenAt.After(existing.LastSeenAt) {
				update.SetLastSeenAt(seenAt.UTC()).SetSource(source)
				changed = true
			}
			if !changed {
				continue
			}
			_, err = update.Save(ctx)
			if err != nil {
				return err
			}
			continue
		}
		if !ent.IsNotFound(err) {
			return err
		}
		_, err = client.RelationshipIdentity.Create().
			SetWorkspace(ws).SetRelationship(rel).SetUser(u).
			SetKind(signal.Kind).SetProvider(signal.Provider).
			SetKeyHash(signal.KeyHash).SetNormalizedValue(signal.Value).
			SetSource(source).SetConfidence(signal.Confidence).
			SetFirstSeenAt(seenAt.UTC()).SetLastSeenAt(seenAt.UTC()).
			Save(ctx)
		if err != nil {
			if ent.IsConstraintError(err) {
				return fmt.Errorf("%w: identity was claimed concurrently and requires review", ErrConflict)
			}
			return err
		}
	}
	return nil
}

func mergeRelationshipIdentityFields(
	ctx context.Context,
	rel *ent.Relationship,
	input RelationshipObservationInput,
	refs []string,
) (*ent.Relationship, error) {
	mergedRefs, err := normalizeResourceRefs(append(append([]string{}, rel.ResourceRefs...), refs...))
	if err != nil {
		return nil, err
	}
	update := rel.Update()
	changed := !slices.Equal(mergedRefs, rel.ResourceRefs)
	if changed {
		update.SetResourceRefs(mergedRefs)
	}
	email := strings.ToLower(strings.TrimSpace(input.PrimaryEmail))
	if rel.PrimaryEmail == "" && email != "" {
		update.SetPrimaryEmail(email)
		changed = true
	}
	domain := strings.ToLower(strings.TrimSpace(input.AccountDomain))
	if rel.AccountDomain == "" && domain != "" && !isPublicMailboxDomain(domain) {
		update.SetAccountDomain(domain)
		changed = true
	}
	if !changed {
		return rel, nil
	}
	return update.Save(ctx)
}

func isPublicMailboxDomain(domain string) bool {
	_, public := map[string]struct{}{
		"gmail.com": {}, "googlemail.com": {}, "outlook.com": {}, "hotmail.com": {},
		"live.com": {}, "icloud.com": {}, "me.com": {}, "mac.com": {},
		"yahoo.com": {}, "aol.com": {}, "proton.me": {}, "protonmail.com": {},
	}[strings.ToLower(strings.TrimSpace(domain))]
	return public
}

func normalizeResourceRefs(refs []string) ([]string, error) {
	seen := make(map[string]struct{}, len(refs))
	out := make([]string, 0, len(refs))
	for _, raw := range refs {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		if len(raw) > 512 {
			return nil, errors.New("resource ref exceeds 512 bytes")
		}
		parts := strings.SplitN(raw, ":", 3)
		if len(parts) != 3 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" || strings.TrimSpace(parts[2]) == "" {
			return nil, fmt.Errorf("resource ref %q must use product:type:externalId", raw)
		}
		ref := strings.ToLower(strings.TrimSpace(parts[0])) + ":" + strings.ToLower(strings.TrimSpace(parts[1])) + ":" + strings.TrimSpace(parts[2])
		if _, ok := seen[ref]; ok {
			continue
		}
		seen[ref] = struct{}{}
		out = append(out, ref)
		if len(out) > 50 {
			return nil, errors.New("at most 50 unique resource refs are allowed")
		}
	}
	sort.Strings(out)
	return out, nil
}

func mergeRelationshipResourceRefs(ctx context.Context, rel *ent.Relationship, refs []string) (*ent.Relationship, error) {
	if len(refs) == 0 {
		return rel, nil
	}
	merged, err := normalizeResourceRefs(append(append([]string{}, rel.ResourceRefs...), refs...))
	if err != nil {
		return nil, err
	}
	if slices.Equal(merged, rel.ResourceRefs) {
		return rel, nil
	}
	return rel.Update().SetResourceRefs(merged).Save(ctx)
}

func upsertRelationshipParticipant(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	rel *ent.Relationship,
	input RelationshipParticipantInput,
) error {
	email := strings.ToLower(strings.TrimSpace(input.Email))
	name := strings.TrimSpace(input.DisplayName)
	refs, err := normalizeResourceRefs(input.ExternalRefs)
	if err != nil {
		return fmt.Errorf("%w: participant external refs: %v", ErrInvalidInput, err)
	}
	if email == "" && name == "" && len(refs) == 0 {
		return nil
	}
	matches := map[uuid.UUID]*ent.RelationshipParticipant{}
	if email != "" {
		existing, queryErr := client.RelationshipParticipant.Query().
			Where(
				relationshipparticipant.HasRelationshipWith(relationship.IDEQ(rel.ID)),
				relationshipparticipant.EmailEQ(email),
			).
			Only(ctx)
		if queryErr == nil {
			matches[existing.ID] = existing
		} else if !ent.IsNotFound(queryErr) {
			return queryErr
		}
	}
	if len(refs) > 0 {
		participants, queryErr := client.RelationshipParticipant.Query().
			Where(relationshipparticipant.HasRelationshipWith(relationship.IDEQ(rel.ID))).
			All(ctx)
		if queryErr != nil {
			return queryErr
		}
		wanted := make(map[string]struct{}, len(refs))
		for _, ref := range refs {
			wanted[ref] = struct{}{}
		}
		for _, participant := range participants {
			for _, ref := range participant.ExternalRefs {
				if _, ok := wanted[ref]; ok {
					matches[participant.ID] = participant
					break
				}
			}
		}
	}
	if len(matches) > 1 {
		return fmt.Errorf("%w: participant email and provider refs resolve to different people", ErrConflict)
	}
	var existing *ent.RelationshipParticipant
	for _, match := range matches {
		existing = match
	}
	role := strings.TrimSpace(input.Role)
	if role == "" {
		role = "contact"
	}
	if existing != nil {
		update := existing.Update().SetRole(role).SetActive(true)
		if name != "" {
			update.SetDisplayName(name)
		}
		if input.Title != "" {
			update.SetTitle(input.Title)
		}
		if email != "" && existing.Email == "" {
			update.SetEmail(email)
		}
		if len(refs) > 0 {
			merged, mergeErr := normalizeResourceRefs(append(append([]string{}, existing.ExternalRefs...), refs...))
			if mergeErr != nil {
				return mergeErr
			}
			update.SetExternalRefs(merged)
		}
		_, err = update.Save(ctx)
		return err
	}
	// A provider-only alias can enrich an existing person, but without a name
	// or email it is not enough evidence to invent a new participant record.
	if name == "" && email == "" {
		return nil
	}
	if name == "" {
		name = email
	}
	create := client.RelationshipParticipant.Create().
		SetWorkspace(ws).
		SetRelationship(rel).
		SetUser(u).
		SetDisplayName(name).
		SetEmail(email).
		SetRole(role).
		SetTitle(input.Title).
		SetExternalRefs(refs)
	_, err = create.Save(ctx)
	return err
}

func createRelationshipAssertion(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	rel *ent.Relationship,
	observation *ent.RelationshipObservation,
	input RelationshipAssertionInput,
) (*ent.RelationshipAssertion, error) {
	if input.ValidFrom.IsZero() {
		input.ValidFrom = time.Now().UTC()
	}
	if input.SourceType == "" {
		input.SourceType = "ai_inference"
	}
	if input.Confidence == 0 && input.SourceType != "user_correction" {
		input.Confidence = 0.5
	}
	if input.SourceType == "user_correction" {
		input.Confidence = 1
	}
	create := client.RelationshipAssertion.Create().
		SetWorkspace(ws).
		SetRelationship(rel).
		SetUser(u).
		SetDimension(strings.TrimSpace(input.Dimension)).
		SetValue(strings.TrimSpace(input.Value)).
		SetSourceType(input.SourceType).
		SetConfidence(input.Confidence).
		SetReason(input.Reason).
		SetValidFrom(input.ValidFrom.UTC())
	if input.ID != uuid.Nil {
		create.SetID(input.ID)
	}
	if observation != nil {
		create.SetObservation(observation).
			SetSupportingObservationIds([]string{observation.ID.String()})
	}
	assertion, err := create.Save(ctx)
	if err != nil && isValidationError(err) {
		return nil, fmt.Errorf("%w: %v", ErrInvalidInput, err)
	}
	return assertion, err
}

func updateRelationshipSourceStatus(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	input RelationshipObservationInput,
) error {
	accountID := input.SourceAccountID
	if accountID == "" {
		accountID = "default"
	}
	status, err := client.RelationshipSourceStatus.Query().
		Where(
			relationshipsourcestatus.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			relationshipsourcestatus.SourceEQ(input.Source),
			relationshipsourcestatus.SourceAccountIDEQ(accountID),
		).
		Only(ctx)
	if err == nil {
		_, err = status.Update().
			SetStatus("connected").
			SetLastSuccessAt(input.ReceivedAt.UTC()).
			SetLastObservationAt(input.OccurredAt.UTC()).
			ClearLastError().
			Save(ctx)
		return err
	}
	if !ent.IsNotFound(err) {
		return err
	}
	_, err = client.RelationshipSourceStatus.Create().
		SetWorkspace(ws).
		SetUser(u).
		SetSource(input.Source).
		SetSourceAccountID(accountID).
		SetStatus("connected").
		SetLastSuccessAt(input.ReceivedAt.UTC()).
		SetLastObservationAt(input.OccurredAt.UTC()).
		Save(ctx)
	return err
}

func assertionPriority(sourceType string) int {
	switch sourceType {
	case "user_correction":
		return 4
	case "source_fact":
		return 3
	case "deterministic":
		return 2
	default:
		return 1
	}
}

func projectRelationshipState(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	rel *ent.Relationship,
) (*ent.Relationship, error) {
	assertions, err := client.RelationshipAssertion.Query().
		Where(relationshipassertion.HasRelationshipWith(relationship.IDEQ(rel.ID))).
		All(ctx)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(assertions, func(i, j int) bool {
		left, right := assertions[i], assertions[j]
		lp, rp := assertionPriority(left.SourceType), assertionPriority(right.SourceType)
		if lp != rp {
			return lp > rp
		}
		if !left.ValidFrom.Equal(right.ValidFrom) {
			return left.ValidFrom.After(right.ValidFrom)
		}
		if left.Confidence != right.Confidence {
			return left.Confidence > right.Confidence
		}
		return left.ID.String() > right.ID.String()
	})
	selected := map[string]*ent.RelationshipAssertion{}
	for _, assertion := range assertions {
		if selected[assertion.Dimension] == nil {
			selected[assertion.Dimension] = assertion
		}
	}

	next := RelationshipState{
		Lifecycle:    rel.Lifecycle,
		Engagement:   rel.Engagement,
		Sentiment:    rel.Sentiment,
		Health:       rel.Health,
		Summary:      rel.Summary,
		NextAction:   rel.NextAction,
		StateReason:  rel.StateReason,
		Risks:        append([]string(nil), rel.Risks...),
		Milestones:   append([]string(nil), rel.Milestones...),
		StateVersion: rel.StateVersion,
	}
	changed := make([]string, 0, len(selected))
	apply := func(dimension, current string, target *string) {
		if assertion := selected[dimension]; assertion != nil && assertion.Value != current {
			*target = assertion.Value
			changed = append(changed, dimension)
		}
	}
	apply("lifecycle", next.Lifecycle, &next.Lifecycle)
	apply("engagement", next.Engagement, &next.Engagement)
	apply("sentiment", next.Sentiment, &next.Sentiment)
	apply("health", next.Health, &next.Health)
	apply("summary", next.Summary, &next.Summary)
	apply("next_action", next.NextAction, &next.NextAction)
	if assertion := selected["risk"]; assertion != nil {
		risks := []string{assertion.Value}
		if !equalStrings(next.Risks, risks) {
			next.Risks = risks
			changed = append(changed, "risks")
		}
	}
	if assertion := selected["milestone"]; assertion != nil {
		milestones := []string{assertion.Value}
		if !equalStrings(next.Milestones, milestones) {
			next.Milestones = milestones
			changed = append(changed, "milestones")
		}
	}
	if len(changed) == 0 {
		return rel, nil
	}
	sort.Strings(changed)
	reasons := make([]string, 0, len(changed))
	assertionIDs := make([]string, 0, len(changed))
	for _, dimension := range changed {
		key := strings.TrimSuffix(dimension, "s")
		if assertion := selected[key]; assertion != nil {
			assertionIDs = append(assertionIDs, assertion.ID.String())
			if assertion.Reason != "" {
				reasons = append(reasons, assertion.Reason)
			}
		}
	}
	next.StateVersion++
	next.StateReason = strings.Join(reasons, " ")
	now := time.Now().UTC()
	stateJSON, err := json.Marshal(next)
	if err != nil {
		return nil, err
	}
	updated, err := rel.Update().
		SetLifecycle(next.Lifecycle).
		SetEngagement(next.Engagement).
		SetSentiment(next.Sentiment).
		SetHealth(next.Health).
		SetSummary(next.Summary).
		SetNextAction(next.NextAction).
		SetStateReason(next.StateReason).
		SetStateVersion(next.StateVersion).
		SetLastChangedAt(now).
		SetRisks(next.Risks).
		SetMilestones(next.Milestones).
		Save(ctx)
	if err != nil {
		return nil, err
	}
	_, err = client.RelationshipStateSnapshot.Create().
		SetWorkspace(ws).
		SetRelationship(updated).
		SetUser(u).
		SetVersion(next.StateVersion).
		SetStateJSON(string(stateJSON)).
		SetChangedDimensions(changed).
		SetAssertionIds(assertionIDs).
		Save(ctx)
	return updated, err
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

// RelationshipCorrectionInput contains a user-confirmed canonical state correction.
type RelationshipCorrectionInput struct {
	Dimension             string
	Value                 string
	Reason                string
	SupersedesAssertionID string
}

// CorrectRelationship appends a user correction and deterministically reprojects state.
func (s *Service) CorrectRelationship(
	ctx context.Context,
	u *ent.User,
	relationshipID uuid.UUID,
	input RelationshipCorrectionInput,
) (*ent.Relationship, error) {
	ws, err := s.CurrentWorkspace(ctx, u)
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
	assertion, err := createRelationshipAssertion(ctx, s.client, ws, u, rel, nil, RelationshipAssertionInput{
		Dimension:  input.Dimension,
		Value:      input.Value,
		SourceType: "user_correction",
		Confidence: 1,
		Reason:     input.Reason,
		ValidFrom:  s.now(),
	})
	if err != nil {
		return nil, err
	}
	if input.SupersedesAssertionID != "" {
		if _, err := assertion.Update().
			SetSupersedesAssertionID(input.SupersedesAssertionID).
			Save(ctx); err != nil {
			return nil, err
		}
	}
	return projectRelationshipState(ctx, s.client, ws, u, rel)
}

// RelationshipTimeline returns relationship observations in chronological order.
func (s *Service) RelationshipTimeline(
	ctx context.Context,
	relationshipID uuid.UUID,
	limit int,
) ([]*ent.RelationshipObservation, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if _, err := s.client.Relationship.Get(ctx, relationshipID); err != nil {
		if ent.IsNotFound(err) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return s.client.RelationshipObservation.Query().
		Where(relationshipobservation.HasRelationshipWith(relationship.IDEQ(relationshipID))).
		Order(ent.Desc(relationshipobservation.FieldOccurredAt)).
		Limit(limit).
		All(ctx)
}

// RelationshipObservation returns one observation that belongs to a relationship.
func (s *Service) RelationshipObservation(
	ctx context.Context,
	relationshipID uuid.UUID,
	observationID uuid.UUID,
) (*ent.RelationshipObservation, error) {
	observation, err := s.client.RelationshipObservation.Query().
		Where(
			relationshipobservation.IDEQ(observationID),
			relationshipobservation.HasRelationshipWith(relationship.IDEQ(relationshipID)),
		).
		Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrNotFound
	}
	return observation, err
}

// RelationshipObservationPayload returns the original payload for an observation.
func (s *Service) RelationshipObservationPayload(
	ctx context.Context,
	relationshipID uuid.UUID,
	observationID uuid.UUID,
) (*ent.RelationshipObservation, []byte, error) {
	observation, err := s.RelationshipObservation(ctx, relationshipID, observationID)
	if err != nil {
		return nil, nil, err
	}
	if len(observation.PayloadCiphertext) == 0 {
		return observation, nil, nil
	}
	if s.sealer == nil {
		return observation, observation.PayloadCiphertext, nil
	}
	payload, err := s.sealer.Open(observation.PayloadCiphertext)
	if err != nil {
		return nil, nil, err
	}
	return observation, payload, nil
}

// RelationshipChanges returns projected state snapshots for a relationship.
func (s *Service) RelationshipChanges(
	ctx context.Context,
	relationshipID uuid.UUID,
) ([]*ent.RelationshipStateSnapshot, error) {
	if _, err := s.client.Relationship.Get(ctx, relationshipID); err != nil {
		if ent.IsNotFound(err) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return s.client.RelationshipStateSnapshot.Query().
		Where(relationshipstatesnapshot.HasRelationshipWith(relationship.IDEQ(relationshipID))).
		Order(ent.Desc(relationshipstatesnapshot.FieldVersion)).
		Limit(2).
		All(ctx)
}

// RelationshipSourceStatuses returns the current ingestion state of relationship sources.
func (s *Service) RelationshipSourceStatuses(
	ctx context.Context,
	u *ent.User,
) ([]*ent.RelationshipSourceStatus, error) {
	ws, err := s.CurrentWorkspace(ctx, u)
	if err != nil {
		return nil, err
	}
	return s.client.RelationshipSourceStatus.Query().
		Where(relationshipsourcestatus.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID))).
		Order(ent.Asc(relationshipsourcestatus.FieldSource)).
		All(ctx)
}
