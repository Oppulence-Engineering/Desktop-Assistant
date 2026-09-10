package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

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
	ScopeGmailSend        = "https://www.googleapis.com/auth/gmail.send"
	ScopeCalendarReadonly = "https://www.googleapis.com/auth/calendar.events.readonly"
	ScopeCalendarEvents   = "https://www.googleapis.com/auth/calendar.events"
	ScopeDriveReadonly    = "https://www.googleapis.com/auth/drive.readonly"
	ScopeDriveFile        = "https://www.googleapis.com/auth/drive.file"
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
func (t *gmailReadTool) AuditInfo(args json.RawMessage) ToolAudit {
	operation := "gmail.search"
	var input struct {
		Query          string `json:"query"`
		MessageID      string `json:"messageId"`
		ThreadID       string `json:"threadId"`
		LabelID        string `json:"labelId"`
		IncludeBodies  bool   `json:"includeBodies"`
		CountOnly      bool   `json:"countOnly"`
		ListLabels     bool   `json:"listLabels"`
		MailboxProfile bool   `json:"mailboxProfile"`
	}
	if json.Unmarshal(args, &input) == nil {
		switch {
		case strings.TrimSpace(input.Query) != "" && input.CountOnly:
			operation = "gmail.search.count"
		case strings.TrimSpace(input.LabelID) != "":
			operation = "gmail.label.read"
		case input.MailboxProfile:
			operation = "gmail.profile.read"
		case input.ListLabels:
			operation = "gmail.labels.read"
		case strings.TrimSpace(input.MessageID) != "":
			operation = "gmail.message.read"
		case strings.TrimSpace(input.ThreadID) != "" && input.IncludeBodies:
			operation = "gmail.thread.read.full"
		case strings.TrimSpace(input.ThreadID) != "":
			operation = "gmail.thread.read"
		}
	}
	return ToolAudit{TrustTier: TierRead, Connector: "google", Operation: operation, RequiredScopes: []string{ScopeGmailReadonly}}
}
func (t *gmailReadTool) Description() string {
	return "Read the authorized Gmail account identity and totals; list labels or read one label's counts; count, search, and page through matching messages; read one thread's summaries or complete plain-text messages; or read one exact message's body and attachment metadata. Read-only."
}

func (t *gmailReadTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"query":{"type":"string","description":"Gmail search query, e.g. \"from:acme.com newer_than:30d\"."},"countOnly":{"type":"boolean","const":true,"description":"Query mode only. Count matching message IDs without fetching message content; complete=false means the result is a lower bound."},"pageToken":{"type":"string","description":"Opaque nextPageToken returned by a prior search; repeat the same query and limit to read the next page."},"threadId":{"type":"string","description":"Exact thread ID returned by a prior search; returns chronological message headers and snippets by default."},"includeBodies":{"type":"boolean","description":"Thread mode only. Return every message's plain-text body and attachment metadata in one read."},"messageId":{"type":"string","description":"Exact message ID returned by a search or thread read; returns headers, labels, direction, plain-text body, and attachment metadata without downloading attachment bytes."},"listLabels":{"type":"boolean","const":true,"description":"Return the connected mailbox's system and user label names and IDs."},"labelId":{"type":"string","description":"Exact label ID returned by listLabels; returns live message and thread total and unread counts."},"mailboxProfile":{"type":"boolean","const":true,"description":"Return the Gmail account Google actually authorized plus live message and thread totals."},"limit":{"type":"integer","description":"Max messages (1-10); search mode only."}},"oneOf":[{"required":["query"]},{"required":["threadId"]},{"required":["messageId"]},{"required":["listLabels"]},{"required":["labelId"]},{"required":["mailboxProfile"]}],"additionalProperties":false}`)
}

func (t *gmailReadTool) Invoke(ctx context.Context, _ ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		Query          string `json:"query"`
		MessageID      string `json:"messageId"`
		ThreadID       string `json:"threadId"`
		LabelID        string `json:"labelId"`
		Limit          int    `json:"limit"`
		IncludeBodies  bool   `json:"includeBodies"`
		CountOnly      bool   `json:"countOnly"`
		PageToken      string `json:"pageToken"`
		ListLabels     bool   `json:"listLabels"`
		MailboxProfile bool   `json:"mailboxProfile"`
	}
	if err := json.Unmarshal(args, &in); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	in.Query = strings.TrimSpace(in.Query)
	in.MessageID = strings.TrimSpace(in.MessageID)
	in.ThreadID = strings.TrimSpace(in.ThreadID)
	in.LabelID = strings.TrimSpace(in.LabelID)
	in.PageToken = strings.TrimSpace(in.PageToken)
	modes := 0
	for _, value := range []string{in.Query, in.ThreadID, in.MessageID, in.LabelID} {
		if value != "" {
			modes++
		}
	}
	if in.ListLabels {
		modes++
	}
	if in.MailboxProfile {
		modes++
	}
	if modes != 1 {
		return nil, fmt.Errorf("provide exactly one of query, threadId, messageId, listLabels, labelId, or mailboxProfile")
	}
	if in.IncludeBodies && in.ThreadID == "" {
		return nil, fmt.Errorf("includeBodies is only valid with threadId")
	}
	if in.PageToken != "" && in.Query == "" {
		return nil, fmt.Errorf("pageToken is only valid with query")
	}
	if in.CountOnly && (in.Query == "" || in.PageToken != "" || in.Limit != 0) {
		return nil, fmt.Errorf("countOnly requires query and cannot be combined with limit or pageToken")
	}
	token, err := t.deps.accessToken(ctx, ScopeGmailReadonly)
	if err != nil {
		return nil, err
	}
	if in.LabelID != "" {
		label, err := t.deps.google.GetLabel(ctx, token, in.LabelID)
		if err != nil {
			return nil, fmt.Errorf("gmail label detail read: %w", err)
		}
		return json.Marshal(label)
	}
	if in.MailboxProfile {
		profile, err := t.deps.google.GetProfile(ctx, token)
		if err != nil {
			return nil, fmt.Errorf("gmail profile read: %w", err)
		}
		return json.Marshal(profile)
	}
	if in.ListLabels {
		labels, err := t.deps.google.ListLabels(ctx, token)
		if err != nil {
			return nil, fmt.Errorf("gmail label read: %w", err)
		}
		return json.Marshal(map[string]any{"labels": labels})
	}
	if in.CountOnly {
		matchingMessages, complete, err := t.deps.google.CountMessages(ctx, token, in.Query)
		if err != nil {
			return nil, fmt.Errorf("gmail search count: %w", err)
		}
		return json.Marshal(map[string]any{"matchingMessages": matchingMessages, "complete": complete})
	}
	if in.MessageID != "" {
		content, err := t.deps.google.GetMessageContent(ctx, token, in.MessageID)
		if err != nil {
			return nil, fmt.Errorf("gmail message read: %w", err)
		}
		return json.Marshal(content)
	}
	if in.ThreadID != "" {
		if in.IncludeBodies {
			messages, err := t.deps.google.GetThreadContent(ctx, token, in.ThreadID)
			if err != nil {
				return nil, fmt.Errorf("gmail full thread read: %w", err)
			}
			return json.Marshal(map[string]any{"threadId": in.ThreadID, "messages": messages})
		}
		messages, err := t.deps.google.GetThreadMessages(ctx, token, in.ThreadID)
		if err != nil {
			return nil, fmt.Errorf("gmail thread read: %w", err)
		}
		return json.Marshal(map[string]any{"threadId": in.ThreadID, "messages": messages})
	}
	messages, nextPageToken, err := t.deps.google.ListMessages(ctx, token, in.Query, in.Limit, in.PageToken)
	if err != nil {
		return nil, fmt.Errorf("gmail search: %w", err)
	}
	result := map[string]any{"messages": messages}
	if nextPageToken != "" {
		result["nextPageToken"] = nextPageToken
	}
	return json.Marshal(result)
}

// NewGmailDraftTool builds connector.write.gmail_draft (creates a draft; never
// sends). It is an outward-facing act — the durable runtime gates it behind a
// human approval (RFC 012 act tier).
func NewGmailDraftTool(client *ent.Client, sealer *crypto.Sealer, sec *secrets.Store, google *googleapi.Client, userID uuid.UUID) Tool {
	return &gmailDraftTool{deps: connectorDeps{client: client, sealer: sealer, secrets: sec, google: google, userID: userID}}
}

type gmailDraftTool struct{ deps connectorDeps }

func (t *gmailDraftTool) Name() string { return "connector.write.gmail_draft" }
func (t *gmailDraftTool) AuditInfo(json.RawMessage) ToolAudit {
	return ToolAudit{TrustTier: TierAct, Connector: "google", Operation: "gmail.draft.create", RequiredScopes: []string{ScopeGmailCompose}}
}
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

// NewGmailSendTool builds connector.write.gmail_send (sends an email). The
// runtime gates this outward-facing act behind human approval.
func NewGmailSendTool(client *ent.Client, sealer *crypto.Sealer, sec *secrets.Store, google *googleapi.Client, userID uuid.UUID) Tool {
	return &gmailSendTool{deps: connectorDeps{client: client, sealer: sealer, secrets: sec, google: google, userID: userID}}
}

type gmailSendTool struct{ deps connectorDeps }

func (t *gmailSendTool) Name() string { return "connector.write.gmail_send" }
func (t *gmailSendTool) AuditInfo(json.RawMessage) ToolAudit {
	return ToolAudit{TrustTier: TierAct, Connector: "google", Operation: "gmail.message.send", RequiredScopes: []string{ScopeGmailSend}}
}
func (t *gmailSendTool) Description() string {
	return "Send a plain-text Gmail message on the user's behalf. Requires human approval."
}
func (t *gmailSendTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"to":{"type":"string","description":"recipient email address"},"subject":{"type":"string"},"body":{"type":"string","description":"plain-text body"}},"required":["to","body"]}`)
}
func (t *gmailSendTool) Invoke(ctx context.Context, _ ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		To      string `json:"to"`
		Subject string `json:"subject"`
		Body    string `json:"body"`
	}
	if err := json.Unmarshal(args, &in); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	if in.To == "" || in.Body == "" {
		return nil, fmt.Errorf("'to' and 'body' are required")
	}
	token, err := t.deps.accessToken(ctx, ScopeGmailSend)
	if err != nil {
		return nil, err
	}
	id, err := t.deps.google.SendMessage(ctx, token, in.To, in.Subject, in.Body)
	if err != nil {
		return nil, fmt.Errorf("gmail send: %w", err)
	}
	return json.Marshal(map[string]any{"messageId": id, "status": "sent"})
}

// NewCalendarReadTool builds connector.read.calendar (read-only event list/detail).
func NewCalendarReadTool(client *ent.Client, sealer *crypto.Sealer, sec *secrets.Store, google *googleapi.Client, userID uuid.UUID) Tool {
	return &calendarReadTool{deps: connectorDeps{client: client, sealer: sealer, secrets: sec, google: google, userID: userID}}
}

type calendarReadTool struct{ deps connectorDeps }

func (t *calendarReadTool) Name() string { return "connector.read.calendar" }
func (t *calendarReadTool) AuditInfo(args json.RawMessage) ToolAudit {
	operation := "calendar.events.list"
	var input struct {
		EventID         string `json:"eventId"`
		DurationMinutes int    `json:"durationMinutes"`
		CountOnly       bool   `json:"countOnly"`
	}
	if json.Unmarshal(args, &input) == nil {
		switch {
		case strings.TrimSpace(input.EventID) != "":
			operation = "calendar.event.read"
		case input.DurationMinutes != 0:
			operation = "calendar.availability.read"
		case input.CountOnly:
			operation = "calendar.events.count"
		}
	}
	return ToolAudit{TrustTier: TierRead, Connector: "google", Operation: operation, RequiredScopes: []string{ScopeCalendarReadonly}}
}
func (t *calendarReadTool) Description() string {
	return "Count events in a bounded window without details; list and page through events; find free windows without details; or read one exact event. Read-only."
}

func (t *calendarReadTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"eventId":{"type":"string","description":"Exact event ID returned by a prior list; returns description, location, organizer, status, attendees, and meeting links."},"timeMin":{"type":"string","description":"RFC3339 lower bound."},"timeMax":{"type":"string","description":"RFC3339 upper bound."},"durationMinutes":{"type":"integer","minimum":1,"maximum":1440,"description":"With timeMin and timeMax, returns maximal free windows at least this long without event details."},"countOnly":{"type":"boolean","const":true,"description":"With exact timeMin and timeMax, count event instances without returning event details; complete=false means the result is a lower bound."},"query":{"type":"string","description":"Free-text filter; list or count mode."},"limit":{"type":"integer","description":"Max events (1-10); list mode only."},"pageToken":{"type":"string","description":"Opaque nextPageToken returned by a prior event list; repeat the same list filters to read the next page."}},"additionalProperties":false}`)
}

func (t *calendarReadTool) Invoke(ctx context.Context, _ ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		EventID         string `json:"eventId"`
		TimeMin         string `json:"timeMin"`
		TimeMax         string `json:"timeMax"`
		DurationMinutes int    `json:"durationMinutes"`
		CountOnly       bool   `json:"countOnly"`
		Query           string `json:"query"`
		Limit           int    `json:"limit"`
		PageToken       string `json:"pageToken"`
	}
	if err := json.Unmarshal(args, &in); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	in.EventID = strings.TrimSpace(in.EventID)
	in.PageToken = strings.TrimSpace(in.PageToken)
	if in.EventID != "" && (strings.TrimSpace(in.TimeMin) != "" || strings.TrimSpace(in.TimeMax) != "" || in.DurationMinutes != 0 || in.CountOnly || strings.TrimSpace(in.Query) != "" || in.Limit != 0 || in.PageToken != "") {
		return nil, fmt.Errorf("eventId cannot be combined with calendar list filters")
	}
	if in.DurationMinutes != 0 && (strings.TrimSpace(in.TimeMin) == "" || strings.TrimSpace(in.TimeMax) == "" || in.CountOnly || strings.TrimSpace(in.Query) != "" || in.Limit != 0 || in.PageToken != "") {
		return nil, fmt.Errorf("durationMinutes requires timeMin and timeMax and cannot be combined with query, limit, or pageToken")
	}
	if in.CountOnly && (strings.TrimSpace(in.TimeMin) == "" || strings.TrimSpace(in.TimeMax) == "" || in.Limit != 0 || in.PageToken != "") {
		return nil, fmt.Errorf("countOnly requires timeMin and timeMax and cannot be combined with limit or pageToken")
	}
	token, err := t.deps.accessToken(ctx, ScopeCalendarReadonly)
	if err != nil {
		return nil, err
	}
	if in.EventID != "" {
		event, err := t.deps.google.GetEvent(ctx, token, in.EventID)
		if err != nil {
			return nil, fmt.Errorf("calendar event read: %w", err)
		}
		return json.Marshal(map[string]any{"event": event})
	}
	if in.DurationMinutes != 0 {
		availability, err := t.deps.google.FindAvailability(ctx, token, in.TimeMin, in.TimeMax, in.DurationMinutes)
		if err != nil {
			return nil, fmt.Errorf("calendar availability: %w", err)
		}
		return json.Marshal(availability)
	}
	if in.CountOnly {
		matchingEvents, complete, err := t.deps.google.CountEvents(ctx, token, in.TimeMin, in.TimeMax, strings.TrimSpace(in.Query))
		if err != nil {
			return nil, fmt.Errorf("calendar count: %w", err)
		}
		return json.Marshal(map[string]any{"matchingEvents": matchingEvents, "complete": complete})
	}
	events, nextPageToken, err := t.deps.google.ListEvents(ctx, token, googleapi.CalendarQuery{
		TimeMin: in.TimeMin, TimeMax: in.TimeMax, Text: in.Query, Limit: in.Limit, PageToken: in.PageToken,
	})
	if err != nil {
		return nil, fmt.Errorf("calendar list: %w", err)
	}
	result := map[string]any{"events": events}
	if nextPageToken != "" {
		result["nextPageToken"] = nextPageToken
	}
	return json.Marshal(result)
}

// NewCalendarCreateTool builds connector.write.calendar_create.
func NewCalendarCreateTool(client *ent.Client, sealer *crypto.Sealer, sec *secrets.Store, google *googleapi.Client, userID uuid.UUID) Tool {
	return &calendarCreateTool{deps: connectorDeps{client: client, sealer: sealer, secrets: sec, google: google, userID: userID}}
}

type calendarCreateTool struct{ deps connectorDeps }

func (t *calendarCreateTool) Name() string { return "connector.write.calendar_create" }
func (t *calendarCreateTool) AuditInfo(json.RawMessage) ToolAudit {
	return ToolAudit{TrustTier: TierAct, Connector: "google", Operation: "calendar.event.create", RequiredScopes: []string{ScopeCalendarEvents}}
}
func (t *calendarCreateTool) Description() string {
	return "Create an event on the user's primary Google Calendar. Requires human approval."
}
func (t *calendarCreateTool) JSONSchema() json.RawMessage {
	return calendarWriteSchema(false)
}
func (t *calendarCreateTool) Invoke(ctx context.Context, _ ToolScope, args json.RawMessage) (json.RawMessage, error) {
	in, err := decodeCalendarWriteArgs(args, false)
	if err != nil {
		return nil, err
	}
	token, err := t.deps.accessToken(ctx, ScopeCalendarEvents)
	if err != nil {
		return nil, err
	}
	event, err := t.deps.google.CreateEvent(ctx, token, in.mutation)
	if err != nil {
		return nil, fmt.Errorf("calendar create: %w", err)
	}
	return json.Marshal(map[string]any{"event": event, "status": "created"})
}

// NewCalendarUpdateTool builds connector.write.calendar_update.
func NewCalendarUpdateTool(client *ent.Client, sealer *crypto.Sealer, sec *secrets.Store, google *googleapi.Client, userID uuid.UUID) Tool {
	return &calendarUpdateTool{deps: connectorDeps{client: client, sealer: sealer, secrets: sec, google: google, userID: userID}}
}

type calendarUpdateTool struct{ deps connectorDeps }

func (t *calendarUpdateTool) Name() string { return "connector.write.calendar_update" }
func (t *calendarUpdateTool) AuditInfo(json.RawMessage) ToolAudit {
	return ToolAudit{TrustTier: TierAct, Connector: "google", Operation: "calendar.event.update", RequiredScopes: []string{ScopeCalendarEvents}}
}
func (t *calendarUpdateTool) Description() string {
	return "Update an event on the user's primary Google Calendar. Requires human approval."
}
func (t *calendarUpdateTool) JSONSchema() json.RawMessage {
	return calendarWriteSchema(true)
}
func (t *calendarUpdateTool) Invoke(ctx context.Context, _ ToolScope, args json.RawMessage) (json.RawMessage, error) {
	in, err := decodeCalendarWriteArgs(args, true)
	if err != nil {
		return nil, err
	}
	token, err := t.deps.accessToken(ctx, ScopeCalendarEvents)
	if err != nil {
		return nil, err
	}
	event, err := t.deps.google.UpdateEvent(ctx, token, in.EventID, in.mutation)
	if err != nil {
		return nil, fmt.Errorf("calendar update: %w", err)
	}
	return json.Marshal(map[string]any{"event": event, "status": "updated"})
}

type calendarWriteArgs struct {
	EventID     string   `json:"eventId"`
	Summary     string   `json:"summary"`
	Description string   `json:"description"`
	Location    string   `json:"location"`
	Start       string   `json:"start"`
	End         string   `json:"end"`
	TimeZone    string   `json:"timeZone"`
	Attendees   []string `json:"attendees"`

	mutation googleapi.CalendarEventMutation
}

func decodeCalendarWriteArgs(args json.RawMessage, requireEventID bool) (calendarWriteArgs, error) {
	var in calendarWriteArgs
	if err := json.Unmarshal(args, &in); err != nil {
		return in, fmt.Errorf("invalid calendar arguments: %w", err)
	}
	if requireEventID && in.EventID == "" {
		return in, fmt.Errorf("eventId is required")
	}
	in.mutation = googleapi.CalendarEventMutation{
		Summary:     in.Summary,
		Description: in.Description,
		Location:    in.Location,
		Start:       in.Start,
		End:         in.End,
		TimeZone:    in.TimeZone,
		Attendees:   in.Attendees,
	}
	return in, nil
}

func calendarWriteSchema(includeEventID bool) json.RawMessage {
	required := `["summary","start","end"]`
	eventID := ""
	if includeEventID {
		required = `["eventId","summary","start","end"]`
		eventID = `"eventId":{"type":"string","description":"Google Calendar event id to update."},`
	}
	return json.RawMessage(`{"type":"object","properties":{` + eventID + `"summary":{"type":"string"},"description":{"type":"string"},"location":{"type":"string"},"start":{"type":"string","description":"RFC3339 event start."},"end":{"type":"string","description":"RFC3339 event end."},"timeZone":{"type":"string","description":"IANA timezone, e.g. America/New_York."},"attendees":{"type":"array","items":{"type":"string"},"description":"Attendee email addresses."}},"required":` + required + `}`)
}

// NewDriveReadTool builds connector.read.drive (read-only file metadata search).
func NewDriveReadTool(client *ent.Client, sealer *crypto.Sealer, sec *secrets.Store, google *googleapi.Client, userID uuid.UUID) Tool {
	return &driveReadTool{deps: connectorDeps{client: client, sealer: sealer, secrets: sec, google: google, userID: userID}}
}

type driveReadTool struct{ deps connectorDeps }

func (t *driveReadTool) Name() string { return "connector.read.drive" }
func (t *driveReadTool) AuditInfo(json.RawMessage) ToolAudit {
	return ToolAudit{TrustTier: TierRead, Connector: "google", Operation: "drive.files.list", RequiredScopes: []string{ScopeDriveReadonly}}
}
func (t *driveReadTool) Description() string {
	return "Search/list the user's Google Drive files (read-only metadata). Returns file names, MIME types, owners, modified times, and links; never file contents."
}

func (t *driveReadTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"query":{"type":"string","description":"Optional Google Drive files.list q expression, e.g. \"name contains 'invoice'\"."},"limit":{"type":"integer","description":"Max files (1-10)."}}}`)
}

func (t *driveReadTool) Invoke(ctx context.Context, _ ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		Query string `json:"query"`
		Limit int    `json:"limit"`
	}
	if len(args) > 0 {
		if err := json.Unmarshal(args, &in); err != nil {
			return nil, fmt.Errorf("invalid arguments: %w", err)
		}
	}
	token, err := t.deps.accessToken(ctx, ScopeDriveReadonly)
	if err != nil {
		return nil, err
	}
	files, err := t.deps.google.ListDriveFiles(ctx, token, in.Query, in.Limit)
	if err != nil {
		return nil, fmt.Errorf("drive files list: %w", err)
	}
	return json.Marshal(map[string]any{"files": files})
}

// NewDriveUpdateTool builds connector.write.drive_update.
func NewDriveUpdateTool(client *ent.Client, sealer *crypto.Sealer, sec *secrets.Store, google *googleapi.Client, userID uuid.UUID) Tool {
	return &driveUpdateTool{deps: connectorDeps{client: client, sealer: sealer, secrets: sec, google: google, userID: userID}}
}

type driveUpdateTool struct{ deps connectorDeps }

func (t *driveUpdateTool) Name() string { return "connector.write.drive_update" }
func (t *driveUpdateTool) AuditInfo(args json.RawMessage) ToolAudit {
	var in struct {
		ReplaceContent bool `json:"replaceContent"`
	}
	_ = json.Unmarshal(args, &in)
	operation := "drive.file.metadata.update"
	if in.ReplaceContent {
		operation = "drive.file.content.replace"
	}
	return ToolAudit{TrustTier: TierAct, Connector: "google", Operation: operation, RequiredScopes: []string{ScopeDriveFile}}
}
func (t *driveUpdateTool) Description() string {
	return "Update metadata or replace bounded text content for a Google Drive file accessible to Rowboat. Requires human approval."
}
func (t *driveUpdateTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"fileId":{"type":"string"},"name":{"type":"string"},"description":{"type":"string"},"mimeType":{"type":"string","description":"MIME type for metadata/content updates."},"replaceContent":{"type":"boolean","description":"When true, replace the file content with the provided text content."},"content":{"type":"string","description":"Replacement text content, max 256 KiB."}},"required":["fileId"]}`)
}
func (t *driveUpdateTool) Invoke(ctx context.Context, _ ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		FileID         string `json:"fileId"`
		Name           string `json:"name"`
		Description    string `json:"description"`
		MIMEType       string `json:"mimeType"`
		ReplaceContent bool   `json:"replaceContent"`
		Content        string `json:"content"`
	}
	if err := json.Unmarshal(args, &in); err != nil {
		return nil, fmt.Errorf("invalid drive update arguments: %w", err)
	}
	if in.FileID == "" {
		return nil, fmt.Errorf("fileId is required")
	}
	token, err := t.deps.accessToken(ctx, ScopeDriveFile)
	if err != nil {
		return nil, err
	}
	mutation := googleapi.DriveFileMutation{Name: in.Name, Description: in.Description, MIMEType: in.MIMEType, Content: in.Content}
	var file googleapi.DriveFile
	if in.ReplaceContent {
		file, err = t.deps.google.ReplaceDriveFileTextContent(ctx, token, in.FileID, mutation)
	} else {
		file, err = t.deps.google.UpdateDriveFileMetadata(ctx, token, in.FileID, mutation)
	}
	if err != nil {
		return nil, fmt.Errorf("drive update: %w", err)
	}
	return json.Marshal(map[string]any{"file": file, "status": "updated"})
}
