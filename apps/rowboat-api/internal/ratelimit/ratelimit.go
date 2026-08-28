// Package ratelimit provides per-user, per-route-group rate limiting backed by
// a Redis fixed-window counter (production) or an in-memory counter (dev/test).
// Limits and the route groups they apply to are defined by the caller (wire.go)
// per the plan's rate-limit table.
package ratelimit

import (
	"context"
	"fmt"
	"math"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"go.uber.org/zap"
)

// Route group names (used as part of the bucket key).
const (
	GroupLLM                = "llm"
	GroupVoice              = "voice"
	GroupSearch             = "search"
	GroupConnections        = "connections"
	GroupConnectorCallbacks = "connector_callbacks"
	GroupDefault            = "default"
	GroupAuth               = "auth"
	GroupFeedback           = "feedback"
	GroupInternal           = "internal"
	GroupLLMBurst           = "llm_burst"
	GroupVoiceBurst         = "voice_burst"
	GroupSearchBurst        = "search_burst"
	GroupTaskBurst          = "background_task_burst"
	GroupEvents             = "events"
	GroupWebhooks           = "webhooks"
	GroupAgent              = "agent"
	GroupRevenue            = "revenue"
	GroupActions            = "actions"
)

// Limiter is a fixed-window rate limiter.
type Limiter interface {
	// Allow records a hit on key and reports whether it is within limit for the
	// window, and if not, how long until the window resets.
	Allow(ctx context.Context, key string, limit int, window time.Duration) (allowed bool, retryAfter time.Duration, err error)
}

// Manager applies a Limiter as per-user HTTP middleware.
type Manager struct {
	limiter    Limiter
	log        *zap.Logger
	failClosed bool
}

// NewManager builds a Manager. Production callers pass failClosed=true, making
// Redis mandatory and turning limiter backend errors into 503s.
func NewManager(ctx context.Context, redisURL string, failClosed bool, log *zap.Logger) (*Manager, error) {
	if redisURL != "" {
		rl, err := newRedisLimiter(ctx, redisURL)
		if err != nil {
			if failClosed {
				return nil, err
			}
			log.Warn("redis rate limiter unavailable, using in-memory", zap.Error(err))
		} else {
			log.Info("rate limiter: redis")
			return &Manager{limiter: rl, log: log, failClosed: failClosed}, nil
		}
	} else if failClosed {
		return nil, fmt.Errorf("ratelimit: REDIS_URL is required when failClosed=true")
	}
	return &Manager{limiter: newMemoryLimiter(ctx), log: log, failClosed: failClosed}, nil
}

// PerUser returns middleware enforcing `limit` requests per minute for the
// route group, keyed by authenticated user (falling back to remote address).
func (m *Manager) PerUser(group string, limit int) func(http.Handler) http.Handler {
	return m.PerUserWindow(group, limit, time.Minute)
}

// PerUserWindow returns middleware enforcing limit requests per window.
func (m *Manager) PerUserWindow(group string, limit int, window time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := group + ":" + subject(r)
			allowed, retryAfter, err := m.limiter.Allow(r.Context(), key, limit, window)
			if err != nil {
				if m.failClosed {
					m.log.Error("rate limiter error, denying", zap.Error(err))
					w.Header().Set("Retry-After", "5")
					httpx.Error(w, http.StatusServiceUnavailable, "rate limiter unavailable", "rate_limiter_unavailable")
					return
				}
				m.log.Warn("rate limiter error, allowing in non-production", zap.Error(err))
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
	// RemoteAddr is "IP:port"; the ephemeral source port changes per TCP
	// connection, so key on the host portion only to avoid a per-connection
	// bucket that defeats the limit. Fall back to the raw value if it lacks a
	// parseable host:port form.
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	return "ip:" + host
}
