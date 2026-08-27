package connectors

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mcpconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthpending"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/predicate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/connectormetrics"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// Config carries the OAuth-brokering settings the handler needs.
type Config struct {
	OryPublicURL          string
	OryBrokerClientID     string
	OryBrokerClientSecret string
	PublicBaseURL         string
	DeepLinkScheme        string
	RedirectAllowlist     []string
}

// Handler serves the connector + connection endpoints.
type Handler struct {
	client         *ent.Client
	sealer         *crypto.Sealer
	registry       *Registry
	resourceTokens ResourceTokenIssuer
	ory            *oryClient
	cfg            Config
	log            *zap.Logger
	refresh        refreshDeduper
}

// SetResourceTokenIssuer configures the RS256 broker key used for short-lived
// product tokens. Provider access tokens and API keys remain server-side.
func (h *Handler) SetResourceTokenIssuer(issuer ResourceTokenIssuer) {
	h.resourceTokens = issuer
}

// BrokerJWKS publishes the public key used by RFC 012 product resource servers.
func (h *Handler) BrokerJWKS(w http.ResponseWriter, _ *http.Request) {
	if h.resourceTokens == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "connector resource token issuer is not configured", "broker_unconfigured")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, h.resourceTokens.JWKS())
}

// SetRefreshDedup enables sealed result caching and cross-replica locking for
// Ory's rotating, one-use connector refresh tokens.
func (h *Handler) SetRefreshDedup(cache RefreshCache, sealer *crypto.Sealer) {
	h.refresh.configure(cache, sealer, h.log)
}

// New builds the connectors handler.
func New(client *ent.Client, sealer *crypto.Sealer, registry *Registry, cfg Config, log *zap.Logger) *Handler {
	if cfg.DeepLinkScheme == "" {
		cfg.DeepLinkScheme = "solomon-ai"
	}
	return &Handler{
		client:   client,
		sealer:   sealer,
		registry: registry,
		ory:      newOryClient(cfg.OryPublicURL, cfg.OryBrokerClientID, cfg.OryBrokerClientSecret),
		cfg:      cfg,
		log:      log,
	}
}

// SetOryBaseURL overrides the Ory public URL (tests).
func (h *Handler) SetOryBaseURL(u string) {
	h.ory = newOryClient(u, h.cfg.OryBrokerClientID, h.cfg.OryBrokerClientSecret)
}

// SetOutboundPolicy applies the shared outbound vendor policy to Ory calls.
func (h *Handler) SetOutboundPolicy(policy outbound.Policy) {
	h.ory.setOutboundPolicy(policy)
}

// connectPending is sealed into OAuthPending during /start. The token fields are
// populated by Callback after a successful code exchange and consumed by the
// authenticated Claim step.
type connectPending struct {
	Connector       string   `json:"connector"`
	Verifier        string   `json:"code_verifier"`
	WorkOSUserID    string   `json:"workos_user_id"`
	OrgID           string   `json:"org_id,omitempty"`
	RedirectTarget  string   `json:"redirect_target"`
	RequestedScopes []string `json:"requested_scopes"`
	RefreshToken    string   `json:"refresh_token,omitempty"`
	GrantedScopes   []string `json:"granted_scopes,omitempty"`
}

func connectorOrganizationID(u *ent.User) string {
	return OrganizationIDForUser(u)
}

// OrganizationIDForUser returns the immutable tenant key used by connector
// credentials, including a stable personal tenant for users without a WorkOS org.
func OrganizationIDForUser(u *ent.User) string {
	if u == nil {
		return ""
	}
	if orgID := strings.TrimSpace(u.WorkosOrgID); orgID != "" {
		return orgID
	}
	return "personal:" + u.WorkosUserID
}

type connectorView struct {
	Name             string                     `json:"name"`
	DisplayName      string                     `json:"displayName"`
	Description      string                     `json:"description"`
	MCPURL           string                     `json:"mcpUrl"`
	Transport        string                     `json:"transport,omitempty"`
	AuthType         string                     `json:"authType"`
	Audience         string                     `json:"audience"`
	Status           string                     `json:"status"`
	Health           string                     `json:"health"`
	AvailableScopes  []ScopeDefinition          `json:"availableScopes,omitempty"`
	GrantedScopes    []ScopeDefinition          `json:"grantedScopes,omitempty"`
	IconURL          string                     `json:"iconUrl,omitempty"`
	MCPTools         []MCPToolPolicy            `json:"mcpTools,omitempty"`
	NativeTools      []MCPToolPolicy            `json:"nativeTools,omitempty"`
	TemplateBlocks   []IntegrationTemplateBlock `json:"templateBlocks,omitempty"`
	Connected        bool                       `json:"connected"`
	ConnectedAt      string                     `json:"connectedAt,omitempty"`
	LastUsedAt       string                     `json:"lastUsedAt,omitempty"`
	RevokedAt        string                     `json:"revokedAt,omitempty"`
	ConnectionHealth string                     `json:"connectionHealth"`
	ConnectionReason string                     `json:"connectionReason,omitempty"`
}

// List handles GET /v1/connectors.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	conns, err := h.client.MCPConnection.Query().Where(mcpconnection.OrganizationIDEQ(connectorOrganizationID(u))).All(r.Context())
	if err != nil {
		h.log.Error("list connections", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not load connections", "internal_error")
		return
	}
	connected := make(map[string]*ent.MCPConnection, len(conns))
	for _, c := range conns {
		connected[c.Connector] = c
	}

	views := make([]connectorView, 0, len(h.registry.List()))
	for _, c := range h.registry.List() {
		v := connectorView{
			Name: c.Name, DisplayName: c.DisplayName, Description: c.Description,
			MCPURL: c.MCPURL, Transport: c.Transport, AuthType: c.AuthType, Audience: c.Audience,
			Status: h.registry.EffectiveStatus(c.Name), Health: c.Health, AvailableScopes: h.registry.AvailableScopes(c.Name), IconURL: c.IconURL,
			MCPTools: c.MCPTools, NativeTools: c.NativeTools, TemplateBlocks: c.TemplateBlocks,
		}
		if mc, ok := connected[c.Name]; ok {
			v.Connected = mc.Status == "active" && h.registry.Enabled(c.Name)
			v.GrantedScopes = h.registry.definitionsForScopes(c.Name, mc.Scopes)
			if !mc.ConnectedAt.IsZero() {
				v.ConnectedAt = mc.ConnectedAt.UTC().Format(time.RFC3339)
			}
			if !mc.LastUsedAt.IsZero() {
				v.LastUsedAt = mc.LastUsedAt.UTC().Format(time.RFC3339)
			}
			if !mc.RevokedAt.IsZero() {
				v.RevokedAt = mc.RevokedAt.UTC().Format(time.RFC3339)
			}
			v.ConnectionHealth, v.ConnectionReason = connectionHealth(mc)
		} else {
			v.ConnectionHealth = "disconnected"
		}
		views = append(views, v)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"connectors": views})
}

func connectionHealth(mc *ent.MCPConnection) (string, string) {
	if mc == nil {
		return "disconnected", "not_connected"
	}
	switch mc.Status {
	case "active":
		return "healthy", ""
	case "reauth_required":
		return "degraded", "reauth_required"
	case "error":
		return "degraded", "upstream_error"
	case "revoking":
		return "disabled", "revocation_pending"
	case "revoked", "invalidated":
		if mc.RevokedReason != "" {
			return "disabled", mc.RevokedReason
		}
		return "disabled", mc.Status
	default:
		return "degraded", mc.Status
	}
}

// Start handles POST /v1/connections/{name}/start.
func (h *Handler) Start(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	name := chi.URLParam(r, "name")
	c, ok := h.registry.Get(name)
	if !ok {
		httpx.Error(w, http.StatusNotFound, "unknown connector", "not_found")
		return
	}
	if c.AuthType != "oauth" {
		httpx.Error(w, http.StatusBadRequest, "connector does not use the oauth flow", "unsupported_auth_type")
		return
	}
	if !h.registry.Enabled(name) {
		connectormetrics.Lifecycle.WithLabelValues(name, "start", "disabled").Inc()
		h.appendAudit(r.Context(), u, auditRecord{EventType: "oauth_start_rejected", Connector: name, Audience: c.Audience, Reason: "connector_disabled"})
		httpx.Error(w, http.StatusServiceUnavailable, "connector is disabled", "connector_disabled")
		return
	}
	var req struct {
		RequestedScopes      []string `json:"requestedScopes"`
		RequestedScopesSnake []string `json:"requested_scopes"`
		RedirectTarget       string   `json:"redirectTarget"`
		RedirectAfter        string   `json:"redirect_after"`
	}
	if r.Body != nil && r.ContentLength != 0 {
		if !httpx.DecodeJSON(w, r, 1<<16, &req) {
			return
		}
	}
	if len(req.RequestedScopes) == 0 {
		req.RequestedScopes = req.RequestedScopesSnake
	}
	if req.RedirectTarget == "" {
		req.RedirectTarget = req.RedirectAfter
	}
	requestedScopes, err := h.registry.validateRequestedScopes(name, req.RequestedScopes)
	if err != nil {
		connectormetrics.Lifecycle.WithLabelValues(name, "start", "invalid_scope").Inc()
		h.appendAudit(r.Context(), u, auditRecord{EventType: "oauth_start_rejected", Connector: name, Audience: c.Audience, Requested: req.RequestedScopes, Reason: "invalid_scope"})
		httpx.Error(w, http.StatusBadRequest, err.Error(), "invalid_scope")
		return
	}
	redirectTarget, err := h.validateRedirectTarget(req.RedirectTarget)
	if err != nil {
		h.appendAudit(r.Context(), u, auditRecord{EventType: "oauth_start_rejected", Connector: name, Audience: c.Audience, Requested: requestedScopes, Reason: "invalid_redirect_target"})
		httpx.Error(w, http.StatusBadRequest, err.Error(), "invalid_redirect_target")
		return
	}
	if allowed, reason := h.isEntitled(r.Context(), u, c, requestedScopes); !allowed {
		connectormetrics.Lifecycle.WithLabelValues(name, "start", "entitlement_denied").Inc()
		h.appendAudit(r.Context(), u, auditRecord{EventType: "oauth_start_rejected", Connector: name, Audience: c.Audience, Requested: requestedScopes, Reason: reason})
		httpx.Error(w, http.StatusForbidden, "connector entitlement denied", reason)
		return
	}

	state, err1 := randomToken(32)
	verifier, err2 := randomToken(48)
	if err1 != nil || err2 != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not generate state", "internal_error")
		return
	}
	organizationID := connectorOrganizationID(u)
	payload, _ := json.Marshal(connectPending{Connector: name, Verifier: verifier, WorkOSUserID: u.WorkosUserID, OrgID: organizationID, RedirectTarget: redirectTarget, RequestedScopes: requestedScopes})
	sealed, err := h.sealer.Seal(payload)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not seal state", "internal_error")
		return
	}
	stateHash := hashState(state)
	// Expand/contract compatibility: during the mixed-version window the legacy
	// column retains raw state for old readers while all new readers prefer the
	// digest. A later contract migration removes raw state after the maximum TTL.
	tx, err := h.client.Tx(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not start connection", "internal_error")
		return
	}
	create := tx.OAuthPending.Create().
		SetState(state).
		SetStateHash(stateHash).
		SetProvider(name).
		SetPayloadEncrypted(sealed).
		SetExpiresAt(time.Now().Add(10 * time.Minute)).
		SetLifecycleStatus("started").
		SetOwnerWorkosUserID(u.WorkosUserID).
		SetRequestedScopes(requestedScopes).
		SetRedirectTarget(redirectTarget)
	create.SetOwnerOrgID(organizationID)
	pending, err := create.Save(r.Context())
	if err != nil {
		_ = tx.Rollback()
		h.log.Error("persist pending", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not start connection", "internal_error")
		return
	}
	if err := h.persistAuditTransitionWithClient(r.Context(), tx.Client(), u, auditRecord{
		EventType: "oauth_started", EventID: deterministicAuditEventID("oauth_started", pending.ID.String()),
		Connector: name, OrganizationID: organizationID, Audience: c.Audience, Requested: requestedScopes,
	}); err != nil {
		_ = tx.Rollback()
		h.log.Error("persist oauth start audit", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not start connection", "internal_error")
		return
	}
	if err := tx.Commit(); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not start connection", "internal_error")
		return
	}

	redirectURI := strings.TrimRight(h.cfg.PublicBaseURL, "/") + "/v1/connections/" + name + "/callback"
	scope := strings.Join(append([]string{"offline_access"}, requestedScopes...), " ")
	authURL := h.ory.authorizeURL(redirectURI, scope, state, codeChallengeS256(verifier), c.Audience)
	connectormetrics.Lifecycle.WithLabelValues(name, "start", "success").Inc()
	httpx.WriteJSON(w, http.StatusOK, map[string]string{
		"authorization_url": authURL,
		"authorize_url":     authURL,
		"expires_at":        time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339),
	})
}

func hashState(state string) string {
	sum := sha256.Sum256([]byte(state))
	return hex.EncodeToString(sum[:])
}

func pendingStatePredicate(state string) predicate.OAuthPending {
	return oauthpending.Or(
		oauthpending.StateHashEQ(hashState(state)),
		oauthpending.StateEQ(state),
	)
}

const connectorCallbackLease = 30 * time.Second

func (h *Handler) claimCallbackLease(ctx context.Context, pending *ent.OAuthPending, owner *ent.User, cp connectPending) (uuid.UUID, bool, error) {
	now := time.Now().UTC()
	if pending.LifecycleStatus == "callback_processing" {
		if !pending.CallbackClaimedUntil.IsZero() && pending.CallbackClaimedUntil.After(now) {
			return uuid.Nil, false, nil
		}
		// The provider authorization code may have been consumed before the prior
		// process died. Never replay it. Expire the lease into an explicit bounded
		// restart state so a fresh authorization can be started immediately.
		tx, err := h.client.Tx(auth.WithInternal(ctx))
		if err != nil {
			return uuid.Nil, false, err
		}
		updated, err := tx.OAuthPending.Update().Where(
			oauthpending.IDEQ(pending.ID),
			oauthpending.LifecycleStatusEQ("callback_processing"),
			oauthpending.CallbackClaimedUntilLTE(now),
		).SetLifecycleStatus("restart_required").
			SetFailureReason("callback_lease_expired").
			ClearCallbackClaimID().ClearCallbackClaimedUntil().
			Save(auth.WithInternal(ctx))
		if err != nil || updated != 1 {
			_ = tx.Rollback()
			if err == nil {
				return uuid.Nil, false, nil
			}
			return uuid.Nil, false, err
		}
		claimID := pending.CallbackClaimID
		if err := h.persistAuditTransitionWithClient(ctx, tx.Client(), owner, auditRecord{
			EventType: "oauth_callback_restart_required",
			EventID:   deterministicAuditEventID("oauth_callback_restart_required", pending.ID.String(), claimID.String()),
			Connector: cp.Connector, OrganizationID: cp.OrgID, Requested: cp.RequestedScopes, Reason: "callback_lease_expired",
		}); err != nil {
			_ = tx.Rollback()
			return uuid.Nil, false, err
		}
		if err := tx.Commit(); err != nil {
			return uuid.Nil, false, err
		}
		return uuid.Nil, true, nil
	}
	if pending.LifecycleStatus != "started" {
		return uuid.Nil, false, nil
	}

	claimID := uuid.New()
	tx, err := h.client.Tx(auth.WithInternal(ctx))
	if err != nil {
		return uuid.Nil, false, err
	}
	updated, err := tx.OAuthPending.Update().Where(
		oauthpending.IDEQ(pending.ID), oauthpending.LifecycleStatusEQ("started"),
	).SetLifecycleStatus("callback_processing").
		SetCallbackClaimID(claimID).
		SetCallbackClaimedUntil(now.Add(connectorCallbackLease)).
		AddCallbackAttempts(1).
		Save(auth.WithInternal(ctx))
	if err != nil || updated != 1 {
		_ = tx.Rollback()
		if err == nil {
			return uuid.Nil, false, nil
		}
		return uuid.Nil, false, err
	}
	if err := h.persistAuditTransitionWithClient(ctx, tx.Client(), owner, auditRecord{
		EventType: "oauth_callback_processing",
		EventID:   deterministicAuditEventID("oauth_callback_processing", pending.ID.String(), claimID.String()),
		Connector: cp.Connector, OrganizationID: cp.OrgID, Requested: cp.RequestedScopes,
	}); err != nil {
		_ = tx.Rollback()
		return uuid.Nil, false, err
	}
	if err := tx.Commit(); err != nil {
		return uuid.Nil, false, err
	}
	return claimID, false, nil
}

func (h *Handler) finishCallback(ctx context.Context, pending *ent.OAuthPending, owner *ent.User, cp connectPending, claimID uuid.UUID, status, reason string, payload []byte, granted []string) error {
	tx, err := h.client.Tx(auth.WithInternal(ctx))
	if err != nil {
		return err
	}
	update := tx.OAuthPending.Update().Where(
		oauthpending.IDEQ(pending.ID),
		oauthpending.LifecycleStatusEQ("callback_processing"),
		oauthpending.CallbackClaimIDEQ(claimID),
	).SetLifecycleStatus(status).
		ClearCallbackClaimID().ClearCallbackClaimedUntil()
	if reason != "" {
		update.SetFailureReason(reason)
	} else {
		update.ClearFailureReason()
	}
	if len(payload) > 0 {
		update.SetPayloadEncrypted(payload).SetCallbackAt(time.Now().UTC())
	}
	updated, err := update.Save(auth.WithInternal(ctx))
	if err != nil || updated != 1 {
		_ = tx.Rollback()
		if err == nil {
			return errConnectorCredentialSuperseded
		}
		return err
	}
	eventType := "oauth_callback_completed"
	if status != "callback_completed" {
		eventType = "oauth_callback_restart_required"
	}
	if err := h.persistAuditTransitionWithClient(ctx, tx.Client(), owner, auditRecord{
		EventType: eventType, EventID: deterministicAuditEventID(eventType, pending.ID.String(), claimID.String()),
		Connector: cp.Connector, OrganizationID: cp.OrgID, Requested: cp.RequestedScopes, Granted: granted, Reason: reason,
	}); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

func (h *Handler) validateRedirectTarget(raw string) (string, error) {
	if strings.TrimSpace(raw) == "" {
		raw = h.cfg.DeepLinkScheme + "://connection-complete"
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" || u.User != nil || u.Fragment != "" {
		return "", fmt.Errorf("redirectTarget must be an absolute allowlisted deep link")
	}
	u.RawQuery = ""
	normalized := strings.TrimRight(u.String(), "/")
	allowlist := append([]string(nil), h.cfg.RedirectAllowlist...)
	allowlist = append(allowlist, h.cfg.DeepLinkScheme+"://connection-complete")
	for _, allowed := range allowlist {
		if strings.EqualFold(normalized, strings.TrimRight(strings.TrimSpace(allowed), "/")) {
			return normalized, nil
		}
	}
	return "", fmt.Errorf("redirectTarget is not allowlisted")
}

// Callback handles GET /v1/connections/{name}/callback. This is the browser
// redirect target from Ory, so it is NOT behind RequireJWT. It exchanges the
// code and PARKS the resulting grant in the ticket, then deep-links back to the
// desktop, which redeems it with its bearer via Claim. It deliberately does NOT
// persist the connection here: the callback is unauthenticated and the owning
// user is known only from the ticket, so persisting now would let an attacker
// who started a flow capture a phished victim's connector grant (the victim
// completes the attacker's ticket). Binding persistence to the authenticated
// user at Claim is what defeats that.
func (h *Handler) Callback(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	q := r.URL.Query()
	state := q.Get("state")
	code := q.Get("code")
	if state == "" || (code == "" && q.Get("error") == "") {
		httpx.Error(w, http.StatusBadRequest, "missing code or state", "bad_request")
		return
	}

	ctx := r.Context()
	pending, err := h.client.OAuthPending.Query().Where(pendingStatePredicate(state)).Only(auth.WithInternal(ctx))
	if err != nil {
		connectormetrics.Lifecycle.WithLabelValues(name, "callback", "replay_or_invalid").Inc()
		httpx.Error(w, http.StatusBadRequest, "invalid or expired state", "bad_request")
		return
	}
	plain, err := h.sealer.Open(pending.PayloadEncrypted)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not read state", "internal_error")
		return
	}
	var cp connectPending
	if err := json.Unmarshal(plain, &cp); err != nil || cp.Connector != name {
		httpx.Error(w, http.StatusBadRequest, "state/connector mismatch", "bad_request")
		return
	}
	owner, _ := h.client.User.Query().Where(user.WorkosUserIDEQ(cp.WorkOSUserID)).Only(auth.WithInternal(ctx))
	if owner == nil {
		httpx.Error(w, http.StatusInternalServerError, "oauth owner no longer exists", "internal_error")
		return
	}
	if pending.LifecycleStatus != "started" && pending.LifecycleStatus != "callback_processing" {
		connectormetrics.Lifecycle.WithLabelValues(name, "callback", "replay").Inc()
		h.appendAudit(ctx, owner, auditRecord{EventType: "oauth_callback_rejected", Connector: name, Requested: cp.RequestedScopes, Reason: "replay"})
		httpx.Error(w, http.StatusConflict, "oauth callback already consumed", "replay")
		return
	}
	if !h.registry.Enabled(name) {
		_ = pending.Update().SetLifecycleStatus("failed").SetFailureReason("connector_disabled").Exec(ctx)
		h.appendAudit(ctx, owner, auditRecord{EventType: "oauth_callback_failed", Connector: name, Requested: cp.RequestedScopes, Reason: "connector_disabled"})
		h.deepLinkTo(w, r, cp.RedirectTarget, name, "error", state)
		return
	}
	if time.Now().After(pending.ExpiresAt) {
		_ = pending.Update().SetLifecycleStatus("failed").SetFailureReason("expired").Exec(ctx)
		h.appendAudit(ctx, owner, auditRecord{EventType: "oauth_callback_failed", Connector: name, Requested: cp.RequestedScopes, Reason: "expired"})
		h.deleteTicket(ctx, pending)
		h.deepLinkTo(w, r, cp.RedirectTarget, name, "error", state)
		return
	}
	if oauthErr := q.Get("error"); oauthErr != "" {
		_ = pending.Update().SetLifecycleStatus("failed").SetFailureReason("oauth_denied").Exec(ctx)
		connectormetrics.Lifecycle.WithLabelValues(name, "callback", "oauth_denied").Inc()
		h.appendAudit(ctx, owner, auditRecord{EventType: "oauth_callback_failed", Connector: name, Requested: cp.RequestedScopes, Reason: "oauth_denied"})
		h.deepLinkTo(w, r, cp.RedirectTarget, name, "error", state)
		return
	}
	claimID, restartRequired, err := h.claimCallbackLease(ctx, pending, owner, cp)
	if err != nil {
		h.log.Error("claim connector callback lease", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not process oauth callback", "internal_error")
		return
	}
	if restartRequired {
		connectormetrics.Lifecycle.WithLabelValues(name, "callback", "restart_required").Inc()
		h.deepLinkTo(w, r, cp.RedirectTarget, name, "restart_required", "")
		return
	}
	if claimID == uuid.Nil {
		connectormetrics.Lifecycle.WithLabelValues(name, "callback", "in_progress").Inc()
		w.Header().Set("Retry-After", "2")
		httpx.Error(w, http.StatusConflict, "oauth callback already in progress", "callback_in_progress")
		return
	}

	redirectURI := strings.TrimRight(h.cfg.PublicBaseURL, "/") + "/v1/connections/" + name + "/callback"
	tok, err := h.ory.exchange(ctx, code, redirectURI, cp.Verifier)
	if err != nil {
		h.log.Warn("token exchange failed", zap.String("connector", name), zap.Error(err))
		_ = h.finishCallback(ctx, pending, owner, cp, claimID, "restart_required", "token_exchange_failed", nil, nil)
		connectormetrics.Lifecycle.WithLabelValues(name, "callback", "exchange_failed").Inc()
		h.deepLinkTo(w, r, cp.RedirectTarget, name, "restart_required", "")
		return
	}
	granted, err := h.grantedScopes(name, cp.RequestedScopes, tok.Scope)
	if err != nil {
		if tok.RefreshToken != "" {
			_ = h.ory.revoke(ctx, tok.RefreshToken)
		}
		_ = h.finishCallback(ctx, pending, owner, cp, claimID, "restart_required", "scope_escalation", nil, nil)
		connectormetrics.Lifecycle.WithLabelValues(name, "callback", "scope_escalation").Inc()
		h.deepLinkTo(w, r, cp.RedirectTarget, name, "restart_required", "")
		return
	}

	// Park the grant in the ticket for the authenticated Claim step.
	cp.RefreshToken = tok.RefreshToken
	cp.GrantedScopes = granted
	resealed, mErr := json.Marshal(cp)
	if mErr != nil {
		h.deepLinkTo(w, r, cp.RedirectTarget, name, "error", state)
		return
	}
	sealed, sErr := h.sealer.Seal(resealed)
	if sErr != nil {
		h.deepLinkTo(w, r, cp.RedirectTarget, name, "error", state)
		return
	}
	if uErr := h.finishCallback(ctx, pending, owner, cp, claimID, "callback_completed", "", sealed, granted); uErr != nil {
		h.log.Error("park connector grant", zap.Error(uErr))
		if tok.RefreshToken != "" {
			_ = h.ory.revoke(context.WithoutCancel(ctx), tok.RefreshToken)
		}
		h.deepLinkTo(w, r, cp.RedirectTarget, name, "error", state)
		return
	}
	connectormetrics.Lifecycle.WithLabelValues(name, "callback", "success").Inc()
	h.deepLinkTo(w, r, cp.RedirectTarget, name, "success", state)
}

// Claim handles POST /v1/connections/{name}/claim. The desktop calls it (with
// its bearer) after the browser deep-links back, redeeming the connector grant
// parked by Callback. Persistence is bound to the AUTHENTICATED user, who must
// be the same user that started the flow — this is what prevents an attacker
// from capturing a phished victim's grant via authorization-code injection.
func (h *Handler) Claim(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	name := chi.URLParam(r, "name")
	c, ok := h.registry.Get(name)
	if !ok {
		httpx.Error(w, http.StatusNotFound, "unknown connector", "not_found")
		return
	}
	var req struct {
		State string `json:"state"`
	}
	if !httpx.DecodeJSON(w, r, 1<<16, &req) {
		return
	}
	if req.State == "" {
		httpx.Error(w, http.StatusBadRequest, "missing state", "bad_request")
		return
	}

	ctx := r.Context()
	pending, err := h.client.OAuthPending.Query().Where(pendingStatePredicate(req.State)).Only(ctx)
	if err != nil {
		connectormetrics.Lifecycle.WithLabelValues(name, "claim", "replay_or_expired").Inc()
		httpx.Error(w, http.StatusNotFound, "ticket not found or already used", "ticket_expired")
		return
	}
	if time.Now().After(pending.ExpiresAt) {
		h.deleteTicket(ctx, pending)
		httpx.Error(w, http.StatusGone, "ticket expired", "ticket_expired")
		return
	}
	plain, err := h.sealer.Open(pending.PayloadEncrypted)
	if err != nil {
		h.deleteTicket(ctx, pending)
		httpx.Error(w, http.StatusInternalServerError, "could not read ticket", "internal_error")
		return
	}
	var cp connectPending
	if err := json.Unmarshal(plain, &cp); err != nil || cp.Connector != name {
		h.deleteTicket(ctx, pending)
		httpx.Error(w, http.StatusBadRequest, "state/connector mismatch", "bad_request")
		return
	}
	if pending.LifecycleStatus != "callback_completed" {
		if pending.LifecycleStatus == "started" || pending.LifecycleStatus == "callback_processing" {
			httpx.Error(w, http.StatusConflict, "connection not ready", "not_ready")
			return
		}
		connectormetrics.Lifecycle.WithLabelValues(name, "claim", "replay").Inc()
		httpx.Error(w, http.StatusConflict, "ticket already consumed", "replay")
		return
	}
	// Ownership: only the user who STARTED the flow may claim it.
	if cp.WorkOSUserID != u.WorkosUserID {
		// Do NOT consume the ticket on a wrong-user rejection, so a probe can't
		// burn the legitimate owner's pending ticket.
		httpx.Error(w, http.StatusForbidden, "ticket does not belong to this user", "forbidden")
		return
	}
	if cp.OrgID == "" || cp.OrgID != connectorOrganizationID(u) || pending.OwnerOrgID != cp.OrgID {
		if cp.RefreshToken != "" {
			_ = h.ory.revoke(context.WithoutCancel(ctx), cp.RefreshToken)
		}
		_ = pending.Update().SetLifecycleStatus("failed").SetFailureReason("organization_mismatch").Exec(auth.WithInternal(ctx))
		httpx.Error(w, http.StatusForbidden, "ticket does not belong to this organization", "organization_mismatch")
		return
	}
	if cp.RefreshToken == "" {
		// The browser flow hasn't completed yet (Callback hasn't parked a grant);
		// keep the ticket so the desktop can retry once it finishes.
		httpx.Error(w, http.StatusConflict, "connection not ready", "not_ready")
		return
	}
	if !h.registry.Enabled(name) {
		_ = h.ory.revoke(ctx, cp.RefreshToken)
		httpx.Error(w, http.StatusServiceUnavailable, "connector is disabled", "connector_disabled")
		return
	}
	if allowed, reason := h.isEntitled(ctx, u, c, cp.GrantedScopes); !allowed {
		_ = h.ory.revoke(ctx, cp.RefreshToken)
		_ = pending.Update().SetLifecycleStatus("failed").SetFailureReason(reason).Exec(ctx)
		h.appendAudit(ctx, u, auditRecord{EventType: "oauth_claim_rejected", Connector: name, Requested: cp.RequestedScopes, Granted: cp.GrantedScopes, Reason: reason})
		httpx.Error(w, http.StatusForbidden, "connector entitlement denied", reason)
		return
	}
	if !isSubset(cp.GrantedScopes, cp.RequestedScopes) {
		_ = pending.Update().SetLifecycleStatus("failed").SetFailureReason("scope_escalation").Exec(ctx)
		h.appendAudit(ctx, u, auditRecord{EventType: "oauth_claim_rejected", Connector: name, Requested: cp.RequestedScopes, Granted: cp.GrantedScopes, Reason: "scope_escalation"})
		httpx.Error(w, http.StatusBadRequest, "granted scopes exceed requested scopes", "scope_escalation")
		return
	}
	tx, err := h.client.Tx(ctx)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not claim connection", "internal_error")
		return
	}
	rollback := true
	defer func() {
		if rollback {
			_ = tx.Rollback()
		}
	}()
	txp, err := tx.OAuthPending.Query().Where(oauthpending.IDEQ(pending.ID), oauthpending.LifecycleStatusEQ("callback_completed")).Only(auth.WithInternal(ctx))
	if err != nil {
		// Another claimant may already have committed this exact grant. Revoking
		// here would invalidate the winning connection, so replay losers must only
		// reject their own request.
		connectormetrics.Lifecycle.WithLabelValues(name, "claim", "replay").Inc()
		httpx.Error(w, http.StatusConflict, "ticket already consumed", "replay")
		return
	}
	if err := txp.Update().Where(oauthpending.LifecycleStatusEQ("callback_completed")).SetLifecycleStatus("claimed").SetClaimedAt(time.Now().UTC()).Exec(auth.WithInternal(ctx)); err != nil {
		// The conditional update losing a race does not own the provider grant.
		// The transaction winner is responsible for its lifecycle.
		connectormetrics.Lifecycle.WithLabelValues(name, "claim", "replay").Inc()
		httpx.Error(w, http.StatusConflict, "ticket already consumed", "replay")
		return
	}

	connection, replacedGrant, err := h.upsertConnectionWithClient(auth.WithUser(ctx, u), tx.Client(), u, c, cp.RefreshToken, cp.GrantedScopes, pending.CreatedAt)
	if err != nil {
		h.log.Error("persist connection", zap.Error(err))
		_ = h.ory.revoke(context.WithoutCancel(ctx), cp.RefreshToken)
		if errors.Is(err, errConnectorCredentialSuperseded) {
			httpx.Error(w, http.StatusConflict, "connection was disconnected while authorization was in progress; restart authorization", "authorization_restart_required")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "could not persist connection", "internal_error")
		return
	}
	if err := h.persistAuditTransitionWithClient(ctx, tx.Client(), u, auditRecord{
		EventType: "oauth_claimed", EventID: deterministicAuditEventID("oauth_claimed", pending.ID.String(), connection.ID.String(), fmt.Sprint(connection.CredentialGeneration)),
		Connector: name, ConnectionID: connection.ID, OrganizationID: connection.OrganizationID,
		Audience: c.Audience, Requested: cp.RequestedScopes, Granted: cp.GrantedScopes,
	}); err != nil {
		_ = h.ory.revoke(context.WithoutCancel(ctx), cp.RefreshToken)
		httpx.Error(w, http.StatusInternalServerError, "could not persist connection audit", "internal_error")
		return
	}
	if err := tx.Commit(); err != nil {
		_ = h.ory.revoke(context.WithoutCancel(ctx), cp.RefreshToken)
		httpx.Error(w, http.StatusInternalServerError, "could not persist connection", "internal_error")
		return
	}
	rollback = false
	if len(replacedGrant) > 0 {
		if old, openErr := h.sealer.Open(replacedGrant); openErr == nil && string(old) != cp.RefreshToken {
			_ = h.ory.revoke(context.WithoutCancel(ctx), string(old))
		}
	}
	connectormetrics.Lifecycle.WithLabelValues(name, "claim", "success").Inc()
	h.deleteTicket(ctx, pending)
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"connected":    true,
		"connectionId": connection.ID.String(),
		"connector":    name,
		"audience":     c.Audience,
		"scopes":       cp.GrantedScopes,
	})
}

// SetAPIKey handles POST /v1/connections/{name}/api-key for connectors that
// use a vendor-issued API key instead of the OAuth broker.
func (h *Handler) SetAPIKey(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	name := chi.URLParam(r, "name")
	c, ok := h.registry.Get(name)
	if !ok {
		httpx.Error(w, http.StatusNotFound, "unknown connector", "not_found")
		return
	}
	if c.AuthType != "api_key" {
		httpx.Error(w, http.StatusBadRequest, "connector does not use api key auth", "unsupported_auth_type")
		return
	}
	if !h.registry.Enabled(name) {
		httpx.Error(w, http.StatusServiceUnavailable, "connector is disabled", "connector_disabled")
		return
	}
	var req struct {
		APIKey string `json:"apiKey"`
	}
	if !httpx.DecodeJSON(w, r, 1<<16, &req) {
		return
	}
	if strings.TrimSpace(req.APIKey) == "" {
		httpx.Error(w, http.StatusBadRequest, "missing apiKey", "bad_request")
		return
	}
	if allowed, reason := h.isEntitled(r.Context(), u, c, c.Scopes); !allowed {
		httpx.Error(w, http.StatusForbidden, "connector entitlement denied", reason)
		return
	}
	operationStartedAt := time.Now().UTC()
	tx, err := h.client.Tx(auth.WithUser(r.Context(), u))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not persist connection", "internal_error")
		return
	}
	defer func() { _ = tx.Rollback() }()
	connection, err := h.upsertAPIKeyConnection(auth.WithUser(r.Context(), u), tx.Client(), u, c, strings.TrimSpace(req.APIKey), operationStartedAt)
	if err != nil {
		h.log.Error("persist api key connector", zap.Error(err))
		if errors.Is(err, errConnectorCredentialSuperseded) {
			httpx.Error(w, http.StatusConflict, "connection was disconnected while the credential update was in progress; retry", "connection_update_conflict")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "could not persist connection", "internal_error")
		return
	}
	if err := h.persistAuditTransitionWithClient(r.Context(), tx.Client(), u, auditRecord{
		EventType: "api_key_connected", EventID: deterministicAuditEventID("api_key_connected", connection.ID.String(), fmt.Sprint(connection.CredentialGeneration)),
		Connector: name, ConnectionID: connection.ID, OrganizationID: connection.OrganizationID, Audience: c.Audience, Granted: c.Scopes,
	}); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not persist connection audit", "internal_error")
		return
	}
	if err := tx.Commit(); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not persist connection", "internal_error")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"connected": true})
}

// deleteTicket consumes a single-use pending ticket on a detached, time-bounded
// context (so a stalled DB can't block the response or hang on a stripped
// deadline).
func (h *Handler) deleteTicket(ctx context.Context, pending *ent.OAuthPending) {
	dctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := h.client.OAuthPending.DeleteOne(pending).Exec(dctx); err != nil {
		h.log.Warn("delete pending ticket", zap.Error(err))
	}
}

func (h *Handler) upsertConnectionWithClient(ctx context.Context, client *ent.Client, u *ent.User, c Connector, refreshToken string, scopes []string, operationStartedAt time.Time) (*ent.MCPConnection, []byte, error) {
	sealed, err := h.sealer.SealString(refreshToken)
	if err != nil {
		return nil, nil, err
	}
	existing, err := client.MCPConnection.Query().Where(
		mcpconnection.ConnectorEQ(c.Name), mcpconnection.OrganizationIDEQ(connectorOrganizationID(u)),
	).Only(ctx)
	switch {
	case err == nil:
		if (existing.Status == "revoked" || existing.Status == "invalidated") && !existing.RevokedAt.IsZero() && existing.RevokedAt.After(operationStartedAt) {
			return nil, nil, errConnectorCredentialSuperseded
		}
		old := append([]byte(nil), existing.RefreshTokenEncrypted...)
		updated, updateErr := existing.Update().
			Where(mcpconnection.CredentialGenerationEQ(existing.CredentialGeneration), mcpconnection.OrganizationIDEQ(connectorOrganizationID(u))).
			SetRefreshTokenEncrypted(sealed).
			AddCredentialGeneration(1).
			ClearAPIKeyEncrypted().
			SetScopes(scopes).
			SetAudience(c.Audience).
			SetStatus("active").
			SetConnectedAt(time.Now()).
			ClearRevokedAt().ClearRevokedReason().ClearRevokedBy().ClearRevocationAttemptedAt().ClearRevocationSucceeded().
			Save(ctx)
		if ent.IsNotFound(updateErr) {
			return h.upsertConnectionWithClient(ctx, client, u, c, refreshToken, scopes, operationStartedAt)
		}
		return updated, old, updateErr
	case ent.IsNotFound(err):
		created, createErr := client.MCPConnection.Create().
			SetUser(u).
			SetConnector(c.Name).
			SetAudience(c.Audience).
			SetOrganizationID(connectorOrganizationID(u)).
			SetScopes(scopes).
			SetRefreshTokenEncrypted(sealed).
			SetStatus("active").
			SetConnectedAt(time.Now()).
			Save(ctx)
		return created, nil, createErr
	default:
		return nil, nil, err
	}
}

func (h *Handler) upsertAPIKeyConnection(ctx context.Context, client *ent.Client, u *ent.User, c Connector, apiKey string, operationStartedAt time.Time) (*ent.MCPConnection, error) {
	sealed, err := h.sealer.SealString(apiKey)
	if err != nil {
		return nil, err
	}
	existing, err := client.MCPConnection.Query().Where(
		mcpconnection.ConnectorEQ(c.Name), mcpconnection.OrganizationIDEQ(connectorOrganizationID(u)),
	).Only(ctx)
	switch {
	case err == nil:
		if (existing.Status == "revoked" || existing.Status == "invalidated") && !existing.RevokedAt.IsZero() && existing.RevokedAt.After(operationStartedAt) {
			return nil, errConnectorCredentialSuperseded
		}
		updated, updateErr := existing.Update().
			Where(mcpconnection.CredentialGenerationEQ(existing.CredentialGeneration), mcpconnection.OrganizationIDEQ(connectorOrganizationID(u))).
			SetAPIKeyEncrypted(sealed).
			AddCredentialGeneration(1).
			ClearRefreshTokenEncrypted().
			SetScopes(c.Scopes).
			SetAudience(c.Audience).
			SetStatus("active").
			SetConnectedAt(time.Now()).
			ClearRevokedAt().ClearRevokedReason().ClearRevokedBy().ClearRevocationAttemptedAt().ClearRevocationSucceeded().
			Save(ctx)
		if ent.IsNotFound(updateErr) {
			return h.upsertAPIKeyConnection(ctx, client, u, c, apiKey, operationStartedAt)
		}
		return updated, updateErr
	case ent.IsNotFound(err):
		return client.MCPConnection.Create().
			SetUser(u).
			SetConnector(c.Name).
			SetAudience(c.Audience).
			SetOrganizationID(connectorOrganizationID(u)).
			SetScopes(c.Scopes).
			SetAPIKeyEncrypted(sealed).
			SetStatus("active").
			SetConnectedAt(time.Now()).
			Save(ctx)
	default:
		return nil, err
	}
}

// MCPToken handles POST /v1/connections/{name}/mcp-token.
func (h *Handler) MCPToken(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	name := chi.URLParam(r, "name")
	c, ok := h.registry.Get(name)
	if !ok {
		httpx.Error(w, http.StatusNotFound, "unknown connector", "not_found")
		return
	}
	if c.Transport == "native" {
		httpx.Error(w, http.StatusBadRequest, "connector uses server-side native tools, not MCP", "unsupported_transport")
		return
	}
	if !h.registry.Enabled(name) {
		connectormetrics.TokenMint.WithLabelValues(name, "connector_disabled").Inc()
		httpx.Error(w, http.StatusServiceUnavailable, "connector is disabled", "connector_disabled")
		return
	}
	var req struct {
		Audience        string   `json:"audience"`
		RequestedScopes []string `json:"requestedScopes"`
	}
	if r.Body != nil && r.ContentLength != 0 {
		if !httpx.DecodeJSON(w, r, 1<<16, &req) {
			return
		}
	}
	ctx := r.Context()
	mc, err := h.client.MCPConnection.Query().Where(
		mcpconnection.ConnectorEQ(name), mcpconnection.OrganizationIDEQ(connectorOrganizationID(u)),
	).Only(ctx)
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "connector not connected", "not_connected")
		return
	}
	if mc.Status != "active" || !mc.RevokedAt.IsZero() {
		connectormetrics.TokenMint.WithLabelValues(name, "revoked").Inc()
		httpx.Error(w, http.StatusGone, "connector connection is revoked", "connection_revoked")
		return
	}
	audience := strings.TrimSpace(req.Audience)
	if audience == "" {
		audience = c.Audience
	}
	if audience != c.Audience || audience != mc.Audience {
		connectormetrics.TokenMint.WithLabelValues(name, "audience_mismatch").Inc()
		h.appendAudit(ctx, u, auditRecord{EventType: "token_mint_rejected", Connector: name, ConnectionID: mc.ID, Audience: audience, Reason: "audience_mismatch"})
		httpx.Error(w, http.StatusBadRequest, "requested audience does not match connection", "audience_mismatch")
		return
	}
	requestedScopes := req.RequestedScopes
	if len(requestedScopes) == 0 {
		requestedScopes = append([]string(nil), mc.Scopes...)
	}
	validatedScopes, scopeErr := h.registry.validateRequestedScopes(name, requestedScopes)
	if scopeErr != nil || !isSubset(validatedScopes, mc.Scopes) {
		connectormetrics.TokenMint.WithLabelValues(name, "scope_not_granted").Inc()
		h.appendAudit(ctx, u, auditRecord{EventType: "token_mint_rejected", Connector: name, ConnectionID: mc.ID, Audience: audience, Requested: requestedScopes, Granted: mc.Scopes, Reason: "scope_not_granted"})
		httpx.Error(w, http.StatusForbidden, "requested scopes are not granted on this connection", "scope_not_granted")
		return
	}
	if allowed, reason := h.isEntitled(ctx, u, c, validatedScopes); !allowed {
		connectormetrics.TokenMint.WithLabelValues(name, "entitlement_denied").Inc()
		h.appendAudit(ctx, u, auditRecord{EventType: "token_mint_rejected", Connector: name, ConnectionID: mc.ID, Audience: audience, Requested: validatedScopes, Reason: reason})
		if reason != "entitlement_unavailable" {
			_ = h.revokeConnection(context.WithoutCancel(ctx), u, mc, reason, "entitlement", "invalidated")
		}
		httpx.Error(w, http.StatusForbidden, "connector entitlement denied", reason)
		return
	}

	// API-key connector credentials stay server-side. The desktop receives only
	// a broker resource token accepted by the connector's MCP resource server.
	if c.AuthType == "api_key" {
		if _, oErr := h.sealer.Open(mc.APIKeyEncrypted); oErr != nil {
			httpx.Error(w, http.StatusInternalServerError, "could not read credential", "internal_error")
			return
		}
		_ = mc.Update().SetLastUsedAt(time.Now()).Exec(ctx)
		h.writeResourceToken(ctx, w, u, c, mc, audience, validatedScopes)
		return
	}

	refresh, err := h.sealer.Open(mc.RefreshTokenEncrypted)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not read refresh token", "internal_error")
		return
	}
	persistRefresh := func(pctx context.Context, tok *oryToken) error {
		tx, txErr := h.client.Tx(auth.WithUser(pctx, u))
		if txErr != nil {
			return fmt.Errorf("begin connector refresh transaction: %w", txErr)
		}
		rollback := true
		defer func() {
			if rollback {
				_ = tx.Rollback()
			}
		}()
		update := tx.MCPConnection.UpdateOneID(mc.ID).
			Where(
				mcpconnection.CredentialGenerationEQ(mc.CredentialGeneration),
				mcpconnection.StatusEQ("active"),
				mcpconnection.OrganizationIDEQ(mc.OrganizationID),
			).
			SetLastUsedAt(time.Now().UTC())
		newGeneration := mc.CredentialGeneration
		if tok.RefreshToken != "" {
			sealedRefresh, sealErr := h.sealer.SealString(tok.RefreshToken)
			if sealErr != nil {
				return fmt.Errorf("seal rotated connector refresh token: %w", sealErr)
			}
			update.SetRefreshTokenEncrypted(sealedRefresh).AddCredentialGeneration(1)
			newGeneration++
		}
		updated, saveErr := update.Save(auth.WithUser(pctx, u))
		if saveErr != nil {
			if ent.IsNotFound(saveErr) {
				return errConnectorCredentialSuperseded
			}
			return fmt.Errorf("persist rotated connector refresh token: %w", saveErr)
		}
		if auditErr := h.persistAuditTransitionWithClient(pctx, tx.Client(), u, auditRecord{
			EventType: "token_refresh_committed",
			EventID:   deterministicAuditEventID("token_refresh_committed", mc.ID.String(), fmt.Sprint(mc.CredentialGeneration), fmt.Sprint(newGeneration), hashState(tok.AccessToken)),
			Connector: name, ConnectionID: mc.ID, OrganizationID: mc.OrganizationID,
			Audience: mc.Audience, Granted: mc.Scopes,
		}); auditErr != nil {
			return auditErr
		}
		if commitErr := tx.Commit(); commitErr != nil {
			return fmt.Errorf("commit connector refresh: %w", commitErr)
		}
		rollback = false
		mc = updated
		return nil
	}
	tok, err := h.refresh.refresh(ctx, name, mc, h.ory, string(refresh), persistRefresh)
	if err != nil {
		if errors.Is(err, errConnectorRefreshInProgress) {
			w.Header().Set("Retry-After", "2")
			httpx.Error(w, http.StatusTooManyRequests, "token refresh in progress; retry shortly", "refresh_in_progress")
			return
		}
		code := "upstream_error"
		switch {
		case isRefreshFamilyInvalidation(err):
			_ = mc.Update().Where(mcpconnection.CredentialGenerationEQ(mc.CredentialGeneration), mcpconnection.StatusEQ("active")).SetStatus("invalidated").SetRevokedAt(time.Now().UTC()).SetRevokedReason("refresh_token_reuse").SetRevokedBy("provider").SetRevocationSucceeded(true).ClearRefreshTokenEncrypted().ClearAPIKeyEncrypted().Exec(ctx)
			h.appendAudit(ctx, u, auditRecord{EventType: "connection_invalidated", Connector: name, ConnectionID: mc.ID, Audience: mc.Audience, Granted: mc.Scopes, Reason: "refresh_token_reuse", Result: "credential_family_invalidated"})
			connectormetrics.Revocation.WithLabelValues(name, "refresh_family_invalidated").Inc()
			code = "connection_revoked"
		case isOAuthErrorCode(err, "invalid_grant"):
			code = "reauth_required"
			_ = mc.Update().Where(mcpconnection.CredentialGenerationEQ(mc.CredentialGeneration), mcpconnection.StatusEQ("active")).SetStatus("reauth_required").ClearRefreshTokenEncrypted().Exec(ctx)
			h.appendAudit(ctx, u, auditRecord{EventType: "connection_reauth_required", Connector: name, ConnectionID: mc.ID, Audience: mc.Audience, Granted: mc.Scopes, Reason: "invalid_grant"})
		default:
			_ = mc.Update().Where(mcpconnection.CredentialGenerationEQ(mc.CredentialGeneration), mcpconnection.StatusEQ("active")).SetStatus("error").Exec(ctx)
		}
		h.log.Warn("mcp-token refresh failed", zap.String("connector", name), zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "token refresh failed", code)
		return
	}
	// Cached refresh results can arrive after another replica fenced this
	// connection. Re-read the immutable org-owned row before minting any token.
	current, currentErr := h.client.MCPConnection.Query().Where(
		mcpconnection.IDEQ(mc.ID), mcpconnection.OrganizationIDEQ(connectorOrganizationID(u)), mcpconnection.StatusEQ("active"),
	).Only(ctx)
	if currentErr != nil {
		if tok.RefreshToken != "" {
			_ = h.ory.revoke(context.WithoutCancel(ctx), tok.RefreshToken)
		}
		httpx.Error(w, http.StatusGone, "connector connection is revoked", "connection_revoked")
		return
	}
	mc = current
	if _, err := h.grantedScopes(name, validatedScopes, tok.Scope); err != nil {
		connectormetrics.TokenMint.WithLabelValues(name, "scope_escalation").Inc()
		h.appendAudit(ctx, u, auditRecord{EventType: "token_mint_rejected", Connector: name, ConnectionID: mc.ID, Audience: audience, Requested: validatedScopes, Reason: "scope_escalation"})
		httpx.Error(w, http.StatusBadGateway, "upstream token scope mismatch", "scope_escalation")
		return
	}
	h.writeResourceToken(ctx, w, u, c, mc, audience, validatedScopes)
}

func (h *Handler) grantedScopes(connector string, requested []string, raw string) ([]string, error) {
	granted := strings.Fields(raw)
	// RFC 6749 permits omission when the granted scope is identical to the
	// request. Treat omission as equality, never as an empty grant.
	if len(granted) == 0 {
		granted = append([]string(nil), requested...)
	}
	validated, err := validateGrantedScopes(requested, granted)
	if err != nil {
		return nil, err
	}
	for _, def := range h.registry.definitionsForScopes(connector, requested) {
		if def.GrantTier == "required" && !slices.Contains(validated, def.Name) {
			return nil, fmt.Errorf("required scope %q was not granted", def.Name)
		}
	}
	return validated, nil
}

func (h *Handler) writeResourceToken(ctx context.Context, w http.ResponseWriter, u *ent.User, c Connector, mc *ent.MCPConnection, audience string, scopes []string) {
	if h.resourceTokens == nil {
		connectormetrics.TokenMint.WithLabelValues(c.Name, "broker_unconfigured").Inc()
		httpx.Error(w, http.StatusServiceUnavailable, "connector resource token issuer is not configured", "broker_unconfigured")
		return
	}
	tokenID := uuid.NewString()
	token, expiresAt, err := h.resourceTokens.Mint(ResourceTokenClaims{
		TokenID: tokenID, UserID: u.WorkosUserID, OrganizationID: mc.OrganizationID,
		ConnectionID: mc.ID.String(), ConnectorID: c.Name, Audience: audience,
		Scopes: scopes, TrustTier: trustTierForScopes(h.registry, c.Name, scopes),
	})
	if err != nil {
		h.log.Error("mint connector resource token", zap.String("connector", c.Name), zap.Error(err))
		connectormetrics.TokenMint.WithLabelValues(c.Name, "signing_failed").Inc()
		httpx.Error(w, http.StatusInternalServerError, "could not mint connector resource token", "internal_error")
		return
	}
	if err := h.persistAuditTransitionWithClient(ctx, h.client, u, auditRecord{
		EventType: "token_minted", EventID: deterministicAuditEventID("token_minted", tokenID),
		Connector: c.Name, ConnectionID: mc.ID, OrganizationID: mc.OrganizationID,
		Audience: audience, Requested: scopes, Granted: mc.Scopes,
	}); err != nil {
		h.log.Error("persist connector token audit", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not persist token audit", "internal_error")
		return
	}
	expiresIn := max(int64(time.Until(expiresAt).Seconds()), 1)
	connectormetrics.TokenMint.WithLabelValues(c.Name, "success").Inc()
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"access_token": token,
		"token":        token,
		"token_type":   "Bearer",
		"expires_in":   expiresIn,
		"expires_at":   expiresAt.Unix(),
		"scope":        strings.Join(scopes, " "),
		"scopes":       scopes,
		"mcpUrl":       c.MCPURL,
		"audience":     audience,
		"connectionId": mc.ID.String(),
	})
}

// Delete handles DELETE /v1/connections/{name}.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	name := chi.URLParam(r, "name")
	ctx := r.Context()
	mc, err := h.client.MCPConnection.Query().Where(
		mcpconnection.ConnectorEQ(name), mcpconnection.OrganizationIDEQ(connectorOrganizationID(u)),
	).Only(ctx)
	if err != nil {
		w.WriteHeader(http.StatusNoContent) // idempotent
		return
	}
	if connectionID := chi.URLParam(r, "connectionID"); connectionID != "" && connectionID != mc.ID.String() {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err := h.revokeConnection(ctx, u, mc, "user_disconnect", "user", "revoked"); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not disconnect", "internal_error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) deepLinkTo(w http.ResponseWriter, r *http.Request, target, connector, status, session string) {
	// URL-encode the query params: `connector` is a raw path segment (and on the
	// error/expired branches is reflected before registry validation), so a
	// crafted value containing `&`/`=` could otherwise inject extra params the
	// desktop deep-link handler might trust (e.g. spoofing &status=success).
	q := url.Values{}
	q.Set("connector", connector)
	q.Set("status", status)
	if session != "" {
		// The desktop redeems this session/state via the authenticated Claim
		// endpoint to persist the connection.
		q.Set("session", session)
	}
	if normalized, err := h.validateRedirectTarget(target); err == nil {
		target = normalized
	} else {
		target = h.cfg.DeepLinkScheme + "://connection-complete"
	}
	http.Redirect(w, r, target+"?"+q.Encode(), http.StatusFound)
}
