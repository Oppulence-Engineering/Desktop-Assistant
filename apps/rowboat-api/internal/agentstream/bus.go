// Package agentstream is the durable agent runtime's streaming layer (RFC 027):
// a Redis pub/sub fan-out for low-latency live deltas plus an NDJSON SSE handler
// that tails the AgentSessionEvent projection (the source of truth) and the bus
// together, backfilling missed events by seq and deduping by seq. Token-level
// deltas bypass the workflow entirely and are out of scope here — this package
// only relays the durable, ordered session events.
package agentstream

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// busChannel is the per-session pub/sub channel.
func busChannel(sessionID string) string { return "agent-session:" + sessionID }

// Bus is the Redis-backed live fan-out. It implements
// agentworkflow.EventPublisher (PublishSessionEvent) so ActivityAppendSessionEvent
// can tee each durable event to it.
type Bus struct {
	rdb *redis.Client
}

// NewBus dials Redis and verifies connectivity.
func NewBus(ctx context.Context, redisURL string) (*Bus, error) {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("agentstream: parse redis url: %w", err)
	}
	rdb := redis.NewClient(opt)
	pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := rdb.Ping(pingCtx).Err(); err != nil {
		_ = rdb.Close()
		return nil, fmt.Errorf("agentstream: ping redis: %w", err)
	}
	return &Bus{rdb: rdb}, nil
}

// PublishSessionEvent fans one durable event out to live subscribers. Best
// effort: the durable projection remains the source of truth, so a publish
// failure never blocks the session (the stream backfills from the DB).
func (b *Bus) PublishSessionEvent(ctx context.Context, sessionID string, payload []byte) error {
	return b.rdb.Publish(ctx, busChannel(sessionID), payload).Err()
}

// Subscribe opens a subscription to a session's live event channel. The caller
// must Close the returned *redis.PubSub.
func (b *Bus) Subscribe(ctx context.Context, sessionID string) *redis.PubSub {
	return b.rdb.Subscribe(ctx, busChannel(sessionID))
}

// Close releases the Redis client.
func (b *Bus) Close() error {
	if b == nil || b.rdb == nil {
		return nil
	}
	return b.rdb.Close()
}
