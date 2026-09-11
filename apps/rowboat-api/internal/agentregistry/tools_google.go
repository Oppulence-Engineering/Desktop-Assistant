package agentregistry

import (
	"context"
	"encoding/json"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
	"github.com/google/uuid"
)

// Google connector capabilities (RFC 012 connectors). They reuse the RFC 004
// connector tools (internal/backgroundtaskruntime.NewGmailReadTool /
// NewCalendarReadTool / NewDriveReadTool and their write siblings), which
// resolve the session owner's Google connection, check the required OAuth scope,
// exchange the sealed refresh token for an access token, and call the Google API
// — credentials never enter model text. Reads are auto-execute; writes are
// approval-eligible. When the Google deps are not wired, Build returns a tool
// that reports the capability as unavailable rather than panicking.

// GmailReadCapability reads the user's Gmail (read-only).
func GmailReadCapability() Capability {
	return Capability{
		Name:        "connector.read.gmail",
		Description: "Read the authorized Gmail account identity and totals; list labels or read exact label counts singly or in a bounded batch; count, search, and page through matching messages or distinct conversation threads with Gmail, RFC 822, and reply-parent identities, To, Cc, Bcc, mailing-list unsubscribe, and estimated-size metadata; optionally read complete plain-text bodies or attachment metadata for a search or exact thread; read exact messages or bounded text attachments. Requires gmail.readonly.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"query":{"type":"string","description":"Gmail search query"},"countOnly":{"type":"boolean","const":true,"description":"count matching messages and distinct threads without content"},"groupByThread":{"type":"boolean","const":true,"description":"return up to 10 distinct matching conversations with chronological headers and snippets; supports pagination and never returns bodies"},"includeAttachments":{"type":"boolean","const":true,"description":"With query or threadId, return attachment metadata and sealed references without message bodies"},"pageToken":{"type":"string"},"threadId":{"type":"string","description":"Exact thread ID; add includeAttachments for attachment metadata without bodies"},"includeBodies":{"type":"boolean","description":"With query or threadId, return complete plain-text messages and attachment metadata; query mode keeps the 10-message limit and pagination"},"messageId":{"type":"string","description":"Exact message ID; returns message content and sealed attachment references"},"attachmentRef":{"type":"string","description":"Sealed reference returned by a message or full thread read; text only, maximum 256 KiB"},"listLabels":{"type":"boolean","const":true},"labelId":{"type":"string"},"labelIds":{"type":"array","minItems":1,"maxItems":20,"items":{"type":"string","minLength":1},"description":"Exact label IDs; returns live counts for each label"},"mailboxProfile":{"type":"boolean","const":true},"limit":{"type":"integer","description":"max messages or threads (1-10)"}},"oneOf":[{"required":["query"]},{"required":["threadId"]},{"required":["messageId"]},{"required":["attachmentRef"]},{"required":["listLabels"]},{"required":["labelId"]},{"required":["labelIds"]},{"required":["mailboxProfile"]}],"additionalProperties":false}`),
		TrustTier:   TierRead,
		Kind:        KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			uid, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil || d.Sealer == nil || d.Secrets == nil || d.Google == nil {
				return newUnavailableTool("connector.read.gmail", "the Gmail tool is not configured on this server")
			}
			return guardOwnerScopedToolInSlack(d, backgroundtaskruntime.NewGmailReadTool(d.Client, d.Sealer, d.Secrets, d.Google, uid))
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
			return guardOwnerScopedToolInSlack(d, backgroundtaskruntime.NewGmailDraftTool(d.Client, d.Sealer, d.Secrets, d.Google, uid))
		},
	}
}

// GmailSendCapability sends an email on the user's behalf (act-tier:
// approval-eligible).
func GmailSendCapability() Capability {
	return Capability{
		Name:        "connector.write.gmail_send",
		Description: "Send a plain-text Gmail message on the user's behalf. Requires a connected Google account with the gmail.send scope, and human approval.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"to":{"type":"string","description":"recipient email address"},"subject":{"type":"string"},"body":{"type":"string","description":"plain-text body"}},"required":["to","body"]}`),
		TrustTier:   TierAct,
		Kind:        KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			uid, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil || d.Sealer == nil || d.Secrets == nil || d.Google == nil {
				return newUnavailableTool("connector.write.gmail_send", "the Gmail send tool is not configured on this server")
			}
			return guardOwnerScopedToolInSlack(d, backgroundtaskruntime.NewGmailSendTool(d.Client, d.Sealer, d.Secrets, d.Google, uid))
		},
	}
}

// CalendarReadCapability reads events on the user's primary Google Calendar.
func CalendarReadCapability() Capability {
	return Capability{
		Name:        "connector.read.calendar",
		Description: "Count, group by day, read availability, list and page through events with Google and iCalendar identities, explicit all-day, event-type, provenance, recurring-series, recurrence-rule, reminder, attendee-response, blocks-time, conference-provider, and attachment metadata, or read one exact event on the user's primary Google Calendar (read-only). Requires a connected Google account with the calendar.events.readonly scope.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"eventId":{"type":"string","description":"Exact Google event ID returned by a prior list; returns the cross-system iCalUID, whether it is all-day, Google's event type, creator and create/update times, recurring-series metadata and recurrence rules, default/custom reminder metadata, whether it blocks time, description, location, organizer, status, attendees, attendee invitation responses, conference provider, meeting link, and attachment titles, MIME types, and links"},"timeMin":{"type":"string","description":"RFC3339 lower bound"},"timeMax":{"type":"string","description":"RFC3339 upper bound"},"durationMinutes":{"type":"integer","minimum":1,"maximum":1440,"description":"return occupied time, timed-event load, all-day busy-event count, and free windows at least this long"},"countOnly":{"type":"boolean","const":true,"description":"count event instances in the bounded time window without details"},"countByDay":{"type":"boolean","const":true,"description":"count event instances by date in the primary calendar timezone without details"},"query":{"type":"string","description":"free-text filter"},"limit":{"type":"integer","description":"max events (1-10)"},"pageToken":{"type":"string","description":"Opaque nextPageToken returned by a prior event list; repeat the same filters to read the next page"}}}`),
		TrustTier:   TierRead,
		Kind:        KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			uid, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil || d.Sealer == nil || d.Secrets == nil || d.Google == nil {
				return newUnavailableTool("connector.read.calendar", "the Calendar tool is not configured on this server")
			}
			return guardOwnerScopedToolInSlack(d, backgroundtaskruntime.NewCalendarReadTool(d.Client, d.Sealer, d.Secrets, d.Google, uid))
		},
	}
}

// CalendarCreateCapability creates events on the user's primary Google Calendar.
func CalendarCreateCapability() Capability {
	return Capability{
		Name:        "connector.write.calendar_create",
		Description: "Create an event on the user's primary Google Calendar. Requires a connected Google account with the calendar.events scope, and human approval.",
		Parameters:  calendarWriteParameters(false),
		TrustTier:   TierAct,
		Kind:        KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			uid, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil || d.Sealer == nil || d.Secrets == nil || d.Google == nil {
				return newUnavailableTool("connector.write.calendar_create", "the Calendar create tool is not configured on this server")
			}
			return guardOwnerScopedToolInSlack(d, backgroundtaskruntime.NewCalendarCreateTool(d.Client, d.Sealer, d.Secrets, d.Google, uid))
		},
	}
}

// CalendarUpdateCapability updates events on the user's primary Google Calendar.
func CalendarUpdateCapability() Capability {
	return Capability{
		Name:        "connector.write.calendar_update",
		Description: "Update an event on the user's primary Google Calendar. Requires a connected Google account with the calendar.events scope, and human approval.",
		Parameters:  calendarWriteParameters(true),
		TrustTier:   TierAct,
		Kind:        KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			uid, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil || d.Sealer == nil || d.Secrets == nil || d.Google == nil {
				return newUnavailableTool("connector.write.calendar_update", "the Calendar update tool is not configured on this server")
			}
			return guardOwnerScopedToolInSlack(d, backgroundtaskruntime.NewCalendarUpdateTool(d.Client, d.Sealer, d.Secrets, d.Google, uid))
		},
	}
}

func calendarWriteParameters(includeEventID bool) json.RawMessage {
	required := `["summary","start","end"]`
	eventID := ""
	if includeEventID {
		required = `["eventId","summary","start","end"]`
		eventID = `"eventId":{"type":"string","description":"Google Calendar event id to update"},`
	}
	return json.RawMessage(`{"type":"object","properties":{` + eventID + `"summary":{"type":"string"},"description":{"type":"string"},"location":{"type":"string"},"start":{"type":"string","description":"RFC3339 event start"},"end":{"type":"string","description":"RFC3339 event end"},"timeZone":{"type":"string","description":"IANA timezone, e.g. America/New_York"},"attendees":{"type":"array","items":{"type":"string"},"description":"attendee email addresses"}},"required":` + required + `}`)
}

// DriveReadCapability searches/lists metadata for the user's Google Drive files.
func DriveReadCapability() Capability {
	return Capability{
		Name:        "connector.read.drive",
		Description: "Search/list the user's Google Drive files (read-only metadata): returns file names, MIME types, owners, modified times, and links; never file contents. Requires a connected Google account with the drive.readonly scope.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"query":{"type":"string","description":"optional Google Drive files.list q expression, e.g. \"name contains 'invoice'\""},"limit":{"type":"integer","description":"max files (1-10)"}}}`),
		TrustTier:   TierRead,
		Kind:        KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			uid, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil || d.Sealer == nil || d.Secrets == nil || d.Google == nil {
				return newUnavailableTool("connector.read.drive", "the Drive tool is not configured on this server")
			}
			return guardOwnerScopedToolInSlack(d, backgroundtaskruntime.NewDriveReadTool(d.Client, d.Sealer, d.Secrets, d.Google, uid))
		},
	}
}

// DriveUpdateCapability updates Drive file metadata or bounded text content.
func DriveUpdateCapability() Capability {
	return Capability{
		Name:        "connector.write.drive_update",
		Description: "Update metadata or replace bounded text content for a Google Drive file accessible to Rowboat. Requires a connected Google account with the drive.file scope, and human approval.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"fileId":{"type":"string"},"name":{"type":"string"},"description":{"type":"string"},"mimeType":{"type":"string","description":"MIME type for metadata/content updates"},"replaceContent":{"type":"boolean","description":"When true, replace the file content with the provided text content"},"content":{"type":"string","description":"Replacement text content, max 256 KiB"}},"required":["fileId"]}`),
		TrustTier:   TierAct,
		Kind:        KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			uid, err := uuid.Parse(d.UserID)
			if err != nil || d.Client == nil || d.Sealer == nil || d.Secrets == nil || d.Google == nil {
				return newUnavailableTool("connector.write.drive_update", "the Drive update tool is not configured on this server")
			}
			return guardOwnerScopedToolInSlack(d, backgroundtaskruntime.NewDriveUpdateTool(d.Client, d.Sealer, d.Secrets, d.Google, uid))
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
