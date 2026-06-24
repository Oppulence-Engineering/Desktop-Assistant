package agentregistry

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentsession"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/slackclient"
)

// Slack-native capabilities (RFC 027 channels / RFC 012 connector tools). They
// act on the workspace the session was tagged in: the bot token is resolved
// from the session owner's Slack connection, and the target thread is the
// session's own channel_key. read_thread is read-only (auto-execute);
// post_message is an outward-facing act (approval-eligible).

// SlackReadThreadCapability reads the current Slack thread.
func SlackReadThreadCapability() Capability {
	return Capability{
		Name:        "slack.read_thread",
		Description: "Read the messages of the current Slack thread (oldest first). Use this to understand the conversation you were tagged in before acting.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"limit":{"type":"integer","description":"max messages to read (default 50, max 200)"}}}`),
		TrustTier:   TierRead,
		Kind:        KindTool,
		Build:       func(d ToolDeps) backgroundtaskruntime.Tool { return &slackReadThreadTool{deps: d} },
	}
}

type slackReadThreadTool struct{ deps ToolDeps }

func (t *slackReadThreadTool) Name() string { return "slack.read_thread" }
func (t *slackReadThreadTool) Description() string {
	return "Read the messages of the current Slack thread."
}
func (t *slackReadThreadTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"limit":{"type":"integer"}}}`)
}
func (t *slackReadThreadTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		Limit int `json:"limit"`
	}
	if len(args) > 0 {
		if err := json.Unmarshal(args, &in); err != nil {
			return nil, fmt.Errorf("invalid slack.read_thread arguments: %w", err)
		}
	}
	token, channel, thread, err := slackThreadForSession(ctx, t.deps, scope)
	if err != nil {
		return slackToolError(err)
	}
	msgs, err := t.deps.Slack.ReadThread(ctx, token, channel, thread, in.Limit)
	if err != nil {
		return slackToolError(err)
	}
	return json.Marshal(map[string]any{"messages": msgs})
}

// SlackPostMessageCapability posts a message to Slack (act-tier; HITL-eligible).
func SlackPostMessageCapability() Capability {
	return Capability{
		Name:        "slack.post_message",
		Description: "Post a message to Slack. With no channel, posts into the current thread; with a channel id, posts to that channel. The final answer of a turn is already delivered automatically — use this only for additional or cross-channel messages. Requires human approval.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"text":{"type":"string","description":"message to post"},"channel":{"type":"string","description":"optional Slack channel id; defaults to the current thread"}},"required":["text"]}`),
		TrustTier:   TierAct,
		Kind:        KindTool,
		Build:       func(d ToolDeps) backgroundtaskruntime.Tool { return &slackPostMessageTool{deps: d} },
	}
}

type slackPostMessageTool struct{ deps ToolDeps }

func (t *slackPostMessageTool) Name() string { return "slack.post_message" }
func (t *slackPostMessageTool) Description() string {
	return "Post a message to Slack (current thread by default)."
}
func (t *slackPostMessageTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"text":{"type":"string"},"channel":{"type":"string"}},"required":["text"]}`)
}
func (t *slackPostMessageTool) Invoke(ctx context.Context, scope backgroundtaskruntime.ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		Text    string `json:"text"`
		Channel string `json:"channel"`
	}
	if len(args) > 0 {
		if err := json.Unmarshal(args, &in); err != nil {
			return nil, fmt.Errorf("invalid slack.post_message arguments: %w", err)
		}
	}
	if strings.TrimSpace(in.Text) == "" {
		return slackToolError(errors.New("text is required"))
	}
	token, channel, thread, err := slackThreadForSession(ctx, t.deps, scope)
	if err != nil {
		return slackToolError(err)
	}
	// Default target is the current thread; an explicit channel posts top-level.
	target, threadTS := channel, thread
	if strings.TrimSpace(in.Channel) != "" {
		target, threadTS = in.Channel, ""
	}
	if err := t.deps.Slack.PostMessage(ctx, token, target, threadTS, in.Text); err != nil {
		return slackToolError(err)
	}
	return json.Marshal(map[string]any{"ok": true, "channel": target})
}

// slackThreadForSession resolves the bot token + the (channel, thread) target
// for the session that issued the tool call. The ctx is already the internal
// context (set by ActivityToolInvoke), so the session lookup is not
// tenant-filtered; the session id is globally unique.
func slackThreadForSession(ctx context.Context, deps ToolDeps, scope backgroundtaskruntime.ToolScope) (botToken, channel, thread string, err error) {
	if deps.Slack == nil || deps.Creds == nil {
		return "", "", "", errors.New("slack tools are not configured on this server")
	}
	if deps.Client == nil {
		return "", "", "", errors.New("slack tools are not configured")
	}
	sess, serr := deps.Client.AgentSession.Query().
		Where(agentsession.SessionIDEQ(scope.RunID)).
		Only(ctx)
	if serr != nil {
		return "", "", "", fmt.Errorf("load session: %w", serr)
	}
	if sess.Channel != "slack" {
		return "", "", "", errors.New("this tool is only available in Slack conversations")
	}
	_, channel, thread, ok := slackclient.ParseChannelKey(sess.ChannelKey)
	if !ok {
		return "", "", "", errors.New("could not resolve the Slack thread for this session")
	}
	token, terr := deps.Creds.Resolve(ctx, scope.UserID, "slack")
	if terr != nil {
		return "", "", "", terr
	}
	return token, channel, thread, nil
}

// slackToolError returns a model-visible observation (not a hard tool failure)
// so the model can adapt — e.g. tell the user to connect Slack or grant a scope
// — without Temporal retrying a non-transient condition.
func slackToolError(err error) (json.RawMessage, error) {
	b, mErr := json.Marshal(map[string]string{"error": err.Error()})
	if mErr != nil {
		return nil, mErr
	}
	return b, nil
}
