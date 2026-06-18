// Package agents serves the durable agent runtime HTTP surface (RFC 027):
// AgentDefinition CRUD and the agent-session lifecycle (create / submit turn /
// stream / events / approve / cancel) under /v1/*. It is the analogue of
// internal/backgroundtasks and funnels all session creation through the one
// canonical path in internal/agentsessions.
package agents

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	entsql "entgo.io/ent/dialect/sql"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentapproval"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentsession"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentsessionevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentgitops"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentregistry"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentsessions"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentstream"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agenttoken"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentworkflow"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	oauthrs "github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

const maxBody = 1 << 20

// Handler serves /v1/agents and /v1/agent-sessions.
type Handler struct {
	client      *ent.Client
	loader      *agentregistry.Loader
	starter     *agentsessions.Starter
	streamer    *agentstream.Streamer
	scheduler   *agentworkflow.SessionScheduler
	gitops      *agentgitops.Reconciler // nil → GitOps disabled
	signer      *agenttoken.Signer
	approvalTTL time.Duration
	requireMFA  bool
	policy      agentregistry.Policy // RFC 028 semantic-validation policy
	log         *zap.Logger
}

// New builds the handler with a Temporal-less starter (create returns 503 until
// SetStarter wires the controller) and a durable-only streamer. The token signer
// is built from the resolved agent signing secret (RFC 012).
func New(client *ent.Client, loader *agentregistry.Loader, cfg appconfig.Config, log *zap.Logger) *Handler {
	signer, err := agenttoken.NewSigner(cfg.AgentSigningSecret())
	if err != nil && log != nil {
		log.Warn("agent token signer unavailable; continuation/approval tokens disabled", zap.Error(err))
	}
	return &Handler{
		client:      client,
		loader:      loader,
		starter:     agentsessions.New(client, loader, nil, cfg, log),
		streamer:    agentstream.NewStreamer(client, nil, log),
		signer:      signer,
		approvalTTL: cfg.AgentApprovalTokenTTL,
		requireMFA:  cfg.AgentRequireMFAForMoneyMoving,
		policy: agentregistry.Policy{
			AllowedModels:           cfg.LLMAllowedModels,
			MaxTurns:                cfg.AgentMaxTurnsPerSession,
			MaxLLMCalls:             cfg.AgentMaxLLMCallsPerSession,
			MaxToolCalls:            cfg.AgentMaxToolCallsPerTurn,
			DeclarativeToolsEnabled: cfg.AgentDeclarativeToolsEnabled,
		},
		log: log,
	}
}

// SetStarter swaps in a Temporal-backed session starter (analogue of
// backgroundtasks.SetTemporal).
func (h *Handler) SetStarter(s *agentsessions.Starter) { h.starter = s }

// SetStreamer swaps in the streamer (bus-backed when streaming is enabled).
func (h *Handler) SetStreamer(s *agentstream.Streamer) { h.streamer = s }

// SetScheduler wires the Temporal-Schedule manager for recurring sessions (P5).
func (h *Handler) SetScheduler(s *agentworkflow.SessionScheduler) { h.scheduler = s }

// SetGitOps wires the GitOps reconciler (RFC 028 P4), enabling the internal
// reconcile endpoint.
func (h *Handler) SetGitOps(r *agentgitops.Reconciler) { h.gitops = r }

// Policy exposes the validation policy (used to build the reconciler).
func (h *Handler) Policy() agentregistry.Policy { return h.policy }

// --- session views -----------------------------------------------------------

type sessionView struct {
	SessionID         string  `json:"sessionId"`
	Agent             string  `json:"agent"`
	AgentSource       string  `json:"agentSource,omitempty"`
	Status            string  `json:"status"`
	Channel           string  `json:"channel"`
	Title             string  `json:"title,omitempty"`
	Turns             int     `json:"turns"`
	LLMCalls          int     `json:"llmCalls"`
	ToolCalls         int     `json:"toolCalls"`
	CostUnits         int     `json:"costUnits"`
	ContinuationToken string  `json:"continuationToken"`
	Error             string  `json:"error,omitempty"`
	ErrorCode         string  `json:"errorCode,omitempty"`
	CreatedAt         string  `json:"createdAt"`
	LastActivityAt    *string `json:"lastActivityAt,omitempty"`
}

func (h *Handler) viewSession(s *ent.AgentSession, userID string) sessionView {
	v := sessionView{
		SessionID:         s.SessionID,
		Agent:             s.AgentSlug,
		AgentSource:       s.AgentSource,
		Status:            s.Status,
		Channel:           s.Channel,
		Title:             s.Title,
		Turns:             s.TurnCount,
		LLMCalls:          s.LlmCallCount,
		ToolCalls:         s.ToolCallCount,
		CostUnits:         s.CostUnits,
		ContinuationToken: h.continuationToken(s.TemporalWorkflowID, s.SessionID, userID),
		Error:             s.Error,
		ErrorCode:         s.ErrorCode,
		CreatedAt:         s.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
	}
	if s.LastActivityAt != nil {
		ts := s.LastActivityAt.UTC().Format("2006-01-02T15:04:05Z")
		v.LastActivityAt = &ts
	}
	return v
}

// continuationToken is the HMAC-signed handle encoding the stable session
// workflow id (survives ContinueAsNew), bound to the owner so it cannot be
// forged or reused cross-tenant — the signed analogue of eve's continuationToken.
func (h *Handler) continuationToken(workflowID, sessionID, userID string) string {
	if workflowID == "" || h.signer == nil {
		return ""
	}
	tok, err := h.signer.MintContinuation(
		agenttoken.ContinuationClaims{WorkflowID: workflowID, SessionID: sessionID, UserID: userID},
		time.Now(), continuationTokenTTL)
	if err != nil {
		return ""
	}
	return tok
}

// continuationTokenTTL bounds a continuation token's life; clients re-fetch the
// session view to refresh it.
const continuationTokenTTL = 30 * 24 * time.Hour

// --- requests ----------------------------------------------------------------

type createSessionRequest struct {
	Agent   string `json:"agent"`
	Input   string `json:"input,omitempty"`
	Title   string `json:"title,omitempty"`
	Channel string `json:"channel,omitempty"`
}

type submitTurnRequest struct {
	Input string `json:"input"`
}

type approveRequest struct {
	Decision   string `json:"decision"` // granted | denied
	ResolvedBy string `json:"resolvedBy,omitempty"`
}

// --- session handlers --------------------------------------------------------

// CreateSession handles POST /v1/agent-sessions.
func (h *Handler) CreateSession(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	var req createSessionRequest
	if !httpx.DecodeJSON(w, r, maxBody, &req) {
		return
	}
	if req.Agent == "" {
		httpx.Error(w, http.StatusBadRequest, "agent is required", "bad_request")
		return
	}
	sess, err := h.starter.CreateSession(r.Context(), agentsessions.CreateParams{
		User: u, AgentSlug: req.Agent, Channel: req.Channel, Title: req.Title, FirstInput: req.Input,
	})
	if err != nil {
		h.writeStarterError(w, err, sess)
		return
	}
	w.Header().Set("x-rowboat-session-id", sess.Row.SessionID)
	httpx.WriteJSON(w, http.StatusCreated, h.viewSession(sess.Row, u.ID.String()))
}

// GetSession handles GET /v1/agent-sessions/{id}.
func (h *Handler) GetSession(w http.ResponseWriter, r *http.Request) {
	sess, ok := h.lookupSession(w, r)
	if !ok {
		return
	}
	uid := ""
	if u, ok := auth.UserFromCtx(r.Context()); ok {
		uid = u.ID.String()
	}
	httpx.WriteJSON(w, http.StatusOK, h.viewSession(sess, uid))
}

// SubmitTurn handles POST /v1/agent-sessions/{id}/turns.
func (h *Handler) SubmitTurn(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	sess, ok := h.lookupSession(w, r)
	if !ok {
		return
	}
	var req submitTurnRequest
	if !httpx.DecodeJSON(w, r, maxBody, &req) {
		return
	}
	ack, err := h.starter.SubmitTurn(r.Context(), u.ID.String(), sess.SessionID, req.Input)
	if err != nil {
		if errors.Is(err, agentsessions.ErrTemporalNotConfigured) {
			httpx.Error(w, http.StatusServiceUnavailable, "temporal unavailable", "temporal_unavailable")
			return
		}
		// A rejected Update validator (closed session, bad input, turn cap) is a 400.
		httpx.Error(w, http.StatusBadRequest, err.Error(), "turn_rejected")
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{"accepted": ack.Accepted, "turnSeq": ack.TurnSeq})
}

// Stream handles GET /v1/agent-sessions/{id}/stream (NDJSON).
func (h *Handler) Stream(w http.ResponseWriter, r *http.Request) {
	sess, ok := h.lookupSession(w, r)
	if !ok {
		return
	}
	h.streamer.Stream(w, r, sess)
}

// ListEvents handles GET /v1/agent-sessions/{id}/events (paged poll fallback,
// the ?afterSeq / nextSeq contract shared with background-task runs).
func (h *Handler) ListEvents(w http.ResponseWriter, r *http.Request) {
	sess, ok := h.lookupSession(w, r)
	if !ok {
		return
	}
	q := h.client.AgentSessionEvent.Query().
		Where(agentsessionevent.HasSessionWith(agentsession.IDEQ(sess.ID))).
		Order(agentsessionevent.BySeq(entsql.OrderAsc()))
	if raw := r.URL.Query().Get("afterSeq"); raw != "" {
		seq, err := strconv.Atoi(raw)
		if err != nil || seq < 0 {
			httpx.Error(w, http.StatusBadRequest, "invalid afterSeq", "bad_request")
			return
		}
		q = q.Where(agentsessionevent.SeqGT(seq))
	}
	const (
		defaultLimit = 500
		maxLimit     = 1000
	)
	limit := defaultLimit
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	events, err := q.Limit(limit).All(r.Context())
	if err != nil {
		h.log.Error("list agent session events", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not list events", "internal_error")
		return
	}
	views := make([]agentworkflow.StreamEvent, 0, len(events))
	for _, ev := range events {
		views = append(views, agentworkflow.StreamEvent{Seq: ev.Seq, Type: ev.EventType, TurnSeq: ev.TurnSeq, Data: []byte(ev.EventJSON)})
	}
	resp := map[string]any{"events": views}
	if len(events) == limit {
		resp["nextSeq"] = events[len(events)-1].Seq
	}
	httpx.WriteJSON(w, http.StatusOK, resp)
}

// Approve handles POST /v1/agent-sessions/{id}/approvals/{approvalId}.
func (h *Handler) Approve(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	sess, ok := h.lookupSession(w, r)
	if !ok {
		return
	}
	approvalID := chi.URLParam(r, "approvalId")
	if approvalID == "" {
		httpx.Error(w, http.StatusBadRequest, "approvalId is required", "bad_request")
		return
	}
	var req approveRequest
	if !httpx.DecodeJSON(w, r, maxBody, &req) {
		return
	}
	if req.Decision != "granted" && req.Decision != "denied" {
		httpx.Error(w, http.StatusBadRequest, "decision must be granted or denied", "bad_request")
		return
	}
	resolvedBy := req.ResolvedBy
	if resolvedBy == "" {
		resolvedBy = u.ID.String()
	}
	_, err := h.starter.Approve(r.Context(), u.ID.String(), sess.SessionID, agentworkflow.ApproveAction{
		ApprovalID:    approvalID,
		Decision:      req.Decision,
		ApprovalToken: r.Header.Get("X-Approval-Token"),
		ResolvedBy:    resolvedBy,
	})
	if err != nil {
		if errors.Is(err, agentsessions.ErrTemporalNotConfigured) {
			httpx.Error(w, http.StatusServiceUnavailable, "temporal unavailable", "temporal_unavailable")
			return
		}
		httpx.Error(w, http.StatusBadRequest, err.Error(), "approval_rejected")
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{"approvalId": approvalID, "decision": req.Decision})
}

// MintApprovalToken handles POST /v1/agent-sessions/{id}/approvals/{approvalId}/token.
// It mints a short-lived, HMAC-signed money-moving approval token (RFC 012)
// bound to this pending approval, the caller, and the session, asserting whether
// an MFA step-up backed it (read from the verified WorkOS amr/acr claim). The
// minted token is then presented as X-Approval-Token on the grant.
func (h *Handler) MintApprovalToken(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	if h.signer == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "approval token signing not configured", "signing_unavailable")
		return
	}
	sess, ok := h.lookupSession(w, r)
	if !ok {
		return
	}
	approvalID := chi.URLParam(r, "approvalId")
	approval, err := h.client.AgentApproval.Query().
		Where(agentapproval.ApprovalIDEQ(approvalID), agentapproval.HasSessionWith(agentsession.IDEQ(sess.ID))).
		Only(r.Context())
	if err != nil {
		if ent.IsNotFound(err) {
			httpx.Error(w, http.StatusNotFound, "approval not found", "not_found")
			return
		}
		h.log.Error("lookup approval", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not load approval", "internal_error")
		return
	}
	if approval.Status != "pending" {
		httpx.Error(w, http.StatusConflict, "approval already resolved", "conflict")
		return
	}
	mfa := mfaFromClaims(r)
	if approval.TrustTier == agentregistry.TierMoneyMoving && h.requireMFA && !mfa {
		httpx.Error(w, http.StatusForbidden, "an MFA step-up is required to approve a money-moving action", "mfa_required")
		return
	}
	tok, err := h.signer.MintApproval(agenttoken.ApprovalClaims{
		ApprovalID: approvalID, UserID: u.ID.String(), SessionID: sess.SessionID,
		TrustTier: approval.TrustTier, MFA: mfa,
	}, time.Now(), h.approvalTTL)
	if err != nil {
		h.log.Error("mint approval token", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not mint token", "internal_error")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"approvalToken": tok,
		"expiresAt":     time.Now().Add(h.approvalTTL).UTC().Format("2006-01-02T15:04:05Z"),
		"mfa":           mfa,
	})
}

// mfaFromClaims reports whether the verified token evidences an MFA step-up,
// reading WorkOS's amr (authentication methods) / acr (context class) claims.
func mfaFromClaims(r *http.Request) bool {
	claims, ok := oauthrs.ClaimsFromContext(r.Context())
	if !ok || claims.Raw == nil {
		return false
	}
	if amr, ok := claims.Raw["amr"].([]any); ok {
		for _, m := range amr {
			if s, ok := m.(string); ok && (s == "mfa" || s == "otp" || s == "hwk" || s == "sms") {
				return true
			}
		}
	}
	if acr, ok := claims.Raw["acr"].(string); ok {
		if acr == "mfa" || acr == "urn:okta:loa:2fa:any" || acr == "http://schemas.openid.net/pape/policies/2007/06/multi-factor" {
			return true
		}
	}
	return false
}

// Cancel handles POST /v1/agent-sessions/{id}/cancel.
func (h *Handler) Cancel(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	sess, ok := h.lookupSession(w, r)
	if !ok {
		return
	}
	if err := h.starter.Cancel(r.Context(), u.ID.String(), sess.SessionID); err != nil {
		if errors.Is(err, agentsessions.ErrTemporalNotConfigured) {
			httpx.Error(w, http.StatusServiceUnavailable, "temporal unavailable", "temporal_unavailable")
			return
		}
		h.log.Error("cancel agent session", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not cancel session", "internal_error")
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{"sessionId": sess.SessionID, "status": "canceling"})
}

// --- helpers -----------------------------------------------------------------

// lookupSession resolves a session row, tenant-scoped. A signed continuation
// token (?continuationToken= or X-Continuation-Token) — the tamper-proof handle
// from the session view — takes precedence over the {id} path param: it is
// verified, bound to the authed user, and resolves to its encoded session id. A
// present-but-invalid token is rejected rather than silently ignored.
func (h *Handler) lookupSession(w http.ResponseWriter, r *http.Request) (*ent.AgentSession, bool) {
	id := chi.URLParam(r, "id")
	if ct := continuationFromRequest(r); ct != "" {
		if h.signer == nil {
			httpx.Error(w, http.StatusServiceUnavailable, "continuation tokens not configured", "signing_unavailable")
			return nil, false
		}
		claims, err := h.signer.VerifyContinuation(ct, time.Now())
		if err != nil {
			httpx.Error(w, http.StatusUnauthorized, "invalid continuation token", "invalid_continuation_token")
			return nil, false
		}
		if u, ok := auth.UserFromCtx(r.Context()); !ok || claims.UserID != u.ID.String() {
			httpx.Error(w, http.StatusForbidden, "continuation token does not belong to this user", "forbidden")
			return nil, false
		}
		id = claims.SessionID
	}
	if id == "" {
		httpx.Error(w, http.StatusBadRequest, "session id is required", "bad_request")
		return nil, false
	}
	sess, err := h.client.AgentSession.Query().
		Where(agentsession.SessionIDEQ(id)).
		Only(r.Context())
	if err != nil {
		if ent.IsNotFound(err) {
			httpx.Error(w, http.StatusNotFound, "session not found", "not_found")
			return nil, false
		}
		h.log.Error("lookup agent session", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not load session", "internal_error")
		return nil, false
	}
	return sess, true
}

// continuationFromRequest reads the continuation token from the query string or
// the X-Continuation-Token header.
func continuationFromRequest(r *http.Request) string {
	if v := r.URL.Query().Get("continuationToken"); v != "" {
		return v
	}
	return r.Header.Get("X-Continuation-Token")
}

func (h *Handler) writeStarterError(w http.ResponseWriter, err error, sess *agentsessions.Session) {
	var invalid *agentsessions.InvalidParamsError
	switch {
	case errors.As(err, &invalid):
		httpx.Error(w, http.StatusBadRequest, invalid.Message, "bad_request")
	case errors.Is(err, agentsessions.ErrTemporalNotConfigured):
		httpx.Error(w, http.StatusServiceUnavailable, "temporal unavailable", "temporal_unavailable")
	default:
		h.log.Error("create agent session", zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "could not start session", "session_start_failed")
	}
}
