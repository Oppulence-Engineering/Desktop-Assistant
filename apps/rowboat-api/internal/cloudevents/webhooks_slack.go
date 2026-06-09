package cloudevents

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"go.uber.org/zap"
)

const (
	maxSlackWebhookBody = 1 << 20 // 1 MiB
	// slackTimestampSkew rejects replayed requests (RFC 003 security table).
	slackTimestampSkew = 5 * time.Minute
)

// SlackWebhook handles POST /v1/webhooks/slack (Slack Events API).
func (h *Handler) SlackWebhook(w http.ResponseWriter, r *http.Request) {
	body, ok := httpx.ReadBody(w, r, maxSlackWebhookBody)
	if !ok {
		return
	}
	if err := verifySlackSignature(
		h.cfg.SlackSigningSecret,
		r.Header.Get("X-Slack-Request-Timestamp"),
		body,
		r.Header.Get("X-Slack-Signature"),
		time.Now(),
	); err != nil {
		if errors.Is(err, errSlackUnconfigured) {
			h.log.Error("slack webhook rejected: SLACK_SIGNING_SECRET is not configured")
			httpx.Error(w, http.StatusInternalServerError, "webhook verification unavailable", "webhook_unconfigured")
			return
		}
		httpx.Error(w, http.StatusUnauthorized, "invalid slack signature", "unauthorized")
		return
	}

	var envelope struct {
		Type      string `json:"type"`
		Challenge string `json:"challenge"`
		TeamID    string `json:"team_id"`
		EventID   string `json:"event_id"`
		EventTime int64  `json:"event_time"`
		Event     struct {
			Type    string `json:"type"`
			Text    string `json:"text"`
			Channel string `json:"channel"`
			User    string `json:"user"`
		} `json:"event"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid JSON body", "bad_request")
		return
	}

	switch envelope.Type {
	case "url_verification":
		// Slack's endpoint handshake — must echo the challenge before any
		// user resolution exists.
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"challenge": envelope.Challenge})
		return
	case "event_callback":
		// Handled below.
	default:
		// Unknown envelope types are acknowledged so Slack doesn't retry them.
		w.WriteHeader(http.StatusOK)
		return
	}
	if envelope.TeamID == "" || envelope.EventID == "" {
		httpx.Error(w, http.StatusBadRequest, "missing team_id or event_id", "bad_request")
		return
	}

	owner, ok := h.resolveSlackUser(r, envelope.TeamID)
	if !ok {
		// Ack to stop retries; the workspace isn't mapped to a Rowboat user.
		metricUnresolved.WithLabelValues(SourceSlack).Inc()
		h.log.Warn("slack event for unresolved workspace dropped", zap.String("teamId", envelope.TeamID))
		w.WriteHeader(http.StatusOK)
		return
	}

	var occurredAt *time.Time
	if envelope.EventTime > 0 {
		t := time.Unix(envelope.EventTime, 0).UTC()
		occurredAt = &t
	}
	req := IngestRequest{
		Source:          SourceSlack,
		SourceEventID:   envelope.EventID,
		SourceAccountID: envelope.TeamID,
		EventType:       envelope.Event.Type,
		Text:            envelope.Event.Text,
		Payload:         json.RawMessage(body),
		// Slack's event_id is the canonical retry-stable id (retries reuse it).
		DedupeKey:  fmt.Sprintf("slack:%s:%s", envelope.TeamID, envelope.EventID),
		OccurredAt: occurredAt,
	}
	// Respond fast: routing is async by design, which keeps this handler well
	// inside Slack's 3-second delivery deadline.
	h.respondIngest(w, r, owner, req)
}

var errSlackUnconfigured = errors.New("cloudevents: slack signing secret not configured")

// verifySlackSignature checks X-Slack-Signature == "v0=" + hex(HMAC-SHA256(
// secret, "v0:{ts}:{body}")) with constant-time comparison, and rejects
// timestamps outside ±slackTimestampSkew (replay protection). Fails closed on
// an empty secret.
func verifySlackSignature(secret, ts string, body []byte, got string, now time.Time) error {
	if secret == "" {
		return errSlackUnconfigured
	}
	if ts == "" || got == "" {
		return errors.New("missing signature headers")
	}
	unix, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		return errors.New("malformed timestamp")
	}
	if d := now.Sub(time.Unix(unix, 0)); d > slackTimestampSkew || d < -slackTimestampSkew {
		return errors.New("stale timestamp")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("v0:" + ts + ":"))
	mac.Write(body)
	want := "v0=" + hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(want), []byte(got)) {
		return errors.New("signature mismatch")
	}
	return nil
}

// resolveSlackUser maps a Slack workspace (team_id) to the owning Rowboat
// user via OAuthConnection(provider=slack, external_account_id=team_id).
// No self-serve Slack connect flow exists yet; v1 rows are created
// operationally via the admin GraphQL surface when a workspace is onboarded.
func (h *Handler) resolveSlackUser(r *http.Request, teamID string) (*ent.User, bool) {
	ctx := auth.WithInternal(r.Context())
	conn, err := h.client.OAuthConnection.Query().
		Where(
			oauthconnection.ProviderEQ("slack"),
			oauthconnection.ExternalAccountIDEQ(strings.TrimSpace(teamID)),
		).
		WithUser().
		First(ctx)
	if err != nil {
		if !ent.IsNotFound(err) {
			h.log.Error("slack webhook user resolution failed", zap.Error(err))
		}
		return nil, false
	}
	if conn.Edges.User == nil {
		return nil, false
	}
	return conn.Edges.User, true
}
