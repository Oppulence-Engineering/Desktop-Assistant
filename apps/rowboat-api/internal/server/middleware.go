package server

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
)

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
					h.Set("Access-Control-Allow-Headers", "Authorization,Content-Type,Idempotency-Key,X-Hook-Signature,X-Internal-Secret")
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
		strings.HasPrefix(path, "/v1/composio/") ||
		strings.HasSuffix(path, "/events")
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
	return strings.HasPrefix(path, "/v1/composio/")
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
	return strings.HasPrefix(path, "/v1/") ||
		strings.HasPrefix(path, "/oauth/") ||
		path == "/graphql"
}
