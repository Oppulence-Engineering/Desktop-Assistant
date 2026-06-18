// Package agentchannels adapts inbound platform messages (RFC 027 channels)
// into durable agent sessions, funneling every message through the one
// canonical creation path (internal/agentsessions.Starter.CreateOrContinue) so
// a channel conversation threads to a single session. It mirrors the
// internal/cloudevents webhook pattern: a platform-specific handler verifies its
// own credential, resolves the owning user, normalizes the message, and
// dispatches.
package agentchannels

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentdefinition"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentsessions"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"go.uber.org/zap"
)

// ChannelMessage is a normalized inbound message from any platform.
type ChannelMessage struct {
	Channel    string    // "slack", "discord", "http", …
	ChannelKey string    // thread identity → one session
	User       *ent.User // resolved owner
	AgentSlug  string    // explicit; else resolved from bindings/default
	Text       string
}

// Dispatcher routes normalized channel messages to the canonical session path.
type Dispatcher struct {
	client       *ent.Client
	starter      *agentsessions.Starter
	defaultAgent string
	log          *zap.Logger
}

// New builds a Dispatcher. defaultAgent is the slug used when no agent is
// explicitly named and none is bound to the channel.
func New(client *ent.Client, starter *agentsessions.Starter, defaultAgent string, log *zap.Logger) *Dispatcher {
	if log == nil {
		log = zap.NewNop()
	}
	if defaultAgent == "" {
		defaultAgent = "assistant"
	}
	return &Dispatcher{client: client, starter: starter, defaultAgent: defaultAgent, log: log}
}

// Dispatch creates or continues the session for one channel message.
func (d *Dispatcher) Dispatch(ctx context.Context, msg ChannelMessage) (*agentsessions.Session, bool, error) {
	agentSlug := msg.AgentSlug
	if agentSlug == "" {
		agentSlug = d.resolveAgentForChannel(ctx, msg.User, msg.Channel)
	}
	return d.starter.CreateOrContinue(ctx, agentsessions.ContinueParams{
		User: msg.User, AgentSlug: agentSlug, Channel: msg.Channel, ChannelKey: msg.ChannelKey, Input: msg.Text,
	})
}

// resolveAgentForChannel picks the tenant agent bound to this channel via its
// channel_bindings (a JSON array of channel names), falling back to the default.
func (d *Dispatcher) resolveAgentForChannel(ctx context.Context, u *ent.User, channel string) string {
	if u == nil {
		return d.defaultAgent
	}
	defs, err := d.client.AgentDefinition.Query().
		Order(agentdefinition.BySlug()).
		All(auth.WithUser(ctx, u))
	if err != nil {
		return d.defaultAgent
	}
	for _, def := range defs {
		if channelBindingsInclude(def.ChannelBindings, channel) {
			return def.Slug
		}
	}
	return d.defaultAgent
}

// channelBindingsInclude reports whether an agent's channel_bindings JSON
// (an array of channel names) includes the channel.
func channelBindingsInclude(raw, channel string) bool {
	if strings.TrimSpace(raw) == "" {
		return false
	}
	var channels []string
	if err := json.Unmarshal([]byte(raw), &channels); err != nil {
		return false
	}
	for _, c := range channels {
		if strings.EqualFold(c, channel) {
			return true
		}
	}
	return false
}
