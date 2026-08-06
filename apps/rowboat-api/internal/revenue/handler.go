package revenue

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
)

// maxBody bounds revenue request bodies; every payload is a small envelope.
const maxBody = 256 << 10

// Canonical transcript observations repeat bounded quote evidence beside their
// encrypted envelope, so they need a larger—but still explicit—ingestion ceiling.
const maxObservationBody = 4 << 20

// Handler serves the RFC 030 revenue API surface.
type Handler struct {
	svc *Service
	log *zap.Logger
}

// NewHandler builds the revenue HTTP handler.
func NewHandler(svc *Service, log *zap.Logger) *Handler {
	return &Handler{svc: svc, log: log}
}

// MountPublic exposes the single-plan, token-scoped response surface. Tokens travel in
// a header so access logs never receive them as URL path or query parameters.
func (h *Handler) MountPublic(r chi.Router) {
	r.Get("/v1/public/mutual-action-plan", h.GetPublicMutualActionPlan)
	r.Post("/v1/public/mutual-action-plan/responses", h.ReceivePublicMutualActionPlanResponse)
}

// Mount registers the revenue routes on an authenticated router group.
func (h *Handler) Mount(r chi.Router) {
	r.Route("/v1/revenue-workspaces", func(r chi.Router) {
		r.Get("/current", h.CurrentWorkspace)
		r.Post("/link", h.LinkWorkspace)
		r.Get("/current/members", h.ListWorkspaceMembers)
		r.Put("/current/members/{userId}", h.UpsertWorkspaceMember)
		r.Delete("/current/members/{membershipId}", h.RemoveWorkspaceMember)
		r.Get("/current/evidence-keys", h.TenantEvidenceKeyStatuses)
		r.Post("/current/evidence-keys/rotate", h.RotateTenantEvidenceKey)
		r.Post("/current/evidence-keys/destroy", h.DestroyTenantEvidenceKeys)
		r.Get("/current/features", h.WorkspaceFeatureControls)
		r.Put("/current/features/{capability}", h.SetWorkspaceFeatureControl)
	})
	r.Get("/v1/revenue-impact", h.Impact)
	r.Get("/v1/revenue-digest", h.Digest)
	r.Get("/v1/revenue-search", h.SemanticSearch)
	r.Route("/v1/revenue-leak-scans", func(r chi.Router) {
		r.Post("/", h.StartScan)
		r.Get("/{scanId}", h.GetScan)
	})
	r.Route("/v1/relationships", func(r chi.Router) {
		r.Get("/", h.ListRelationships)
		r.Post("/", h.CreateRelationship)
		r.Get("/graph", h.RelationshipGraph)
		r.Get("/{relationshipId}", h.GetRelationship)
		r.Get("/{relationshipId}/timeline", h.RelationshipTimeline)
		r.Get("/{relationshipId}/changes", h.RelationshipChanges)
		r.Post("/{relationshipId}/acknowledgements", h.AcknowledgeMissionControl)
		r.Get("/{relationshipId}/evidence/{evidenceId}", h.RelationshipEvidence)
		r.Post("/{relationshipId}/corrections", h.CorrectRelationship)
		r.Post("/{relationshipId}/assertions/{assertionId}/retract", h.RetractRelationshipAssertion)
		r.Post("/{relationshipId}/conversation-corrections", h.CorrectConversationReview)
		r.Post("/{relationshipId}/conversation-decisions", h.DecideConversationReview)
		r.Post("/{relationshipId}/contradictions/{caseId}/resolve", h.ResolveContradiction)
		r.Post("/{relationshipId}/commitment-recovery/run", h.RunCommitmentRecovery)
		r.Get("/{relationshipId}/commitments/{commitmentId}/events", h.CommitmentEvents)
		r.Post("/{relationshipId}/commitments/{commitmentId}/transitions", h.AppendCommitmentTransition)
		r.Post("/{relationshipId}/commitment-dependencies", h.CreateCommitmentDependency)
		r.Post("/{relationshipId}/mutual-action-plans", h.CreateMutualActionPlan)
		r.Put("/{relationshipId}/mutual-action-plans/{planId}", h.ReviseMutualActionPlan)
		r.Post("/{relationshipId}/mutual-action-plans/{planId}/approve", h.ApproveMutualActionPlan)
		r.Post("/{relationshipId}/mutual-action-plans/{planId}/share", h.ShareMutualActionPlan)
		r.Get("/{relationshipId}/conversation-policy", h.GetConversationPolicy)
		r.Put("/{relationshipId}/conversation-policy", h.PutConversationPolicy)
		r.Post("/{relationshipId}/conversation-deletion", h.RequestConversationDeletion)
	})
	r.Post("/v1/relationship-observations/batch", h.IngestRelationshipObservations)
	r.Route("/v1/relationship-identity-candidates", func(r chi.Router) {
		r.Get("/", h.ListIdentityCandidates)
		r.Get("/{candidateId}", h.GetIdentityCandidate)
		r.Post("/{candidateId}/decisions", h.DecideIdentityCandidate)
	})
	// The workspace-canonical person. Deliberately symmetric with the relationship
	// surface above: corrections and retractions mirror /v1/relationships/{id}, and
	// merge candidates mirror the identity-candidate review contract.
	r.Route("/v1/relationship-persons", func(r chi.Router) {
		r.Get("/", h.ListPersons)
		r.Get("/{personId}", h.GetPerson)
		r.Get("/{personId}/attributes", h.PersonAttributes)
		r.Get("/{personId}/interactions", h.PersonInteractions)
		r.Post("/{personId}/corrections", h.CorrectPerson)
		r.Post("/{personId}/attributes/{attributeId}/retract", h.RetractPersonAttribute)
		r.Delete("/{personId}", h.DeletePerson)
	})
	r.Route("/v1/relationship-person-merge-candidates", func(r chi.Router) {
		r.Get("/", h.ListPersonMergeCandidates)
		r.Post("/{candidateId}/decisions", h.DecidePersonMergeCandidate)
	})
	r.Route("/v1/relationship-attention", func(r chi.Router) {
		r.Get("/", h.ListRelationshipAttention)
		r.Post("/{attentionId}/decisions", h.DecideRelationshipAttention)
	})
	r.Get("/v1/relationship-sources", h.RelationshipSourceInventory)
	r.Get("/v1/relationship-sources/status", h.RelationshipSourceStatuses)
	r.Get("/v1/relationship-beta/diagnostics", h.BetaDiagnostics)
	r.Post("/v1/relationship-sources/{source}/authorization", h.ReportSourceAuthorization)
	r.Post("/v1/relationship-sources/{source}/resync", h.BeginSourceBackfill)
	r.Post("/v1/relationship-sources/{source}/{sourceAccountId}/disconnect", h.DisconnectRelationshipSource)
	r.Route("/v1/relationship-recommendations", func(r chi.Router) {
		r.Post("/{recommendationId}/approve", h.ApproveRecommendation)
		r.Post("/{recommendationId}/reject", h.RejectRecommendation)
	})
	r.Route("/v1/revenue-actions", func(r chi.Router) {
		r.Get("/", h.ListActions)
		r.Post("/", h.CreateAction)
		r.Get("/{actionId}", h.GetAction)
		r.Get("/{actionId}/audit", h.Audit)
		r.Post("/{actionId}/evaluate", h.Evaluate)
		r.Post("/{actionId}/edit", h.Edit)
		r.Post("/{actionId}/snooze", h.Snooze)
		r.Post("/{actionId}/dismiss", h.Dismiss)
		r.Post("/{actionId}/approve", h.Approve)
		r.Post("/{actionId}/reject", h.Reject)
		r.Post("/{actionId}/execute", h.Execute)
		r.Post("/{actionId}/outcomes", h.AppendOutcome)
		r.Get("/{actionId}/source-body", h.SourceBody)
	})
}

// --- DTOs --------------------------------------------------------------------
//
// Ent marks sensitive columns (recipient email, proposed message) json:"-",
// which is right for logs but wrong for the owner reading their own queue;
// explicit DTOs restore exactly the fields the product needs and nothing else.

type workspaceDTO struct {
	ID                     string     `json:"id"`
	Mode                   string     `json:"mode"`
	Status                 string     `json:"status"`
	OutboundOrganizationID string     `json:"outboundOrganizationId,omitempty"`
	OutboundWorkspaceID    string     `json:"outboundWorkspaceId,omitempty"`
	LastVerifiedAt         *time.Time `json:"lastVerifiedAt,omitempty"`
	PreflightAvailable     bool       `json:"preflightAvailable"`
}

func (h *Handler) workspaceDTO(ws *ent.RevenueWorkspace) workspaceDTO {
	dto := workspaceDTO{
		ID:                     ws.ID.String(),
		Mode:                   ws.Mode,
		Status:                 ws.Status,
		OutboundOrganizationID: ws.OutboundOrganizationID,
		LastVerifiedAt:         ws.LastVerifiedAt,
		PreflightAvailable:     ws.Mode == ModeLinked && ws.Status == "active",
	}
	if ws.OutboundWorkspaceID != nil {
		dto.OutboundWorkspaceID = *ws.OutboundWorkspaceID
	}
	return dto
}

type relationshipDTO struct {
	ID               string     `json:"id"`
	Kind             string     `json:"kind"`
	DisplayName      string     `json:"displayName"`
	PrimaryEmail     string     `json:"primaryEmail,omitempty"`
	AccountDomain    string     `json:"accountDomain,omitempty"`
	Summary          string     `json:"summary,omitempty"`
	Status           string     `json:"status"`
	LastTouchAt      *time.Time `json:"lastTouchAt,omitempty"`
	NextActionAt     *time.Time `json:"nextActionAt,omitempty"`
	OpenActions      int        `json:"openActions,omitempty"`
	NextAction       string     `json:"nextAction,omitempty"`
	Lifecycle        string     `json:"lifecycle"`
	Engagement       string     `json:"engagement"`
	Sentiment        string     `json:"sentiment"`
	Health           string     `json:"health"`
	StateReason      string     `json:"stateReason,omitempty"`
	StateVersion     int        `json:"stateVersion"`
	StateHash        string     `json:"stateHash,omitempty"`
	ProjectorVersion int        `json:"projectorVersion"`
	ProjectedAt      *time.Time `json:"projectedAt,omitempty"`
	LastChangedAt    *time.Time `json:"lastChangedAt,omitempty"`
	Risks            []string   `json:"risks"`
	Milestones       []string   `json:"milestones"`
	ResourceRefs     []string   `json:"resourceRefs"`
}

func relationshipToDTO(rel *ent.Relationship) relationshipDTO {
	return relationshipDTO{
		ID:               rel.ID.String(),
		Kind:             rel.Kind,
		DisplayName:      rel.DisplayName,
		PrimaryEmail:     rel.PrimaryEmail,
		AccountDomain:    rel.AccountDomain,
		Summary:          rel.Summary,
		Status:           rel.Status,
		LastTouchAt:      rel.LastTouchAt,
		NextActionAt:     rel.NextActionAt,
		NextAction:       rel.NextAction,
		Lifecycle:        rel.Lifecycle,
		Engagement:       rel.Engagement,
		Sentiment:        rel.Sentiment,
		Health:           rel.Health,
		StateReason:      rel.StateReason,
		StateVersion:     rel.StateVersion,
		StateHash:        rel.StateHash,
		ProjectorVersion: rel.ProjectorVersion,
		ProjectedAt:      rel.ProjectedAt,
		LastChangedAt:    rel.LastChangedAt,
		Risks:            rel.Risks,
		Milestones:       rel.Milestones,
		ResourceRefs:     rel.ResourceRefs,
	}
}

type participantDTO struct {
	ID           string   `json:"id"`
	DisplayName  string   `json:"displayName"`
	Email        string   `json:"email,omitempty"`
	Role         string   `json:"role"`
	Title        string   `json:"title,omitempty"`
	Active       bool     `json:"active"`
	ExternalRefs []string `json:"externalRefs"`
	// The canonical human behind this role. Absent for rows the person backfill
	// has not reached yet, so clients must treat it as optional.
	PersonID string     `json:"personId,omitempty"`
	Person   *personDTO `json:"person,omitempty"`
}

// personDTO is the workspace-canonical human. Every enrichment field is projected
// from PersonAttribute rows, so each has a source, a confidence and a timestamp
// behind it — see GET /v1/relationship-persons/{id}/attributes.
type personDTO struct {
	ID           string   `json:"id"`
	DisplayName  string   `json:"displayName"`
	Aliases      []string `json:"aliases"`
	PrimaryEmail string   `json:"primaryEmail,omitempty"`
	Title        string   `json:"title,omitempty"`
	OrgName      string   `json:"orgName,omitempty"`
	OrgDomain    string   `json:"orgDomain,omitempty"`
	Timezone     string   `json:"timezone,omitempty"`
	Locale       string   `json:"locale,omitempty"`
	Status       string   `json:"status"`
	// Whether their mail still reaches them. Surfaced so the UI can say a contact
	// has left rather than silently ranking the account as merely quiet.
	EmploymentStatus   string  `json:"employmentStatus,omitempty"`
	RelationshipCount  int     `json:"relationshipCount"`
	FirstInteractionAt *string `json:"firstInteractionAt,omitempty"`
	LastInteractionAt  *string `json:"lastInteractionAt,omitempty"`
	AttributesVersion  int     `json:"attributesVersion"`
	// Phone is deliberately absent: it is derived PII with no relationship
	// dimension to land in, and it stays on the device that parsed it.
}

func personToDTO(p *ent.Person) *personDTO {
	if p == nil {
		return nil
	}
	dto := &personDTO{
		ID:                p.ID.String(),
		DisplayName:       p.DisplayName,
		Aliases:           p.Aliases,
		PrimaryEmail:      p.PrimaryEmail,
		Title:             p.Title,
		OrgName:           p.OrgName,
		OrgDomain:         p.OrgDomain,
		Timezone:          p.Timezone,
		Locale:            p.Locale,
		Status:            p.Status,
		EmploymentStatus:  p.EmploymentStatus,
		RelationshipCount: p.RelationshipCount,
		AttributesVersion: p.AttributesVersion,
	}
	if dto.Aliases == nil {
		dto.Aliases = []string{}
	}
	if p.FirstInteractionAt != nil {
		value := p.FirstInteractionAt.UTC().Format(time.RFC3339)
		dto.FirstInteractionAt = &value
	}
	if p.LastInteractionAt != nil {
		value := p.LastInteractionAt.UTC().Format(time.RFC3339)
		dto.LastInteractionAt = &value
	}
	return dto
}

type personAttributeDTO struct {
	ID         string  `json:"id"`
	Dimension  string  `json:"dimension"`
	Value      string  `json:"value"`
	SourceType string  `json:"sourceType"`
	Source     string  `json:"source"`
	Extractor  string  `json:"extractor"`
	Status     string  `json:"status"`
	Confidence float64 `json:"confidence"`
	Reason     string  `json:"reason,omitempty"`
	ObservedAt string  `json:"observedAt"`
	ValidFrom  string  `json:"validFrom"`
	ValidTo    *string `json:"validTo,omitempty"`
}

func personAttributeToDTO(attribute *ent.PersonAttribute) personAttributeDTO {
	dto := personAttributeDTO{
		ID:         attribute.ID.String(),
		Dimension:  attribute.Dimension,
		Value:      attribute.Value,
		SourceType: attribute.SourceType,
		Source:     attribute.Source,
		Extractor:  attribute.Extractor,
		Status:     attribute.Status,
		Confidence: attribute.Confidence,
		Reason:     attribute.Reason,
		ObservedAt: attribute.ObservedAt.UTC().Format(time.RFC3339),
		ValidFrom:  attribute.ValidFrom.UTC().Format(time.RFC3339),
	}
	if attribute.ValidTo != nil {
		value := attribute.ValidTo.UTC().Format(time.RFC3339)
		dto.ValidTo = &value
	}
	return dto
}

type personInteractionDTO struct {
	RelationshipID     string         `json:"relationshipId"`
	FirstInteractionAt string         `json:"firstInteractionAt"`
	LastInteractionAt  string         `json:"lastInteractionAt"`
	InteractionCount   int            `json:"interactionCount"`
	InboundCount       int            `json:"inboundCount"`
	OutboundCount      int            `json:"outboundCount"`
	MeetingCount       int            `json:"meetingCount"`
	ChannelCounts      map[string]int `json:"channelCounts"`
	LastChannel        string         `json:"lastChannel,omitempty"`
	LastDirection      string         `json:"lastDirection,omitempty"`
}

func participantToDTO(participant *ent.RelationshipParticipant) participantDTO {
	dto := participantDTO{
		ID:           participant.ID.String(),
		DisplayName:  participant.DisplayName,
		Email:        participant.Email,
		Role:         participant.Role,
		Title:        participant.Title,
		Active:       participant.Active,
		ExternalRefs: participant.ExternalRefs,
	}
	if p, err := participant.Edges.PersonOrErr(); err == nil && p != nil {
		dto.PersonID = p.ID.String()
		dto.Person = personToDTO(p)
	}
	return dto
}

type commitmentDTO struct {
	ID                         string     `json:"id"`
	Direction                  string     `json:"direction"`
	Text                       string     `json:"text"`
	Status                     string     `json:"status"`
	DueAt                      *time.Time `json:"dueAt,omitempty"`
	Confidence                 float64    `json:"confidence"`
	UserConfirmed              bool       `json:"userConfirmed"`
	OwnerParticipantRef        string     `json:"ownerParticipantRef,omitempty"`
	CounterpartyParticipantRef string     `json:"counterpartyParticipantRef,omitempty"`
	BeneficiaryParticipantRef  string     `json:"beneficiaryParticipantRef,omitempty"`
	SourcePhrase               string     `json:"sourcePhrase,omitempty"`
	DuePhrase                  string     `json:"duePhrase,omitempty"`
	DueTimezone                string     `json:"dueTimezone,omitempty"`
	Acceptance                 string     `json:"acceptance,omitempty"`
	Blocker                    string     `json:"blocker,omitempty"`
	CompletedAt                *time.Time `json:"completedAt,omitempty"`
	CurrentEventVersion        int        `json:"currentEventVersion,omitempty"`
}

func commitmentToDTO(commitment *ent.Commitment) commitmentDTO {
	return commitmentDTO{
		ID:                         commitment.ID.String(),
		Direction:                  commitment.Direction,
		Text:                       commitment.Text,
		Status:                     commitment.Status,
		DueAt:                      commitment.DueAt,
		Confidence:                 commitment.Confidence,
		UserConfirmed:              commitment.UserConfirmed,
		OwnerParticipantRef:        commitment.OwnerParticipantRef,
		CounterpartyParticipantRef: commitment.CounterpartyParticipantRef,
		BeneficiaryParticipantRef:  commitment.BeneficiaryParticipantRef,
		SourcePhrase:               commitment.SourcePhrase,
		DuePhrase:                  commitment.DuePhrase,
		DueTimezone:                commitment.DueTimezone,
		Acceptance:                 commitment.Acceptance,
		Blocker:                    commitment.Blocker,
		CompletedAt:                commitment.CompletedAt,
		CurrentEventVersion:        commitment.CurrentEventVersion,
	}
}

type commitmentEventDTO struct {
	EventID                    string    `json:"eventId"`
	CommitmentID               string    `json:"commitmentId"`
	SourceEventID              string    `json:"sourceEventId"`
	Version                    int       `json:"version"`
	Kind                       string    `json:"kind"`
	ActorType                  string    `json:"actorType"`
	ActorRef                   string    `json:"actorRef,omitempty"`
	OccurredAt                 time.Time `json:"occurredAt"`
	SourceObservationID        string    `json:"sourceObservationId,omitempty"`
	EvidenceRefs               []string  `json:"evidenceRefs"`
	OwnerParticipantRef        string    `json:"ownerParticipantRef,omitempty"`
	CounterpartyParticipantRef string    `json:"counterpartyParticipantRef,omitempty"`
	BeneficiaryParticipantRef  string    `json:"beneficiaryParticipantRef,omitempty"`
	Action                     string    `json:"action,omitempty"`
	DuePhrase                  string    `json:"duePhrase,omitempty"`
	DueAt                      string    `json:"dueAt,omitempty"`
	DueTimezone                string    `json:"dueTimezone,omitempty"`
	Blocker                    string    `json:"blocker,omitempty"`
	Reason                     string    `json:"reason,omitempty"`
	SupersedesCommitmentID     string    `json:"supersedesCommitmentId,omitempty"`
}

func commitmentEventToDTO(commitmentID uuid.UUID, event *ent.CommitmentEvent) commitmentEventDTO {
	payload := map[string]any{}
	_ = json.Unmarshal([]byte(event.PayloadJSON), &payload)
	stringValue := func(key string) string {
		value, _ := payload[key].(string)
		return value
	}
	return commitmentEventDTO{
		EventID: event.ID.String(), CommitmentID: commitmentID.String(),
		SourceEventID: event.SourceEventID, Version: event.Version,
		Kind: event.Kind, ActorType: event.ActorType, ActorRef: event.ActorRef,
		OccurredAt: event.OccurredAt, SourceObservationID: event.SourceObservationID,
		EvidenceRefs:               event.EvidenceRefs,
		OwnerParticipantRef:        stringValue("ownerParticipantRef"),
		CounterpartyParticipantRef: stringValue("counterpartyParticipantRef"),
		BeneficiaryParticipantRef:  stringValue("beneficiaryParticipantRef"),
		Action:                     stringValue("action"), DuePhrase: stringValue("duePhrase"),
		DueAt: stringValue("dueAt"), DueTimezone: stringValue("dueTimezone"),
		Blocker: stringValue("blocker"), Reason: stringValue("reason"),
		SupersedesCommitmentID: stringValue("supersedesCommitmentId"),
	}
}

type commitmentDependencyDTO struct {
	ID               string    `json:"dependencyId"`
	RelationshipID   string    `json:"relationshipId"`
	FromCommitmentID string    `json:"fromCommitmentId"`
	ToCommitmentID   string    `json:"toCommitmentId"`
	Kind             string    `json:"kind"`
	EvidenceRefs     []string  `json:"evidenceRefs"`
	CreatedAt        time.Time `json:"createdAt"`
}

func commitmentDependencyToDTO(relationshipID uuid.UUID, dependency *ent.CommitmentDependency) (commitmentDependencyDTO, error) {
	from, err := dependency.Edges.FromCommitmentOrErr()
	if err != nil {
		return commitmentDependencyDTO{}, err
	}
	to, err := dependency.Edges.ToCommitmentOrErr()
	if err != nil {
		return commitmentDependencyDTO{}, err
	}
	return commitmentDependencyDTO{
		ID: dependency.ID.String(), RelationshipID: relationshipID.String(),
		FromCommitmentID: from.ID.String(), ToCommitmentID: to.ID.String(),
		Kind: dependency.Kind, EvidenceRefs: dependency.EvidenceRefs, CreatedAt: dependency.CreatedAt,
	}, nil
}

type observationDTO struct {
	ID              string         `json:"id"`
	Source          string         `json:"source"`
	SourceAccountID string         `json:"sourceAccountId,omitempty"`
	ExternalID      string         `json:"externalId"`
	SourceVersion   string         `json:"sourceVersion"`
	EventType       string         `json:"eventType"`
	OccurredAt      time.Time      `json:"occurredAt"`
	ReceivedAt      time.Time      `json:"receivedAt"`
	Summary         string         `json:"summary,omitempty"`
	NormalizedFacts map[string]any `json:"normalizedFacts"`
	ContentHash     string         `json:"contentHash"`
}

func observationToDTO(observation *ent.RelationshipObservation) observationDTO {
	facts := map[string]any{}
	_ = json.Unmarshal([]byte(observation.NormalizedFactsJSON), &facts)
	return observationDTO{
		ID:              observation.ID.String(),
		Source:          observation.Source,
		SourceAccountID: observation.SourceAccountID,
		ExternalID:      observation.ExternalID,
		SourceVersion:   observation.SourceVersion,
		EventType:       observation.EventType,
		OccurredAt:      observation.OccurredAt,
		ReceivedAt:      observation.ReceivedAt,
		Summary:         observation.Summary,
		NormalizedFacts: facts,
		ContentHash:     observation.ContentHash,
	}
}

type snapshotDTO struct {
	ID                string         `json:"id"`
	Version           int            `json:"version"`
	State             map[string]any `json:"state"`
	StateHash         string         `json:"stateHash"`
	ProjectorVersion  int            `json:"projectorVersion"`
	EvaluatedAt       time.Time      `json:"evaluatedAt"`
	ChangedDimensions []string       `json:"changedDimensions"`
	AssertionIDs      []string       `json:"assertionIds"`
	CreatedAt         time.Time      `json:"createdAt"`
}

type identityDecisionDTO struct {
	ID                    string     `json:"id"`
	Decision              string     `json:"decision"`
	CandidateVersion      int        `json:"candidateVersion"`
	ActorID               string     `json:"actorId"`
	Reason                string     `json:"reason,omitempty"`
	DecidedAt             time.Time  `json:"decidedAt"`
	CompensatesDecisionID *uuid.UUID `json:"compensatesDecisionId,omitempty"`
}

type identityLineageDTO struct {
	ID                    string    `json:"id"`
	Kind                  string    `json:"kind"`
	ActorID               string    `json:"actorId"`
	Reason                string    `json:"reason,omitempty"`
	ObservationIDs        []string  `json:"observationIds"`
	IdentityIDs           []string  `json:"identityIds"`
	MovedObjectRefs       []string  `json:"movedObjectRefs"`
	BeforeRelationshipIDs []string  `json:"beforeRelationshipIds"`
	AfterRelationshipIDs  []string  `json:"afterRelationshipIds"`
	OccurredAt            time.Time `json:"occurredAt"`
}

type identityCandidateDTO struct {
	ID                       string                `json:"id"`
	Status                   string                `json:"status"`
	CandidateType            string                `json:"candidateType"`
	Version                  int                   `json:"version"`
	ProposedRelationship     relationshipDTO       `json:"proposedRelationship"`
	ExistingRelationship     relationshipDTO       `json:"existingRelationship"`
	AnchorKind               string                `json:"anchorKind"`
	AnchorProvider           string                `json:"anchorProvider,omitempty"`
	AnchorPreview            string                `json:"anchorPreview,omitempty"`
	MatchingAnchors          []string              `json:"matchingAnchors"`
	ConflictingAnchors       []string              `json:"conflictingAnchors"`
	EvidenceRefs             []string              `json:"evidenceRefs"`
	EvidenceCount            int                   `json:"evidenceCount"`
	EvidenceFrom             *time.Time            `json:"evidenceFrom,omitempty"`
	EvidenceTo               *time.Time            `json:"evidenceTo,omitempty"`
	Impact                   map[string]any        `json:"impact"`
	RecommendedDecision      string                `json:"recommendedDecision"`
	RecommendationConfidence float64               `json:"recommendationConfidence"`
	Decision                 string                `json:"decision,omitempty"`
	DecisionReason           string                `json:"decisionReason,omitempty"`
	DecisionActorID          *uuid.UUID            `json:"decisionActorId,omitempty"`
	DecidedAt                *time.Time            `json:"decidedAt,omitempty"`
	Decisions                []identityDecisionDTO `json:"decisions"`
	Lineage                  []identityLineageDTO  `json:"lineage"`
}

type relationshipAttentionDTO struct {
	ID                       string         `json:"id"`
	Version                  int            `json:"version"`
	RelationshipID           string         `json:"relationshipId"`
	RelationshipName         string         `json:"relationshipName"`
	ReasonCode               string         `json:"reasonCode"`
	Explanation              string         `json:"explanation"`
	TriggeringObjectRef      string         `json:"triggeringObjectRef"`
	EvidenceRefs             []string       `json:"evidenceRefs"`
	UrgencyBand              string         `json:"urgencyBand"`
	RankScore                int            `json:"rankScore"`
	RankFactors              map[string]int `json:"rankFactors"`
	SourceRequirements       []string       `json:"sourceRequirements"`
	RecommendationID         *uuid.UUID     `json:"recommendationId,omitempty"`
	RecommendationRevision   int            `json:"recommendationRevision,omitempty"`
	OwnerID                  *uuid.UUID     `json:"ownerId,omitempty"`
	Status                   string         `json:"status"`
	StateReason              string         `json:"stateReason,omitempty"`
	SnoozedUntil             *time.Time     `json:"snoozedUntil,omitempty"`
	ExpiresAt                *time.Time     `json:"expiresAt,omitempty"`
	DetectorVersion          int            `json:"detectorVersion"`
	ProjectorVersion         int            `json:"projectorVersion"`
	RelationshipStateVersion int            `json:"relationshipStateVersion"`
	AcknowledgedBy           *uuid.UUID     `json:"acknowledgedBy,omitempty"`
	AcknowledgedAt           *time.Time     `json:"acknowledgedAt,omitempty"`
	DismissedBy              *uuid.UUID     `json:"dismissedBy,omitempty"`
	DismissedAt              *time.Time     `json:"dismissedAt,omitempty"`
	CreatedAt                time.Time      `json:"createdAt"`
	UpdatedAt                time.Time      `json:"updatedAt"`
}

func relationshipAttentionToDTO(item *ent.RelationshipAttentionItem) (relationshipAttentionDTO, error) {
	rel, err := item.Edges.RelationshipOrErr()
	if err != nil {
		return relationshipAttentionDTO{}, err
	}
	factors := map[string]int{}
	if err := json.Unmarshal([]byte(item.RankFactorsJSON), &factors); err != nil {
		return relationshipAttentionDTO{}, err
	}
	return relationshipAttentionDTO{
		ID: item.ID.String(), Version: item.Version, RelationshipID: rel.ID.String(), RelationshipName: rel.DisplayName,
		ReasonCode: item.ReasonCode, Explanation: item.Explanation, TriggeringObjectRef: item.TriggeringObjectRef,
		EvidenceRefs: item.EvidenceRefs, UrgencyBand: item.UrgencyBand, RankScore: item.RankScore, RankFactors: factors,
		SourceRequirements: item.SourceRequirements, RecommendationID: item.RecommendationID,
		RecommendationRevision: item.RecommendationRevision, OwnerID: item.OwnerID, Status: item.Status,
		StateReason: item.StateReason, SnoozedUntil: item.SnoozedUntil, ExpiresAt: item.ExpiresAt,
		DetectorVersion: item.DetectorVersion, ProjectorVersion: item.ProjectorVersion,
		RelationshipStateVersion: item.RelationshipStateVersion, AcknowledgedBy: item.AcknowledgedBy,
		AcknowledgedAt: item.AcknowledgedAt, DismissedBy: item.DismissedBy, DismissedAt: item.DismissedAt,
		CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt,
	}, nil
}

func identityCandidateToDTO(candidate *ent.RelationshipIdentityCandidate) (identityCandidateDTO, error) {
	proposed, err := candidate.Edges.ProposedRelationshipOrErr()
	if err != nil {
		return identityCandidateDTO{}, err
	}
	existing, err := candidate.Edges.ExistingRelationshipOrErr()
	if err != nil {
		return identityCandidateDTO{}, err
	}
	impact := map[string]any{}
	if err := json.Unmarshal([]byte(candidate.ImpactJSON), &impact); err != nil {
		return identityCandidateDTO{}, err
	}
	dto := identityCandidateDTO{
		ID: candidate.ID.String(), Status: candidate.Status, CandidateType: candidate.CandidateType,
		Version: candidate.Version, ProposedRelationship: relationshipToDTO(proposed), ExistingRelationship: relationshipToDTO(existing),
		AnchorKind: candidate.AnchorKind, AnchorProvider: candidate.AnchorProvider, AnchorPreview: candidate.AnchorPreview,
		MatchingAnchors: candidate.MatchingAnchors, ConflictingAnchors: candidate.ConflictingAnchors,
		EvidenceRefs: candidate.EvidenceRefs, EvidenceCount: candidate.EvidenceCount,
		EvidenceFrom: candidate.EvidenceFrom, EvidenceTo: candidate.EvidenceTo, Impact: impact,
		RecommendedDecision: candidate.RecommendedDecision, RecommendationConfidence: candidate.Confidence,
		Decision: candidate.Decision, DecisionReason: candidate.DecisionReason,
		DecisionActorID: candidate.DecisionActorID, DecidedAt: candidate.DecidedAt,
		Decisions: []identityDecisionDTO{}, Lineage: []identityLineageDTO{},
	}
	if decisions, edgeErr := candidate.Edges.DecisionsOrErr(); edgeErr == nil {
		for _, decision := range decisions {
			dto.Decisions = append(dto.Decisions, identityDecisionDTO{
				ID: decision.ID.String(), Decision: decision.Decision, CandidateVersion: decision.CandidateVersion,
				ActorID: decision.ActorID.String(), Reason: decision.Reason, DecidedAt: decision.DecidedAt,
				CompensatesDecisionID: decision.CompensatesDecisionID,
			})
		}
	}
	if lineage, edgeErr := candidate.Edges.LineageEventsOrErr(); edgeErr == nil {
		for _, event := range lineage {
			dto.Lineage = append(dto.Lineage, identityLineageDTO{
				ID: event.ID.String(), Kind: event.Kind, ActorID: event.ActorID.String(), Reason: event.Reason,
				ObservationIDs: event.ObservationIds, IdentityIDs: event.IdentityIds, MovedObjectRefs: event.MovedObjectRefs,
				BeforeRelationshipIDs: event.BeforeRelationshipIds, AfterRelationshipIDs: event.AfterRelationshipIds,
				OccurredAt: event.OccurredAt,
			})
		}
	}
	return dto, nil
}

func snapshotToDTO(snapshot *ent.RelationshipStateSnapshot) snapshotDTO {
	state := map[string]any{}
	_ = json.Unmarshal([]byte(snapshot.StateJSON), &state)
	return snapshotDTO{
		ID:                snapshot.ID.String(),
		Version:           snapshot.Version,
		State:             state,
		StateHash:         snapshot.StateHash,
		ProjectorVersion:  snapshot.ProjectorVersion,
		EvaluatedAt:       snapshot.EvaluatedAt,
		ChangedDimensions: snapshot.ChangedDimensions,
		AssertionIDs:      snapshot.AssertionIds,
		CreatedAt:         snapshot.CreatedAt,
	}
}

type sourceStatusDTO struct {
	ConnectionID           string     `json:"connectionId"`
	Source                 string     `json:"source"`
	SourceAccountID        string     `json:"sourceAccountId"`
	ConsentingActorID      *uuid.UUID `json:"consentingActorId,omitempty"`
	Status                 string     `json:"status"`
	BackfillPhase          string     `json:"backfillPhase"`
	BackfillCompleted      int        `json:"backfillCompleted"`
	BackfillTotal          int        `json:"backfillTotal"`
	Completeness           string     `json:"completeness"`
	ExpectedCadenceSeconds int64      `json:"expectedCadenceSeconds"`
	LagSeconds             int64      `json:"lagSeconds"`
	RequiredScopes         []string   `json:"requiredScopes"`
	GrantedScopes          []string   `json:"grantedScopes"`
	MissingScopes          []string   `json:"missingScopes"`
	ErrorCode              string     `json:"errorCode,omitempty"`
	RetryCount             int        `json:"retryCount"`
	NextRetryAt            *time.Time `json:"nextRetryAt,omitempty"`
	SyncStartedAt          *time.Time `json:"syncStartedAt,omitempty"`
	AuthorizationStartedAt *time.Time `json:"authorizationStartedAt,omitempty"`
	AuthorizedAt           *time.Time `json:"authorizedAt,omitempty"`
	BackfillCompletedAt    *time.Time `json:"backfillCompletedAt,omitempty"`
	LastFailedSyncAt       *time.Time `json:"lastFailedSyncAt,omitempty"`
	DisconnectedAt         *time.Time `json:"disconnectedAt,omitempty"`
	RevokedAt              *time.Time `json:"revokedAt,omitempty"`
	LastSyncAt             *time.Time `json:"lastSyncAt,omitempty"`
	LastSuccessAt          *time.Time `json:"lastSuccessAt,omitempty"`
	LastObservationAt      *time.Time `json:"lastObservationAt,omitempty"`
	LastProviderEventAt    *time.Time `json:"lastProviderEventAt,omitempty"`
	LastError              string     `json:"lastError,omitempty"`
}

func sourceStatusToDTO(status *ent.RelationshipSourceStatus) sourceStatusDTO {
	return sourceStatusDTO{
		ConnectionID: status.ID.String(), Source: status.Source, SourceAccountID: status.SourceAccountID,
		ConsentingActorID: status.ConsentingActorID, Status: status.Status,
		BackfillPhase: status.BackfillPhase, BackfillCompleted: status.BackfillCompleted,
		BackfillTotal: status.BackfillTotal, Completeness: status.Completeness,
		ExpectedCadenceSeconds: status.ExpectedCadenceSeconds, LagSeconds: status.LagSeconds,
		RequiredScopes: status.RequiredScopes, GrantedScopes: status.GrantedScopes,
		MissingScopes: status.MissingScopes, ErrorCode: status.ErrorCode,
		RetryCount: status.RetryCount, NextRetryAt: status.NextRetryAt,
		SyncStartedAt: status.SyncStartedAt, AuthorizationStartedAt: status.AuthorizationStartedAt,
		AuthorizedAt: status.AuthorizedAt, BackfillCompletedAt: status.BackfillCompletedAt,
		LastFailedSyncAt: status.LastFailedSyncAt, DisconnectedAt: status.DisconnectedAt,
		RevokedAt: status.RevokedAt, LastSyncAt: status.LastSyncAt,
		LastSuccessAt: status.LastSuccessAt, LastObservationAt: status.LastObservationAt,
		LastProviderEventAt: status.LastProviderEventAt,
		LastError:           status.LastError,
	}
}

// relationshipToDTOWithOpen is relationshipToDTO plus the open-loop count,
// populated from an eager-loaded (open-filtered) actions edge.
func relationshipToDTOWithOpen(rel *ent.Relationship) relationshipDTO {
	dto := relationshipToDTO(rel)
	if actions, err := rel.Edges.ActionsOrErr(); err == nil {
		dto.OpenActions = len(actions)
	}
	return dto
}

type actionDTO struct {
	ID                      string              `json:"id"`
	RelationshipID          string              `json:"relationshipId,omitempty"`
	ActionType              string              `json:"actionType"`
	Channel                 string              `json:"channel"`
	Detector                string              `json:"detector"`
	Revision                int                 `json:"revision"`
	RevisionHash            string              `json:"revisionHash"`
	Reason                  string              `json:"reason"`
	RecipientEmail          string              `json:"recipientEmail,omitempty"`
	ProposedSubject         string              `json:"proposedSubject,omitempty"`
	ProposedMessage         string              `json:"proposedMessage,omitempty"`
	SenderAccountRef        string              `json:"senderAccountRef,omitempty"`
	PriorityScore           int                 `json:"priorityScore"`
	PriorityComponents      json.RawMessage     `json:"priorityComponents,omitempty"`
	QueueStatus             string              `json:"queueStatus"`
	PolicyStatus            string              `json:"policyStatus"`
	ApprovalStatus          string              `json:"approvalStatus"`
	ExecutionStatus         string              `json:"executionStatus"`
	ExecutionOwner          string              `json:"executionOwner"`
	ExecutionMode           string              `json:"executionMode"`
	ApprovedRevision        int                 `json:"approvedRevision,omitempty"`
	ApprovedAt              *time.Time          `json:"approvedAt,omitempty"`
	ProviderMessageID       string              `json:"providerMessageId,omitempty"`
	ProviderThreadID        string              `json:"providerThreadId,omitempty"`
	ExecutedAt              *time.Time          `json:"executedAt,omitempty"`
	ExecutionError          string              `json:"executionError,omitempty"`
	ReconciliationStatus    string              `json:"reconciliationStatus,omitempty"`
	ReconciliationAttempts  int                 `json:"reconciliationAttempts,omitempty"`
	ReconciliationCheckedAt *time.Time          `json:"reconciliationCheckedAt,omitempty"`
	ReconciliationNextAt    *time.Time          `json:"reconciliationNextAt,omitempty"`
	ReconciliationError     string              `json:"reconciliationError,omitempty"`
	DismissReason           string              `json:"dismissReason,omitempty"`
	SnoozedUntil            *time.Time          `json:"snoozedUntil,omitempty"`
	DueAt                   *time.Time          `json:"dueAt,omitempty"`
	CreatedAt               time.Time           `json:"createdAt"`
	UpdatedAt               time.Time           `json:"updatedAt"`
	Evidence                []actionEvidenceDTO `json:"evidence"`
}

type actionEvidenceDTO struct {
	ID                   string    `json:"id"`
	Source               string    `json:"source"`
	SourceRecordID       string    `json:"sourceRecordId"`
	Excerpt              string    `json:"excerpt,omitempty"`
	OccurredAt           time.Time `json:"occurredAt"`
	ExternalEvidenceRefs []string  `json:"externalEvidenceRefs"`
}

func actionToDTO(a *ent.RevenueAction) actionDTO {
	dto := actionDTO{
		ID:                      a.ID.String(),
		ActionType:              a.ActionType,
		Channel:                 a.Channel,
		Detector:                a.Detector,
		Revision:                a.Revision,
		RevisionHash:            a.RevisionHash,
		Reason:                  a.Reason,
		RecipientEmail:          a.RecipientEmail,
		ProposedSubject:         a.ProposedSubject,
		ProposedMessage:         a.ProposedMessage,
		SenderAccountRef:        a.SenderAccountRef,
		PriorityScore:           a.PriorityScore,
		QueueStatus:             a.QueueStatus,
		PolicyStatus:            a.PolicyStatus,
		ApprovalStatus:          a.ApprovalStatus,
		ExecutionStatus:         a.ExecutionStatus,
		ExecutionOwner:          a.ExecutionOwner,
		ExecutionMode:           a.ExecutionMode,
		ApprovedRevision:        a.ApprovedRevision,
		ApprovedAt:              a.ApprovedAt,
		ProviderMessageID:       a.ProviderMessageID,
		ProviderThreadID:        a.ProviderThreadID,
		ExecutedAt:              a.ExecutedAt,
		ExecutionError:          a.ExecutionError,
		ReconciliationStatus:    a.ReconciliationStatus,
		ReconciliationAttempts:  a.ReconciliationAttempts,
		ReconciliationCheckedAt: a.ReconciliationCheckedAt,
		ReconciliationNextAt:    a.ReconciliationNextAt,
		ReconciliationError:     a.ReconciliationError,
		DismissReason:           a.DismissReason,
		SnoozedUntil:            a.SnoozedUntil,
		DueAt:                   a.DueAt,
		CreatedAt:               a.CreatedAt,
		UpdatedAt:               a.UpdatedAt,
		Evidence:                []actionEvidenceDTO{},
	}
	if evidences, err := a.Edges.EvidencesOrErr(); err == nil {
		for _, evidence := range evidences {
			dto.Evidence = append(dto.Evidence, actionEvidenceDTO{
				ID: evidence.ID.String(), Source: evidence.Source,
				SourceRecordID: evidence.SourceRecordID, Excerpt: evidence.Excerpt,
				OccurredAt:           evidence.OccurredAt,
				ExternalEvidenceRefs: evidence.ExternalEvidenceRefs,
			})
		}
	}
	if a.PriorityComponentsJSON != "" {
		dto.PriorityComponents = json.RawMessage(a.PriorityComponentsJSON)
	}
	if rel, err := a.Edges.RelationshipOrErr(); err == nil {
		dto.RelationshipID = rel.ID.String()
	}
	return dto
}

type decisionDTO struct {
	ID           string          `json:"id"`
	Revision     int             `json:"revision"`
	RevisionHash string          `json:"revisionHash"`
	Status       string          `json:"status"`
	ReasonCodes  []string        `json:"reasonCodes"`
	Verification json.RawMessage `json:"verification,omitempty"`
	Suppression  json.RawMessage `json:"suppression,omitempty"`
	Research     json.RawMessage `json:"research,omitempty"`
	CRM          json.RawMessage `json:"crm,omitempty"`
	EvaluatedAt  time.Time       `json:"evaluatedAt"`
	ExpiresAt    time.Time       `json:"expiresAt"`
}

func decisionToDTO(d *ent.PolicyDecisionSnapshot) decisionDTO {
	dto := decisionDTO{
		ID:           d.ID.String(),
		Revision:     d.ActionRevision,
		RevisionHash: d.RevisionHash,
		Status:       d.Status,
		ReasonCodes:  d.ReasonCodes,
		EvaluatedAt:  d.EvaluatedAt,
		ExpiresAt:    d.ExpiresAt,
	}
	if d.VerificationJSON != "" {
		dto.Verification = json.RawMessage(d.VerificationJSON)
	}
	if d.SuppressionJSON != "" {
		dto.Suppression = json.RawMessage(d.SuppressionJSON)
	}
	if d.ResearchJSON != "" {
		dto.Research = json.RawMessage(d.ResearchJSON)
	}
	if d.CrmJSON != "" {
		dto.CRM = json.RawMessage(d.CrmJSON)
	}
	return dto
}

type outcomeDTO struct {
	ID            string    `json:"id"`
	Kind          string    `json:"kind"`
	Source        string    `json:"source"`
	SourceEventID string    `json:"sourceEventId"`
	OccurredAt    time.Time `json:"occurredAt"`
}

func outcomeToDTO(o *ent.ActionOutcome) outcomeDTO {
	return outcomeDTO{
		ID:            o.ID.String(),
		Kind:          o.Kind,
		Source:        o.Source,
		SourceEventID: o.SourceEventID,
		OccurredAt:    o.OccurredAt,
	}
}

// --- helpers -----------------------------------------------------------------

func (h *Handler) viewer(w http.ResponseWriter, r *http.Request) (*ent.User, bool) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "authentication required", "unauthenticated")
		return nil, false
	}
	return u, true
}

func pathUUID(w http.ResponseWriter, r *http.Request, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, name))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid "+name, "invalid_id")
		return uuid.Nil, false
	}
	return id, true
}

// writeServiceError maps lifecycle errors onto RFC 9457 problems. Every
// invariant violation is a 409: the request was well-formed but the state
// machine refuses the transition.
func (h *Handler) writeServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "not found", "not_found")
	case errors.Is(err, ErrInvalidInput):
		httpx.Error(w, http.StatusBadRequest, err.Error(), "invalid_input")
	case errors.Is(err, ErrForbidden):
		httpx.Error(w, http.StatusForbidden, "workspace role forbids this operation", "forbidden")
	case errors.Is(err, ErrEvidenceEncryptionUnavailable):
		httpx.Error(w, http.StatusServiceUnavailable, "tenant evidence encryption is unavailable", "evidence_encryption_unavailable")
	case errors.Is(err, ErrEvidenceKeyDestroyed):
		httpx.Error(w, http.StatusGone, "tenant evidence key has been destroyed", "evidence_key_destroyed")
	case errors.Is(err, ErrCapabilityDisabled):
		httpx.Error(w, http.StatusConflict, err.Error(), "capability_disabled")
	case errors.Is(err, ErrIdentityUnresolved):
		httpx.Error(w, http.StatusConflict, "action destination depends on unresolved identity", "identity_unresolved")
	case errors.Is(err, ErrSourceIncomplete):
		httpx.Error(w, http.StatusConflict, "required source evidence is incomplete or stale", "source_incomplete")
	case errors.Is(err, ErrBlocked):
		httpx.Error(w, http.StatusConflict, "action is blocked by policy", "blocked")
	case errors.Is(err, ErrNoDecision):
		httpx.Error(w, http.StatusConflict, "no policy decision for the current revision; evaluate first", "no_decision")
	case errors.Is(err, ErrDecisionExpired):
		httpx.Error(w, http.StatusConflict, "policy decision expired; re-evaluate", "decision_expired")
	case errors.Is(err, ErrReviewRequired):
		httpx.Error(w, http.StatusConflict, "decision requires explicit human risk acceptance", "review_required")
	case errors.Is(err, ErrNotApproved):
		httpx.Error(w, http.StatusConflict, "action is not approved for its current revision", "not_approved")
	case errors.Is(err, ErrNotEditable):
		httpx.Error(w, http.StatusConflict, "execution already started; the action is immutable", "not_editable")
	case errors.Is(err, ErrWorkspaceNotLinked):
		httpx.Error(w, http.StatusConflict, "workspace is not linked; sends are disabled", "workspace_not_linked")
	case errors.Is(err, ErrSubscriptionRequired):
		httpx.Error(w, http.StatusPaymentRequired, "an active subscription is required to act on actions", "subscription_required")
	case errors.Is(err, ErrConflict):
		httpx.Error(w, http.StatusConflict, "conflicting concurrent transition; reload and retry", "conflict")
	case errors.Is(err, ErrFacadeUnavailable):
		httpx.Error(w, http.StatusServiceUnavailable, "policy preflight unavailable; the action stays pending", "facade_unavailable")
	default:
		h.log.Error("revenue: internal error", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "internal error", "internal")
	}
}

// --- workspace endpoints -----------------------------------------------------

// CurrentWorkspace returns the mapping and preflight health.
func (h *Handler) CurrentWorkspace(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	ws, err := h.svc.CurrentWorkspace(r.Context(), u)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, h.workspaceDTO(ws))
}

// LinkWorkspace completes the OutboundConsole workspace link.
func (h *Handler) LinkWorkspace(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	var body struct {
		OutboundOrganizationID string `json:"outboundOrganizationId"`
		OutboundWorkspaceID    string `json:"outboundWorkspaceId"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	ws, err := h.svc.LinkWorkspace(r.Context(), u, LinkInput{
		OutboundOrganizationID: body.OutboundOrganizationID,
		OutboundWorkspaceID:    body.OutboundWorkspaceID,
	})
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, h.workspaceDTO(ws))
}

type workspaceMemberDTO struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Email     string    `json:"email"`
	Role      string    `json:"role"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func workspaceMemberToDTO(member *ent.RevenueWorkspaceMember) workspaceMemberDTO {
	dto := workspaceMemberDTO{
		ID: member.ID.String(), Role: member.Role, Status: member.Status,
		CreatedAt: member.CreatedAt, UpdatedAt: member.UpdatedAt,
	}
	if u, err := member.Edges.UserOrErr(); err == nil {
		dto.UserID = u.ID.String()
		dto.Email = u.Email
	}
	return dto
}

// ListWorkspaceMembers returns active tenant membership and role metadata.
func (h *Handler) ListWorkspaceMembers(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	members, err := h.svc.ListWorkspaceMembers(r.Context(), u)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	out := make([]workspaceMemberDTO, 0, len(members))
	for _, member := range members {
		out = append(out, workspaceMemberToDTO(member))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"members": out})
}

// UpsertWorkspaceMember creates or changes a tenant-scoped membership.
func (h *Handler) UpsertWorkspaceMember(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.viewer(w, r)
	if !ok {
		return
	}
	targetID, ok := pathUUID(w, r, "userId")
	if !ok {
		return
	}
	var body struct {
		Role string `json:"role"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	member, err := h.svc.UpsertWorkspaceMember(r.Context(), actor, targetID, body.Role)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	loaded, err := member.QueryUser().Only(r.Context())
	if err == nil {
		member.Edges.User = loaded
	}
	httpx.WriteJSON(w, http.StatusOK, workspaceMemberToDTO(member))
}

// RemoveWorkspaceMember deactivates a tenant membership by identifier.
func (h *Handler) RemoveWorkspaceMember(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.viewer(w, r)
	if !ok {
		return
	}
	membershipID, ok := pathUUID(w, r, "membershipId")
	if !ok {
		return
	}
	member, err := h.svc.RemoveWorkspaceMember(r.Context(), actor, membershipID)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, workspaceMemberToDTO(member))
}

// TenantEvidenceKeyStatuses returns non-secret envelope-key lifecycle metadata.
func (h *Handler) TenantEvidenceKeyStatuses(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	statuses, err := h.svc.TenantEvidenceKeyStatuses(r.Context(), u)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"keys": statuses})
}

// RotateTenantEvidenceKey creates the next wrapped tenant key version.
func (h *Handler) RotateTenantEvidenceKey(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	status, err := h.svc.RotateTenantEvidenceKey(r.Context(), u)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, status)
}

// DestroyTenantEvidenceKeys performs owner-only cryptographic erasure.
func (h *Handler) DestroyTenantEvidenceKeys(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	var body struct {
		Confirmation string `json:"confirmation"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	if body.Confirmation != "DESTROY EVIDENCE KEYS" {
		h.writeServiceError(w, fmt.Errorf("%w: exact evidence-key destruction confirmation is required", ErrInvalidInput))
		return
	}
	statuses, err := h.svc.DestroyTenantEvidenceKeys(r.Context(), u)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"keys": statuses})
}

// WorkspaceFeatureControls returns the tenant's explicit rollout controls.
func (h *Handler) WorkspaceFeatureControls(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	controls, err := h.svc.WorkspaceFeatureControls(r.Context(), u)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"features": controls})
}

// SetWorkspaceFeatureControl applies one owner-managed rollout control.
func (h *Handler) SetWorkspaceFeatureControl(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	var body struct {
		Enabled      bool   `json:"enabled"`
		RolloutStage string `json:"rolloutStage"`
		ReasonCode   string `json:"reasonCode"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	control, err := h.svc.SetWorkspaceFeatureControl(
		r.Context(), u, chi.URLParam(r, "capability"), body.Enabled, body.RolloutStage, body.ReasonCode,
	)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, control)
}

// --- impact ------------------------------------------------------------------

type impactDTO struct {
	Surfaced  int `json:"surfaced"`
	Open      int `json:"open"`
	Handled   int `json:"handled"`
	Snoozed   int `json:"snoozed"`
	Dismissed int `json:"dismissed"`
	Approved  int `json:"approved"`
	Executed  int `json:"executed"`
	Replied   int `json:"replied"`
	Meetings  int `json:"meetingsBooked"`
	Won       int `json:"won"`
	Lost      int `json:"lost"`
	// Rates are fractions in [0,1]; null when there is no denominator yet.
	ReplyRate   *float64       `json:"replyRate"`
	MeetingRate *float64       `json:"meetingRate"`
	Outcomes    map[string]int `json:"outcomes"`
	ByDetector  []DetectorStat `json:"byDetector"`
}

func ratio(num, den int) *float64 {
	if den <= 0 {
		return nil
	}
	r := float64(num) / float64(den)
	return &r
}

// Impact returns the aggregate ROI picture for the caller.
func (h *Handler) Impact(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	imp, err := h.svc.Impact(r.Context(), u)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	replied := imp.OutcomeCount("replied")
	meetings := imp.OutcomeCount("meeting_booked")
	dto := impactDTO{
		Surfaced:    imp.Surfaced,
		Open:        imp.Open,
		Handled:     imp.Handled,
		Snoozed:     imp.Snoozed,
		Dismissed:   imp.Dismissed,
		Approved:    imp.Approved,
		Executed:    imp.Executed,
		Replied:     replied,
		Meetings:    meetings,
		Won:         imp.OutcomeCount("won"),
		Lost:        imp.OutcomeCount("lost"),
		ReplyRate:   ratio(replied, imp.Executed),
		MeetingRate: ratio(meetings, imp.Executed),
		Outcomes:    imp.Outcomes,
		ByDetector:  imp.Detectors,
	}
	httpx.WriteJSON(w, http.StatusOK, dto)
}

// SemanticSearch runs a natural-language search over the caller's Layer-2
// signals (RFC 031). When no embedder is configured it returns an empty,
// available=false result rather than an error, so the UI can degrade quietly.
func (h *Handler) SemanticSearch(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		httpx.Error(w, http.StatusBadRequest, "q is required", "invalid_input")
		return
	}
	matches, err := h.svc.SemanticSearch(r.Context(), u, q, 10)
	if err != nil {
		if errors.Is(err, ErrEmbeddingsUnavailable) {
			httpx.WriteJSON(w, http.StatusOK, map[string]any{"available": false, "matches": []any{}})
			return
		}
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"available": true, "matches": matches})
}

// Digest returns the caller's current digest content (the same summary the
// proactive email is built from), so the UI can preview it.
func (h *Handler) Digest(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	dg, err := h.svc.Digest(r.Context(), u)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, dg)
}

// SourceBody returns the original email body behind an action (RFC 031 Layer
// 3, on demand). Read-only; served from the sealed short-TTL cache or fetched
// from Gmail. 404 when there is no linked source or the body is unavailable.
func (h *Handler) SourceBody(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "actionId")
	if !ok {
		return
	}
	body, err := h.svc.ActionSourceBody(r.Context(), u, id)
	if err != nil {
		if errors.Is(err, ErrBodyUnavailable) {
			httpx.Error(w, http.StatusNotFound, "no original email available for this action", "body_unavailable")
			return
		}
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"body": body})
}

// --- scan endpoints ----------------------------------------------------------

type scanDTO struct {
	ID                   string     `json:"id"`
	Status               string     `json:"status"`
	Mode                 string     `json:"mode"`
	LookbackDays         int        `json:"lookbackDays"`
	ThreadsSeen          int        `json:"threadsSeen"`
	CandidatesSeen       int        `json:"candidatesSeen"`
	RelationshipsCreated int        `json:"relationshipsCreated"`
	EvidencesCreated     int        `json:"evidencesCreated"`
	ActionsCreated       int        `json:"actionsCreated"`
	StartedAt            *time.Time `json:"startedAt,omitempty"`
	CompletedAt          *time.Time `json:"completedAt,omitempty"`
	SourceFreshnessAt    *time.Time `json:"sourceFreshnessAt,omitempty"`
	Error                string     `json:"error,omitempty"`
}

func scanToDTO(sc *ent.RevenueLeakScan) scanDTO {
	return scanDTO{
		ID:                   sc.ID.String(),
		Status:               sc.Status,
		Mode:                 sc.Mode,
		LookbackDays:         sc.LookbackDays,
		ThreadsSeen:          sc.ThreadsSeen,
		CandidatesSeen:       sc.CandidatesSeen,
		RelationshipsCreated: sc.RelationshipsCreated,
		EvidencesCreated:     sc.EvidencesCreated,
		ActionsCreated:       sc.ActionsCreated,
		StartedAt:            sc.StartedAt,
		CompletedAt:          sc.CompletedAt,
		SourceFreshnessAt:    sc.SourceFreshnessAt,
		Error:                sc.Error,
	}
}

// StartScan starts a bounded historical scan.
func (h *Handler) StartScan(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	var body struct {
		LookbackDays int `json:"lookbackDays"`
	}
	// The body is optional: the default lookback is 90 days.
	if r.ContentLength != 0 && !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	scan, err := h.svc.StartScan(r.Context(), u, body.LookbackDays)
	if err != nil {
		if errors.Is(err, ErrScanUnavailable) {
			httpx.Error(w, http.StatusConflict, err.Error(), "scan_unavailable")
			return
		}
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, scanToDTO(scan))
}

// GetScan returns scan progress, counts, errors, and freshness.
func (h *Handler) GetScan(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.viewer(w, r); !ok {
		return
	}
	id, ok := pathUUID(w, r, "scanId")
	if !ok {
		return
	}
	scan, err := h.svc.GetScan(r.Context(), id)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, scanToDTO(scan))
}

// --- relationship endpoints --------------------------------------------------

// ListRelationships lists relationship summaries.
func (h *Handler) ListRelationships(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	rels, err := h.svc.ListRelationshipsFiltered(r.Context(), u, RelationshipListFilter{
		Query:      r.URL.Query().Get("q"),
		Lifecycle:  r.URL.Query().Get("lifecycle"),
		Health:     r.URL.Query().Get("health"),
		Engagement: r.URL.Query().Get("engagement"),
	})
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	out := make([]relationshipDTO, 0, len(rels))
	for _, rel := range rels {
		out = append(out, relationshipToDTOWithOpen(rel))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"relationships": out})
}

// CreateRelationship records a relationship.
func (h *Handler) CreateRelationship(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	var body struct {
		Kind          string   `json:"kind"`
		DisplayName   string   `json:"displayName"`
		PrimaryEmail  string   `json:"primaryEmail"`
		AccountDomain string   `json:"accountDomain"`
		Summary       string   `json:"summary"`
		ResourceRefs  []string `json:"resourceRefs"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	rel, err := h.svc.CreateRelationship(r.Context(), u, RelationshipInput{
		Kind:          body.Kind,
		DisplayName:   body.DisplayName,
		PrimaryEmail:  body.PrimaryEmail,
		AccountDomain: body.AccountDomain,
		Summary:       body.Summary,
		ResourceRefs:  body.ResourceRefs,
	})
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, relationshipToDTO(rel))
}

// GetRelationship returns one relationship with its open loops.
func (h *Handler) GetRelationship(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	missionControl, err := h.svc.MissionControl(r.Context(), u, id)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	h.svc.recordMissionControlOpened(r.Context(), u, missionControl)
	rel := missionControl.relationship
	intelligence := *missionControl.intelligence
	dto := relationshipToDTO(rel)
	actions := make([]actionDTO, 0)
	if list, err := rel.Edges.ActionsOrErr(); err == nil {
		for _, a := range list {
			if a.QueueStatus == QueueOpen {
				dto.OpenActions++
			}
			actions = append(actions, actionToDTO(a))
		}
	}
	participants := make([]participantDTO, 0)
	if list, err := rel.Edges.ParticipantsOrErr(); err == nil {
		for _, participant := range list {
			participants = append(participants, participantToDTO(participant))
		}
	}
	commitments := make([]commitmentDTO, 0)
	if list, err := rel.Edges.CommitmentsOrErr(); err == nil {
		for _, commitment := range list {
			commitments = append(commitments, commitmentToDTO(commitment))
		}
	}
	dependencies := make([]commitmentDependencyDTO, 0)
	if list, err := h.svc.CommitmentDependencies(r.Context(), id); err == nil {
		for _, dependency := range list {
			dto, dtoErr := commitmentDependencyToDTO(id, dependency)
			if dtoErr != nil {
				h.writeServiceError(w, dtoErr)
				return
			}
			dependencies = append(dependencies, dto)
		}
	} else {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"relationship":           dto,
		"actions":                actions,
		"recommendations":        actions,
		"participants":           participants,
		"commitments":            commitments,
		"commitmentDependencies": dependencies,
		"intelligence":           intelligence,
		"missionControl":         missionControl,
	})
}

// AcknowledgeMissionControl records a user's review of an exact state version.
func (h *Handler) AcknowledgeMissionControl(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	var body struct {
		StateVersion int    `json:"stateVersion"`
		StateHash    string `json:"stateHash"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	ack, err := h.svc.AcknowledgeMissionControl(r.Context(), u, id, body.StateVersion, body.StateHash)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{
		"id": ack.ID.String(), "stateVersion": ack.StateVersion,
		"stateHash": ack.StateHash, "acknowledgedAt": ack.AcknowledgedAt,
	})
}

// CreateCommitmentDependency creates a cycle-checked evidence-backed graph edge.
func (h *Handler) CreateCommitmentDependency(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	relationshipID, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	var body struct {
		FromCommitmentID string   `json:"fromCommitmentId"`
		ToCommitmentID   string   `json:"toCommitmentId"`
		Kind             string   `json:"kind"`
		EvidenceRefs     []string `json:"evidenceRefs"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	fromID, err := uuid.Parse(body.FromCommitmentID)
	if err != nil {
		h.writeServiceError(w, fmt.Errorf("%w: invalid from commitment id", ErrInvalidInput))
		return
	}
	toID, err := uuid.Parse(body.ToCommitmentID)
	if err != nil {
		h.writeServiceError(w, fmt.Errorf("%w: invalid to commitment id", ErrInvalidInput))
		return
	}
	dependency, err := h.svc.CreateCommitmentDependency(r.Context(), u, relationshipID, CommitmentDependencyInput{
		FromCommitmentID: fromID, ToCommitmentID: toID, Kind: body.Kind, EvidenceRefs: body.EvidenceRefs,
	})
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	dto, err := commitmentDependencyToDTO(relationshipID, dependency)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, dto)
}

// CorrectConversationReview resolves a low-confidence word, speaker, entity, or
// material claim. State-bearing corrections become top-precedence assertions;
// attribution-only corrections remain immutable meeting-scoped evidence.
func (h *Handler) CorrectConversationReview(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	var body struct {
		ReviewItemID   string `json:"reviewItemId"`
		CorrectedValue string `json:"correctedValue"`
		Reason         string `json:"reason"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	rel, intelligence, err := h.svc.CorrectConversationReview(r.Context(), u, id, ConversationReviewCorrectionInput{
		ReviewItemID:   body.ReviewItemID,
		CorrectedValue: body.CorrectedValue, Reason: body.Reason,
	})
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{
		"relationship": relationshipToDTO(rel), "intelligence": intelligence,
	})
}

// DecideConversationReview approves, corrects, rejects, or defers one semantic candidate.
func (h *Handler) DecideConversationReview(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	var body struct {
		ReviewItemID   string `json:"reviewItemId"`
		Kind           string `json:"kind"`
		CorrectedValue string `json:"correctedValue"`
		Reason         string `json:"reason"`
		DeferUntil     string `json:"deferUntil"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	var deferUntil time.Time
	var err error
	if strings.TrimSpace(body.DeferUntil) != "" {
		deferUntil, err = time.Parse(time.RFC3339, body.DeferUntil)
		if err != nil {
			h.writeServiceError(w, fmt.Errorf("%w: invalid deferUntil", ErrInvalidInput))
			return
		}
	}
	rel, intelligence, err := h.svc.DecideConversationReview(
		r.Context(), u, id, ConversationReviewDecisionInput{
			ReviewItemID: body.ReviewItemID, Kind: body.Kind,
			CorrectedValue: body.CorrectedValue, Reason: body.Reason, DeferUntil: deferUntil,
		},
	)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{
		"relationship": relationshipToDTO(rel), "intelligence": intelligence,
	})
}

// ResolveContradiction records a user-selected authoritative contradiction side.
func (h *Handler) ResolveContradiction(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	var body struct {
		SelectedAssertionID string `json:"selectedAssertionId"`
		Reason              string `json:"reason"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	rel, intelligence, err := h.svc.ResolveContradiction(r.Context(), u, id, ContradictionResolutionInput{
		CaseID: chi.URLParam(r, "caseId"), SelectedAssertionID: body.SelectedAssertionID, Reason: body.Reason,
	})
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{
		"relationship": relationshipToDTO(rel), "intelligence": intelligence,
	})
}

// RunCommitmentRecovery reconciles due commitments against bounded fresh evidence.
func (h *Handler) RunCommitmentRecovery(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	evaluations, err := h.svc.ReconcileDueCommitments(r.Context(), u, &id)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"evaluations": evaluations})
}

// AppendCommitmentTransition appends one validated idempotent event.
func (h *Handler) AppendCommitmentTransition(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	relationshipID, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	commitmentID, ok := pathUUID(w, r, "commitmentId")
	if !ok {
		return
	}
	var body struct {
		Kind           string   `json:"kind"`
		IdempotencyKey string   `json:"idempotencyKey"`
		Reason         string   `json:"reason"`
		DueAt          string   `json:"dueAt"`
		Action         string   `json:"action"`
		Blocker        string   `json:"blocker"`
		EvidenceRefs   []string `json:"evidenceRefs"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	var dueAt time.Time
	var err error
	if strings.TrimSpace(body.DueAt) != "" {
		dueAt, err = time.Parse(time.RFC3339, body.DueAt)
		if err != nil {
			h.writeServiceError(w, fmt.Errorf("%w: invalid dueAt", ErrInvalidInput))
			return
		}
	}
	row, err := h.svc.AppendCommitmentTransition(r.Context(), u, relationshipID, commitmentID, CommitmentTransitionInput{
		Kind: body.Kind, IdempotencyKey: body.IdempotencyKey, Reason: body.Reason,
		DueAt: dueAt, Action: body.Action, Blocker: body.Blocker, EvidenceRefs: body.EvidenceRefs,
	})
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, commitmentToDTO(row))
}

// CommitmentEvents returns the replayable event history for one commitment.
func (h *Handler) CommitmentEvents(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.viewer(w, r); !ok {
		return
	}
	relationshipID, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	commitmentID, ok := pathUUID(w, r, "commitmentId")
	if !ok {
		return
	}
	events, err := h.svc.CommitmentEventHistory(r.Context(), relationshipID, commitmentID)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	result := make([]commitmentEventDTO, 0, len(events))
	for _, event := range events {
		result = append(result, commitmentEventToDTO(commitmentID, event))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"events": result})
}

// CreateMutualActionPlan creates a plan draft from accepted commitments.
func (h *Handler) CreateMutualActionPlan(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	relationshipID, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	var body struct {
		CommitmentIDs []string `json:"commitmentIds"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	ids := make([]uuid.UUID, 0, len(body.CommitmentIDs))
	for _, raw := range body.CommitmentIDs {
		id, err := uuid.Parse(raw)
		if err != nil {
			h.writeServiceError(w, fmt.Errorf("%w: invalid commitment id", ErrInvalidInput))
			return
		}
		ids = append(ids, id)
	}
	plan, err := h.svc.CreateMutualActionPlan(r.Context(), u, relationshipID, ids)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, plan)
}

// ReviseMutualActionPlan appends a validated replacement revision.
func (h *Handler) ReviseMutualActionPlan(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	relationshipID, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	var body struct {
		Items []MutualActionPlanItem `json:"items"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	plan, err := h.svc.ReviseMutualActionPlan(r.Context(), u, relationshipID, chi.URLParam(r, "planId"), body.Items)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, plan)
}

// ApproveMutualActionPlan approves the exact current revision.
func (h *Handler) ApproveMutualActionPlan(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	relationshipID, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	plan, err := h.svc.ApproveMutualActionPlan(r.Context(), u, relationshipID, chi.URLParam(r, "planId"))
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, plan)
}

// ShareMutualActionPlan creates a governed token and queued draft action.
func (h *Handler) ShareMutualActionPlan(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	relationshipID, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	plan, token, err := h.svc.ShareMutualActionPlan(r.Context(), u, relationshipID, chi.URLParam(r, "planId"))
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"plan": plan, "responseToken": token})
}

func planToken(r *http.Request) string {
	return strings.TrimSpace(r.Header.Get("X-Oppulence-Plan-Token"))
}

// GetPublicMutualActionPlan serves a redacted token-scoped plan.
func (h *Handler) GetPublicMutualActionPlan(w http.ResponseWriter, r *http.Request) {
	plan, err := h.svc.PublicMutualActionPlan(r.Context(), planToken(r))
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"plan": plan})
}

// ReceivePublicMutualActionPlanResponse records an external proposal for review.
func (h *Handler) ReceivePublicMutualActionPlanResponse(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ResponseID    string `json:"responseId"`
		Kind          string `json:"kind"`
		ItemID        string `json:"itemId"`
		ProposedValue string `json:"proposedValue"`
		Comment       string `json:"comment"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	responseID, err := h.svc.ReceiveMutualActionPlanResponse(r.Context(), planToken(r), PublicMutualActionPlanResponse{
		ResponseID: body.ResponseID, Kind: body.Kind, ItemID: body.ItemID,
		ProposedValue: body.ProposedValue, Comment: body.Comment,
	})
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"responseId": responseID, "recorded": true})
}

// GetConversationPolicy returns applicable layers and the effective policy.
func (h *Handler) GetConversationPolicy(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	relationshipID, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	rel, err := h.svc.GetRelationship(r.Context(), relationshipID)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	ws, err := h.svc.CurrentWorkspace(r.Context(), u)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	layers, err := h.svc.conversationPolicyLayersFor(r.Context(), h.svc.client, ws, rel)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	effective := resolveConversationPolicyLayers(layers, h.svc.now())
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"layers": layers, "effectivePolicy": effective})
}

// PutConversationPolicy appends validated policy-layer versions.
func (h *Handler) PutConversationPolicy(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	relationshipID, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	var body struct {
		Layers []ConversationPolicyLayer `json:"layers"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	effective, err := h.svc.SaveConversationPolicyLayers(r.Context(), u, relationshipID, body.Layers)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"effectivePolicy": effective})
}

// RequestConversationDeletion executes a legal-hold-aware deletion request.
func (h *Handler) RequestConversationDeletion(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	relationshipID, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	var body struct {
		RequestID string `json:"requestId"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	receipt, err := h.svc.RequestConversationDeletion(r.Context(), u, relationshipID, body.RequestID)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, receipt)
}

// ListIdentityCandidates returns the workspace review inbox with bounded
// filters and complete decision/lineage history.
func (h *Handler) ListIdentityCandidates(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	filter := IdentityCandidateFilter{
		Status: r.URL.Query().Get("status"),
		Source: r.URL.Query().Get("source"),
	}
	if raw := r.URL.Query().Get("relationshipId"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			h.writeServiceError(w, fmt.Errorf("%w: invalid relationshipId", ErrInvalidInput))
			return
		}
		filter.RelationshipID = id
	}
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil {
			h.writeServiceError(w, fmt.Errorf("%w: invalid limit", ErrInvalidInput))
			return
		}
		filter.Limit = limit
	}
	candidates, err := h.svc.ListIdentityCandidates(r.Context(), u, filter)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	out := make([]identityCandidateDTO, 0, len(candidates))
	for _, candidate := range candidates {
		dto, err := identityCandidateToDTO(candidate)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		out = append(out, dto)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"candidates": out})
}

// GetIdentityCandidate returns one tenant-scoped identity ambiguity and lineage.
func (h *Handler) GetIdentityCandidate(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "candidateId")
	if !ok {
		return
	}
	candidate, err := h.svc.GetIdentityCandidate(r.Context(), u, id)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	h.svc.recordIdentityCandidateViewed(r.Context(), u, candidate)
	dto, err := identityCandidateToDTO(candidate)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, dto)
}

// DecideIdentityCandidate applies a version-bound human identity decision.
func (h *Handler) DecideIdentityCandidate(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "candidateId")
	if !ok {
		return
	}
	var body struct {
		Decision        string `json:"decision"`
		Reason          string `json:"reason"`
		ExpectedVersion int    `json:"expectedVersion"`
		IdempotencyKey  string `json:"idempotencyKey"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	candidate, err := h.svc.DecideIdentityCandidate(r.Context(), u, id, IdentityDecisionInput{
		Decision: body.Decision, Reason: body.Reason, ExpectedVersion: body.ExpectedVersion,
		IdempotencyKey: body.IdempotencyKey,
	})
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	dto, err := identityCandidateToDTO(candidate)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, dto)
}

// ListRelationshipAttention returns the durable portfolio review queue.
func (h *Handler) ListRelationshipAttention(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil {
			h.writeServiceError(w, fmt.Errorf("%w: invalid limit", ErrInvalidInput))
			return
		}
		limit = value
	}
	items, err := h.svc.ListRelationshipAttention(r.Context(), u, r.URL.Query().Get("status"), limit)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	out := make([]relationshipAttentionDTO, 0, len(items))
	for _, item := range items {
		dto, err := relationshipAttentionToDTO(item)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		out = append(out, dto)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"contractVersion": "relationship-attention.v1", "asOf": h.svc.now().UTC(), "items": out,
	})
}

// DecideRelationshipAttention acknowledges, snoozes, or dismisses a queue item.
func (h *Handler) DecideRelationshipAttention(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "attentionId")
	if !ok {
		return
	}
	var body struct {
		Decision        string     `json:"decision"`
		Reason          string     `json:"reason"`
		ExpectedVersion int        `json:"expectedVersion"`
		SnoozedUntil    *time.Time `json:"snoozedUntil"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	item, err := h.svc.DecideRelationshipAttention(r.Context(), u, id, AttentionDecisionInput{
		Decision: body.Decision, Reason: body.Reason, ExpectedVersion: body.ExpectedVersion,
		SnoozedUntil: body.SnoozedUntil,
	})
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	dto, err := relationshipAttentionToDTO(item)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, dto)
}

// IngestRelationshipObservations is the shared adapter/desktop append-only
// ingestion contract.
func (h *Handler) IngestRelationshipObservations(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	var body struct {
		Observations []struct {
			RelationshipID  string                         `json:"relationshipId"`
			DisplayName     string                         `json:"displayName"`
			PrimaryEmail    string                         `json:"primaryEmail"`
			AccountDomain   string                         `json:"accountDomain"`
			ResourceRefs    []string                       `json:"resourceRefs"`
			Source          string                         `json:"source"`
			SourceAccountID string                         `json:"sourceAccountId"`
			ExternalID      string                         `json:"externalId"`
			SourceVersion   string                         `json:"sourceVersion"`
			EventType       string                         `json:"eventType"`
			OccurredAt      *time.Time                     `json:"occurredAt"`
			ReceivedAt      *time.Time                     `json:"receivedAt"`
			Summary         string                         `json:"summary"`
			Facts           map[string]any                 `json:"normalizedFacts"`
			Payload         json.RawMessage                `json:"payload"`
			Participants    []RelationshipParticipantInput `json:"participants"`
			Assertions      []RelationshipAssertionInput   `json:"assertions"`
			Channel         string                         `json:"channel"`
			Direction       string                         `json:"direction"`
		} `json:"observations"`
	}
	if !httpx.DecodeJSON(w, r, maxObservationBody, &body) {
		return
	}
	inputs := make([]RelationshipObservationInput, 0, len(body.Observations))
	for _, observation := range body.Observations {
		input := RelationshipObservationInput{
			DisplayName:     observation.DisplayName,
			PrimaryEmail:    observation.PrimaryEmail,
			AccountDomain:   observation.AccountDomain,
			ResourceRefs:    observation.ResourceRefs,
			Source:          observation.Source,
			SourceAccountID: observation.SourceAccountID,
			ExternalID:      observation.ExternalID,
			SourceVersion:   observation.SourceVersion,
			EventType:       observation.EventType,
			Summary:         observation.Summary,
			Facts:           observation.Facts,
			Payload:         observation.Payload,
			Participants:    observation.Participants,
			Assertions:      observation.Assertions,
			Channel:         observation.Channel,
			Direction:       observation.Direction,
		}
		if observation.RelationshipID != "" {
			id, err := uuid.Parse(observation.RelationshipID)
			if err != nil {
				httpx.Error(w, http.StatusBadRequest, "invalid relationshipId", "invalid_id")
				return
			}
			input.RelationshipID = id
		}
		if observation.OccurredAt != nil {
			input.OccurredAt = *observation.OccurredAt
		}
		if observation.ReceivedAt != nil {
			input.ReceivedAt = *observation.ReceivedAt
		}
		inputs = append(inputs, input)
	}
	results, err := h.svc.IngestRelationshipObservations(r.Context(), u, inputs)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	out := make([]map[string]any, 0, len(results))
	for _, result := range results {
		projectionJobID := ""
		if result.ProjectionJobID != uuid.Nil {
			projectionJobID = result.ProjectionJobID.String()
		}
		out = append(out, map[string]any{
			"observation":      observationToDTO(result.Observation),
			"relationship":     relationshipToDTO(result.Relationship),
			"duplicate":        result.Duplicate,
			"projectionStatus": result.ProjectionStatus,
			"projectionJobId":  projectionJobID,
		})
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"results": out})
}

// RelationshipTimeline returns the relationship's immutable observation timeline.
func (h *Handler) RelationshipTimeline(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.viewer(w, r); !ok {
		return
	}
	id, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	limit := 50
	if value := r.URL.Query().Get("limit"); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil {
			limit = parsed
		}
	}
	observations, err := h.svc.RelationshipTimeline(r.Context(), id, limit)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	out := make([]observationDTO, 0, len(observations))
	for _, observation := range observations {
		out = append(out, observationToDTO(observation))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"observations": out})
}

// RelationshipChanges returns projected state changes for a relationship.
func (h *Handler) RelationshipChanges(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.viewer(w, r); !ok {
		return
	}
	id, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	snapshots, err := h.svc.RelationshipChanges(r.Context(), id)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	out := make([]snapshotDTO, 0, len(snapshots))
	for _, snapshot := range snapshots {
		out = append(out, snapshotToDTO(snapshot))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"snapshots": out})
}

// RelationshipEvidence returns a single evidence record and its source references.
func (h *Handler) RelationshipEvidence(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.viewer(w, r); !ok {
		return
	}
	relationshipID, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	evidenceID, ok := pathUUID(w, r, "evidenceId")
	if !ok {
		return
	}
	observation, payload, err := h.svc.RelationshipObservationPayload(
		r.Context(), relationshipID, evidenceID,
	)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	var decoded any
	if len(payload) > 0 {
		if err := json.Unmarshal(payload, &decoded); err != nil {
			decoded = string(payload)
		}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"observation": observationToDTO(observation),
		"payload":     decoded,
	})
}

// CorrectRelationship appends a user correction and reprojects relationship state.
func (h *Handler) CorrectRelationship(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	var body struct {
		Dimension             string     `json:"dimension"`
		Value                 string     `json:"value"`
		Reason                string     `json:"reason"`
		SupersedesAssertionID string     `json:"supersedesAssertionId"`
		ValidTo               *time.Time `json:"validTo"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	rel, err := h.svc.CorrectRelationship(r.Context(), u, id, RelationshipCorrectionInput{
		Dimension:             body.Dimension,
		Value:                 body.Value,
		Reason:                body.Reason,
		SupersedesAssertionID: body.SupersedesAssertionID,
		ValidTo:               body.ValidTo,
	})
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, relationshipToDTO(rel))
}

// RetractRelationshipAssertion ends one user correction without rewriting its
// immutable history and returns the resulting canonical relationship state.
func (h *Handler) RetractRelationshipAssertion(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	relationshipID, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	assertionID, ok := pathUUID(w, r, "assertionId")
	if !ok {
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	rel, err := h.svc.RetractRelationshipAssertion(
		r.Context(), u, relationshipID, assertionID, body.Reason,
	)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, relationshipToDTO(rel))
}

// RelationshipSourceStatuses returns ingestion status for configured relationship sources.
func (h *Handler) RelationshipSourceStatuses(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	statuses, err := h.svc.RelationshipSourceStatuses(r.Context(), u)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	out := make([]sourceStatusDTO, 0, len(statuses))
	for _, status := range statuses {
		out = append(out, sourceStatusToDTO(status))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"sources": out})
}

// BetaDiagnostics exports tenant-scoped, content-free support diagnostics.
func (h *Handler) BetaDiagnostics(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	diagnostics, err := h.svc.BetaDiagnostics(r.Context(), u)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, diagnostics)
}

// RelationshipSourceInventory returns guided connector and lifecycle cards.
func (h *Handler) RelationshipSourceInventory(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	inventory, err := h.svc.RelationshipSourceInventory(r.Context(), u)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	type inventoryItem struct {
		SourceDescriptor
		Accounts []sourceStatusDTO `json:"accounts"`
	}
	out := make([]inventoryItem, 0, len(inventory))
	for _, item := range inventory {
		accounts := make([]sourceStatusDTO, 0, len(item.Accounts))
		for _, account := range item.Accounts {
			accounts = append(accounts, sourceStatusToDTO(account))
		}
		out = append(out, inventoryItem{SourceDescriptor: item.SourceDescriptor, Accounts: accounts})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"sources": out})
}

// BeginSourceBackfill queues bounded work for an authorized provider account.
func (h *Handler) BeginSourceBackfill(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	var body struct {
		SourceAccountID string `json:"sourceAccountId"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	status, err := h.svc.BeginSourceBackfill(
		r.Context(), u, chi.URLParam(r, "source"), body.SourceAccountID,
	)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, sourceStatusToDTO(status))
}

// ReportSourceAuthorization records a bounded provider-consent transition.
func (h *Handler) ReportSourceAuthorization(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	var body struct {
		SourceAccountID string   `json:"sourceAccountId"`
		State           string   `json:"state"`
		GrantedScopes   []string `json:"grantedScopes"`
		ErrorCode       string   `json:"errorCode"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	status, err := h.svc.ReportSourceAuthorization(r.Context(), u, chi.URLParam(r, "source"), SourceAuthorizationInput{
		SourceAccountID: body.SourceAccountID, State: body.State,
		GrantedScopes: body.GrantedScopes, ErrorCode: body.ErrorCode,
	})
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, sourceStatusToDTO(status))
}

// DisconnectRelationshipSource makes a tenant source disconnect explicit.
func (h *Handler) DisconnectRelationshipSource(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	status, err := h.svc.MarkSourceDisconnected(
		r.Context(), u, chi.URLParam(r, "source"), chi.URLParam(r, "sourceAccountId"),
	)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, sourceStatusToDTO(status))
}

// --- action endpoints --------------------------------------------------------

// ListActions lists/filters the action queue (default: top-ten open).
func (h *Handler) ListActions(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	f := ListFilter{QueueStatus: r.URL.Query().Get("queueStatus")}
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			f.Limit = n
		}
	}
	actions, err := h.svc.ListActions(r.Context(), u, f)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	out := make([]actionDTO, 0, len(actions))
	for _, a := range actions {
		out = append(out, actionToDTO(a))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"actions": out})
}

// CreateAction proposes a manual queue action.
func (h *Handler) CreateAction(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	var body struct {
		RelationshipID   string         `json:"relationshipId"`
		ActionType       string         `json:"actionType"`
		Channel          string         `json:"channel"`
		Reason           string         `json:"reason"`
		RecipientEmail   string         `json:"recipientEmail"`
		ProposedSubject  string         `json:"proposedSubject"`
		ProposedMessage  string         `json:"proposedMessage"`
		SenderAccountRef string         `json:"senderAccountRef"`
		ExecutionMode    string         `json:"executionMode"`
		PriorityScore    int            `json:"priorityScore"`
		PriorityParts    map[string]int `json:"priorityComponents"`
		DueAt            *time.Time     `json:"dueAt"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	relID, err := uuid.Parse(body.RelationshipID)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid relationshipId", "invalid_id")
		return
	}
	action, err := h.svc.CreateAction(r.Context(), u, ActionInput{
		RelationshipID:   relID,
		ActionType:       body.ActionType,
		Channel:          body.Channel,
		Reason:           body.Reason,
		RecipientEmail:   body.RecipientEmail,
		ProposedSubject:  body.ProposedSubject,
		ProposedMessage:  body.ProposedMessage,
		SenderAccountRef: body.SenderAccountRef,
		ExecutionMode:    body.ExecutionMode,
		PriorityScore:    body.PriorityScore,
		PriorityParts:    body.PriorityParts,
		DueAt:            body.DueAt,
	})
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, actionToDTO(action))
}

// GetAction returns one action.
func (h *Handler) GetAction(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.viewer(w, r); !ok {
		return
	}
	id, ok := pathUUID(w, r, "actionId")
	if !ok {
		return
	}
	action, err := h.svc.GetAction(r.Context(), id)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, actionToDTO(action))
}

// Audit returns the observe → decision → approval → execution → outcome chain.
func (h *Handler) Audit(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.viewer(w, r); !ok {
		return
	}
	id, ok := pathUUID(w, r, "actionId")
	if !ok {
		return
	}
	action, err := h.svc.Audit(r.Context(), id)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	decisions := make([]decisionDTO, 0)
	if list, err := action.Edges.DecisionsOrErr(); err == nil {
		for _, d := range list {
			decisions = append(decisions, decisionToDTO(d))
		}
	}
	outcomes := make([]outcomeDTO, 0)
	if list, err := action.Edges.OutcomesOrErr(); err == nil {
		for _, o := range list {
			outcomes = append(outcomes, outcomeToDTO(o))
		}
	}
	revisions := make([]map[string]any, 0)
	if list, err := action.Edges.RevisionsOrErr(); err == nil {
		for _, rev := range list {
			revisions = append(revisions, map[string]any{
				"revision":     rev.Revision,
				"revisionHash": rev.RevisionHash,
				"actionType":   rev.ActionType,
				"channel":      rev.Channel,
				"createdAt":    rev.CreatedAt,
			})
		}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"action":    actionToDTO(action),
		"revisions": revisions,
		"decisions": decisions,
		"outcomes":  outcomes,
	})
}

// Evaluate requests/retries the OutboundConsole preflight.
func (h *Handler) Evaluate(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "actionId")
	if !ok {
		return
	}
	snap, err := h.svc.Evaluate(r.Context(), u, id)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, decisionToDTO(snap))
}

// Edit creates a new revision and invalidates policy/approval.
func (h *Handler) Edit(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "actionId")
	if !ok {
		return
	}
	var body struct {
		Reason           *string `json:"reason"`
		RecipientEmail   *string `json:"recipientEmail"`
		ProposedSubject  *string `json:"proposedSubject"`
		ProposedMessage  *string `json:"proposedMessage"`
		SenderAccountRef *string `json:"senderAccountRef"`
		Channel          *string `json:"channel"`
		ActionType       *string `json:"actionType"`
		ExecutionMode    *string `json:"executionMode"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	action, err := h.svc.EditAction(r.Context(), u, id, EditInput{
		Reason:           body.Reason,
		RecipientEmail:   body.RecipientEmail,
		ProposedSubject:  body.ProposedSubject,
		ProposedMessage:  body.ProposedMessage,
		SenderAccountRef: body.SenderAccountRef,
		Channel:          body.Channel,
		ActionType:       body.ActionType,
		ExecutionMode:    body.ExecutionMode,
	})
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, actionToDTO(action))
}

// Snooze parks the action until a bounded timestamp.
func (h *Handler) Snooze(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "actionId")
	if !ok {
		return
	}
	var body struct {
		Until time.Time `json:"until"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	action, err := h.svc.Snooze(r.Context(), u, id, body.Until)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, actionToDTO(action))
}

// Dismiss removes the action from the queue with a reason label.
func (h *Handler) Dismiss(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "actionId")
	if !ok {
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	action, err := h.svc.Dismiss(r.Context(), u, id, body.Reason)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, actionToDTO(action))
}

// Approve approves the current passed, unexpired revision.
func (h *Handler) Approve(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "actionId")
	if !ok {
		return
	}
	var body struct {
		AcceptRisk bool `json:"acceptRisk"`
	}
	// The body is optional: a plain approve needs no options.
	if r.ContentLength != 0 && !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	action, err := h.svc.Approve(r.Context(), u, id, body.AcceptRisk)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, actionToDTO(action))
}

// Reject rejects the current revision with a reason.
func (h *Handler) Reject(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "actionId")
	if !ok {
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	action, err := h.svc.Reject(r.Context(), u, id, body.Reason)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, actionToDTO(action))
}

// ApproveRecommendation is the relationship-intelligence alias for the
// existing governed RevenueAction approval lifecycle.
func (h *Handler) ApproveRecommendation(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "recommendationId")
	if !ok {
		return
	}
	var body struct {
		AcceptRisk bool `json:"acceptRisk"`
	}
	if r.ContentLength != 0 && !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	action, err := h.svc.Approve(r.Context(), u, id, body.AcceptRisk)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, actionToDTO(action))
}

// RejectRecommendation records rejection of a governed recommendation revision.
func (h *Handler) RejectRecommendation(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "recommendationId")
	if !ok {
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	action, err := h.svc.Reject(r.Context(), u, id, body.Reason)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, actionToDTO(action))
}

// Execute performs the approved action exactly once.
func (h *Handler) Execute(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "actionId")
	if !ok {
		return
	}
	action, err := h.svc.Execute(r.Context(), u, id)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, actionToDTO(action))
}

// AppendOutcome records an observed outcome (idempotent on source event).
func (h *Handler) AppendOutcome(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "actionId")
	if !ok {
		return
	}
	var body struct {
		Kind          string         `json:"kind"`
		Source        string         `json:"source"`
		SourceEventID string         `json:"sourceEventId"`
		OccurredAt    *time.Time     `json:"occurredAt"`
		Metadata      map[string]any `json:"metadata"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	in := OutcomeInput{
		Kind:          body.Kind,
		Source:        body.Source,
		SourceEventID: body.SourceEventID,
		Metadata:      body.Metadata,
	}
	if body.OccurredAt != nil {
		in.OccurredAt = *body.OccurredAt
	}
	outcome, err := h.svc.AppendOutcome(r.Context(), u, id, in)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, outcomeToDTO(outcome))
}
