package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/slackclient"
)

const (
	// SlackScopeChannelsHistory allows reading Slack channel history.
	SlackScopeChannelsHistory = "channels:history"
	// SlackScopeChatWrite allows posting Slack messages.
	SlackScopeChatWrite = "chat:write"
)

// SlackTeamTokenResolver resolves a connected Slack workspace token for a user.
type SlackTeamTokenResolver interface {
	ResolveTeam(ctx context.Context, userID, teamID string) (string, error)
}

// SlackThreadReader is the narrow Slack Web API surface cloud tasks need.
type SlackThreadReader interface {
	ReadThread(ctx context.Context, botToken, channel, threadTS string, limit int) ([]slackclient.Message, error)
}

// SlackThreadWriter is the narrow Slack Web API surface for approved replies.
type SlackThreadWriter interface {
	PostMessage(ctx context.Context, botToken, channel, threadTS, text string) error
}

// SlackThreadDefaults identifies the Slack thread that triggered a cloud run.
type SlackThreadDefaults struct {
	TeamID   string
	Channel  string
	ThreadTS string
}

// SlackThreadDefaultsFromEventPayload extracts Slack thread coordinates from a
// Slack Events API envelope. For top-level messages Slack has no thread_ts, so
// ts is the conversations.replies anchor.
func SlackThreadDefaultsFromEventPayload(sourceAccountID string, payload []byte) SlackThreadDefaults {
	var env struct {
		TeamID string `json:"team_id"`
		Event  struct {
			Channel  string `json:"channel"`
			ThreadTS string `json:"thread_ts"`
			TS       string `json:"ts"`
		} `json:"event"`
	}
	_ = json.Unmarshal(payload, &env)
	out := SlackThreadDefaults{
		TeamID:   firstNonBlank(env.TeamID, sourceAccountID),
		Channel:  strings.TrimSpace(env.Event.Channel),
		ThreadTS: firstNonBlank(env.Event.ThreadTS, env.Event.TS),
	}
	return out
}

// NewSlackReadThreadTool builds connector.read.slack_thread (read-only thread
// history). The Slack bot token is resolved inside Invoke from the run owner and
// team id; model text never carries credentials.
func NewSlackReadThreadTool(tokens SlackTeamTokenResolver, slack SlackThreadReader, defaults SlackThreadDefaults) Tool {
	return &slackReadThreadTool{tokens: tokens, slack: slack, defaults: defaults}
}

type slackReadThreadTool struct {
	tokens   SlackTeamTokenResolver
	slack    SlackThreadReader
	defaults SlackThreadDefaults
}

func (t *slackReadThreadTool) Name() string { return "connector.read.slack_thread" }
func (t *slackReadThreadTool) AuditInfo(json.RawMessage) ToolAudit {
	return ToolAudit{TrustTier: TierRead, Connector: "slack", Operation: "slack.thread.read", RequiredScopes: []string{SlackScopeChannelsHistory}}
}
func (t *slackReadThreadTool) Description() string {
	return "Read a Slack thread from a connected workspace. For Slack-triggered runs, teamId/channel/threadTs default to the triggering event; otherwise provide all three."
}

func (t *slackReadThreadTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"teamId":{"type":"string","description":"Slack workspace/team id. Defaults to the triggering Slack event when available."},"channel":{"type":"string","description":"Slack channel id. Defaults to the triggering Slack event when available."},"threadTs":{"type":"string","description":"Slack thread timestamp. Defaults to thread_ts or ts from the triggering Slack event when available."},"limit":{"type":"integer","description":"Max messages (default 50, max 200)."}}}`)
}

func (t *slackReadThreadTool) Invoke(ctx context.Context, scope ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		TeamID   string `json:"teamId"`
		Channel  string `json:"channel"`
		ThreadTS string `json:"threadTs"`
		Limit    int    `json:"limit"`
	}
	if len(args) > 0 {
		if err := json.Unmarshal(args, &in); err != nil {
			return nil, fmt.Errorf("invalid slack thread arguments: %w", err)
		}
	}
	teamID := firstNonBlank(in.TeamID, t.defaults.TeamID)
	channel := firstNonBlank(in.Channel, t.defaults.Channel)
	threadTS := firstNonBlank(in.ThreadTS, t.defaults.ThreadTS)
	if teamID == "" || channel == "" || threadTS == "" {
		return slackObservation("teamId, channel, and threadTs are required unless this run was triggered by a Slack event")
	}
	if t.tokens == nil || t.slack == nil {
		return slackObservation("Slack tools are not configured on this server")
	}
	token, err := t.tokens.ResolveTeam(ctx, scope.UserID, teamID)
	if err != nil {
		return slackObservation(err.Error())
	}
	messages, err := t.slack.ReadThread(ctx, token, channel, threadTS, in.Limit)
	if err != nil {
		return slackObservation(err.Error())
	}
	return json.Marshal(map[string]any{
		"teamId":   teamID,
		"channel":  channel,
		"threadTs": threadTS,
		"messages": messages,
	})
}

// NewSlackReplyTool builds connector.write.slack_reply. The runtime must gate
// this act-tier tool behind human approval before Invoke posts the message.
func NewSlackReplyTool(tokens SlackTeamTokenResolver, slack SlackThreadWriter, defaults SlackThreadDefaults) Tool {
	return &slackReplyTool{tokens: tokens, slack: slack, defaults: defaults}
}

type slackReplyTool struct {
	tokens   SlackTeamTokenResolver
	slack    SlackThreadWriter
	defaults SlackThreadDefaults
}

func (t *slackReplyTool) Name() string { return "connector.write.slack_reply" }
func (t *slackReplyTool) AuditInfo(json.RawMessage) ToolAudit {
	return ToolAudit{TrustTier: TierAct, Connector: "slack", Operation: "slack.thread.reply", RequiredScopes: []string{SlackScopeChatWrite}}
}
func (t *slackReplyTool) Description() string {
	return "Post a reply into a connected Slack thread. For Slack-triggered runs, teamId/channel/threadTs default to the triggering event. Requires human approval."
}
func (t *slackReplyTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"teamId":{"type":"string","description":"Slack workspace/team id. Defaults to the triggering Slack event when available."},"channel":{"type":"string","description":"Slack channel id. Defaults to the triggering Slack event when available."},"threadTs":{"type":"string","description":"Slack thread timestamp. Defaults to thread_ts or ts from the triggering Slack event when available."},"text":{"type":"string","description":"Reply text to post."}},"required":["text"]}`)
}
func (t *slackReplyTool) Invoke(ctx context.Context, scope ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		TeamID   string `json:"teamId"`
		Channel  string `json:"channel"`
		ThreadTS string `json:"threadTs"`
		Text     string `json:"text"`
	}
	if len(args) > 0 {
		if err := json.Unmarshal(args, &in); err != nil {
			return nil, fmt.Errorf("invalid slack reply arguments: %w", err)
		}
	}
	teamID := firstNonBlank(in.TeamID, t.defaults.TeamID)
	channel := firstNonBlank(in.Channel, t.defaults.Channel)
	threadTS := firstNonBlank(in.ThreadTS, t.defaults.ThreadTS)
	text := strings.TrimSpace(in.Text)
	if teamID == "" || channel == "" || threadTS == "" {
		return slackObservation("teamId, channel, and threadTs are required unless this run was triggered by a Slack event")
	}
	if text == "" {
		return slackObservation("text is required")
	}
	if t.tokens == nil || t.slack == nil {
		return slackObservation("Slack tools are not configured on this server")
	}
	token, err := t.tokens.ResolveTeam(ctx, scope.UserID, teamID)
	if err != nil {
		return slackObservation(err.Error())
	}
	if err := t.slack.PostMessage(ctx, token, channel, threadTS, text); err != nil {
		return slackObservation(err.Error())
	}
	return json.Marshal(map[string]any{
		"teamId":   teamID,
		"channel":  channel,
		"threadTs": threadTS,
		"posted":   true,
	})
}

func slackObservation(message string) (json.RawMessage, error) {
	b, err := json.Marshal(map[string]string{"error": message})
	if err != nil {
		return nil, err
	}
	return b, nil
}

func firstNonBlank(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
