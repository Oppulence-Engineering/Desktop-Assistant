package revenue

import (
	"encoding/json"
	"errors"
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

// Handler serves the RFC 030 revenue API surface.
type Handler struct {
	svc *Service
	log *zap.Logger
}

// NewHandler builds the revenue HTTP handler.
func NewHandler(svc *Service, log *zap.Logger) *Handler {
	return &Handler{svc: svc, log: log}
}

// Mount registers the revenue routes on an authenticated router group.
func (h *Handler) Mount(r chi.Router) {
	r.Route("/v1/revenue-workspaces", func(r chi.Router) {
		r.Get("/current", h.CurrentWorkspace)
		r.Post("/link", h.LinkWorkspace)
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
		r.Get("/{relationshipId}", h.GetRelationship)
		r.Get("/{relationshipId}/timeline", h.RelationshipTimeline)
		r.Get("/{relationshipId}/changes", h.RelationshipChanges)
		r.Get("/{relationshipId}/evidence/{evidenceId}", h.RelationshipEvidence)
		r.Post("/{relationshipId}/corrections", h.CorrectRelationship)
	})
	r.Post("/v1/relationship-observations/batch", h.IngestRelationshipObservations)
	r.Get("/v1/relationship-sources/status", h.RelationshipSourceStatuses)
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
	ID            string     `json:"id"`
	Kind          string     `json:"kind"`
	DisplayName   string     `json:"displayName"`
	PrimaryEmail  string     `json:"primaryEmail,omitempty"`
	AccountDomain string     `json:"accountDomain,omitempty"`
	Summary       string     `json:"summary,omitempty"`
	Status        string     `json:"status"`
	LastTouchAt   *time.Time `json:"lastTouchAt,omitempty"`
	NextActionAt  *time.Time `json:"nextActionAt,omitempty"`
	OpenActions   int        `json:"openActions,omitempty"`
	NextAction    string     `json:"nextAction,omitempty"`
	Lifecycle     string     `json:"lifecycle"`
	Engagement    string     `json:"engagement"`
	Sentiment     string     `json:"sentiment"`
	Health        string     `json:"health"`
	StateReason   string     `json:"stateReason,omitempty"`
	StateVersion  int        `json:"stateVersion"`
	LastChangedAt *time.Time `json:"lastChangedAt,omitempty"`
	Risks         []string   `json:"risks"`
	Milestones    []string   `json:"milestones"`
}

func relationshipToDTO(rel *ent.Relationship) relationshipDTO {
	return relationshipDTO{
		ID:            rel.ID.String(),
		Kind:          rel.Kind,
		DisplayName:   rel.DisplayName,
		PrimaryEmail:  rel.PrimaryEmail,
		AccountDomain: rel.AccountDomain,
		Summary:       rel.Summary,
		Status:        rel.Status,
		LastTouchAt:   rel.LastTouchAt,
		NextActionAt:  rel.NextActionAt,
		NextAction:    rel.NextAction,
		Lifecycle:     rel.Lifecycle,
		Engagement:    rel.Engagement,
		Sentiment:     rel.Sentiment,
		Health:        rel.Health,
		StateReason:   rel.StateReason,
		StateVersion:  rel.StateVersion,
		LastChangedAt: rel.LastChangedAt,
		Risks:         rel.Risks,
		Milestones:    rel.Milestones,
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
}

func participantToDTO(participant *ent.RelationshipParticipant) participantDTO {
	return participantDTO{
		ID:           participant.ID.String(),
		DisplayName:  participant.DisplayName,
		Email:        participant.Email,
		Role:         participant.Role,
		Title:        participant.Title,
		Active:       participant.Active,
		ExternalRefs: participant.ExternalRefs,
	}
}

type commitmentDTO struct {
	ID            string     `json:"id"`
	Direction     string     `json:"direction"`
	Text          string     `json:"text"`
	Status        string     `json:"status"`
	DueAt         *time.Time `json:"dueAt,omitempty"`
	Confidence    float64    `json:"confidence"`
	UserConfirmed bool       `json:"userConfirmed"`
}

func commitmentToDTO(commitment *ent.Commitment) commitmentDTO {
	return commitmentDTO{
		ID:            commitment.ID.String(),
		Direction:     commitment.Direction,
		Text:          commitment.Text,
		Status:        commitment.Status,
		DueAt:         commitment.DueAt,
		Confidence:    commitment.Confidence,
		UserConfirmed: commitment.UserConfirmed,
	}
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
	ChangedDimensions []string       `json:"changedDimensions"`
	AssertionIDs      []string       `json:"assertionIds"`
	CreatedAt         time.Time      `json:"createdAt"`
}

func snapshotToDTO(snapshot *ent.RelationshipStateSnapshot) snapshotDTO {
	state := map[string]any{}
	_ = json.Unmarshal([]byte(snapshot.StateJSON), &state)
	return snapshotDTO{
		ID:                snapshot.ID.String(),
		Version:           snapshot.Version,
		State:             state,
		ChangedDimensions: snapshot.ChangedDimensions,
		AssertionIDs:      snapshot.AssertionIds,
		CreatedAt:         snapshot.CreatedAt,
	}
}

type sourceStatusDTO struct {
	Source            string     `json:"source"`
	SourceAccountID   string     `json:"sourceAccountId"`
	Status            string     `json:"status"`
	LastSuccessAt     *time.Time `json:"lastSuccessAt,omitempty"`
	LastObservationAt *time.Time `json:"lastObservationAt,omitempty"`
	LastError         string     `json:"lastError,omitempty"`
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
	ID                 string          `json:"id"`
	RelationshipID     string          `json:"relationshipId,omitempty"`
	ActionType         string          `json:"actionType"`
	Channel            string          `json:"channel"`
	Detector           string          `json:"detector"`
	Revision           int             `json:"revision"`
	RevisionHash       string          `json:"revisionHash"`
	Reason             string          `json:"reason"`
	RecipientEmail     string          `json:"recipientEmail,omitempty"`
	ProposedSubject    string          `json:"proposedSubject,omitempty"`
	ProposedMessage    string          `json:"proposedMessage,omitempty"`
	SenderAccountRef   string          `json:"senderAccountRef,omitempty"`
	PriorityScore      int             `json:"priorityScore"`
	PriorityComponents json.RawMessage `json:"priorityComponents,omitempty"`
	QueueStatus        string          `json:"queueStatus"`
	PolicyStatus       string          `json:"policyStatus"`
	ApprovalStatus     string          `json:"approvalStatus"`
	ExecutionStatus    string          `json:"executionStatus"`
	ExecutionOwner     string          `json:"executionOwner"`
	ExecutionMode      string          `json:"executionMode"`
	ApprovedRevision   int             `json:"approvedRevision,omitempty"`
	ApprovedAt         *time.Time      `json:"approvedAt,omitempty"`
	ProviderMessageID  string          `json:"providerMessageId,omitempty"`
	ProviderThreadID   string          `json:"providerThreadId,omitempty"`
	ExecutedAt         *time.Time      `json:"executedAt,omitempty"`
	ExecutionError     string          `json:"executionError,omitempty"`
	DismissReason      string          `json:"dismissReason,omitempty"`
	SnoozedUntil       *time.Time      `json:"snoozedUntil,omitempty"`
	DueAt              *time.Time      `json:"dueAt,omitempty"`
	CreatedAt          time.Time       `json:"createdAt"`
	UpdatedAt          time.Time       `json:"updatedAt"`
}

func actionToDTO(a *ent.RevenueAction) actionDTO {
	dto := actionDTO{
		ID:                a.ID.String(),
		ActionType:        a.ActionType,
		Channel:           a.Channel,
		Detector:          a.Detector,
		Revision:          a.Revision,
		RevisionHash:      a.RevisionHash,
		Reason:            a.Reason,
		RecipientEmail:    a.RecipientEmail,
		ProposedSubject:   a.ProposedSubject,
		ProposedMessage:   a.ProposedMessage,
		SenderAccountRef:  a.SenderAccountRef,
		PriorityScore:     a.PriorityScore,
		QueueStatus:       a.QueueStatus,
		PolicyStatus:      a.PolicyStatus,
		ApprovalStatus:    a.ApprovalStatus,
		ExecutionStatus:   a.ExecutionStatus,
		ExecutionOwner:    a.ExecutionOwner,
		ExecutionMode:     a.ExecutionMode,
		ApprovedRevision:  a.ApprovedRevision,
		ApprovedAt:        a.ApprovedAt,
		ProviderMessageID: a.ProviderMessageID,
		ProviderThreadID:  a.ProviderThreadID,
		ExecutedAt:        a.ExecutedAt,
		ExecutionError:    a.ExecutionError,
		DismissReason:     a.DismissReason,
		SnoozedUntil:      a.SnoozedUntil,
		DueAt:             a.DueAt,
		CreatedAt:         a.CreatedAt,
		UpdatedAt:         a.UpdatedAt,
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
		Kind          string `json:"kind"`
		DisplayName   string `json:"displayName"`
		PrimaryEmail  string `json:"primaryEmail"`
		AccountDomain string `json:"accountDomain"`
		Summary       string `json:"summary"`
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
	})
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, relationshipToDTO(rel))
}

// GetRelationship returns one relationship with its open loops.
func (h *Handler) GetRelationship(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.viewer(w, r); !ok {
		return
	}
	id, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	rel, err := h.svc.GetRelationship(r.Context(), id)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
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
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"relationship":    dto,
		"actions":         actions,
		"recommendations": actions,
		"participants":    participants,
		"commitments":     commitments,
	})
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
		} `json:"observations"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	inputs := make([]RelationshipObservationInput, 0, len(body.Observations))
	for _, observation := range body.Observations {
		input := RelationshipObservationInput{
			DisplayName:     observation.DisplayName,
			PrimaryEmail:    observation.PrimaryEmail,
			AccountDomain:   observation.AccountDomain,
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
		out = append(out, map[string]any{
			"observation":  observationToDTO(result.Observation),
			"relationship": relationshipToDTO(result.Relationship),
			"duplicate":    result.Duplicate,
		})
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"results": out})
}

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
		Dimension             string `json:"dimension"`
		Value                 string `json:"value"`
		Reason                string `json:"reason"`
		SupersedesAssertionID string `json:"supersedesAssertionId"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	rel, err := h.svc.CorrectRelationship(r.Context(), u, id, RelationshipCorrectionInput{
		Dimension:             body.Dimension,
		Value:                 body.Value,
		Reason:                body.Reason,
		SupersedesAssertionID: body.SupersedesAssertionID,
	})
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, relationshipToDTO(rel))
}

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
		out = append(out, sourceStatusDTO{
			Source:            status.Source,
			SourceAccountID:   status.SourceAccountID,
			Status:            status.Status,
			LastSuccessAt:     status.LastSuccessAt,
			LastObservationAt: status.LastObservationAt,
			LastError:         status.LastError,
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"sources": out})
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
