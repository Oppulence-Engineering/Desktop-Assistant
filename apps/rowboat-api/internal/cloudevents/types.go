// Package cloudevents implements RFC 003: cloud event ingestion and
// event-triggered cloud runs. It accepts external/connector events (internal
// posts + provider webhooks), persists a normalized, deduped CloudEvent
// envelope with the raw payload sealed at rest, routes events to matching
// API-target background tasks with a two-pass LLM decision, and starts
// trigger=event runs through the shared backgroundtaskruns.Starter.
package cloudevents

import (
	"context"
	"encoding/json"
	"time"
)

// Known event sources. The schema validator (ent/schema/cloud_event.go) is the
// authority; this list mirrors it for request validation.
const (
	SourceGmail          = "gmail"
	SourceGoogleCalendar = "google_calendar"
	SourceSlack          = "slack"
	SourceWebhook        = "webhook"
	SourceInternal       = "internal"
)

// Routing statuses (mirror the ent schema enum).
const (
	StatusPending = "pending"
	StatusRouted  = "routed"
	StatusSkipped = "skipped"
	StatusFailed  = "failed"
)

// knownSources gates request validation.
var knownSources = map[string]struct{}{
	SourceGmail:          {},
	SourceGoogleCalendar: {},
	SourceSlack:          {},
	SourceWebhook:        {},
	SourceInternal:       {},
}

// Bounds on the plaintext routing gist. Oversized values are truncated (not
// rejected): the gist exists for routing prompts and list views; the full
// payload is the fidelity copy.
const (
	maxSubjectLen   = 1 << 10  // 1 KiB
	maxTextLen      = 16 << 10 // 16 KiB
	maxDedupeKeyLen = 512
)

// IngestRequest is the normalized POST /v1/events body (RFC 003 contract).
type IngestRequest struct {
	Source          string          `json:"source"`
	SourceEventID   string          `json:"sourceEventId,omitempty"`
	SourceAccountID string          `json:"sourceAccountId,omitempty"`
	EventType       string          `json:"eventType,omitempty"`
	Subject         string          `json:"subject,omitempty"`
	Text            string          `json:"text,omitempty"`
	Payload         json.RawMessage `json:"payload,omitempty"`
	DedupeKey       string          `json:"dedupeKey"`
	OccurredAt      *time.Time      `json:"occurredAt,omitempty"`
}

// internalIngestRequest is the server-to-server variant: the caller must name
// the event owner explicitly (there is no JWT user).
type internalIngestRequest struct {
	IngestRequest
	UserID string `json:"userId"`
}

// IngestResponse is returned by POST /v1/events: 202 for a fresh event, 200
// with deduped=true for an idempotent replay.
type IngestResponse struct {
	EventID          string `json:"eventId"`
	RoutingStatus    string `json:"routingStatus"`
	Deduped          bool   `json:"deduped"`
	MatchedTaskCount int    `json:"matchedTaskCount,omitempty"`
}

// RouteInput identifies one event for the route workflow. Intentionally small
// — it is persisted in Temporal history (StartInput precedent).
type RouteInput struct {
	UserID  string `json:"userId"`
	EventID string `json:"eventId"`
}

// RouteController starts the async route workflow for a freshly ingested
// event. Nil when routing is disabled (events are stored skipped).
type RouteController interface {
	StartRoute(ctx context.Context, in RouteInput) error
}

// routingJSON is the bounded decision summary stored on the event row. It is
// Rowboat's own audit record — never third-party raw payload.
type routingJSON struct {
	Threshold     float64           `json:"threshold,omitempty"`
	PromptVersion string            `json:"promptVersion,omitempty"`
	Decisions     []routingDecision `json:"decisions,omitempty"`
	Reason        string            `json:"reason,omitempty"`
	Error         string            `json:"error,omitempty"`
}

// routingDecision records one pass-2 verdict (below-threshold ones too — they
// are the threshold-tuning data).
type routingDecision struct {
	TaskSlug    string  `json:"taskSlug"`
	Match       bool    `json:"match"`
	Confidence  float64 `json:"confidence"`
	Explanation string  `json:"explanation,omitempty"`
	RunID       string  `json:"runId,omitempty"`
	Error       string  `json:"error,omitempty"`
}

// truncate bounds a plaintext gist field at a rune-safe cut.
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	end := maxLen
	for end > 0 && (s[end]&0xC0) == 0x80 { // back up to a UTF-8 rune start
		end--
	}
	return s[:end]
}
