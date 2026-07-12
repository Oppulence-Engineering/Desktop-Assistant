package cloudevents

import (
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/googlewatch"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"go.uber.org/zap"
)

// Google push ingestion: Gmail arrives as an OIDC-authenticated Pub/Sub push
// envelope; Calendar and Drive arrive as channel notifications authenticated
// by the X-Goog-Channel-Token set at watch time. Development retains the legacy
// query-token fallback for local Pub/Sub mocks, but production configuration
// requires OIDC for Gmail so secrets never appear in push URLs or access logs.

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

	// Calendar and Drive channel notifications carry everything in headers.
	if state := r.Header.Get("X-Goog-Resource-State"); state != "" {
		h.handleGoogleChannelNotification(w, r, state)
		return
	}
	h.handleGmailPush(w, r, body)
}

// verifyGoogleToken constant-time-compares the shared token from either the
// query string (Pub/Sub push) or the channel token header (Calendar). Fails
// closed when the secret is unconfigured (pattern: auth.RequireHookHMAC).
func (h *Handler) verifyGoogleToken(w http.ResponseWriter, r *http.Request) bool {
	if r.Header.Get("X-Goog-Resource-State") == "" && h.googlePushVerifier != nil {
		authz := strings.TrimSpace(r.Header.Get("Authorization"))
		const prefix = "Bearer "
		if len(authz) <= len(prefix) || !strings.EqualFold(authz[:len(prefix)], prefix) {
			httpx.Error(w, http.StatusUnauthorized, "missing Pub/Sub OIDC token", "unauthorized")
			return false
		}
		claims, err := h.googlePushVerifier.Verify(strings.TrimSpace(authz[len(prefix):]))
		if err != nil || claims == nil || h.googlePushEmail == "" || !strings.EqualFold(strings.TrimSpace(claims.Email), h.googlePushEmail) {
			httpx.Error(w, http.StatusUnauthorized, "invalid Pub/Sub OIDC token", "unauthorized")
			return false
		}
		return true
	}
	secret := h.cfg.GoogleWebhookToken
	if secret == "" {
		h.log.Error("google webhook rejected: GOOGLE_WEBHOOK_TOKEN is not configured")
		httpx.Error(w, http.StatusInternalServerError, "webhook verification unavailable", "webhook_unconfigured")
		return false
	}
	got := r.Header.Get("X-Goog-Channel-Token")
	if r.Header.Get("X-Goog-Resource-State") == "" {
		// Local-development compatibility only. Production Gmail pushes install
		// an OIDC verifier and never reach this query-token branch.
		got = r.URL.Query().Get("token")
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
	owner, ok := h.resolveActiveGoogleWatch(r, "gmail", email, "", "")
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

func (h *Handler) handleGoogleChannelNotification(w http.ResponseWriter, r *http.Request, state string) {
	// The initial handshake message for a new channel carries state=sync and
	// must simply be acknowledged.
	if state == "sync" {
		w.WriteHeader(http.StatusOK)
		return
	}
	channelID := r.Header.Get("X-Goog-Channel-ID")
	messageNumber := r.Header.Get("X-Goog-Message-Number")
	resourceID := r.Header.Get("X-Goog-Resource-ID")
	if channelID == "" || messageNumber == "" || resourceID == "" {
		httpx.Error(w, http.StatusBadRequest, "missing Goog channel headers", "bad_request")
		return
	}
	switch {
	case strings.HasPrefix(channelID, "gcal:"):
		h.handleCalendarNotification(w, r, state, channelID, messageNumber, resourceID)
	case strings.HasPrefix(channelID, "gdrive:"):
		h.handleDriveNotification(w, r, state, channelID, messageNumber, resourceID)
	default:
		metricUnresolved.WithLabelValues(SourceGoogleCalendar).Inc()
		h.log.Warn("google notification for unresolved channel dropped",
			zap.String("channelId", channelID))
		w.WriteHeader(http.StatusOK)
	}
}

func (h *Handler) handleCalendarNotification(w http.ResponseWriter, r *http.Request, state, channelID, messageNumber, resourceID string) {
	// The watching account travels in the channel id, which Rowboat controls
	// at watch time: "gcal:{accountEmail}:{uuid}".
	email := calendarAccountFromChannelID(channelID)
	owner, ok := h.resolveActiveGoogleWatch(r, "calendar", email, channelID, resourceID)
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

func (h *Handler) handleDriveNotification(w http.ResponseWriter, r *http.Request, state, channelID, messageNumber, resourceID string) {
	// The watching account travels in the channel id, which Rowboat controls
	// at watch time: "gdrive:{accountEmail}:{uuid}".
	email := driveAccountFromChannelID(channelID)
	owner, ok := h.resolveActiveGoogleWatch(r, "drive", email, channelID, resourceID)
	if !ok {
		metricUnresolved.WithLabelValues(SourceGoogleDrive).Inc()
		h.log.Warn("drive notification for unresolved channel dropped",
			zap.String("channelId", channelID))
		w.WriteHeader(http.StatusOK)
		return
	}

	payload, _ := json.Marshal(map[string]string{
		"channelId":     channelID,
		"resourceId":    resourceID,
		"resourceState": state,
		"messageNumber": messageNumber,
		"changed":       r.Header.Get("X-Goog-Changed"),
	})
	req := IngestRequest{
		Source:          SourceGoogleDrive,
		SourceEventID:   resourceID,
		SourceAccountID: email,
		EventType:       "resource." + state,
		Text:            fmt.Sprintf("Google Drive update (%s) for %s.", state, email),
		Payload:         payload,
		DedupeKey:       fmt.Sprintf("gdrive:%s:%s", channelID, messageNumber),
	}
	h.respondIngest(w, r, owner, req)
}

// calendarAccountFromChannelID extracts the account email from a Rowboat-
// minted channel id ("gcal:{email}:{uuid}"), or "" for foreign formats.
func calendarAccountFromChannelID(channelID string) string {
	return googleChannelAccountFromID(channelID, "gcal")
}

// driveAccountFromChannelID extracts the account email from a Rowboat-minted
// Drive channel id ("gdrive:{email}:{uuid}"), or "" for foreign formats.
func driveAccountFromChannelID(channelID string) string {
	return googleChannelAccountFromID(channelID, "gdrive")
}

func googleChannelAccountFromID(channelID, prefix string) string {
	parts := strings.SplitN(channelID, ":", 3)
	if len(parts) != 3 || parts[0] != prefix {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(parts[1]))
}

// resolveActiveGoogleWatch binds a push to the exact registration Rowboat
// created. A shared webhook token alone is not enough: without this check a
// holder could forge a channel id containing any connected user's email and
// inject events into that tenant.
func (h *Handler) resolveActiveGoogleWatch(r *http.Request, kind, email, channelID, resourceID string) (*ent.User, bool) {
	if email == "" {
		return nil, false
	}
	ctx := auth.WithInternal(r.Context())
	q := h.client.GoogleWatch.Query().
		Where(
			googlewatch.KindEQ(kind),
			googlewatch.AccountEmailEQ(email),
			googlewatch.ExpiresAtGT(time.Now().UTC()),
		).
		WithUser()
	if channelID != "" {
		q = q.Where(googlewatch.ChannelIDEQ(channelID))
	}
	if resourceID != "" {
		q = q.Where(googlewatch.ResourceIDEQ(resourceID))
	}
	watch, err := q.Only(ctx)
	if err != nil {
		if !ent.IsNotFound(err) {
			h.log.Error("google webhook watch resolution failed", zap.Error(err))
		}
		return nil, false
	}
	if watch.Edges.User == nil {
		return nil, false
	}
	return watch.Edges.User, true
}
