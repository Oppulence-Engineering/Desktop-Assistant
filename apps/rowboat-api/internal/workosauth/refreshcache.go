package workosauth

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// RefreshCache backs the refresh-dedup layer: a short-TTL result cache plus a
// cross-replica lock. Implementations must be safe for concurrent use.
type RefreshCache interface {
	Get(ctx context.Context, key string) ([]byte, bool, error)
	Set(ctx context.Context, key string, val []byte, ttl time.Duration) error
	// TryLock acquires key for ttl; returns false when another holder has it.
	TryLock(ctx context.Context, key string, ttl time.Duration) (bool, error)
	Unlock(ctx context.Context, key string) error
}

// --- Redis ------------------------------------------------------------------

type redisCache struct{ rdb *redis.Client }

// NewRedisRefreshCache connects like ratelimit's redis limiter (ParseURL +
// ping with a short timeout) so misconfiguration fails at boot, not first use.
func NewRedisRefreshCache(ctx context.Context, redisURL string) (RefreshCache, error) {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("workosauth: parse redis url: %w", err)
	}
	rdb := redis.NewClient(opt)
	pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := rdb.Ping(pingCtx).Err(); err != nil {
		_ = rdb.Close()
		return nil, fmt.Errorf("workosauth: ping redis: %w", err)
	}
	return &redisCache{rdb: rdb}, nil
}

func (c *redisCache) Get(ctx context.Context, key string) ([]byte, bool, error) {
	val, err := c.rdb.Get(ctx, key).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return val, true, nil
}

func (c *redisCache) Set(ctx context.Context, key string, val []byte, ttl time.Duration) error {
	return c.rdb.Set(ctx, key, val, ttl).Err()
}

func (c *redisCache) TryLock(ctx context.Context, key string, ttl time.Duration) (bool, error) {
	return c.rdb.SetNX(ctx, key, "1", ttl).Result()
}

func (c *redisCache) Unlock(ctx context.Context, key string) error {
	return c.rdb.Del(ctx, key).Err()
}

// --- In-memory (devstack / tests) -------------------------------------------

type memoryEntry struct {
	val       []byte
	expiresAt time.Time
}

type memoryCache struct {
	mu      sync.Mutex
	entries map[string]memoryEntry
}

// NewMemoryRefreshCache is the fallback when no Redis is configured. Dedup is
// then per-replica only — the same posture ratelimit takes without Redis.
func NewMemoryRefreshCache() RefreshCache {
	return &memoryCache{entries: make(map[string]memoryEntry)}
}

func (c *memoryCache) Get(_ context.Context, key string) ([]byte, bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[key]
	if !ok || time.Now().After(e.expiresAt) {
		delete(c.entries, key)
		return nil, false, nil
	}
	return e.val, true, nil
}

func (c *memoryCache) Set(_ context.Context, key string, val []byte, ttl time.Duration) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[key] = memoryEntry{val: val, expiresAt: time.Now().Add(ttl)}
	return nil
}

func (c *memoryCache) TryLock(_ context.Context, key string, ttl time.Duration) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.entries[key]; ok && time.Now().Before(e.expiresAt) {
		return false, nil
	}
	c.entries[key] = memoryEntry{val: []byte("1"), expiresAt: time.Now().Add(ttl)}
	return true, nil
}

func (c *memoryCache) Unlock(_ context.Context, key string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, key)
	return nil
}
