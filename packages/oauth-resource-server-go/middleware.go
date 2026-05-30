package oauthrs

import (
	"context"
	"net/http"
	"strings"
)

type claimsCtxKey struct{}

// WithClaims attaches verified claims to a context.
func WithClaims(ctx context.Context, c *Claims) context.Context {
	return context.WithValue(ctx, claimsCtxKey{}, c)
}

// ClaimsFromContext returns the verified claims attached by Require.
func ClaimsFromContext(ctx context.Context) (*Claims, bool) {
	c, ok := ctx.Value(claimsCtxKey{}).(*Claims)
	return c, ok && c != nil
}

// Require is net/http middleware that extracts the bearer token, verifies it,
// and attaches the resulting Claims to the request context. It responds 401
// (with a {error, code} JSON envelope) on any failure.
func (v *Verifier) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw := BearerToken(r)
		if raw == "" {
			writeError(w, http.StatusUnauthorized, "missing bearer token", "unauthorized")
			return
		}
		claims, err := v.Verify(raw)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "invalid or expired token", "unauthorized")
			return
		}
		next.ServeHTTP(w, r.WithContext(WithClaims(r.Context(), claims)))
	})
}

// RequireScopes is middleware that enforces the caller holds every named scope.
// It must be mounted after Require. Responds 403 on missing scope.
func RequireScopes(scopes ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			c, ok := ClaimsFromContext(r.Context())
			if !ok {
				writeError(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
				return
			}
			if !c.HasAllScopes(scopes...) {
				writeError(w, http.StatusForbidden, "insufficient scope", "insufficient_scope")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// BearerToken extracts the token from an "Authorization: Bearer <token>"
// header, returning "" if absent or malformed.
func BearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if h == "" {
		return ""
	}
	const prefix = "Bearer "
	if len(h) > len(prefix) && strings.EqualFold(h[:len(prefix)], prefix) {
		return strings.TrimSpace(h[len(prefix):])
	}
	return ""
}

func writeError(w http.ResponseWriter, status int, msg, code string) {
	w.Header().Set("Content-Type", "application/json")
	if status == http.StatusUnauthorized {
		w.Header().Set("WWW-Authenticate", "Bearer")
	}
	w.WriteHeader(status)
	_, _ = w.Write([]byte(`{"error":"` + msg + `","code":"` + code + `"}`))
}
