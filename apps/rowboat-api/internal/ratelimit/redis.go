package ratelimit

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// redisLimiter is a fixed-window counter shared across replicas. The window is
// the TTL on a per-(group,user) key; the atomic INCR+PEXPIRE+PTTL keeps the
// count and reset time consistent.
type redisLimiter struct {
	rdb *redis.Client
}

var fixedWindowScript = redis.NewScript(`
local c = redis.call('INCR', KEYS[1])
if c == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local pttl = redis.call('PTTL', KEYS[1])
return {c, pttl}
`)

func newRedisLimiter(ctx context.Context, redisURL string) (*redisLimiter, error) {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("ratelimit: parse redis url: %w", err)
	}
	rdb := redis.NewClient(opt)
	pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := rdb.Ping(pingCtx).Err(); err != nil {
		_ = rdb.Close()
		return nil, fmt.Errorf("ratelimit: ping redis: %w", err)
	}
	return &redisLimiter{rdb: rdb}, nil
}

func (r *redisLimiter) Allow(ctx context.Context, key string, limit int, window time.Duration) (bool, time.Duration, error) {
	res, err := fixedWindowScript.Run(ctx, r.rdb, []string{"rl:" + key}, window.Milliseconds()).Result()
	if err != nil {
		return false, 0, err
	}
	arr, ok := res.([]any)
	if !ok || len(arr) != 2 {
		return false, 0, fmt.Errorf("ratelimit: unexpected redis reply %v", res)
	}
	count, _ := arr[0].(int64)
	pttl, _ := arr[1].(int64)
	if count > int64(limit) {
		return false, time.Duration(pttl) * time.Millisecond, nil
	}
	return true, 0, nil
}
