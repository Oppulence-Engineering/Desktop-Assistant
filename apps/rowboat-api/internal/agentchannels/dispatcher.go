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
	Channel     string    // "slack", "discord", "http", …
	ChannelKey  string    // thread identity → one session
	User        *ent.User // resolved owner
	AgentSlug   string    // explicit; else resolved from bindings/default
	Text        string
	InitiatorID string // platform user id of the requester (e.g. Slack user); for HITL authz
}

// Dispatcher routes normalized channel messages to the canonical session path.
type Dispatcher struct {
	client       *ent.Client
	starter      *agentsessions.Starter
	defaultAgent string
	log          *zap.Logger
}

// defaultFallbackAgent is the built-in fallback used when no agent is configured;
// a defaultAgent equal to it is treated as "operator did not override".
const defaultFallbackAgent = "assistant"

// New builds a Dispatcher. defaultAgent is the slug used when no agent is
// explicitly named and none is bound to the channel.
func New(client *ent.Client, starter *agentsessions.Starter, defaultAgent string, log *zap.Logger) *Dispatcher {
	if log == nil {
		log = zap.NewNop()
	}
	if defaultAgent == "" {
		defaultAgent = defaultFallbackAgent
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
		User: msg.User, AgentSlug: agentSlug, Channel: msg.Channel, ChannelKey: msg.ChannelKey,
		Input: msg.Text, InitiatorRef: msg.InitiatorID,
	})
}

// resolveAgentForChannel picks the agent that should handle this channel, in
// precedence order: (1) a tenant agent bound to the channel via its
// channel_bindings (explicit per-user override); (2) an operator-configured
// default (any AGENT_DEFAULT_CHANNEL_AGENT other than the built-in fallback) —
// so setting it is honored rather than silently overridden by a built-in;
// (3) a built-in agent advertising the channel (RFC 028 channels:), the
// out-of-box default (e.g. concierge-slack for Slack); (4) the fallback.
func (d *Dispatcher) resolveAgentForChannel(ctx context.Context, u *ent.User, channel string) string {
	if u != nil {
		defs, err := d.client.AgentDefinition.Query().
			Order(agentdefinition.BySlug()).
			All(auth.WithUser(ctx, u))
		if err == nil {
			for _, def := range defs {
				if channelBindingsInclude(def.ChannelBindings, channel) {
					return def.Slug
				}
			}
		}
	}
	// An explicitly-configured default wins over a built-in's advertisement.
	if d.defaultAgent != "" && d.defaultAgent != defaultFallbackAgent {
		return d.defaultAgent
	}
	if d.starter != nil && d.starter.Loader != nil {
		for _, spec := range d.starter.Loader.Builtins() {
			for _, c := range spec.Channels {
				if strings.EqualFold(c, channel) {
					return spec.Slug
				}
			}
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
