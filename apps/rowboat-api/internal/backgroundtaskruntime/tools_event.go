package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/google/uuid"
)

// eventPayloadCap bounds the decrypted payload surfaced to the model.
const eventPayloadCap = 16 << 10 // 16 KiB

// NewEventReadTool exposes the cloud event that triggered this run (RFC 003
// linkage). Registered only when the run carries a cloud_event_id.
func NewEventReadTool(client *ent.Client, sealer *crypto.Sealer, eventID uuid.UUID) Tool {
	return &eventReadTool{client: client, sealer: sealer, eventID: eventID}
}

type eventReadTool struct {
	client  *ent.Client
	sealer  *crypto.Sealer
	eventID uuid.UUID
}

func (t *eventReadTool) Name() string { return "event.read" }
func (t *eventReadTool) Description() string {
	return "Read the cloud event that triggered this run (subject, gist, and the full normalized payload)."
}

func (t *eventReadTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{}}`)
}

func (t *eventReadTool) Invoke(ctx context.Context, _ ToolScope, _ json.RawMessage) (json.RawMessage, error) {
	ev, err := t.client.CloudEvent.Get(ctx, t.eventID)
	if err != nil {
		return nil, fmt.Errorf("load linked event: %w", err)
	}
	out := map[string]any{
		"source":    ev.Source,
		"eventType": ev.EventType,
		"subject":   ev.Subject,
		"text":      ev.Text,
	}
	if ev.OccurredAt != nil {
		out["occurredAt"] = ev.OccurredAt.UTC().Format("2006-01-02T15:04:05Z")
	}
	if len(ev.PayloadCiphertext) > 0 {
		plain, oerr := t.sealer.Open(ev.PayloadCiphertext)
		if oerr != nil {
			return nil, fmt.Errorf("open event payload: %w", oerr)
		}
		payload := truncate(string(plain), eventPayloadCap)
		// Keep valid JSON payloads structured; truncated/odd ones go as text.
		if json.Valid([]byte(payload)) {
			out["payload"] = json.RawMessage(payload)
		} else {
			out["payloadText"] = payload
		}
	}
	return json.Marshal(out)
}
