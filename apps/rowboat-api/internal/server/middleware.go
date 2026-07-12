package server

import (
	"context"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
)

// RealIPFromTrustedProxies rewrites r.RemoteAddr to the real client IP from
// X-Forwarded-For, but ONLY when the direct peer is inside a trusted-proxy
// CIDR. chi's stock middleware.RealIP trusts the header unconditionally (any
// client could spoof its own identity), so it is deliberately not used.
//
// Without this, every request behind the ingress shares the ingress pod's
// RemoteAddr, which collapses all users of the PRE-AUTH rate-limit buckets
// (sign-in, OAuth front door) into one bucket: legitimate aggregate traffic
// trips the limit for everyone, and one attacker can lock all users out of
// sign-in. Authenticated buckets are unaffected (keyed by user id).
//
// The algorithm walks X-Forwarded-For right-to-left, skipping trusted hops;
// the first untrusted address is the client (entries further left are
// client-supplied and forgeable). With no trusted CIDRs configured this is a
// no-op.
func RealIPFromTrustedProxies(cidrs []string) func(http.Handler) http.Handler {
	prefixes := make([]netip.Prefix, 0, len(cidrs))
	for _, c := range cidrs {
		if p, err := netip.ParsePrefix(strings.TrimSpace(c)); err == nil {
			prefixes = append(prefixes, p)
		}
	}
	trusted := func(addr string) bool {
		ip, err := netip.ParseAddr(addr)
		if err != nil {
			return false
		}
		ip = ip.Unmap()
		for _, p := range prefixes {
			if p.Contains(ip) {
				return true
			}
		}
		return false
	}
	return func(next http.Handler) http.Handler {
		if len(prefixes) == 0 {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			peer, _, err := net.SplitHostPort(r.RemoteAddr)
			if err == nil && trusted(peer) {
				if client := clientIPFromXFF(r.Header.Get("X-Forwarded-For"), trusted); client != "" {
					r.RemoteAddr = net.JoinHostPort(client, "0")
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// clientIPFromXFF returns the rightmost untrusted address in an
// X-Forwarded-For chain, or "" when none parses.
func clientIPFromXFF(xff string, trusted func(string) bool) string {
	if xff == "" {
		return ""
	}
	parts := strings.Split(xff, ",")
	for i := len(parts) - 1; i >= 0; i-- {
		addr := strings.TrimSpace(parts[i])
		if _, err := netip.ParseAddr(addr); err != nil {
			return ""
		}
		if !trusted(addr) {
			return addr
		}
	}
	// Every hop was trusted: the leftmost entry is the origin.
	return strings.TrimSpace(parts[0])
}

// RequestContext exposes request context to response-only helpers.
func RequestContext(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(httpx.WithRequestContext(w, r), r)
	})
}

// SecurityHeaders applies conservative browser-facing defaults to all routes.
func SecurityHeaders(cfg appconfig.Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Referrer-Policy", "no-referrer")
			h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
			if cfg.IsProduction() {
				h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
			}
			next.ServeHTTP(w, r)
		})
	}
}

// CORS permits only configured origins. Requests without Origin are not CORS
// requests and are left alone.
func CORS(cfg appconfig.Config) func(http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(cfg.CORSOrigins))
	for _, origin := range cfg.CORSOrigins {
		allowed[origin] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" {
				w.Header().Add("Vary", "Origin")
				w.Header().Add("Vary", "Access-Control-Request-Method")
				w.Header().Add("Vary", "Access-Control-Request-Headers")
				if _, ok := allowed[origin]; ok {
					h := w.Header()
					h.Set("Access-Control-Allow-Origin", origin)
					h.Set("Access-Control-Allow-Credentials", "true")
					h.Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
					h.Set("Access-Control-Allow-Headers", "Authorization,Content-Type,Idempotency-Key,X-Hook-Signature,X-Webhook-Signature,X-Webhook-Timestamp,X-Internal-Secret")
					h.Set("Access-Control-Max-Age", "600")
				} else if r.Method == http.MethodOptions {
					httpx.Error(w, http.StatusForbidden, "origin is not allowed", "cors_forbidden")
					return
				}
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequestTimeout attaches a timeout context to non-streaming request handlers.
func RequestTimeout(timeout time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if timeout <= 0 || skipRequestTimeout(r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), timeout)
			defer cancel()
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func skipRequestTimeout(path string) bool {
	return strings.HasPrefix(path, "/v1/llm/") ||
		strings.HasSuffix(path, "/events") ||
		strings.HasSuffix(path, "/events/stream")
}

// MaxRequestBody caps inbound request bodies before handlers read them.
func MaxRequestBody(limit int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if limit > 0 && r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, limit)
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireJSONContentType enforces JSON request bodies for mutating API routes.
func RequireJSONContentType(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if methodWithBody(r.Method) && !skipJSONContentType(r.URL.Path) {
			ct := r.Header.Get("Content-Type")
			if ct == "" && r.ContentLength != 0 {
				httpx.Error(w, http.StatusUnsupportedMediaType, "Content-Type must be application/json", "unsupported_media_type")
				return
			}
			if ct != "" && !httpx.JSONContentType(ct) {
				httpx.Error(w, http.StatusUnsupportedMediaType, "Content-Type must be application/json", "unsupported_media_type")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func methodWithBody(method string) bool {
	return method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch
}

func skipJSONContentType(path string) bool {
	// Slack interactive components are signed by Slack and arrive as
	// application/x-www-form-urlencoded (payload=<JSON>), not JSON. Keep the
	// exception exact so every other mutating API route retains the JSON guard.
	return path == "/v1/agent-channels/slack/interactivity"
}

// NoCache marks authenticated, internal, OAuth, and GraphQL surfaces as
// non-cacheable by browsers and intermediaries.
func NoCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if sensitivePath(r.URL.Path) {
			h := w.Header()
			h.Set("Cache-Control", "no-store")
			h.Set("Pragma", "no-cache")
			h.Set("Expires", "0")
		}
		next.ServeHTTP(w, r)
	})
}

func sensitivePath(path string) bool {
	// /v1/config is public, unauthenticated, and deliberately cacheable (its
	// handler sets Cache-Control: public, max-age=300); stamping Pragma/Expires
	// no-cache headers on it here would contradict that.
	if path == "/v1/config" {
		return false
	}
	return strings.HasPrefix(path, "/v1/") ||
		strings.HasPrefix(path, "/oauth/") ||
		path == "/graphql"
}
