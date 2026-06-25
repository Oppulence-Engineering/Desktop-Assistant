package agentworkflow

import (
	"context"
	"encoding/json"
)

// StreamEvent is the wire shape emitted on the NDJSON stream and the Redis bus
// (RFC 027). It is the durable AgentSessionEvent projected for delivery: seq is
// the stable ordering/dedupe key the stream pages by (?afterSeq / nextSeq).
type StreamEvent struct {
	Seq     int             `json:"seq"`
	Type    string          `json:"type"`
	TurnSeq *int            `json:"turnSeq,omitempty"`
	Data    json.RawMessage `json:"data"`
}

// EventPublisher is the live fan-out seam: ActivityAppendSessionEvent tees each
// durable event to it for low-latency delivery. nil → durable-only (the DB
// projection remains the source of truth; the stream backfills by seq). The
// Redis-backed implementation lives in internal/agentstream (P2).
type EventPublisher interface {
	PublishSessionEvent(ctx context.Context, sessionID string, payload []byte) error
}
