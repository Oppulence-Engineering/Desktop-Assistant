package connectors

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mcpconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthpending"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

// Config carries the OAuth-brokering settings the handler needs.
type Config struct {
	OryPublicURL          string
	OryBrokerClientID     string
	OryBrokerClientSecret string
	PublicBaseURL         string
	DeepLinkScheme        string
}

// Handler serves the connector + connection endpoints.
type Handler struct {
	client   *ent.Client
	sealer   *crypto.Sealer
	registry *Registry
	ory      *oryClient
	cfg      Config
	log      *zap.Logger
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
	Connector    string `json:"connector"`
	Verifier     string `json:"code_verifier"`
	WorkOSUserID string `json:"workos_user_id"`
	RefreshToken string `json:"refresh_token,omitempty"`
	Scope        string `json:"scope,omitempty"`
}

type connectorView struct {
	Name        string          `json:"name"`
	DisplayName string          `json:"displayName"`
	Description string          `json:"description"`
	MCPURL      string          `json:"mcpUrl"`
	AuthType    string          `json:"authType"`
	Scopes      []string        `json:"scopes,omitempty"`
	IconURL     string          `json:"iconUrl,omitempty"`
	MCPTools    []MCPToolPolicy `json:"mcpTools,omitempty"`
	Connected   bool            `json:"connected"`
	ConnectedAt string          `json:"connectedAt,omitempty"`
}

// List handles GET /v1/connectors.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserFromCtx(r.Context()); !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	conns, err := h.client.MCPConnection.Query().All(r.Context())
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
			MCPURL: c.MCPURL, AuthType: c.AuthType, Scopes: c.Scopes, IconURL: c.IconURL, MCPTools: c.MCPTools,
		}
		if mc, ok := connected[c.Name]; ok {
			v.Connected = true
			if !mc.ConnectedAt.IsZero() {
				v.ConnectedAt = mc.ConnectedAt.UTC().Format(time.RFC3339)
			}
		}
		views = append(views, v)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"connectors": views})
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

	state, err1 := randomToken(32)
	verifier, err2 := randomToken(48)
	if err1 != nil || err2 != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not generate state", "internal_error")
		return
	}
	payload, _ := json.Marshal(connectPending{Connector: name, Verifier: verifier, WorkOSUserID: u.WorkosUserID})
	sealed, err := h.sealer.Seal(payload)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not seal state", "internal_error")
		return
	}
	if err := h.client.OAuthPending.Create().
		SetState(state).
		SetProvider(name).
		SetPayloadEncrypted(sealed).
		SetExpiresAt(time.Now().Add(10 * time.Minute)).
		Exec(r.Context()); err != nil {
		h.log.Error("persist pending", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not start connection", "internal_error")
		return
	}

	redirectURI := strings.TrimRight(h.cfg.PublicBaseURL, "/") + "/v1/connections/" + name + "/callback"
	scope := strings.Join(append([]string{"offline_access"}, c.Scopes...), " ")
	authURL := h.ory.authorizeURL(redirectURI, scope, state, codeChallengeS256(verifier), c.Audience)
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"authorize_url": authURL})
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

	if oauthErr := q.Get("error"); oauthErr != "" {
		h.deepLink(w, r, name, "error", state)
		return
	}
	code := q.Get("code")
	if code == "" || state == "" {
		httpx.Error(w, http.StatusBadRequest, "missing code or state", "bad_request")
		return
	}

	ctx := r.Context()
	pending, err := h.client.OAuthPending.Query().Where(oauthpending.StateEQ(state)).Only(ctx)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid or expired state", "bad_request")
		return
	}
	if time.Now().After(pending.ExpiresAt) {
		h.deleteTicket(ctx, pending)
		h.deepLink(w, r, name, "error", state)
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

	redirectURI := strings.TrimRight(h.cfg.PublicBaseURL, "/") + "/v1/connections/" + name + "/callback"
	tok, err := h.ory.exchange(ctx, code, redirectURI, cp.Verifier)
	if err != nil {
		h.log.Warn("token exchange failed", zap.String("connector", name), zap.Error(err))
		h.deepLink(w, r, name, "error", state)
		return
	}

	// Park the grant in the ticket for the authenticated Claim step.
	cp.RefreshToken = tok.RefreshToken
	cp.Scope = tok.Scope
	resealed, mErr := json.Marshal(cp)
	if mErr != nil {
		h.deepLink(w, r, name, "error", state)
		return
	}
	sealed, sErr := h.sealer.Seal(resealed)
	if sErr != nil {
		h.deepLink(w, r, name, "error", state)
		return
	}
	if uErr := pending.Update().SetPayloadEncrypted(sealed).Exec(ctx); uErr != nil {
		h.log.Error("park connector grant", zap.Error(uErr))
		h.deepLink(w, r, name, "error", state)
		return
	}
	h.deepLink(w, r, name, "success", state)
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
	pending, err := h.client.OAuthPending.Query().Where(oauthpending.StateEQ(req.State)).Only(ctx)
	if err != nil {
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
	// Ownership: only the user who STARTED the flow may claim it.
	if cp.WorkOSUserID != u.WorkosUserID {
		// Do NOT consume the ticket on a wrong-user rejection, so a probe can't
		// burn the legitimate owner's pending ticket.
		httpx.Error(w, http.StatusForbidden, "ticket does not belong to this user", "forbidden")
		return
	}
	if cp.RefreshToken == "" {
		// The browser flow hasn't completed yet (Callback hasn't parked a grant);
		// keep the ticket so the desktop can retry once it finishes.
		httpx.Error(w, http.StatusConflict, "connection not ready", "not_ready")
		return
	}

	h.deleteTicket(ctx, pending) // single-use: consume on the terminal success path
	if err := h.upsertConnection(auth.WithUser(ctx, u), u, c, &oryToken{RefreshToken: cp.RefreshToken, Scope: cp.Scope}); err != nil {
		h.log.Error("persist connection", zap.Error(err))
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

func (h *Handler) upsertConnection(ctx context.Context, u *ent.User, c Connector, tok *oryToken) error {
	sealed, err := h.sealer.SealString(tok.RefreshToken)
	if err != nil {
		return err
	}
	scopes := strings.Fields(tok.Scope)
	if len(scopes) == 0 {
		scopes = c.Scopes
	}
	existing, err := h.client.MCPConnection.Query().Where(mcpconnection.ConnectorEQ(c.Name)).Only(ctx)
	switch {
	case err == nil:
		return existing.Update().
			SetRefreshTokenEncrypted(sealed).
			SetScopes(scopes).
			SetAudience(c.Audience).
			SetConnectedAt(time.Now()).
			Exec(ctx)
	case ent.IsNotFound(err):
		return h.client.MCPConnection.Create().
			SetUser(u).
			SetConnector(c.Name).
			SetAudience(c.Audience).
			SetScopes(scopes).
			SetRefreshTokenEncrypted(sealed).
			SetConnectedAt(time.Now()).
			Exec(ctx)
	default:
		return err
	}
}

// MCPToken handles POST /v1/connections/{name}/mcp-token.
func (h *Handler) MCPToken(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	_ = u
	name := chi.URLParam(r, "name")
	c, ok := h.registry.Get(name)
	if !ok {
		httpx.Error(w, http.StatusNotFound, "unknown connector", "not_found")
		return
	}
	ctx := r.Context()
	mc, err := h.client.MCPConnection.Query().Where(mcpconnection.ConnectorEQ(name)).Only(ctx)
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "connector not connected", "not_connected")
		return
	}

	// API-key connectors: return the stored vendor key directly.
	if c.AuthType == "api_key" {
		key, oErr := h.sealer.Open(mc.APIKeyEncrypted)
		if oErr != nil {
			httpx.Error(w, http.StatusInternalServerError, "could not read credential", "internal_error")
			return
		}
		_ = mc.Update().SetLastUsedAt(time.Now()).Exec(ctx)
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"access_token": string(key), "token_type": "Bearer", "mcpUrl": c.MCPURL,
		})
		return
	}

	refresh, err := h.sealer.Open(mc.RefreshTokenEncrypted)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not read refresh token", "internal_error")
		return
	}
	tok, err := h.ory.refresh(ctx, string(refresh))
	if err != nil {
		h.log.Warn("mcp-token refresh failed", zap.String("connector", name), zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "token refresh failed", "upstream_error")
		return
	}

	// NOTE: concurrent mcp-token refreshes for the same connection remain a
	// known race (no distributed lock here, out of scope): two in-flight
	// refreshes can each rotate the Ory refresh token and clobber the other's
	// persisted value.
	upd := mc.Update().SetLastUsedAt(time.Now())
	if tok.RefreshToken != "" { // Ory rotates refresh tokens
		newSealed, sErr := h.sealer.SealString(tok.RefreshToken)
		if sErr != nil {
			// Don't silently drop the rotated token: if we proceed without
			// persisting it the stored token is already dead. Surface it.
			h.log.Error("mcp-token seal rotated refresh token", zap.String("connector", name), zap.Error(sErr))
			httpx.Error(w, http.StatusInternalServerError, "could not persist refreshed token", "internal_error")
			return
		}
		upd = upd.SetRefreshTokenEncrypted(newSealed)
	}
	if err := upd.Exec(ctx); err != nil {
		// Ory uses refresh-token rotation: if persisting the rotated refresh
		// token fails, the stored token is now dead and reuse-detection may
		// revoke the grant. Surface the failure rather than swallowing it.
		h.log.Error("mcp-token persist refreshed token", zap.String("connector", name), zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not persist refreshed token", "internal_error")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"access_token": tok.AccessToken,
		"token_type":   defaultStr(tok.TokenType, "Bearer"),
		"expires_at":   time.Now().Add(time.Duration(tok.ExpiresIn) * time.Second).Unix(),
		"mcpUrl":       c.MCPURL,
	})
}

// Delete handles DELETE /v1/connections/{name}.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserFromCtx(r.Context()); !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	name := chi.URLParam(r, "name")
	ctx := r.Context()
	mc, err := h.client.MCPConnection.Query().Where(mcpconnection.ConnectorEQ(name)).Only(ctx)
	if err != nil {
		w.WriteHeader(http.StatusNoContent) // idempotent
		return
	}
	if len(mc.RefreshTokenEncrypted) > 0 {
		if refresh, oErr := h.sealer.Open(mc.RefreshTokenEncrypted); oErr == nil {
			if rErr := h.ory.revoke(ctx, string(refresh)); rErr != nil {
				h.log.Warn("revoke at ory failed", zap.Error(rErr))
			}
		}
	}
	if err := h.client.MCPConnection.DeleteOne(mc).Exec(ctx); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not disconnect", "internal_error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) deepLink(w http.ResponseWriter, r *http.Request, connector, status, session string) {
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
	target := h.cfg.DeepLinkScheme + "://connection-complete?" + q.Encode()
	http.Redirect(w, r, target, http.StatusFound)
}

func defaultStr(v, def string) string {
	if v == "" {
		return def
	}
	return v
}
