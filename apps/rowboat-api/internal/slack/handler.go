// Package slack brokers the Slack workspace connect flow (OAuth v2). The
// desktop (signed in) opens /oauth/slack/start in the system browser; this
// service runs the install dance (it holds the client secret), parks the
// resulting sealed token bundle in OAuthPending keyed by a state ticket, and
// deep-links back to the desktop, which redeems the ticket with its bearer via
// /v1/slack-oauth/claim.
//
// The claim persists OAuthConnection(provider=slack, external_account_id=
// team_id) — the mapping /v1/webhooks/slack resolves Events API deliveries
// against (RFC 003). The bot token stays server-held: the claim response
// carries workspace metadata only, never the raw credential.
package slack

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthpending"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/slacktoken"
	"go.uber.org/zap"
)

// Handler serves the Slack OAuth broker endpoints.
type Handler struct {
	client  *ent.Client
	sealer  *crypto.Sealer
	secrets *secrets.Store
	http    *outbound.Client
	log     *zap.Logger

	authorizeURL   string
	tokenURL       string
	redirectURI    string // must exactly match a redirect URL registered on the Slack app
	deepLinkScheme string // desktop custom scheme
	scopes         string // comma-separated bot scopes
}

// New builds the Slack OAuth handler.
func New(client *ent.Client, sealer *crypto.Sealer, sec *secrets.Store, log *zap.Logger) *Handler {
	return &Handler{
		client:  client,
		sealer:  sealer,
		secrets: sec,
		http: outbound.NewClient(outbound.Policy{
			Name:                  "slack-oauth",
			Timeout:               15 * time.Second,
			ResponseHeaderTimeout: 10 * time.Second,
			MaxConcurrent:         64,
			MaxResponseBytes:      1 << 20,
		}),
		log:            log,
		authorizeURL:   "https://slack.com/oauth/v2/authorize",
		tokenURL:       "https://slack.com/api/oauth.v2.access",
		deepLinkScheme: "rowboat",
		// app_mentions:read receives @-mentions (the CloudTag trigger); chat:write
		// posts the agent's reply back into the thread (the round-trip).
		scopes: "app_mentions:read,channels:history,channels:read,chat:write,users:read",
	}
}

// SetOutboundPolicy applies the shared outbound vendor policy.
func (h *Handler) SetOutboundPolicy(policy outbound.Policy) {
	policy.Name = "slack-oauth"
	h.http = outbound.NewClient(policy)
}

// SetOAuthFlow configures the browser-facing flow. Empty args keep defaults;
// authorizeURL/tokenURL can be pointed at a dev mock.
func (h *Handler) SetOAuthFlow(authorizeURL, tokenURL, redirectURI, deepLinkScheme, scopes string) {
	if authorizeURL != "" {
		h.authorizeURL = authorizeURL
	}
	if tokenURL != "" {
		h.tokenURL = tokenURL
	}
	if redirectURI != "" {
		h.redirectURI = redirectURI
	}
	if deepLinkScheme != "" {
		h.deepLinkScheme = deepLinkScheme
	}
	if scopes != "" {
		h.scopes = scopes
	}
}

// parkedPayload is sealed into OAuthPending.payload_encrypted by Callback.
type parkedPayload struct {
	AccessToken string `json:"access_token"`
	// RefreshToken is present only when the Slack app has token rotation
	// enabled; v1 persists the access token either way (non-rotating default).
	RefreshToken string `json:"refresh_token,omitempty"`
	ExpiresIn    int64  `json:"expires_in,omitempty"`
	Scope        string `json:"scope,omitempty"`
	TeamID       string `json:"team_id"`
	TeamName     string `json:"team_name,omitempty"`
	BotUserID    string `json:"bot_user_id,omitempty"`
	AppID        string `json:"app_id,omitempty"`
}

// claimResponse is what the desktop receives: workspace metadata, never the
// raw bot token (the server is the credential's only consumer).
type claimResponse struct {
	Connected bool   `json:"connected"`
	TeamID    string `json:"teamId"`
	TeamName  string `json:"teamName,omitempty"`
	Scope     string `json:"scope,omitempty"`
	BotUserID string `json:"botUserId,omitempty"`
}

// Claim handles POST /v1/slack-oauth/claim. Reads and atomically consumes the
// parked ticket, persists the workspace connection, and returns workspace
// metadata.
func (h *Handler) Claim(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	var req struct {
		Session string `json:"session"`
	}
	if !httpx.DecodeJSON(w, r, 1<<16, &req) {
		return
	}
	if req.Session == "" {
		httpx.Error(w, http.StatusBadRequest, "missing session", "bad_request")
		return
	}

	ctx := r.Context()
	pending, err := h.client.OAuthPending.Query().
		Where(oauthpending.StateEQ(req.Session), oauthpending.ProviderEQ("slack")).
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			httpx.Error(w, http.StatusNotFound, "ticket not found or already used", "ticket_expired")
			return
		}
		h.log.Error("slack claim: load pending", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not load ticket", "internal_error")
		return
	}

	consume := func() bool {
		// Atomic one-shot: two concurrent claims must not both succeed. Detached
		// from the request context so a client disconnect can't abort cleanup.
		dctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		n, derr := h.client.OAuthPending.Delete().
			Where(oauthpending.IDEQ(pending.ID)).
			Exec(dctx)
		if derr != nil {
			h.log.Error("slack claim: consume pending", zap.Error(derr))
			return false
		}
		return n == 1
	}

	if time.Now().After(pending.ExpiresAt) {
		_ = consume()
		httpx.Error(w, http.StatusGone, "ticket expired", "ticket_expired")
		return
	}
	plain, err := h.sealer.Open(pending.PayloadEncrypted)
	if err != nil {
		_ = consume()
		h.log.Error("slack claim: decrypt payload", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not read ticket", "internal_error")
		return
	}
	var payload parkedPayload
	if err := json.Unmarshal(plain, &payload); err != nil {
		_ = consume()
		httpx.Error(w, http.StatusInternalServerError, "malformed ticket", "internal_error")
		return
	}
	if payload.AccessToken == "" || payload.TeamID == "" {
		// The browser flow never completed (claim raced the callback, or the
		// install was abandoned): the parked row still holds the empty Start
		// placeholder. Not consumed — the callback may still land.
		httpx.Error(w, http.StatusConflict, "slack install not completed yet", "install_incomplete")
		return
	}

	if !consume() {
		httpx.Error(w, http.StatusNotFound, "ticket not found or already used", "ticket_expired")
		return
	}

	if err := h.persistConnection(ctx, u, payload); err != nil {
		h.log.Error("slack claim: persist connection", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not store connection", "internal_error")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, claimResponse{
		Connected: true,
		TeamID:    payload.TeamID,
		TeamName:  payload.TeamName,
		Scope:     payload.Scope,
		BotUserID: payload.BotUserID,
	})
}

// persistConnection upserts the user's Slack OAuthConnection: sealed bot
// token (the credential column), granted scopes, and the team id that keys
// webhook user resolution.
func (h *Handler) persistConnection(ctx context.Context, u *ent.User, payload parkedPayload) error {
	credential := payload.AccessToken
	if payload.RefreshToken != "" {
		expiresAt := time.Time{}
		if payload.ExpiresIn > 0 {
			expiresAt = time.Now().Add(time.Duration(payload.ExpiresIn) * time.Second)
		}
		var err error
		credential, err = slacktoken.MarshalCredential(slacktoken.Credential{
			AccessToken:  payload.AccessToken,
			RefreshToken: payload.RefreshToken,
			ExpiresAt:    expiresAt,
		})
		if err != nil {
			return err
		}
	}
	sealed, err := h.sealer.SealString(credential)
	if err != nil {
		return err
	}
	scopes := splitScopes(payload.Scope)

	existing, err := h.client.OAuthConnection.Query().
		Where(oauthconnection.ProviderEQ("slack")).
		Only(ctx)
	switch {
	case err == nil:
		return existing.Update().
			SetRefreshTokenEncrypted(sealed).
			SetScopes(scopes).
			SetExternalAccountID(payload.TeamID).
			Exec(ctx)
	case ent.IsNotFound(err):
		return h.client.OAuthConnection.Create().
			SetUser(u).
			SetProvider("slack").
			SetRefreshTokenEncrypted(sealed).
			SetScopes(scopes).
			SetExternalAccountID(payload.TeamID).
			Exec(ctx)
	default:
		return err
	}
}

// splitScopes splits Slack's comma-separated scope string.
func splitScopes(scope string) []string {
	if scope == "" {
		return nil
	}
	parts := strings.Split(scope, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
