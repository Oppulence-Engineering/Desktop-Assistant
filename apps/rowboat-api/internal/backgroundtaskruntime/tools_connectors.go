package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/google/uuid"
)

// Capability scopes carried in ToolScope.Allowed, matching the Google OAuth
// scopes the connect flow requests.
const (
	ScopeGmailReadonly    = "https://www.googleapis.com/auth/gmail.readonly"
	ScopeGmailCompose     = "https://www.googleapis.com/auth/gmail.compose"
	ScopeCalendarReadonly = "https://www.googleapis.com/auth/calendar.events.readonly"
)

// connectorDeps bundle what both Google read tools need to resolve a
// credential INSIDE Invoke — tokens never come from model text.
type connectorDeps struct {
	client  *ent.Client
	sealer  *crypto.Sealer
	secrets *secrets.Store
	google  *googleapi.Client
	userID  uuid.UUID
}

// accessToken resolves the user's Google access token, classifying every
// failure mode as connector_unavailable (missing connection, dead refresh
// token, unconfigured OAuth client).
func (d connectorDeps) accessToken(ctx context.Context, requiredScope string) (string, error) {
	conn, err := d.client.OAuthConnection.Query().
		Where(
			oauthconnection.ProviderEQ("google"),
			oauthconnection.HasUserWith(user.IDEQ(d.userID)),
		).
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return "", &RuntimeError{Code: CodeConnectorUnavailable, Message: "google is not connected for this user"}
		}
		return "", fmt.Errorf("load google connection: %w", err)
	}
	if !slices.Contains(conn.Scopes, requiredScope) {
		// Connections made before a scope was added to the connect flow won't carry
		// it; the user must reconnect Google to grant it (we can't widen an existing
		// grant server-side).
		return "", &RuntimeError{Code: CodeConnectorUnavailable, Message: "google connection is missing the " + requiredScope + " scope; reconnect Google to grant it"}
	}
	token, err := d.google.AccessTokenForConnection(ctx, d.sealer, d.secrets, conn)
	if err != nil {
		if errors.Is(err, googleapi.ErrReconnectRequired) {
			return "", &RuntimeError{Code: CodeConnectorUnavailable, Message: "google refresh token is invalid; the user must reconnect", Cause: err}
		}
		return "", &RuntimeError{Code: CodeConnectorUnavailable, Message: "could not obtain a google access token", Cause: err}
	}
	return token, nil
}

// NewGmailReadTool builds connector.read.gmail (read-only message search).
func NewGmailReadTool(client *ent.Client, sealer *crypto.Sealer, sec *secrets.Store, google *googleapi.Client, userID uuid.UUID) Tool {
	return &gmailReadTool{deps: connectorDeps{client: client, sealer: sealer, secrets: sec, google: google, userID: userID}}
}

type gmailReadTool struct{ deps connectorDeps }

func (t *gmailReadTool) Name() string { return "connector.read.gmail" }
func (t *gmailReadTool) Description() string {
	return "Search the user's Gmail (read-only). Returns message headers and snippets, never full bodies."
}

func (t *gmailReadTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"query":{"type":"string","description":"Gmail search query, e.g. \"from:acme.com newer_than:30d\"."},"limit":{"type":"integer","description":"Max messages (1-10)."}},"required":["query"]}`)
}

func (t *gmailReadTool) Invoke(ctx context.Context, _ ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		Query string `json:"query"`
		Limit int    `json:"limit"`
	}
	if err := json.Unmarshal(args, &in); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	if in.Query == "" {
		return nil, fmt.Errorf("query is required")
	}
	token, err := t.deps.accessToken(ctx, ScopeGmailReadonly)
	if err != nil {
		return nil, err
	}
	messages, err := t.deps.google.ListMessages(ctx, token, in.Query, in.Limit)
	if err != nil {
		return nil, fmt.Errorf("gmail search: %w", err)
	}
	return json.Marshal(map[string]any{"messages": messages})
}

// NewGmailDraftTool builds connector.write.gmail_draft (creates a draft; never
// sends). It is an outward-facing act — the durable runtime gates it behind a
// human approval (RFC 012 act tier).
func NewGmailDraftTool(client *ent.Client, sealer *crypto.Sealer, sec *secrets.Store, google *googleapi.Client, userID uuid.UUID) Tool {
	return &gmailDraftTool{deps: connectorDeps{client: client, sealer: sealer, secrets: sec, google: google, userID: userID}}
}

type gmailDraftTool struct{ deps connectorDeps }

func (t *gmailDraftTool) Name() string { return "connector.write.gmail_draft" }
func (t *gmailDraftTool) Description() string {
	return "Create a Gmail draft on the user's behalf (does NOT send it). Returns the draft id."
}

func (t *gmailDraftTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"to":{"type":"string","description":"recipient email address"},"subject":{"type":"string"},"body":{"type":"string","description":"plain-text body"}},"required":["to","body"]}`)
}

func (t *gmailDraftTool) Invoke(ctx context.Context, _ ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		To      string `json:"to"`
		Subject string `json:"subject"`
		Body    string `json:"body"`
	}
	if len(args) > 0 {
		if err := json.Unmarshal(args, &in); err != nil {
			return nil, fmt.Errorf("invalid arguments: %w", err)
		}
	}
	if in.To == "" || in.Body == "" {
		return nil, fmt.Errorf("'to' and 'body' are required")
	}
	token, err := t.deps.accessToken(ctx, ScopeGmailCompose)
	if err != nil {
		return nil, err
	}
	id, err := t.deps.google.CreateDraft(ctx, token, in.To, in.Subject, in.Body)
	if err != nil {
		return nil, fmt.Errorf("gmail draft: %w", err)
	}
	return json.Marshal(map[string]any{"draftId": id, "status": "created"})
}

// NewCalendarReadTool builds connector.read.calendar (read-only events list).
func NewCalendarReadTool(client *ent.Client, sealer *crypto.Sealer, sec *secrets.Store, google *googleapi.Client, userID uuid.UUID) Tool {
	return &calendarReadTool{deps: connectorDeps{client: client, sealer: sealer, secrets: sec, google: google, userID: userID}}
}

type calendarReadTool struct{ deps connectorDeps }

func (t *calendarReadTool) Name() string { return "connector.read.calendar" }
func (t *calendarReadTool) Description() string {
	return "List events on the user's primary Google Calendar (read-only)."
}

func (t *calendarReadTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"timeMin":{"type":"string","description":"RFC3339 lower bound."},"timeMax":{"type":"string","description":"RFC3339 upper bound."},"query":{"type":"string","description":"Free-text filter."},"limit":{"type":"integer","description":"Max events (1-10)."}}}`)
}

func (t *calendarReadTool) Invoke(ctx context.Context, _ ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		TimeMin string `json:"timeMin"`
		TimeMax string `json:"timeMax"`
		Query   string `json:"query"`
		Limit   int    `json:"limit"`
	}
	if err := json.Unmarshal(args, &in); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	token, err := t.deps.accessToken(ctx, ScopeCalendarReadonly)
	if err != nil {
		return nil, err
	}
	events, err := t.deps.google.ListEvents(ctx, token, googleapi.CalendarQuery{
		TimeMin: in.TimeMin, TimeMax: in.TimeMax, Text: in.Query, Limit: in.Limit,
	})
	if err != nil {
		return nil, fmt.Errorf("calendar list: %w", err)
	}
	return json.Marshal(map[string]any{"events": events})
}
