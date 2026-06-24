package agentchannels

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentsessions"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentworkflow"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/cloudevents"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/slackclient"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// Approver resolves a pending HITL approval. *agentsessions.Starter satisfies it;
// defined here so the channel handler depends only on this seam.
type Approver interface {
	Approve(ctx context.Context, userID, sessionID string, in agentworkflow.ApproveAction) (agentworkflow.TurnAck, error)
}

const maxChannelBody = 1 << 20

// Handler serves the channel-inbound endpoints.
type Handler struct {
	client      *ent.Client
	dispatcher  *Dispatcher
	slackSecret string
	approver    Approver            // nil → interactivity returns 503
	slack       *slackclient.Client // nil → no response_url message update
	log         *zap.Logger
}

// NewHandler builds the channel HTTP handler.
func NewHandler(client *ent.Client, dispatcher *Dispatcher, slackSigningSecret string, log *zap.Logger) *Handler {
	if log == nil {
		log = zap.NewNop()
	}
	return &Handler{client: client, dispatcher: dispatcher, slackSecret: slackSigningSecret, log: log}
}

// SetApprovals wires the HITL approval round-trip: approver resolves a Slack
// button click into an agent-session approval; slack (optional) updates the
// original message via its response_url.
func (h *Handler) SetApprovals(approver Approver, slack *slackclient.Client) {
	h.approver = approver
	h.slack = slack
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

// slackMentionRE matches Slack user-mention tokens: <@U123> or <@U123|display>.
var slackMentionRE = regexp.MustCompile(`<@[^>]+>`)

// stripSlackMentions removes mention tokens (the bot's @-mention prefix and any
// others) and collapses surrounding whitespace, leaving the user's instruction.
func stripSlackMentions(text string) string {
	return strings.Join(strings.Fields(slackMentionRE.ReplaceAllString(text, " ")), " ")
}

// SlackInbound handles POST /v1/agent-channels/slack (Slack Events API). It
// verifies the Slack signature, resolves the workspace owner, and dispatches a
// channel message keyed by the Slack channel/thread. The trigger is an
// @-mention of the bot (app_mention) — the "tag us" model (Anthropic CloudTag);
// the agent's reply is posted back into the thread by the durable runtime
// (agentworkflow.DeliverChannelReply). Mirrors cloudevents.SlackWebhook but
// routes to an agent session instead of the event router.
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
		EventID   string `json:"event_id"`
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
	// Slack retries a delivery when it doesn't see our 200 within 3s. We ack fast
	// and run the turn asynchronously, so a retried delivery duplicates work
	// already dispatched — drop it to avoid a second turn. Stateless dedupe: no
	// store needed, and it is multi-replica safe (the retry header travels with
	// the request, not our state).
	if r.Header.Get("X-Slack-Retry-Num") != "" {
		w.WriteHeader(http.StatusOK)
		return
	}
	// Trigger on @-mentions only (the "tag us" model). Ignore everything else and
	// bot-authored mentions (no echo loops).
	if env.Type != "event_callback" || env.Event.Type != "app_mention" || env.Event.BotID != "" {
		w.WriteHeader(http.StatusOK)
		return
	}
	text := stripSlackMentions(env.Event.Text)
	if text == "" {
		w.WriteHeader(http.StatusOK)
		return
	}
	owner, err := h.resolveSlackUser(r, env.TeamID)
	if err != nil {
		// Ack so Slack stops retrying an unmapped workspace.
		w.WriteHeader(http.StatusOK)
		return
	}
	// A top-level mention starts a thread keyed by its own ts; replies (and later
	// mentions in that thread) carry thread_ts, threading to the one session.
	thread := env.Event.ThreadTS
	if thread == "" {
		thread = env.Event.TS
	}
	channelKey := fmt.Sprintf("slack:%s:%s:%s", env.TeamID, env.Event.Channel, thread)
	if _, _, derr := h.dispatcher.Dispatch(auth.WithUser(r.Context(), owner), ChannelMessage{
		Channel: "slack", ChannelKey: channelKey, User: owner, Text: text,
	}); derr != nil {
		h.log.Warn("slack channel dispatch failed", zap.Error(derr), zap.String("eventId", env.EventID))
	}
	// Respond fast (Slack's 3s deadline); session work is async.
	w.WriteHeader(http.StatusOK)
}

// SlackInteractivity handles POST /v1/agent-channels/slack/interactivity (Slack
// interactive components). It verifies the signature, decodes the Approve/Deny
// button click, and resolves the agent-session HITL approval. The button value
// (approvalId, sessionId, userId, decision) was set by the server when posting
// the request and is echoed back inside the signature-verified payload, so it is
// trusted after signature verification. Money-moving grants still require the
// signed approval token (minted via the API), which a naked button cannot
// supply — so a button grants act-tier actions only.
func (h *Handler) SlackInteractivity(w http.ResponseWriter, r *http.Request) {
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
	if h.approver == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "approvals are not available", "unavailable")
		return
	}
	// Interactivity arrives form-encoded: payload=<url-encoded JSON>.
	form, err := url.ParseQuery(string(body))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid form body", "bad_request")
		return
	}
	raw := form.Get("payload")
	if raw == "" {
		w.WriteHeader(http.StatusOK)
		return
	}
	var p struct {
		Type string `json:"type"`
		User struct {
			ID string `json:"id"`
		} `json:"user"`
		ResponseURL string `json:"response_url"`
		Actions     []struct {
			ActionID string `json:"action_id"`
			Value    string `json:"value"`
		} `json:"actions"`
	}
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid interaction payload", "bad_request")
		return
	}
	if p.Type != "block_actions" || len(p.Actions) == 0 {
		w.WriteHeader(http.StatusOK)
		return
	}
	act := p.Actions[0]
	if act.ActionID != slackclient.ActionApprove && act.ActionID != slackclient.ActionDeny {
		w.WriteHeader(http.StatusOK)
		return
	}
	var v struct {
		ApprovalID string `json:"approvalId"`
		SessionID  string `json:"sessionId"`
		UserID     string `json:"userId"`
		Decision   string `json:"decision"`
	}
	if err := json.Unmarshal([]byte(act.Value), &v); err != nil ||
		v.ApprovalID == "" || v.SessionID == "" || v.UserID == "" ||
		(v.Decision != "granted" && v.Decision != "denied") {
		w.WriteHeader(http.StatusOK)
		return
	}

	_, aerr := h.approver.Approve(auth.WithInternal(r.Context()), v.UserID, v.SessionID, agentworkflow.ApproveAction{
		ApprovalID: v.ApprovalID,
		Decision:   v.Decision,
		ResolvedBy: "slack:" + p.User.ID,
	})
	if aerr != nil {
		h.log.Warn("slack approval resolution failed", zap.Error(aerr), zap.String("approvalId", v.ApprovalID))
	}
	// Best-effort: replace the buttons with the outcome so they can't be re-clicked.
	if h.slack != nil && p.ResponseURL != "" {
		status := "✅ Approved"
		switch {
		case aerr != nil:
			status = "⚠️ Could not record the decision; please use the app"
		case v.Decision == "denied":
			status = "🚫 Denied"
		}
		_ = h.slack.RespondURL(auth.WithInternal(r.Context()), p.ResponseURL, map[string]any{
			"replace_original": true,
			"text":             fmt.Sprintf("%s by <@%s>", status, p.User.ID),
		})
	}
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
