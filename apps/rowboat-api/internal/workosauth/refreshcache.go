package workosauth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
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
	// TryLock returns a cryptographically random owner token when acquired.
	TryLock(ctx context.Context, key string, ttl time.Duration) (owner string, acquired bool, err error)
	Renew(ctx context.Context, key, owner string, ttl time.Duration) (bool, error)
	Unlock(ctx context.Context, key, owner string) error
}

// --- Redis ------------------------------------------------------------------

type redisCache struct{ rdb *redis.Client }

var renewLockScript = redis.NewScript(`
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0
`)

var unlockScript = redis.NewScript(`
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`)

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

func (c *redisCache) TryLock(ctx context.Context, key string, ttl time.Duration) (string, bool, error) {
	owner, err := newLockOwner()
	if err != nil {
		return "", false, err
	}
	acquired, err := c.rdb.SetNX(ctx, key, owner, ttl).Result()
	if !acquired {
		owner = ""
	}
	return owner, acquired, err
}

func (c *redisCache) Renew(ctx context.Context, key, owner string, ttl time.Duration) (bool, error) {
	result, err := renewLockScript.Run(ctx, c.rdb, []string{key}, owner, ttl.Milliseconds()).Int64()
	return result == 1, err
}

func (c *redisCache) Unlock(ctx context.Context, key, owner string) error {
	return unlockScript.Run(ctx, c.rdb, []string{key}, owner).Err()
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

func (c *memoryCache) TryLock(_ context.Context, key string, ttl time.Duration) (string, bool, error) {
	owner, err := newLockOwner()
	if err != nil {
		return "", false, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.entries[key]; ok && time.Now().Before(e.expiresAt) {
		return "", false, nil
	}
	c.entries[key] = memoryEntry{val: []byte(owner), expiresAt: time.Now().Add(ttl)}
	return owner, true, nil
}

func (c *memoryCache) Renew(_ context.Context, key, owner string, ttl time.Duration) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[key]
	if !ok || time.Now().After(e.expiresAt) || string(e.val) != owner {
		return false, nil
	}
	e.expiresAt = time.Now().Add(ttl)
	c.entries[key] = e
	return true, nil
}

func (c *memoryCache) Unlock(_ context.Context, key, owner string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[key]
	if ok && time.Now().Before(e.expiresAt) && string(e.val) == owner {
		delete(c.entries, key)
	}
	return nil
}

func newLockOwner() (string, error) {
	var token [32]byte
	if _, err := rand.Read(token[:]); err != nil {
		return "", fmt.Errorf("workosauth: generate refresh lock owner: %w", err)
	}
	return hex.EncodeToString(token[:]), nil
}
