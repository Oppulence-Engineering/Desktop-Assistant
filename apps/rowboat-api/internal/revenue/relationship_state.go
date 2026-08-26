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

	entsql "entgo.io/ent/dialect/sql"
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
	"go.uber.org/zap"
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

const (
	relationshipProjectorVersion             = 2
	minimumSupportedRelationshipProjectorJob = 1
)

// RelationshipParticipantInput identifies a participant observed in a relationship event.
type RelationshipParticipantInput struct {
	DisplayName  string   `json:"displayName"`
	Email        string   `json:"email"`
	Role         string   `json:"role"`
	Title        string   `json:"title"`
	ExternalRefs []string `json:"externalRefs"`
	// Per-participant override. One meeting observation can hold both directions:
	// the organizer is outbound while the attendees are inbound.
	Direction string `json:"direction,omitempty"`
}

// RelationshipAssertionInput describes a sourced candidate value for canonical state.
type RelationshipAssertionInput struct {
	ID                     uuid.UUID  `json:"-"`
	Dimension              string     `json:"dimension"`
	Value                  string     `json:"value"`
	ValueSchemaVersion     int        `json:"valueSchemaVersion,omitempty"`
	SourceType             string     `json:"sourceType"`
	AuthorityRank          int        `json:"-"`
	Confidence             float64    `json:"confidence"`
	Reason                 string     `json:"reason"`
	ValidFrom              time.Time  `json:"validFrom"`
	ValidTo                *time.Time `json:"validTo,omitempty"`
	SupersedesAssertionID  string     `json:"supersedesAssertionId,omitempty"`
	ExtractorVersion       string     `json:"extractorVersion,omitempty"`
	ProjectorCompatVersion int        `json:"projectorCompatVersion,omitempty"`
	// UserConfirmed is an explicit authenticated-user decision carried with a
	// durable observation. It is equivalent in authority to the dedicated
	// correction endpoint: the server ignores caller-claimed source authority,
	// records the current user as reviewer, and emits an accepted correction.
	UserConfirmed bool `json:"userConfirmed,omitempty"`
	// CitationsJSON is the evidence behind an external_research assertion
	// (RFC 039): a JSON array of {title, url, excerpts[]}. Empty for every
	// owned-data source type.
	CitationsJSON string `json:"citationsJson,omitempty"`
	admission     relationshipAssertionAdmission
	status        string
	reviewedAt    time.Time
}

// UnmarshalJSON keeps explicit zero confidence distinct from an omitted public
// contract field. Internal trusted writers construct this type directly, while
// authenticated JSON callers must provide the confidence required by OpenAPI.
func (input *RelationshipAssertionInput) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	rawConfidence, ok := fields["confidence"]
	if !ok || string(rawConfidence) == "null" {
		return errors.New("assertion confidence is required")
	}
	type plainRelationshipAssertionInput RelationshipAssertionInput
	var decoded plainRelationshipAssertionInput
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*input = RelationshipAssertionInput(decoded)
	return nil
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
	// Channel and Direction feed the per-person interaction rollup. Both are
	// optional and both fall back rather than guess: an unknown direction
	// increments the interaction total without touching inbound/outbound.
	Channel   string
	Direction string
	// PreferredKind lets a first-party detector state what it is looking at.
	// resolveObservationRelationship defaults to "company", which is right for
	// domain-anchored account evidence and wrong for a thread with one human.
	PreferredKind string
}

// RelationshipObservationResult reports the stored observation and projected relationship.
type RelationshipObservationResult struct {
	Observation  *ent.RelationshipObservation
	Relationship *ent.Relationship
	Duplicate    bool
	// ProjectionStatus is completed when the inline fast path projected the
	// accepted evidence. Failed/dead means the evidence is durable and the
	// outbox will retry or requires operator repair; it never means the
	// observation was discarded.
	ProjectionStatus string
	ProjectionJobID  uuid.UUID
}

type relationshipProjectionBatch struct {
	rel        *ent.Relationship
	refs       []string
	boundaries []time.Time
	job        *ent.RelationshipProjectionJob
}

// IngestRelationshipObservations appends a batch and its projection outbox
// jobs atomically. Projection runs inline as a latency optimization only after
// evidence commits. A provider replay returns the existing observation and
// never duplicates assertions, participants, or jobs.
func (s *Service) ingestTrustedRelationshipObservations(
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
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceContribute)
	if err != nil {
		return nil, err
	}
	for _, input := range inputs {
		if capability := sourceCapability(input.Source); capability != "" {
			if err := s.requireWorkspaceFeature(ctx, ws, capability); err != nil {
				return nil, err
			}
		}
	}
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	txc := tx.Client()
	results := make([]RelationshipObservationResult, 0, len(inputs))
	affected := map[uuid.UUID]*relationshipProjectionBatch{}
	evaluatedAt := s.now().UTC()

	for _, input := range inputs {
		result, ingestErr := s.ingestRelationshipObservation(ctx, txc, ws, u, input)
		if ingestErr != nil {
			_ = tx.Rollback()
			return nil, ingestErr
		}
		results = append(results, result)
		if !result.Duplicate {
			batch := affected[result.Relationship.ID]
			if batch == nil {
				batch = &relationshipProjectionBatch{rel: result.Relationship}
				affected[result.Relationship.ID] = batch
			}
			ref := "relationship-observation:" + result.Observation.ID.String()
			batch.refs = append(batch.refs, ref)
			if trustErr := appendTrustEvent(ctx, txc, ws, u, TrustEventInput{
				Name: "observation_accepted", Outcome: "accepted",
				CorrelationID: ref, Source: input.Source, OccurredAt: evaluatedAt,
				Relationship: result.Relationship,
			}); trustErr != nil {
				_ = tx.Rollback()
				return nil, trustErr
			}
			for _, assertion := range input.Assertions {
				validFrom := assertion.ValidFrom
				if validFrom.IsZero() {
					validFrom = result.Observation.OccurredAt
				}
				if validFrom.After(evaluatedAt) {
					batch.boundaries = append(batch.boundaries, validFrom.UTC())
				}
				if assertion.ValidTo != nil && assertion.ValidTo.After(evaluatedAt) {
					batch.boundaries = append(batch.boundaries, assertion.ValidTo.UTC())
				}
			}
		}
	}
	for _, batch := range affected {
		job, enqueueErr := s.enqueueRelationshipProjectionTx(
			ctx, txc, ws, u, batch.rel, evaluatedAt, batch.refs,
		)
		if enqueueErr != nil {
			_ = tx.Rollback()
			return nil, enqueueErr
		}
		batch.job = job
		for _, boundary := range uniqueProjectionBoundaries(batch.boundaries) {
			if _, enqueueErr := s.enqueueRelationshipProjectionTx(
				ctx, txc, ws, u, batch.rel, boundary, append(batch.refs, "temporal-boundary"),
			); enqueueErr != nil {
				_ = tx.Rollback()
				return nil, enqueueErr
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	workerID := "inline-relationship-projector-" + uuid.NewString()
	for relationshipID, batch := range affected {
		status := "pending"
		projected, processedStatus, projectErr := s.ProcessRelationshipProjectionJob(
			ctx, u, batch.job.ID, workerID,
		)
		if processedStatus != "" {
			status = processedStatus
		}
		if projectErr != nil {
			s.log.Warn("relationship projection deferred",
				zap.String("relationship", relationshipID.String()),
				zap.String("job", batch.job.ID.String()),
				zap.String("status", status),
				zap.Error(projectErr),
			)
		}
		for i := range results {
			if results[i].Relationship.ID != relationshipID {
				continue
			}
			results[i].ProjectionJobID = batch.job.ID
			results[i].ProjectionStatus = status
			if projected != nil {
				results[i].Relationship = projected
			} else {
				results[i].Relationship = results[i].Relationship.Unwrap()
			}
		}
	}
	for i := range results {
		if results[i].ProjectionStatus == "" {
			results[i].ProjectionStatus = "duplicate"
			results[i].Relationship = results[i].Relationship.Unwrap()
		}
		results[i].Observation = results[i].Observation.Unwrap()
	}
	return results, nil
}

// IngestRelationshipObservationCandidates is the authenticated observation
// boundary. Caller-supplied assertions remain proposed AI-tier candidates and
// cannot mint source-fact or user-correction authority. Provider-verified
// adapters and deterministic jobs call ingestTrustedRelationshipObservations from
// inside this package after establishing their own trust boundary.
func (s *Service) IngestRelationshipObservationCandidates(
	ctx context.Context,
	u *ent.User,
	inputs []RelationshipObservationInput,
) ([]RelationshipObservationResult, error) {
	admitted := make([]RelationshipObservationInput, len(inputs))
	copy(admitted, inputs)
	reviewedAt := s.now().UTC()
	for i := range admitted {
		admitted[i].Assertions = append([]RelationshipAssertionInput(nil), admitted[i].Assertions...)
		for j := range admitted[i].Assertions {
			admitted[i].Assertions[j].admission = relationshipAssertionAdmissionUntrustedObservation
			if admitted[i].Assertions[j].UserConfirmed {
				admitted[i].Assertions[j].reviewedAt = reviewedAt
			}
		}
	}
	return s.ingestTrustedRelationshipObservations(ctx, u, admitted)
}

func uniqueProjectionBoundaries(values []time.Time) []time.Time {
	seen := make(map[string]struct{}, len(values))
	out := make([]time.Time, 0, len(values))
	for _, value := range values {
		value = value.UTC()
		key := value.Format(time.RFC3339Nano)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, value)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Before(out[j]) })
	return out
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

	rel, _, err := resolveObservationRelationship(ctx, client, ws, u, input)
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
		return RelationshipObservationResult{}, fmt.Errorf("%w: normalized facts: %w", ErrInvalidInput, err)
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
		if s.evidenceKeys == nil {
			return RelationshipObservationResult{}, ErrEvidenceEncryptionUnavailable
		}
		payload, keyVersion, sealErr := s.evidenceKeys.Seal(ctx, client, ws, u, []byte(input.Payload))
		if sealErr != nil {
			return RelationshipObservationResult{}, sealErr
		}
		create.SetPayloadCiphertext(payload).SetEncryptionKeyVersion(keyVersion)
	}
	observation, err := create.Save(ctx)
	if err != nil {
		if isValidationError(err) {
			return RelationshipObservationResult{}, fmt.Errorf("%w: %w", ErrInvalidInput, err)
		}
		return RelationshipObservationResult{}, err
	}
	// last_touch_at is derived, not authored. Bump it monotonically here so the
	// quiet_account detector sees fresh evidence inside this same transaction; the
	// projector recomputes it from the observation set so deletion and merge
	// converge on the truth rather than on a high-water mark.
	//
	// Before this it was written at exactly one site -- relationship creation in
	// scan.go -- and never again, so every account's "no recorded interaction for N
	// days" was measured from the day the account was created, forever.
	if rel.LastTouchAt == nil || input.OccurredAt.After(rel.LastTouchAt.UTC()) {
		bumped, touchErr := rel.Update().SetLastTouchAt(input.OccurredAt.UTC()).Save(ctx)
		if touchErr != nil {
			return RelationshipObservationResult{}, touchErr
		}
		rel = bumped
	}
	if err := attachObservationToIdentityCandidates(ctx, client, rel, observation); err != nil {
		return RelationshipObservationResult{}, err
	}
	if err := persistConversationObservationArtifacts(ctx, client, ws, u, rel, observation, input); err != nil {
		return RelationshipObservationResult{}, err
	}

	for _, participant := range input.Participants {
		if err := upsertRelationshipParticipant(ctx, client, ws, u, rel, participant); err != nil {
			return RelationshipObservationResult{}, err
		}
		// This path is reached once per observation -- a duplicate returns before
		// the participant loop -- so counting here is safe.
		person, err := linkParticipantPerson(
			ctx, client, ws, u, rel, observation, input, participant,
		)
		if err != nil {
			return RelationshipObservationResult{}, err
		}
		if err := countParticipantInteraction(
			ctx, client, ws, u, rel, person, input, participant,
		); err != nil {
			return RelationshipObservationResult{}, err
		}
	}
	for _, assertionInput := range input.Assertions {
		if assertionInput.ValidFrom.IsZero() {
			assertionInput.ValidFrom = input.OccurredAt
		}
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
		return nil, fmt.Errorf("%w: %w", ErrInvalidInput, err)
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
			return fmt.Errorf("%w: %w", ErrInvalidInput, err)
		}
		return err
	}
	return s.snapshotRevision(ctx, client, action, u)
}

// resolveObservationRelationship finds or creates the relationship an observation
// belongs to. The bool reports whether a NEW relationship was created -- callers
// need it for their own counters, and inferring it from timestamps is unreliable
// because created_at and updated_at are stamped from separate clock reads.
func resolveObservationRelationship(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	input RelationshipObservationInput,
) (*ent.Relationship, bool, error) {
	refs, err := normalizeResourceRefs(input.ResourceRefs)
	if err != nil {
		return nil, false, fmt.Errorf("%w: %w", ErrInvalidInput, err)
	}
	signals := observationIdentitySignals(input, refs)
	if input.RelationshipID != uuid.Nil {
		rel, err := client.Relationship.Get(ctx, input.RelationshipID)
		if ent.IsNotFound(err) {
			return nil, false, fmt.Errorf("%w: relationship", ErrNotFound)
		}
		if err != nil {
			return nil, false, err
		}
		allSignals := dedupeRelationshipIdentitySignals(append(signals, relationshipIdentitySignals(rel)...))
		safe, conflicts, err := classifyRelationshipIdentitySignals(ctx, client, ws, rel, allSignals)
		if err != nil {
			return nil, false, err
		}
		for _, conflict := range conflicts {
			if _, err := createIdentityCandidate(ctx, client, ws, u, rel, conflict.owner, conflict.signal, "anchor_collision", input.ReceivedAt); err != nil {
				return nil, false, err
			}
		}
		sanitized := removeConflictingIdentityFields(input, conflicts)
		sanitizedRefs, err := normalizeResourceRefs(sanitized.ResourceRefs)
		if err != nil {
			return nil, false, fmt.Errorf("%w: %w", ErrInvalidInput, err)
		}
		rel, err = mergeRelationshipIdentityFields(ctx, rel, sanitized, sanitizedRefs)
		if err != nil {
			return nil, false, err
		}
		if err := bindRelationshipIdentities(ctx, client, ws, u, rel, safe, input.Source, input.ReceivedAt); err != nil {
			return nil, false, err
		}
		return rel, false, nil
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
			return nil, false, err
		}
		for _, identity := range identities {
			rel, edgeErr := identity.Edges.RelationshipOrErr()
			if edgeErr != nil {
				return nil, false, edgeErr
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
			return nil, false, err
		}
		for _, row := range rows {
			matches[row.ID] = row
		}
	}
	if len(matches) > 1 {
		// Never pick a winner. The event is accepted on an isolated proposed
		// relationship and each exact collision becomes independently reviewable.
		proposed, err := createProposedRelationship(ctx, client, ws, u, input)
		if err != nil {
			return nil, false, err
		}
		created := map[uuid.UUID]bool{}
		for _, signal := range signals {
			identity, lookupErr := client.RelationshipIdentity.Query().
				Where(
					relationshipidentity.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
					relationshipidentity.KeyHashEQ(signal.KeyHash),
				).WithRelationship().Only(ctx)
			if lookupErr != nil {
				if ent.IsNotFound(lookupErr) {
					continue
				}
				return nil, false, lookupErr
			}
			owner, edgeErr := identity.Edges.RelationshipOrErr()
			if edgeErr != nil {
				return nil, false, edgeErr
			}
			if created[owner.ID] {
				continue
			}
			if _, err := createIdentityCandidate(ctx, client, ws, u, proposed, owner, signal, "multi_match", input.ReceivedAt); err != nil {
				return nil, false, err
			}
			created[owner.ID] = true
		}
		// Legacy field matches may not yet have durable anchors. Preserve them as
		// candidates with an exact email/domain signal rather than auto-merging.
		for id, owner := range matches {
			if created[id] {
				continue
			}
			signal := newRelationshipIdentitySignal("email", "", email, 1)
			if email == "" || owner.PrimaryEmail != email {
				signal = newRelationshipIdentitySignal("domain", "", domain, 0.9)
			}
			if _, err := createIdentityCandidate(ctx, client, ws, u, proposed, owner, signal, "multi_match", input.ReceivedAt); err != nil {
				return nil, false, err
			}
		}
		return proposed, true, nil
	}
	for _, rel := range matches {
		rel, err = mergeRelationshipIdentityFields(ctx, rel, input, refs)
		if err != nil {
			return nil, false, err
		}
		if err := bindRelationshipIdentities(ctx, client, ws, u, rel, append(signals, relationshipIdentitySignals(rel)...), input.Source, input.ReceivedAt); err != nil {
			return nil, false, err
		}
		return rel, false, nil
	}

	displayName := strings.TrimSpace(input.DisplayName)
	if displayName == "" {
		displayName = domain
	}
	if displayName == "" {
		displayName = email
	}
	if displayName == "" {
		return nil, false, fmt.Errorf(
			"%w: relationshipId or account identity is required", ErrInvalidInput,
		)
	}
	// A domain-anchored account observation is a company; a first-party detector
	// looking at one human's mail thread can say so instead.
	kind := strings.TrimSpace(input.PreferredKind)
	if kind == "" {
		kind = "company"
	}
	create := client.Relationship.Create().
		SetWorkspace(ws).
		SetUser(u).
		SetKind(kind).
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
		return nil, false, err
	}
	if err := bindRelationshipIdentities(ctx, client, ws, u, rel, signals, input.Source, input.ReceivedAt); err != nil {
		return nil, false, err
	}
	return rel, true, nil
}

type relationshipIdentityConflict struct {
	signal relationshipIdentitySignal
	owner  *ent.Relationship
}

func classifyRelationshipIdentitySignals(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	proposed *ent.Relationship,
	signals []relationshipIdentitySignal,
) ([]relationshipIdentitySignal, []relationshipIdentityConflict, error) {
	safe := make([]relationshipIdentitySignal, 0, len(signals))
	conflicts := make([]relationshipIdentityConflict, 0)
	for _, signal := range dedupeRelationshipIdentitySignals(signals) {
		identity, err := client.RelationshipIdentity.Query().Where(
			relationshipidentity.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			relationshipidentity.KeyHashEQ(signal.KeyHash),
		).WithRelationship().Only(ctx)
		if ent.IsNotFound(err) {
			safe = append(safe, signal)
			continue
		}
		if err != nil {
			return nil, nil, err
		}
		owner, err := identity.Edges.RelationshipOrErr()
		if err != nil {
			return nil, nil, err
		}
		if owner.ID == proposed.ID {
			safe = append(safe, signal)
			continue
		}
		conflicts = append(conflicts, relationshipIdentityConflict{signal: signal, owner: owner})
	}
	return safe, conflicts, nil
}

func removeConflictingIdentityFields(input RelationshipObservationInput, conflicts []relationshipIdentityConflict) RelationshipObservationInput {
	blocked := make(map[string]struct{}, len(conflicts))
	for _, conflict := range conflicts {
		blocked[conflict.signal.KeyHash] = struct{}{}
	}
	if _, blockedEmail := blocked[newRelationshipIdentitySignal("email", "", strings.ToLower(strings.TrimSpace(input.PrimaryEmail)), 1).KeyHash]; blockedEmail && input.PrimaryEmail != "" {
		input.PrimaryEmail = ""
	}
	if _, blockedDomain := blocked[newRelationshipIdentitySignal("domain", "", strings.ToLower(strings.TrimSpace(input.AccountDomain)), 0.9).KeyHash]; blockedDomain && input.AccountDomain != "" {
		input.AccountDomain = ""
	}
	refs := make([]string, 0, len(input.ResourceRefs))
	for _, ref := range input.ResourceRefs {
		normalized, err := normalizeResourceRefs([]string{ref})
		if err != nil || len(normalized) == 0 {
			continue
		}
		signal := newRelationshipIdentitySignal("resource_ref", strings.SplitN(normalized[0], ":", 2)[0], normalized[0], 1)
		if _, isBlocked := blocked[signal.KeyHash]; !isBlocked {
			refs = append(refs, normalized[0])
		}
	}
	input.ResourceRefs = refs
	return input
}

func createProposedRelationship(ctx context.Context, client *ent.Client, ws *ent.RevenueWorkspace, u *ent.User, input RelationshipObservationInput) (*ent.Relationship, error) {
	displayName := strings.TrimSpace(input.DisplayName)
	if displayName == "" {
		displayName = "Identity review required"
	}
	kind := strings.TrimSpace(input.PreferredKind)
	if kind == "" {
		kind = "company"
		if strings.TrimSpace(input.PrimaryEmail) != "" && (strings.TrimSpace(input.AccountDomain) == "" || isPublicMailboxDomain(input.AccountDomain)) {
			kind = "person"
		}
	}
	return client.Relationship.Create().SetWorkspace(ws).SetUser(u).SetKind(kind).SetDisplayName(displayName).Save(ctx)
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
				if _, candidateErr := createIdentityCandidate(
					ctx, client, ws, u, rel, owner, signal, "anchor_collision", seenAt,
				); candidateErr != nil {
					return candidateErr
				}
				continue
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
		err = client.RelationshipIdentity.Create().
			SetWorkspace(ws).SetRelationship(rel).SetUser(u).
			SetKind(signal.Kind).SetProvider(signal.Provider).
			SetKeyHash(signal.KeyHash).SetNormalizedValue(signal.Value).
			SetSource(source).SetConfidence(signal.Confidence).
			SetFirstSeenAt(seenAt.UTC()).SetLastSeenAt(seenAt.UTC()).
			OnConflict(
				entsql.ConflictColumns(
					relationshipidentity.FieldKeyHash,
					relationshipidentity.WorkspaceColumn,
				),
				entsql.DoNothing(),
			).Exec(ctx)
		if err != nil {
			return err
		}
		// Read the winner after the conflict-safe insert. This works for both the
		// inserting transaction and a concurrent claimant without relying on a
		// statement error (which would abort PostgreSQL's surrounding transaction).
		winner, err := client.RelationshipIdentity.Query().Where(
			relationshipidentity.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			relationshipidentity.KeyHashEQ(signal.KeyHash),
		).WithRelationship().Only(ctx)
		if err != nil {
			return err
		}
		owner, err := winner.Edges.RelationshipOrErr()
		if err != nil {
			return err
		}
		if owner.ID != rel.ID {
			if _, err := createIdentityCandidate(ctx, client, ws, u, rel, owner, signal, "anchor_collision", seenAt); err != nil {
				return err
			}
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
		return fmt.Errorf("%w: participant external refs: %w", ErrInvalidInput, err)
	}
	if email == "" && name == "" && len(refs) == 0 {
		return nil
	}
	matches := map[uuid.UUID]*ent.RelationshipParticipant{}
	// Rows that are the same human recorded twice under one email. Folded into the
	// canonical pick below rather than counted as separate identities.
	duplicates := map[uuid.UUID]struct{}{}
	if email != "" {
		// .All, not .Only: (relationship_id, email) is not a unique index, and
		// duplicates are reachable through the backfill a few lines down, which
		// sets an email on a row whose address another row already holds. .Only
		// returns NotSingularError, which is not ent.IsNotFound, so this branch
		// used to return it -- and every later observation for this relationship
		// failed permanently, with no way to recover short of editing the table.
		//
		// Duplicates are one person recorded twice, not an identity conflict.
		// Collapse to the oldest so the choice is stable across retries, and leave
		// the >1 check below for the real conflict it was written for: an email
		// and a provider ref pointing at genuinely different people. Collapsing
		// the rows themselves belongs to the participant backfill, not here.
		existing, queryErr := client.RelationshipParticipant.Query().
			Where(
				relationshipparticipant.HasRelationshipWith(relationship.IDEQ(rel.ID)),
				relationshipparticipant.EmailEQ(email),
			).
			Order(
				ent.Asc(relationshipparticipant.FieldCreatedAt),
				ent.Asc(relationshipparticipant.FieldID),
			).
			All(ctx)
		if queryErr != nil {
			return queryErr
		}
		for index, participant := range existing {
			if index == 0 {
				matches[participant.ID] = participant
				continue
			}
			duplicates[participant.ID] = struct{}{}
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
			// A ref that lands on a folded duplicate resolves to the same person
			// the email already matched; counting it would resurrect the false
			// conflict this fix exists to remove.
			if _, dup := duplicates[participant.ID]; dup {
				continue
			}
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
	var err error
	input, err = normalizeRelationshipAssertionInput(input)
	if err != nil {
		return nil, err
	}
	if observation == nil && input.SourceType != "user_correction" &&
		(input.SourceType != "external_research" || strings.TrimSpace(input.CitationsJSON) == "") {
		return nil, fmt.Errorf("%w: accepted assertion requires source evidence or an explicit user action", ErrInvalidInput)
	}
	if input.ValidFrom.IsZero() {
		input.ValidFrom = time.Now().UTC()
	}
	input.ValidFrom = input.ValidFrom.UTC()
	if input.ValidTo != nil {
		validTo := input.ValidTo.UTC()
		if !validTo.After(input.ValidFrom) {
			return nil, fmt.Errorf("%w: assertion validTo must be after validFrom", ErrInvalidInput)
		}
		input.ValidTo = &validTo
	}
	if input.SourceType == "user_correction" {
		input.Confidence = 1
	}
	if strings.TrimSpace(input.ExtractorVersion) == "" {
		input.ExtractorVersion = input.SourceType + "-v1"
	}
	if input.ProjectorCompatVersion == 0 {
		input.ProjectorCompatVersion = relationshipProjectorVersion
	}
	create := client.RelationshipAssertion.Create().
		SetWorkspace(ws).
		SetRelationship(rel).
		SetUser(u).
		SetDimension(strings.TrimSpace(input.Dimension)).
		SetValue(strings.TrimSpace(input.Value)).
		SetSourceType(input.SourceType).
		SetStatus(input.status).
		SetAuthorityRank(input.AuthorityRank).
		SetConfidence(input.Confidence).
		SetReason(input.Reason).
		SetValidFrom(input.ValidFrom).
		SetValueSchemaVersion(input.ValueSchemaVersion).
		SetExtractorVersion(strings.TrimSpace(input.ExtractorVersion)).
		SetProjectorCompatVersion(input.ProjectorCompatVersion)
	if input.admission == relationshipAssertionAdmissionUserCorrection {
		reviewedAt := input.reviewedAt
		if reviewedAt.IsZero() {
			reviewedAt = time.Now().UTC()
		}
		create.SetReviewerID(u.ID).
			SetReviewDecision(relationshipAssertionStatusAccepted).
			SetReviewedAt(reviewedAt)
	}
	if input.ValidTo != nil {
		create.SetValidTo(*input.ValidTo)
	}
	if strings.TrimSpace(input.CitationsJSON) != "" {
		create.SetCitationsJSON(strings.TrimSpace(input.CitationsJSON))
	}
	if strings.TrimSpace(input.SupersedesAssertionID) != "" {
		create.SetSupersedesAssertionID(strings.TrimSpace(input.SupersedesAssertionID))
	}
	if input.ID != uuid.Nil {
		create.SetID(input.ID)
	}
	if observation != nil {
		create.SetObservation(observation).
			SetSupportingObservationIds([]string{observation.ID.String()})
	}
	assertion, err := create.Save(ctx)
	if err != nil && isValidationError(err) {
		return nil, fmt.Errorf("%w: %w", ErrInvalidInput, err)
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
	input.Source = canonicalSource(input.Source)
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
	if ent.IsNotFound(err) && accountID != "default" {
		// Consent callbacks do not always expose a provider account identifier.
		// Reuse their stable default connection when the first provider event
		// supplies the real account, avoiding a duplicate lifecycle card.
		status, err = client.RelationshipSourceStatus.Query().Where(
			relationshipsourcestatus.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
			relationshipsourcestatus.SourceEQ(input.Source),
			relationshipsourcestatus.SourceAccountIDEQ("default"),
		).Only(ctx)
	}
	if err == nil {
		// Disconnect is sticky. A delayed webhook may still be accepted as immutable
		// evidence, but it cannot silently claim the credential/source is live again.
		if status.Status == "disconnected" || status.Status == "reconnect_required" ||
			status.DisconnectedAt != nil || status.RevokedAt != nil || len(status.MissingScopes) > 0 {
			return nil
		}
		update := status.Update().
			SetLastSuccessAt(input.ReceivedAt.UTC()).
			SetLastObservationAt(input.OccurredAt.UTC()).
			SetLastProviderEventAt(input.OccurredAt.UTC()).
			SetLastSyncAt(input.ReceivedAt.UTC()).
			SetLagSeconds(0).
			ClearLastError().
			ClearErrorCode()
		if status.BackfillPhase == "queued" || status.BackfillPhase == "running" {
			update.SetStatus("backfilling").SetCompleteness("partial")
		} else {
			update.SetStatus("live").SetAuthorizedAt(input.ReceivedAt.UTC())
			if status.BackfillPhase == "live" {
				update.SetCompleteness("complete")
			} else {
				update.SetCompleteness("partial")
			}
		}
		_, err = update.Save(ctx)
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
		SetConsentingActorID(u.ID).
		SetStatus("live").
		SetBackfillPhase("idle").
		SetCompleteness("partial").
		SetExpectedCadenceSeconds(sourceDescriptor(canonicalSource(input.Source)).ExpectedCadenceSec).
		SetLastSuccessAt(input.ReceivedAt.UTC()).
		SetLastSyncAt(input.ReceivedAt.UTC()).
		SetLastObservationAt(input.OccurredAt.UTC()).
		SetLastProviderEventAt(input.OccurredAt.UTC()).
		SetAuthorizedAt(input.ReceivedAt.UTC()).
		Save(ctx)
	return err
}

// assertionPriority ranks the provenance ladder shared by RelationshipAssertion
// and PersonAttribute:
//
//	user_correction > source_fact > deterministic > external_research > ai_inference
//
// external_research (RFC 039) sits above ai_inference because it carries
// citations a user can click, and below deterministic because a vendor's read of
// a web page is weaker than something computed from data we own.
//
// The numbers are ordinal and compared only against each other — nothing
// persists them — but the STRINGS must match the schema validators exactly. A
// tier name that does not match falls to the default and silently becomes the
// weakest thing in the system rather than failing loudly, which is how a
// misspelled tier ends up losing to the ai_inference it was meant to outrank.
func assertionPriority(sourceType string) int {
	rank, ok := relationshipAssertionAuthorityRank(sourceType)
	if !ok {
		// Person attributes share this helper and preserve their legacy behavior
		// until their schema gains the same fail-closed authority metadata.
		return 1
	}
	return rank
}

var relationshipProjectionDimensions = [...]string{
	"lifecycle", "engagement", "sentiment", "health", "summary", "next_action", "risk", "milestone",
}

type relationshipProjectionHashState struct {
	Lifecycle  string   `json:"lifecycle"`
	Engagement string   `json:"engagement"`
	Sentiment  string   `json:"sentiment"`
	Health     string   `json:"health"`
	Summary    string   `json:"summary"`
	NextAction string   `json:"nextAction"`
	Risks      []string `json:"risks"`
	Milestones []string `json:"milestones"`
}

type relationshipProjectionHashWinner struct {
	Dimension   string `json:"dimension"`
	AssertionID string `json:"assertionId"`
}

type relationshipProjectionHashEnvelope struct {
	ProjectorVersion int                                `json:"projectorVersion"`
	State            relationshipProjectionHashState    `json:"state"`
	Winners          []relationshipProjectionHashWinner `json:"winners"`
}

func projectRelationshipStateAt(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	rel *ent.Relationship,
	evaluatedAt time.Time,
) (*ent.Relationship, error) {
	evaluatedAt = evaluatedAt.UTC()
	rel, err := reconcileRelationshipLastTouch(ctx, client, rel)
	if err != nil {
		return nil, err
	}
	assertions, err := client.RelationshipAssertion.Query().
		Where(relationshipassertion.HasRelationshipWith(relationship.IDEQ(rel.ID))).
		All(ctx)
	if err != nil {
		return nil, err
	}
	selected, seenDimensions, err := selectRelationshipAssertionsAt(assertions, evaluatedAt)
	if err != nil {
		return nil, err
	}

	current := RelationshipState{
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
	next := RelationshipState{
		Lifecycle:    current.Lifecycle,
		Engagement:   current.Engagement,
		Sentiment:    current.Sentiment,
		Health:       current.Health,
		Summary:      current.Summary,
		NextAction:   current.NextAction,
		StateReason:  current.StateReason,
		Risks:        append([]string(nil), current.Risks...),
		Milestones:   append([]string(nil), current.Milestones...),
		StateVersion: current.StateVersion,
	}
	for dimension := range seenDimensions {
		resetRelationshipProjectionDimension(&next, dimension)
	}
	apply := func(dimension string, target *string) {
		if assertion := selected[dimension]; assertion != nil {
			*target = assertion.Value
		}
	}
	apply("lifecycle", &next.Lifecycle)
	apply("engagement", &next.Engagement)
	apply("sentiment", &next.Sentiment)
	apply("health", &next.Health)
	apply("summary", &next.Summary)
	apply("next_action", &next.NextAction)
	if assertion := selected["risk"]; assertion != nil {
		next.Risks = []string{assertion.Value}
	}
	if assertion := selected["milestone"]; assertion != nil {
		next.Milestones = []string{assertion.Value}
	}

	changed := relationshipStateChangedDimensions(current, next)
	stateHash, assertionIDs, err := relationshipProjectionHash(next, selected)
	if err != nil {
		return nil, err
	}
	if len(changed) == 0 && rel.StateHash == "" {
		return rel.Update().
			SetStateHash(stateHash).
			SetProjectorVersion(relationshipProjectorVersion).
			SetProjectedAt(evaluatedAt).
			Save(ctx)
	}
	if len(changed) == 0 && rel.StateHash == stateHash && rel.ProjectorVersion == relationshipProjectorVersion {
		return rel.Update().SetProjectedAt(evaluatedAt).Save(ctx)
	}
	if len(changed) == 0 {
		changed = append(changed, "evidence")
	}
	sort.Strings(changed)
	reasons := make([]string, 0, len(changed))
	for _, dimension := range changed {
		if dimension == "evidence" {
			reasons = append(reasons, "Supporting evidence changed.")
			continue
		}
		key := strings.TrimSuffix(dimension, "s")
		if assertion := selected[key]; assertion != nil {
			if assertion.Reason != "" {
				reasons = append(reasons, assertion.Reason)
			}
		} else {
			reasons = append(reasons, "No active "+strings.ReplaceAll(key, "_", " ")+" assertion at evaluation time.")
		}
	}
	next.StateVersion++
	next.StateReason = strings.Join(reasons, " ")
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
		SetStateHash(stateHash).
		SetProjectorVersion(relationshipProjectorVersion).
		SetProjectedAt(evaluatedAt).
		SetLastChangedAt(evaluatedAt).
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
		SetStateHash(stateHash).
		SetProjectorVersion(relationshipProjectorVersion).
		SetEvaluatedAt(evaluatedAt).
		SetChangedDimensions(changed).
		SetAssertionIds(assertionIDs).
		Save(ctx)
	return updated, err
}

// selectRelationshipAssertionsAt is shared by projection and Mission Control,
// guaranteeing that a rendered evidence winner is the exact assertion that
// produced the state hash at the same evaluation boundary.
func selectRelationshipAssertionsAt(
	assertions []*ent.RelationshipAssertion,
	evaluatedAt time.Time,
) (map[string]*ent.RelationshipAssertion, map[string]struct{}, error) {
	seenDimensions := make(map[string]struct{}, len(relationshipProjectionDimensions))
	superseded := make(map[string]struct{})
	eligible := make([]*ent.RelationshipAssertion, 0, len(assertions))
	for _, assertion := range assertions {
		if assertion.ProjectorCompatVersion > relationshipProjectorVersion {
			return nil, nil, fmt.Errorf(
				"%w: assertion %s requires projector compatibility version %d",
				ErrReviewRequired, assertion.ID, assertion.ProjectorCompatVersion,
			)
		}
		expectedRank, knownSourceType := relationshipAssertionAuthorityRank(assertion.SourceType)
		if !knownSourceType {
			return nil, nil, fmt.Errorf(
				"%w: assertion %s has inconsistent authority metadata",
				ErrReviewRequired, assertion.ID,
			)
		}
		if assertion.Status == relationshipAssertionStatusLegacyActive {
			// A pre-R1.1 binary writing during a rolling deployment receives the
			// additive database default. Derive the authoritative rank from its
			// already-validated source type without mutating the immutable row.
			legacy := *assertion
			legacy.AuthorityRank = expectedRank
			assertion = &legacy
		} else if assertion.AuthorityRank != expectedRank {
			return nil, nil, fmt.Errorf(
				"%w: assertion %s has inconsistent authority metadata",
				ErrReviewRequired, assertion.ID,
			)
		}
		if assertion.ValueSchemaVersion != relationshipAssertionValueSchemaVersion {
			return nil, nil, fmt.Errorf(
				"%w: assertion %s uses unsupported value schema version %d",
				ErrReviewRequired, assertion.ID, assertion.ValueSchemaVersion,
			)
		}
		if valueErr := validateRelationshipAssertionValue(
			assertion.Dimension, assertion.Value, assertion.ValueSchemaVersion,
		); valueErr != nil {
			return nil, nil, fmt.Errorf(
				"%w: assertion %s failed its typed value contract: %w",
				ErrReviewRequired, assertion.ID, valueErr,
			)
		}
		eligibleAtEvaluation, validLifecycle := relationshipAssertionEligibleAt(
			assertion.Status, assertion.ValidFrom, assertion.ValidTo, evaluatedAt,
		)
		if !validLifecycle {
			return nil, nil, fmt.Errorf(
				"%w: assertion %s has inconsistent lifecycle metadata",
				ErrReviewRequired, assertion.ID,
			)
		}
		if assertion.Status == relationshipAssertionStatusProposed || assertion.Status == relationshipAssertionStatusRejected {
			continue
		}
		seenDimensions[assertion.Dimension] = struct{}{}
		if !eligibleAtEvaluation {
			continue
		}
		eligible = append(eligible, assertion)
		if assertion.SupersedesAssertionID != "" {
			superseded[assertion.SupersedesAssertionID] = struct{}{}
		}
	}
	sort.SliceStable(eligible, func(i, j int) bool {
		left, right := eligible[i], eligible[j]
		lp, rp := left.AuthorityRank, right.AuthorityRank
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
	for _, assertion := range eligible {
		if _, isSuperseded := superseded[assertion.ID.String()]; isSuperseded {
			continue
		}
		if selected[assertion.Dimension] == nil {
			selected[assertion.Dimension] = assertion
		}
	}
	return selected, seenDimensions, nil
}

func resetRelationshipProjectionDimension(state *RelationshipState, dimension string) {
	switch dimension {
	case "lifecycle":
		state.Lifecycle = "prospect"
	case "engagement":
		state.Engagement = "unknown"
	case "sentiment":
		state.Sentiment = "unknown"
	case "health":
		state.Health = "unknown"
	case "summary":
		state.Summary = ""
	case "next_action":
		state.NextAction = ""
	case "risk":
		state.Risks = []string{}
	case "milestone":
		state.Milestones = []string{}
	}
}

func relationshipStateChangedDimensions(current, next RelationshipState) []string {
	changed := make([]string, 0, len(relationshipProjectionDimensions))
	if current.Lifecycle != next.Lifecycle {
		changed = append(changed, "lifecycle")
	}
	if current.Engagement != next.Engagement {
		changed = append(changed, "engagement")
	}
	if current.Sentiment != next.Sentiment {
		changed = append(changed, "sentiment")
	}
	if current.Health != next.Health {
		changed = append(changed, "health")
	}
	if current.Summary != next.Summary {
		changed = append(changed, "summary")
	}
	if current.NextAction != next.NextAction {
		changed = append(changed, "next_action")
	}
	if !equalStrings(current.Risks, next.Risks) {
		changed = append(changed, "risks")
	}
	if !equalStrings(current.Milestones, next.Milestones) {
		changed = append(changed, "milestones")
	}
	return changed
}

func relationshipProjectionHash(
	state RelationshipState,
	selected map[string]*ent.RelationshipAssertion,
) (string, []string, error) {
	winners := make([]relationshipProjectionHashWinner, 0, len(selected))
	assertionIDs := make([]string, 0, len(selected))
	for _, dimension := range relationshipProjectionDimensions {
		assertion := selected[dimension]
		if assertion == nil {
			continue
		}
		id := assertion.ID.String()
		winners = append(winners, relationshipProjectionHashWinner{Dimension: dimension, AssertionID: id})
		assertionIDs = append(assertionIDs, id)
	}
	payload, err := json.Marshal(relationshipProjectionHashEnvelope{
		ProjectorVersion: relationshipProjectorVersion,
		State: relationshipProjectionHashState{
			Lifecycle:  state.Lifecycle,
			Engagement: state.Engagement,
			Sentiment:  state.Sentiment,
			Health:     state.Health,
			Summary:    state.Summary,
			NextAction: state.NextAction,
			Risks:      append([]string(nil), state.Risks...),
			Milestones: append([]string(nil), state.Milestones...),
		},
		Winners: winners,
	})
	if err != nil {
		return "", nil, err
	}
	digest := sha256.Sum256(payload)
	return "sha256:" + hex.EncodeToString(digest[:]), assertionIDs, nil
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
	ValidTo               *time.Time
}

// CorrectRelationship appends a user correction and its projection job in one
// transaction. The inline projection is only a fast path; an incompatible or
// temporarily failing projector cannot roll back the accepted correction.
func (s *Service) CorrectRelationship(
	ctx context.Context,
	u *ent.User,
	relationshipID uuid.UUID,
	input RelationshipCorrectionInput,
) (*ent.Relationship, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceContribute)
	if err != nil {
		return nil, err
	}
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	rollback := func(cause error) (*ent.Relationship, error) {
		_ = tx.Rollback()
		return nil, cause
	}
	txc := tx.Client()
	rel, err := txc.Relationship.Get(ctx, relationshipID)
	if ent.IsNotFound(err) {
		return rollback(ErrNotFound)
	}
	if err != nil {
		return rollback(err)
	}
	evaluatedAt := s.now().UTC()
	var superseded *ent.RelationshipAssertion
	if rawID := strings.TrimSpace(input.SupersedesAssertionID); rawID != "" {
		assertionID, parseErr := uuid.Parse(rawID)
		if parseErr != nil {
			return rollback(fmt.Errorf("%w: invalid supersedesAssertionId", ErrInvalidInput))
		}
		superseded, err = txc.RelationshipAssertion.Query().
			Where(
				relationshipassertion.IDEQ(assertionID),
				relationshipassertion.StatusIn(relationshipAssertionStatusAccepted, relationshipAssertionStatusLegacyActive),
				relationshipassertion.HasRelationshipWith(relationship.IDEQ(rel.ID)),
			).
			Only(ctx)
		if ent.IsNotFound(err) {
			return rollback(fmt.Errorf("%w: superseded assertion is not active on this relationship", ErrInvalidInput))
		}
		if err != nil {
			return rollback(err)
		}
		if superseded.Dimension != strings.TrimSpace(input.Dimension) {
			return rollback(fmt.Errorf("%w: superseded assertion dimension does not match correction", ErrInvalidInput))
		}
	}
	created, err := createRelationshipAssertion(ctx, txc, ws, u, rel, nil, RelationshipAssertionInput{
		Dimension:              input.Dimension,
		Value:                  input.Value,
		SourceType:             "user_correction",
		Confidence:             1,
		Reason:                 input.Reason,
		ValidFrom:              evaluatedAt,
		ValidTo:                input.ValidTo,
		SupersedesAssertionID:  strings.TrimSpace(input.SupersedesAssertionID),
		ExtractorVersion:       "user-correction-v1",
		ProjectorCompatVersion: relationshipProjectorVersion,
		admission:              relationshipAssertionAdmissionUserCorrection,
		reviewedAt:             evaluatedAt,
	})
	if err != nil {
		return rollback(err)
	}
	if superseded != nil {
		if _, err := superseded.Update().
			SetStatus(relationshipAssertionStatusSuperseded).
			SetValidTo(evaluatedAt).
			Save(ctx); err != nil {
			return rollback(err)
		}
	}
	triggerRefs := []string{"relationship-assertion:" + created.ID.String()}
	job, err := s.enqueueRelationshipProjectionTx(ctx, txc, ws, u, rel, evaluatedAt, triggerRefs)
	if err != nil {
		return rollback(err)
	}
	if err := appendTrustEvent(ctx, txc, ws, u, TrustEventInput{
		Name: "correction_applied", Outcome: "corrected",
		ReasonCode: "user_correction", CorrelationID: triggerRefs[0],
		OccurredAt: evaluatedAt, Relationship: rel,
	}); err != nil {
		return rollback(err)
	}
	if input.ValidTo != nil && input.ValidTo.After(evaluatedAt) {
		if _, err := s.enqueueRelationshipProjectionTx(
			ctx, txc, ws, u, rel, input.ValidTo.UTC(), append(triggerRefs, "temporal-boundary"),
		); err != nil {
			return rollback(err)
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	updated, status, projectErr := s.ProcessRelationshipProjectionJob(
		ctx, u, job.ID, "inline-relationship-projector-"+uuid.NewString(),
	)
	if projectErr != nil {
		s.log.Warn("relationship correction projection deferred",
			zap.String("relationship", rel.ID.String()), zap.String("job", job.ID.String()),
			zap.String("status", status), zap.Error(projectErr))
		return rel.Unwrap(), nil
	}
	return updated, nil
}

// RetractRelationshipAssertion ends one active user correction and durably
// requests projection at the same evaluation time.
// Source facts are never rewritten through this path; a user who disagrees
// with a source appends a higher-authority correction instead.
func (s *Service) RetractRelationshipAssertion(
	ctx context.Context,
	u *ent.User,
	relationshipID uuid.UUID,
	assertionID uuid.UUID,
	reason string,
) (*ent.Relationship, error) {
	if strings.TrimSpace(reason) == "" {
		return nil, fmt.Errorf("%w: retraction reason is required", ErrInvalidInput)
	}
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceContribute)
	if err != nil {
		return nil, err
	}
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	rollback := func(cause error) (*ent.Relationship, error) {
		_ = tx.Rollback()
		return nil, cause
	}
	txc := tx.Client()
	rel, err := txc.Relationship.Get(ctx, relationshipID)
	if ent.IsNotFound(err) {
		return rollback(ErrNotFound)
	}
	if err != nil {
		return rollback(err)
	}
	assertion, err := txc.RelationshipAssertion.Query().
		Where(
			relationshipassertion.IDEQ(assertionID),
			relationshipassertion.HasRelationshipWith(relationship.IDEQ(rel.ID)),
		).
		Only(ctx)
	if ent.IsNotFound(err) {
		return rollback(ErrNotFound)
	}
	if err != nil {
		return rollback(err)
	}
	if assertion.SourceType != "user_correction" {
		return rollback(fmt.Errorf("%w: only user corrections can be retracted", ErrInvalidInput))
	}
	if assertion.Status == relationshipAssertionStatusRetracted {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return rel.Unwrap(), nil
	}
	if assertion.Status != relationshipAssertionStatusAccepted && assertion.Status != relationshipAssertionStatusLegacyActive {
		return rollback(fmt.Errorf("%w: assertion is no longer active", ErrConflict))
	}
	evaluatedAt := s.now().UTC()
	if _, err := assertion.Update().
		SetStatus(relationshipAssertionStatusRetracted).
		SetValidTo(evaluatedAt).
		SetRetractedAt(evaluatedAt).
		SetRetractionReason(strings.TrimSpace(reason)).
		Save(ctx); err != nil {
		return rollback(err)
	}
	job, err := s.enqueueRelationshipProjectionTx(
		ctx, txc, ws, u, rel, evaluatedAt,
		[]string{"relationship-assertion-retraction:" + assertion.ID.String()},
	)
	if err != nil {
		return rollback(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	updated, status, projectErr := s.ProcessRelationshipProjectionJob(
		ctx, u, job.ID, "inline-relationship-projector-"+uuid.NewString(),
	)
	if projectErr != nil {
		s.log.Warn("relationship retraction projection deferred",
			zap.String("relationship", rel.ID.String()), zap.String("job", job.ID.String()),
			zap.String("status", status), zap.Error(projectErr))
		return rel.Unwrap(), nil
	}
	return updated, nil
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
		WithWorkspace().
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
	ws, edgeErr := observation.Edges.WorkspaceOrErr()
	if edgeErr != nil {
		return nil, nil, edgeErr
	}
	if s.evidenceKeys == nil {
		return nil, nil, ErrEvidenceEncryptionUnavailable
	}
	payload, err := s.evidenceKeys.Open(
		ctx, ws.ID, observation.EncryptionKeyVersion, observation.PayloadCiphertext,
	)
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
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceView)
	if err != nil {
		return nil, err
	}
	statuses, err := s.client.RelationshipSourceStatus.Query().
		Where(relationshipsourcestatus.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID))).
		Order(
			ent.Asc(relationshipsourcestatus.FieldSource),
			ent.Asc(relationshipsourcestatus.FieldSourceAccountID),
		).
		All(ctx)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	for _, status := range statuses {
		applySourceFreshness(status, now)
	}
	return statuses, nil
}

// reconcileRelationshipLastTouch recomputes last_touch_at from the observation set.
//
// The ingest path bumps it monotonically for freshness; this makes it converge. A
// high-water mark alone would be wrong after conversation deletion removes
// observations, or after a merge re-parents them onto another relationship: the
// account would keep claiming a touch that no evidence supports.
//
// Deliberately NOT part of relationshipProjectionHash. It is an evidence-freshness
// fact, not a projected state dimension, and including it would bump state_version
// and write a "state changed" snapshot on every single observation.
func reconcileRelationshipLastTouch(
	ctx context.Context,
	client *ent.Client,
	rel *ent.Relationship,
) (*ent.Relationship, error) {
	latest, err := client.RelationshipObservation.Query().
		Where(relationshipobservation.HasRelationshipWith(relationship.IDEQ(rel.ID))).
		Order(ent.Desc(relationshipobservation.FieldOccurredAt)).
		First(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return nil, err
	}
	if ent.IsNotFound(err) {
		// No evidence left. Clearing is the honest answer; leaving a stale value
		// would let a deleted conversation keep an account looking recently active.
		if rel.LastTouchAt == nil {
			return rel, nil
		}
		return rel.Update().ClearLastTouchAt().Save(ctx)
	}
	truth := latest.OccurredAt.UTC()
	if rel.LastTouchAt != nil && rel.LastTouchAt.UTC().Equal(truth) {
		return rel, nil
	}
	return rel.Update().SetLastTouchAt(truth).Save(ctx)
}
