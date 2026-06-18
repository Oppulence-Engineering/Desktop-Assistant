package agentchannels

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentsessions"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/cloudevents"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const maxChannelBody = 1 << 20

// Handler serves the channel-inbound endpoints.
type Handler struct {
	client      *ent.Client
	dispatcher  *Dispatcher
	slackSecret string
	log         *zap.Logger
}

// NewHandler builds the channel HTTP handler.
func NewHandler(client *ent.Client, dispatcher *Dispatcher, slackSigningSecret string, log *zap.Logger) *Handler {
	if log == nil {
		log = zap.NewNop()
	}
	return &Handler{client: client, dispatcher: dispatcher, slackSecret: slackSigningSecret, log: log}
}

type inboundRequest struct {
	UserID     string `json:"userId"`
	Channel    string `json:"channel"`
	ChannelKey string `json:"channelKey"`
	AgentSlug  string `json:"agentSlug"`
	Text       string `json:"text"`
}

// InboundInternal handles POST /v1/internal/agent-channels/{channel}/inbound — a
// server-to-server normalized channel message (internal-secret guarded). Any
// channel gateway can deliver here without re-implementing session lifecycle.
func (h *Handler) InboundInternal(w http.ResponseWriter, r *http.Request) {
	var req inboundRequest
	if !httpx.DecodeJSON(w, r, maxChannelBody, &req) {
		return
	}
	channel := chi.URLParam(r, "channel")
	if channel == "" {
		channel = req.Channel
	}
	if req.UserID == "" || channel == "" || strings.TrimSpace(req.Text) == "" {
		httpx.Error(w, http.StatusBadRequest, "userId, channel, and text are required", "bad_request")
		return
	}
	owner, err := h.userByID(r, req.UserID)
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "user not found", "not_found")
		return
	}
	sess, created, err := h.dispatcher.Dispatch(auth.WithUser(r.Context(), owner), ChannelMessage{
		Channel: channel, ChannelKey: req.ChannelKey, User: owner, AgentSlug: req.AgentSlug, Text: req.Text,
	})
	if err != nil {
		h.writeDispatchError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusAccepted, map[string]any{"sessionId": sess.Row.SessionID, "created": created})
}

// SlackInbound handles POST /v1/agent-channels/slack (Slack Events API). It
// verifies the Slack signature, resolves the workspace owner, and dispatches a
// channel message keyed by the Slack channel/thread. Mirrors
// cloudevents.SlackWebhook but routes to an agent session instead of the event
// router.
func (h *Handler) SlackInbound(w http.ResponseWriter, r *http.Request) {
	body, ok := httpx.ReadBody(w, r, maxChannelBody)
	if !ok {
		return
	}
	if err := cloudevents.VerifySlackSignature(
		h.slackSecret,
		r.Header.Get("X-Slack-Request-Timestamp"),
		body,
		r.Header.Get("X-Slack-Signature"),
		time.Now(),
	); err != nil {
		httpx.Error(w, http.StatusUnauthorized, "invalid slack signature", "unauthorized")
		return
	}
	var env struct {
		Type      string `json:"type"`
		Challenge string `json:"challenge"`
		TeamID    string `json:"team_id"`
		Event     struct {
			Type     string `json:"type"`
			Text     string `json:"text"`
			Channel  string `json:"channel"`
			ThreadTS string `json:"thread_ts"`
			TS       string `json:"ts"`
			BotID    string `json:"bot_id"`
		} `json:"event"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid JSON body", "bad_request")
		return
	}
	if env.Type == "url_verification" {
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"challenge": env.Challenge})
		return
	}
	// Ignore non-message events and our own bot's messages (no echo loops).
	if env.Type != "event_callback" || env.Event.Type != "message" || env.Event.BotID != "" || strings.TrimSpace(env.Event.Text) == "" {
		w.WriteHeader(http.StatusOK)
		return
	}
	owner, err := h.resolveSlackUser(r, env.TeamID)
	if err != nil {
		// Ack so Slack stops retrying an unmapped workspace.
		w.WriteHeader(http.StatusOK)
		return
	}
	thread := env.Event.ThreadTS
	if thread == "" {
		thread = env.Event.TS
	}
	channelKey := fmt.Sprintf("slack:%s:%s:%s", env.TeamID, env.Event.Channel, thread)
	if _, _, derr := h.dispatcher.Dispatch(auth.WithUser(r.Context(), owner), ChannelMessage{
		Channel: "slack", ChannelKey: channelKey, User: owner, Text: env.Event.Text,
	}); derr != nil {
		h.log.Warn("slack channel dispatch failed", zap.Error(derr))
	}
	// Respond fast (Slack's 3s deadline); session work is async.
	w.WriteHeader(http.StatusOK)
}

func (h *Handler) userByID(r *http.Request, id string) (*ent.User, error) {
	uid, err := uuid.Parse(id)
	if err != nil {
		return nil, err
	}
	return h.client.User.Get(auth.WithInternal(r.Context()), uid)
}

func (h *Handler) resolveSlackUser(r *http.Request, teamID string) (*ent.User, error) {
	if strings.TrimSpace(teamID) == "" {
		return nil, errors.New("missing team id")
	}
	conn, err := h.client.OAuthConnection.Query().
		Where(oauthconnection.ProviderEQ("slack"), oauthconnection.ExternalAccountIDEQ(strings.TrimSpace(teamID))).
		WithUser().
		First(auth.WithInternal(r.Context()))
	if err != nil {
		return nil, err
	}
	if conn.Edges.User == nil {
		return nil, errors.New("connection has no user")
	}
	return conn.Edges.User, nil
}

func (h *Handler) writeDispatchError(w http.ResponseWriter, err error) {
	var invalid *agentsessions.InvalidParamsError
	switch {
	case errors.As(err, &invalid):
		httpx.Error(w, http.StatusBadRequest, invalid.Message, "bad_request")
	case errors.Is(err, agentsessions.ErrTemporalNotConfigured):
		httpx.Error(w, http.StatusServiceUnavailable, "temporal unavailable", "temporal_unavailable")
	default:
		h.log.Error("channel dispatch failed", zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "could not dispatch channel message", "dispatch_failed")
	}
}
