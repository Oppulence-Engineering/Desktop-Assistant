// Package ratelimit provides per-user, per-route-group rate limiting backed by
// a Redis fixed-window counter (production) or an in-memory counter (dev/test).
// Limits and the route groups they apply to are defined by the caller (wire.go)
// per the plan's rate-limit table.
package ratelimit

import (
	"context"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"go.uber.org/zap"
)

// Route group names (used as part of the bucket key).
const (
	GroupLLM         = "llm"
	GroupVoice       = "voice"
	GroupSearch      = "search"
	GroupComposio    = "composio"
	GroupConnections = "connections"
	GroupDefault     = "default"
)

// Limiter is a fixed-window rate limiter.
type Limiter interface {
	// Allow records a hit on key and reports whether it is within limit for the
	// window, and if not, how long until the window resets.
	Allow(ctx context.Context, key string, limit int, window time.Duration) (allowed bool, retryAfter time.Duration, err error)
}

// Manager applies a Limiter as per-user HTTP middleware.
type Manager struct {
	limiter Limiter
	log     *zap.Logger
}

// NewManager builds a Manager. A non-empty redisURL selects the Redis limiter;
// otherwise (or if Redis is unreachable) it falls back to in-memory.
func NewManager(ctx context.Context, redisURL string, log *zap.Logger) *Manager {
	if redisURL != "" {
		rl, err := newRedisLimiter(redisURL)
		if err != nil {
			log.Warn("redis rate limiter unavailable, using in-memory", zap.Error(err))
		} else {
			log.Info("rate limiter: redis")
			return &Manager{limiter: rl, log: log}
		}
	}
	return &Manager{limiter: newMemoryLimiter(ctx), log: log}
}

// PerUser returns middleware enforcing `limit` requests per minute for the
// route group, keyed by authenticated user (falling back to remote address).
func (m *Manager) PerUser(group string, limit int) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := group + ":" + subject(r)
			allowed, retryAfter, err := m.limiter.Allow(r.Context(), key, limit, time.Minute)
			if err != nil {
				// Fail open: never block users because the limiter backend is down.
				m.log.Warn("rate limiter error, allowing", zap.Error(err))
				next.ServeHTTP(w, r)
				return
			}
			if !allowed {
				secs := int(math.Ceil(retryAfter.Seconds()))
				if secs < 1 {
					secs = 1
				}
				w.Header().Set("Retry-After", strconv.Itoa(secs))
				httpx.Error(w, http.StatusTooManyRequests, "rate limit exceeded", "rate_limited")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// subject identifies the rate-limit principal: the user id when authenticated,
// otherwise the remote address.
func subject(r *http.Request) string {
	if u, ok := auth.UserFromCtx(r.Context()); ok {
		return "u:" + u.ID.String()
	}
	return "ip:" + r.RemoteAddr
}
