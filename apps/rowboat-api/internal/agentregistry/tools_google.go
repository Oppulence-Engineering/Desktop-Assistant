package agentregistry

import (
	"context"
	"encoding/json"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/google/uuid"
)

// Google read capabilities (RFC 012 connectors). They reuse the RFC 004
// connector tools (internal/backgroundtaskruntime.NewGmailReadTool /
// NewCalendarReadTool), which resolve the session owner's Google connection,
// check the required OAuth scope, exchange the sealed refresh token for an
// access token, and call the Google API — credentials never enter model text.
// Both are read-only (auto-execute). When the Google deps are not wired, Build
// returns a tool that reports the capability as unavailable rather than panicking.

// GmailReadCapability searches the user's Gmail (read-only).
func GmailReadCapability() Capability {
	return Capability{
		Name:        "connector.read.gmail",
		Description: "Search the user's Gmail (read-only): returns message headers and snippets, never full bodies. Requires a connected Google account with the gmail.readonly scope.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"query":{"type":"string","description":"Gmail search query, e.g. \"from:acme.com newer_than:30d\""},"limit":{"type":"integer","description":"max messages (1-10)"}},"required":["query"]}`),
		TrustTier:   TierRead,
		Kind:        KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			uid, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil || d.Sealer == nil || d.Secrets == nil || d.Google == nil {
				return newUnavailableTool("connector.read.gmail", "the Gmail tool is not configured on this server")
			}
			return backgroundtaskruntime.NewGmailReadTool(d.Client, d.Sealer, d.Secrets, d.Google, uid)
		},
	}
}

// GmailDraftCapability creates a Gmail draft on the user's behalf (act-tier:
// approval-eligible). It does not send — drafting is the outward-facing action;
// sending stays a deliberate human step.
func GmailDraftCapability() Capability {
	return Capability{
		Name:        "connector.write.gmail_draft",
		Description: "Create a Gmail draft on the user's behalf (does NOT send it). Requires a connected Google account with the gmail.compose scope, and human approval.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"to":{"type":"string","description":"recipient email address"},"subject":{"type":"string"},"body":{"type":"string","description":"plain-text body"}},"required":["to","body"]}`),
		TrustTier:   TierAct,
		Kind:        KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			uid, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil || d.Sealer == nil || d.Secrets == nil || d.Google == nil {
				return newUnavailableTool("connector.write.gmail_draft", "the Gmail draft tool is not configured on this server")
			}
			return backgroundtaskruntime.NewGmailDraftTool(d.Client, d.Sealer, d.Secrets, d.Google, uid)
		},
	}
}

// CalendarReadCapability lists events on the user's primary Google Calendar.
func CalendarReadCapability() Capability {
	return Capability{
		Name:        "connector.read.calendar",
		Description: "List events on the user's primary Google Calendar (read-only). Requires a connected Google account with the calendar.events.readonly scope.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"timeMin":{"type":"string","description":"RFC3339 lower bound"},"timeMax":{"type":"string","description":"RFC3339 upper bound"},"query":{"type":"string","description":"free-text filter"},"limit":{"type":"integer","description":"max events (1-10)"}}}`),
		TrustTier:   TierRead,
		Kind:        KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			uid, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil || d.Sealer == nil || d.Secrets == nil || d.Google == nil {
				return newUnavailableTool("connector.read.calendar", "the Calendar tool is not configured on this server")
			}
			return backgroundtaskruntime.NewCalendarReadTool(d.Client, d.Sealer, d.Secrets, d.Google, uid)
		},
	}
}

// unavailableTool stands in for a capability whose server-side deps are not
// wired. It keeps the capability's name (so the registry resolves it) but every
// call returns a model-visible "unavailable" observation instead of panicking on
// a nil dependency.
type unavailableTool struct {
	name   string
	reason string
}

func newUnavailableTool(name, reason string) *unavailableTool {
	return &unavailableTool{name: name, reason: reason}
}

func (t *unavailableTool) Name() string                { return t.name }
func (t *unavailableTool) Description() string         { return t.reason }
func (t *unavailableTool) JSONSchema() json.RawMessage { return json.RawMessage(`{"type":"object"}`) }
func (t *unavailableTool) Invoke(_ context.Context, _ backgroundtaskruntime.ToolScope, _ json.RawMessage) (json.RawMessage, error) {
	b, err := json.Marshal(map[string]string{"error": t.reason})
	if err != nil {
		return nil, err
	}
	return b, nil
}
