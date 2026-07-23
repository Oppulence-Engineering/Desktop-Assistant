package actions

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
)

// maxBody bounds action request bodies; every payload is a small envelope.
const maxBody = 256 << 10

// Handler serves the RFC 023 closed-loop action API surface.
type Handler struct {
	broker *Broker
	// stepUp reports whether the request's actor meets recent-auth step-up. It
	// is consulted for every approval; the broker decides whether a given
	// (financial) proposal actually requires it. nil ⇒ never satisfied (fail
	// closed for financial approvals).
	stepUp func(*http.Request) bool
	log    *zap.Logger
}

// NewHandler builds the action HTTP handler. stepUp may be nil.
func NewHandler(broker *Broker, stepUp func(*http.Request) bool, log *zap.Logger) *Handler {
	return &Handler{broker: broker, stepUp: stepUp, log: log}
}

// Mount registers the action routes on an authenticated router group.
func (h *Handler) Mount(r chi.Router) {
	r.Route("/v1/action-proposals", func(r chi.Router) {
		r.Post("/", h.Propose)
		r.Get("/", h.ListPending)
		r.Get("/{id}", h.Get)
		r.Post("/{id}/approve", h.Approve)
		r.Post("/{id}/reject", h.Reject)
		r.Post("/{id}/execute", h.Execute)
	})
	// Per-object audit chain. The resourceRef (e.g. "conduit:invoice:inv_456")
	// contains colons, so it is taken as the trailing wildcard segment.
	r.Get("/v1/objects/{resourceRef}/audit", h.Audit)
}

// proposalDTO is the wire shape of a proposal (no token material).
type proposalDTO struct {
	ID            string     `json:"id"`
	Target        string     `json:"target"`
	Kind          string     `json:"kind"`
	ParamsJSON    string     `json:"paramsJson,omitempty"`
	Financial     bool       `json:"financial"`
	Rationale     string     `json:"rationale,omitempty"`
	Status        string     `json:"status"`
	CorrelationID string     `json:"correlationId,omitempty"`
	EntityID      string     `json:"entityId,omitempty"`
	OriginRunID   string     `json:"originRunId,omitempty"`
	ResultRef     string     `json:"resultRef,omitempty"`
	Reason        string     `json:"reason,omitempty"`
	ApprovedAt    *time.Time `json:"approvedAt,omitempty"`
	ExecutedAt    *time.Time `json:"executedAt,omitempty"`
	CreatedAt     time.Time  `json:"createdAt"`
}

func toDTO(p *ent.ActionProposal) proposalDTO {
	return proposalDTO{
		ID:            p.ID.String(),
		Target:        p.Target,
		Kind:          p.Kind,
		ParamsJSON:    p.ParamsJSON,
		Financial:     p.Financial,
		Rationale:     p.Rationale,
		Status:        p.Status,
		CorrelationID: p.CorrelationID,
		EntityID:      p.EntityID,
		OriginRunID:   p.OriginRunID,
		ResultRef:     p.ResultRef,
		Reason:        p.Reason,
		ApprovedAt:    p.ApprovedAt,
		ExecutedAt:    p.ExecutedAt,
		CreatedAt:     p.CreatedAt,
	}
}

// Propose creates a pending proposal. In production the runtime's propose-only
// tool calls the broker directly; this endpoint lets the cockpit (and tests)
// create proposals over HTTP.
func (h *Handler) Propose(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	var body struct {
		Target        string `json:"target"`
		Kind          string `json:"kind"`
		ParamsJSON    string `json:"paramsJson"`
		Financial     bool   `json:"financial"`
		Rationale     string `json:"rationale"`
		EntityID      string `json:"entityId"`
		OriginRunID   string `json:"originRunId"`
		CorrelationID string `json:"correlationId"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	p, err := h.broker.Propose(r.Context(), u, ProposeInput{
		Target:        body.Target,
		Kind:          body.Kind,
		ParamsJSON:    body.ParamsJSON,
		Financial:     body.Financial,
		Rationale:     body.Rationale,
		EntityID:      body.EntityID,
		OriginRunID:   body.OriginRunID,
		CorrelationID: body.CorrelationID,
	})
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, toDTO(p))
}

// ListPending returns the operator's pending proposals.
func (h *Handler) ListPending(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.viewer(w, r); !ok {
		return
	}
	// Only the pending queue is exposed; a non-pending filter is a no-op.
	if s := strings.TrimSpace(r.URL.Query().Get("status")); s != "" && s != StatusPending {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"proposals": []proposalDTO{}})
		return
	}
	list, err := h.broker.ListPending(r.Context())
	if err != nil {
		h.writeError(w, err)
		return
	}
	out := make([]proposalDTO, 0, len(list))
	for _, p := range list {
		out = append(out, toDTO(p))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"proposals": out})
}

// Get returns a single proposal.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.viewer(w, r); !ok {
		return
	}
	id, ok := h.id(w, r)
	if !ok {
		return
	}
	p, err := h.broker.Get(r.Context(), id)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toDTO(p))
}

// Approve issues a single-use token and returns it exactly once.
func (h *Handler) Approve(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := h.id(w, r)
	if !ok {
		return
	}
	res, err := h.broker.Approve(r.Context(), u, id, h.stepUpSatisfied(r))
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"proposal":  toDTO(res.Proposal),
		"token":     res.Token,
		"expiresAt": res.ExpiresAt,
	})
}

// Reject moves a pending proposal to rejected.
func (h *Handler) Reject(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.viewer(w, r); !ok {
		return
	}
	id, ok := h.id(w, r)
	if !ok {
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	p, err := h.broker.Reject(r.Context(), id, body.Reason)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toDTO(p))
}

// Execute verifies+consumes the token and runs the action.
func (h *Handler) Execute(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := h.id(w, r)
	if !ok {
		return
	}
	var body struct {
		Token string `json:"token"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	token := strings.TrimSpace(body.Token)
	if token == "" {
		// Allow the token via header as well, for callers that prefer it.
		token = strings.TrimSpace(r.Header.Get("X-Approval-Token"))
	}
	if token == "" {
		httpx.Error(w, http.StatusBadRequest, "approval token is required", "token_required")
		return
	}
	p, err := h.broker.Execute(r.Context(), u, id, token)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toDTO(p))
}

// Audit returns the full proposal→token→execution chain for one object.
func (h *Handler) Audit(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.viewer(w, r); !ok {
		return
	}
	ref := strings.TrimSpace(chi.URLParam(r, "resourceRef"))
	entries, err := h.broker.Audit(r.Context(), ref)
	if err != nil {
		h.writeError(w, err)
		return
	}
	type entryDTO struct {
		Proposal proposalDTO `json:"proposal"`
		Tokens   []TokenView `json:"tokens"`
	}
	out := make([]entryDTO, 0, len(entries))
	for _, e := range entries {
		out = append(out, entryDTO{Proposal: toDTO(e.Proposal), Tokens: e.Tokens})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"resourceRef": ref, "entries": out})
}

// viewer resolves the authenticated user or writes 401.
func (h *Handler) viewer(w http.ResponseWriter, r *http.Request) (*ent.User, bool) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "authentication required", "unauthenticated")
		return nil, false
	}
	return u, true
}

// id parses the {id} path param as a UUID.
func (h *Handler) id(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid proposal id", "invalid_id")
		return uuid.Nil, false
	}
	return id, true
}

// stepUpSatisfied reports whether the request's actor meets recent-auth.
func (h *Handler) stepUpSatisfied(r *http.Request) bool {
	if h.stepUp == nil {
		return false
	}
	return h.stepUp(r)
}

// writeError maps broker errors to HTTP responses.
func (h *Handler) writeError(w http.ResponseWriter, err error) {
	switch {
	case ent.IsNotFound(err):
		httpx.Error(w, http.StatusNotFound, "not found", "not_found")
	case errors.Is(err, ErrInvalidInput):
		httpx.Error(w, http.StatusBadRequest, err.Error(), "invalid_input")
	case errors.Is(err, ErrNotPending):
		httpx.Error(w, http.StatusConflict, "proposal is not pending", "not_pending")
	case errors.Is(err, ErrNotApproved):
		httpx.Error(w, http.StatusConflict, "proposal is not approved", "not_approved")
	case errors.Is(err, ErrAlreadyExecuted):
		httpx.Error(w, http.StatusConflict, "proposal already executed", "already_executed")
	case errors.Is(err, ErrStepUpRequired):
		httpx.ErrorWith(w, http.StatusForbidden, "step-up authentication required for financial approval",
			"step_up_required", map[string]any{"stepUpRequired": string(auth.StepUpRecentAuth)})
	case errors.Is(err, ErrTokenExpired):
		httpx.Error(w, http.StatusConflict, "approval token expired; re-approve", "token_expired")
	case errors.Is(err, ErrTokenReused):
		httpx.Error(w, http.StatusConflict, "approval token already used", "token_reused")
	case errors.Is(err, ErrTokenInvalid):
		httpx.Error(w, http.StatusForbidden, "approval token is invalid", "token_invalid")
	case errors.Is(err, ErrExecutionUnavailable):
		httpx.Error(w, http.StatusServiceUnavailable, "execution backend is not configured; the action stays approved", "execution_unavailable")
	case errors.Is(err, ErrAmbiguous):
		httpx.Error(w, http.StatusConflict, "execution outcome is ambiguous; reconcile by product state before retrying", "ambiguous")
	default:
		h.log.Error("actions: handler error", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "internal error", "internal")
	}
}
