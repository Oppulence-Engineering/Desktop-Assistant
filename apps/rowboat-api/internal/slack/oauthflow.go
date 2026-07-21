package slack

// Browser-facing Slack OAuth v2 install flow. Mirrors the Google broker
// (internal/google/oauthflow.go): the desktop opens /oauth/slack/start in the
// system browser; the callback exchanges the code server-side and parks the
// sealed bundle for the authenticated claim.

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthpending"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"go.uber.org/zap"
)

// Start handles authenticated POST /v1/slack-oauth/start and binds the state
// ticket to the verified Rowboat user before redirecting to Slack.
func (h *Handler) Start(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	if h.secrets.SlackClientID() == "" || h.secrets.SlackClientSecret() == "" {
		h.errorPage(w, http.StatusBadGateway, "Slack isn't configured on the server yet.")
		return
	}
	if h.redirectURI == "" {
		h.errorPage(w, http.StatusInternalServerError, "Slack redirect URI not configured.")
		return
	}

	state, err := randomState()
	if err != nil {
		h.log.Error("slack start: generate state", zap.Error(err))
		h.errorPage(w, http.StatusInternalServerError, "Could not start the Slack install.")
		return
	}
	initial, _ := json.Marshal(parkedPayload{WorkOSUserID: u.WorkosUserID})
	sealed, err := h.sealer.Seal(initial)
	if err != nil {
		h.errorPage(w, http.StatusInternalServerError, "Could not start the Slack install.")
		return
	}
	if err := h.client.OAuthPending.Create().
		SetState(state).
		SetProvider("slack").
		SetPayloadEncrypted(sealed).
		SetExpiresAt(time.Now().Add(10 * time.Minute)).
		Exec(r.Context()); err != nil {
		h.log.Error("slack start: persist pending", zap.Error(err))
		h.errorPage(w, http.StatusInternalServerError, "Could not start the Slack install.")
		return
	}

	q := url.Values{}
	q.Set("client_id", h.secrets.SlackClientID())
	q.Set("scope", h.scopes) // bot scopes, comma-separated
	q.Set("redirect_uri", h.redirectURI)
	q.Set("state", state)
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"authorizeUrl": h.authorizeURL + "?" + q.Encode()})
}

// Callback handles GET /oauth/slack/callback (Slack's redirect target). It
// exchanges the code server-side, parks the sealed bundle under the state,
// and deep-links back to the desktop.
func (h *Handler) Callback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()
	state := q.Get("state")
	code := q.Get("code")
	if state == "" {
		h.errorPage(w, http.StatusBadRequest, "Missing state.")
		return
	}

	pending, err := h.client.OAuthPending.Query().
		Where(oauthpending.StateEQ(state), oauthpending.ProviderEQ("slack")).
		Only(ctx)
	if err != nil {
		h.errorPage(w, http.StatusBadRequest, "Install session expired or invalid. Please try again.")
		return
	}
	if time.Now().After(pending.ExpiresAt) {
		dctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		_ = h.client.OAuthPending.DeleteOne(pending).Exec(dctx)
		cancel()
		h.errorPage(w, http.StatusBadRequest, "Install session expired. Please try again.")
		return
	}
	initialRaw, err := h.sealer.Open(pending.PayloadEncrypted)
	if err != nil {
		h.errorPage(w, http.StatusBadRequest, "Install session is invalid. Please try again.")
		return
	}
	var initial parkedPayload
	if json.Unmarshal(initialRaw, &initial) != nil || initial.WorkOSUserID == "" {
		h.errorPage(w, http.StatusBadRequest, "Install session is not bound to a user. Please try again.")
		return
	}
	if oauthErr := q.Get("error"); oauthErr != "" {
		h.deepLink(w, state, "error")
		return
	}
	if code == "" {
		h.errorPage(w, http.StatusBadRequest, "Missing code.")
		return
	}

	// Exchange the code at Slack (server holds the client secret).
	form := url.Values{}
	form.Set("client_id", h.secrets.SlackClientID())
	form.Set("client_secret", h.secrets.SlackClientSecret())
	form.Set("code", code)
	form.Set("redirect_uri", h.redirectURI)

	upReq, err := http.NewRequestWithContext(ctx, http.MethodPost, h.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		h.deepLink(w, state, "error")
		return
	}
	upReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := h.http.Do(upReq)
	if err != nil {
		h.log.Warn("slack callback: token exchange", zap.Error(err))
		h.deepLink(w, state, "error")
		return
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := outbound.ReadAll(resp.Body, h.http.MaxResponseBytes())
	if err != nil || resp.StatusCode != http.StatusOK {
		h.log.Warn("slack callback: token exchange failed", zap.Int("status", resp.StatusCode), zap.Error(err))
		h.deepLink(w, state, "error")
		return
	}

	// Slack returns 200 with {"ok": false, "error": "..."} on failure.
	var stok struct {
		OK           bool   `json:"ok"`
		Error        string `json:"error"`
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
		Scope        string `json:"scope"`
		BotUserID    string `json:"bot_user_id"`
		AppID        string `json:"app_id"`
		Team         struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"team"`
	}
	if err := json.Unmarshal(body, &stok); err != nil || !stok.OK || stok.AccessToken == "" || stok.Team.ID == "" {
		h.log.Warn("slack callback: exchange rejected", zap.String("slackError", stok.Error))
		h.deepLink(w, state, "error")
		return
	}

	raw, _ := json.Marshal(parkedPayload{
		WorkOSUserID: initial.WorkOSUserID,
		AccessToken:  stok.AccessToken,
		RefreshToken: stok.RefreshToken,
		ExpiresIn:    stok.ExpiresIn,
		Scope:        stok.Scope,
		TeamID:       stok.Team.ID,
		TeamName:     stok.Team.Name,
		BotUserID:    stok.BotUserID,
		AppID:        stok.AppID,
	})
	sealed, err := h.sealer.Seal(raw)
	if err != nil {
		h.deepLink(w, state, "error")
		return
	}
	if err := pending.Update().SetPayloadEncrypted(sealed).Exec(ctx); err != nil {
		h.log.Error("slack callback: park tokens", zap.Error(err))
		h.deepLink(w, state, "error")
		return
	}
	h.deepLink(w, state, "success")
}

// deepLink bounces the browser back to the desktop via the configured scheme;
// the desktop claims the parked bundle with its bearer. An HTML page is used
// because a bare 302 to a custom scheme is unreliable across browsers.
func (h *Handler) deepLink(w http.ResponseWriter, state, status string) {
	target := h.deepLinkScheme + "://oauth/slack/done?session=" + url.QueryEscape(state) + "&status=" + status
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'nonce-"+state+"'; base-uri 'none'; frame-ancestors 'none'")
	_, _ = io.WriteString(w, "<!doctype html><meta charset=utf-8><title>Rowboat</title>"+
		"<script nonce="+jsString(state)+">location.href="+jsString(target)+"</script>"+
		"<p style=\"font:14px system-ui;margin:3rem\">Returning to Rowboat… "+
		"<a href="+jsString(target)+">Click here</a> if it doesn't open automatically.</p>")
}

func (h *Handler) errorPage(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; base-uri 'none'; frame-ancestors 'none'")
	w.WriteHeader(code)
	_, _ = io.WriteString(w, "<!doctype html><meta charset=utf-8><title>Rowboat</title>"+
		"<p style=\"font:14px system-ui;margin:3rem\">"+htmlEscape(msg)+"</p>")
}

func randomState() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		// Fail closed rather than emit a predictable state.
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func jsString(s string) string { b, _ := json.Marshal(s); return string(b) }

func htmlEscape(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(s)
}
