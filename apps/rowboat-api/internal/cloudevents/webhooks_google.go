package cloudevents

import (
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"go.uber.org/zap"
)

// Google push ingestion: Gmail arrives as a Pub/Sub push envelope, Calendar as
// a channel notification (headers only). Both are verified against the shared
// GOOGLE_WEBHOOK_TOKEN — supplied as ?token= on the Pub/Sub push subscription
// URL, or as the channel token (X-Goog-Channel-Token) set at watch time.
//
// V1 TRADEOFF: a shared bearer-style token is weaker than Pub/Sub OIDC push
// auth (it can leak via URL logging); OIDC JWT verification against Google's
// JWKS is the production follow-up. The blast radius is contained because the
// handler only ever stores events for users it can resolve from a connected
// account, and unresolved pushes are dropped.

const maxGoogleWebhookBody = 1 << 20 // 1 MiB

// GoogleWebhook handles POST /v1/webhooks/google.
func (h *Handler) GoogleWebhook(w http.ResponseWriter, r *http.Request) {
	if !h.verifyGoogleToken(w, r) {
		return
	}

	body, ok := httpx.ReadBody(w, r, maxGoogleWebhookBody)
	if !ok {
		return
	}

	// Calendar channel notifications carry everything in headers.
	if state := r.Header.Get("X-Goog-Resource-State"); state != "" {
		h.handleCalendarNotification(w, r, state)
		return
	}
	h.handleGmailPush(w, r, body)
}

// verifyGoogleToken constant-time-compares the shared token from either the
// query string (Pub/Sub push) or the channel token header (Calendar). Fails
// closed when the secret is unconfigured (pattern: auth.RequireHookHMAC).
func (h *Handler) verifyGoogleToken(w http.ResponseWriter, r *http.Request) bool {
	secret := h.cfg.GoogleWebhookToken
	if secret == "" {
		h.log.Error("google webhook rejected: GOOGLE_WEBHOOK_TOKEN is not configured")
		httpx.Error(w, http.StatusInternalServerError, "webhook verification unavailable", "webhook_unconfigured")
		return false
	}
	got := r.URL.Query().Get("token")
	if got == "" {
		got = r.Header.Get("X-Goog-Channel-Token")
	}
	if subtle.ConstantTimeCompare([]byte(got), []byte(secret)) != 1 {
		httpx.Error(w, http.StatusUnauthorized, "invalid webhook token", "unauthorized")
		return false
	}
	return true
}

// pubsubPush is the Pub/Sub push envelope; Gmail's notification payload is
// base64 inside message.data.
type pubsubPush struct {
	Message struct {
		Data      string `json:"data"`
		MessageID string `json:"messageId"`
	} `json:"message"`
	Subscription string `json:"subscription"`
}

// gmailNotification is the decoded Gmail watch payload.
type gmailNotification struct {
	EmailAddress string `json:"emailAddress"`
	HistoryID    uint64 `json:"historyId"`
}

func (h *Handler) handleGmailPush(w http.ResponseWriter, r *http.Request, body []byte) {
	var push pubsubPush
	if err := json.Unmarshal(body, &push); err != nil || push.Message.Data == "" {
		httpx.Error(w, http.StatusBadRequest, "not a Pub/Sub push envelope", "bad_request")
		return
	}
	decoded, err := base64.StdEncoding.DecodeString(push.Message.Data)
	if err != nil {
		// Pub/Sub uses standard base64; some emitters use URL-safe.
		decoded, err = base64.URLEncoding.DecodeString(push.Message.Data)
	}
	var note gmailNotification
	if err != nil || json.Unmarshal(decoded, &note) != nil || note.EmailAddress == "" {
		httpx.Error(w, http.StatusBadRequest, "unrecognized Gmail notification payload", "bad_request")
		return
	}

	email := strings.ToLower(strings.TrimSpace(note.EmailAddress))
	owner, ok := h.resolveGoogleUser(r, email)
	if !ok {
		// 200, not 4xx: stop provider retries for an account we will never
		// resolve. The event is dropped (CloudEvent.user is required) and the
		// gap is observable via the unresolved metric + log.
		metricUnresolved.WithLabelValues(SourceGmail).Inc()
		h.log.Warn("gmail push for unresolved account dropped", zap.String("sourceAccountId", email))
		w.WriteHeader(http.StatusOK)
		return
	}

	req := IngestRequest{
		Source:          SourceGmail,
		SourceEventID:   fmt.Sprintf("%d", note.HistoryID),
		SourceAccountID: email,
		EventType:       "history.changed",
		// The push carries no message content by design — the run's agent
		// fetches details using the user's connection.
		Text:      fmt.Sprintf("Gmail mailbox update for %s (history %d).", email, note.HistoryID),
		Payload:   json.RawMessage(decoded),
		DedupeKey: fmt.Sprintf("gmail:history:%s:%d", email, note.HistoryID),
	}
	h.respondIngest(w, r, owner, req)
}

func (h *Handler) handleCalendarNotification(w http.ResponseWriter, r *http.Request, state string) {
	// The initial handshake message for a new channel carries state=sync and
	// must simply be acknowledged.
	if state == "sync" {
		w.WriteHeader(http.StatusOK)
		return
	}
	channelID := r.Header.Get("X-Goog-Channel-ID")
	messageNumber := r.Header.Get("X-Goog-Message-Number")
	resourceID := r.Header.Get("X-Goog-Resource-ID")
	if channelID == "" || messageNumber == "" {
		httpx.Error(w, http.StatusBadRequest, "missing Goog channel headers", "bad_request")
		return
	}

	// The watching account travels in the channel id, which Rowboat controls
	// at watch time: "gcal:{accountEmail}:{uuid}".
	email := calendarAccountFromChannelID(channelID)
	owner, ok := h.resolveGoogleUser(r, email)
	if !ok {
		metricUnresolved.WithLabelValues(SourceGoogleCalendar).Inc()
		h.log.Warn("calendar notification for unresolved channel dropped",
			zap.String("channelId", channelID))
		w.WriteHeader(http.StatusOK)
		return
	}

	payload, _ := json.Marshal(map[string]string{
		"channelId":     channelID,
		"resourceId":    resourceID,
		"resourceState": state,
		"messageNumber": messageNumber,
	})
	req := IngestRequest{
		Source:          SourceGoogleCalendar,
		SourceEventID:   resourceID,
		SourceAccountID: email,
		EventType:       "resource." + state, // e.g. resource.exists, resource.update
		Text:            fmt.Sprintf("Google Calendar update (%s) for %s.", state, email),
		Payload:         payload,
		DedupeKey:       fmt.Sprintf("gcal:%s:%s", channelID, messageNumber),
	}
	h.respondIngest(w, r, owner, req)
}

// calendarAccountFromChannelID extracts the account email from a Rowboat-
// minted channel id ("gcal:{email}:{uuid}"), or "" for foreign formats.
func calendarAccountFromChannelID(channelID string) string {
	parts := strings.SplitN(channelID, ":", 3)
	if len(parts) != 3 || parts[0] != "gcal" {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(parts[1]))
}

// resolveGoogleUser maps a Google account email to the owning Rowboat user:
// first via the connection's external_account_id, then falling back to the
// user's WorkOS email (covers connections made before the backfill field).
func (h *Handler) resolveGoogleUser(r *http.Request, email string) (*ent.User, bool) {
	if email == "" {
		return nil, false
	}
	ctx := auth.WithInternal(r.Context())
	conn, err := h.client.OAuthConnection.Query().
		Where(
			oauthconnection.ProviderEQ("google"),
			oauthconnection.ExternalAccountIDEQ(email),
		).
		WithUser().
		First(ctx)
	if err == nil && conn.Edges.User != nil {
		return conn.Edges.User, true
	}
	if err != nil && !ent.IsNotFound(err) {
		h.log.Error("google webhook user resolution failed", zap.Error(err))
		return nil, false
	}
	owner, err := h.client.User.Query().Where(user.EmailEQ(email)).First(ctx)
	if err != nil {
		return nil, false
	}
	return owner, true
}
