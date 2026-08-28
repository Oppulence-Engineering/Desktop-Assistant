package oauthrs

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
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
			writeAuthorizationError(w, authorizationError(CodeTokenMissing, http.StatusUnauthorized, "missing bearer token", nil))
			return
		}
		claims, err := v.Verify(raw)
		if err != nil {
			if authErr, ok := err.(*AuthorizationError); ok {
				writeAuthorizationError(w, authErr)
			} else {
				writeAuthorizationError(w, classifyTokenError(err))
			}
			return
		}
		next.ServeHTTP(w, r.WithContext(WithClaims(r.Context(), claims)))
	})
}

// RequireScopes is middleware that enforces the caller holds every named scope.
// It must be mounted after Require. Responds 403 on missing scope.
func RequireAllScopes(scopes ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			c, ok := ClaimsFromContext(r.Context())
			if !ok {
				writeAuthorizationError(w, authorizationError(CodeTokenMissing, http.StatusUnauthorized, "missing bearer token", nil))
				return
			}
			if !c.HasAllScopes(scopes...) {
				writeAuthorizationError(w, authorizationError(CodeScopeMissing, http.StatusForbidden, "required scope missing", nil))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireScopes is a backward-compatible alias for RequireAllScopes.
func RequireScopes(scopes ...string) func(http.Handler) http.Handler {
	return RequireAllScopes(scopes...)
}

// RequireAnyScope enforces that the caller holds at least one named scope.
func RequireAnyScope(scopes ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			c, ok := ClaimsFromContext(r.Context())
			if !ok {
				writeAuthorizationError(w, authorizationError(CodeTokenMissing, http.StatusUnauthorized, "missing bearer token", nil))
				return
			}
			if len(scopes) == 0 || !c.HasAnyScope(scopes...) {
				writeAuthorizationError(w, authorizationError(CodeScopeMissing, http.StatusForbidden, "required scope missing", nil))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ConnectionStatusValidator performs online revocation/status checks.
// It returns true only for an active connection. Errors deny access.
type ConnectionStatusValidator func(context.Context, *Claims) (bool, error)

// ConnectionValidationMode selects the RFC 012 connection-status policy.
// The zero value is ConnectionValidationLive so production use fails closed.
type ConnectionValidationMode string

const (
	// ConnectionValidationLive requires an online status check on every request.
	ConnectionValidationLive ConnectionValidationMode = "live"
	// ConnectionValidationOfflineDevelopment is an explicit development-only
	// escape hatch that accepts only tokens with a tightly bounded issued TTL.
	ConnectionValidationOfflineDevelopment ConnectionValidationMode = "offline-development"

	// MaxOfflineDevelopmentTokenTTL is the largest token TTL accepted by the
	// explicit offline-development connection policy.
	MaxOfflineDevelopmentTokenTTL = 5 * time.Minute
)

// ApprovalValidator validates or introspects a per-invocation approval token.
// It receives the full request so action/resource details can be matched.
type ApprovalValidator func(*http.Request, string, *Claims) (bool, error)

// MCPTokenOptions composes RFC 012 authorization checks. RequiredScopes are
// all-of. AnyScopes are any-of. A configured ApprovalValidator makes
// X-Approval-Token mandatory.
type MCPTokenOptions struct {
	Audience                 string
	RequiredScopes           []string
	AnyScopes                []string
	ConnectionValidationMode ConnectionValidationMode
	ConnectionValidator      ConnectionStatusValidator
	OfflineMaxTokenTTL       time.Duration
	ApprovalValidator        ApprovalValidator
}

// RequireMCPToken verifies the bearer token, applies scope checks, validates
// connection status, and optionally validates X-Approval-Token. Live validation
// is the default and denies every request when ConnectionValidator is absent or
// fails. Offline development must be selected explicitly and requires an issued
// token TTL no larger than both OfflineMaxTokenTTL and five minutes.
func (v *Verifier) RequireMCPToken(opts MCPTokenOptions) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		h := next
		if opts.ApprovalValidator != nil {
			h = requireApproval(opts.ApprovalValidator)(h)
		}
		h = requireConnectionPolicy(opts)(h)
		if len(opts.AnyScopes) > 0 {
			h = RequireAnyScope(opts.AnyScopes...)(h)
		}
		if len(opts.RequiredScopes) > 0 {
			h = RequireAllScopes(opts.RequiredScopes...)(h)
		}
		if opts.Audience != "" {
			h = requireAudience(opts.Audience)(h)
		}
		return v.Require(h)
	}
}

func requireConnectionPolicy(opts MCPTokenOptions) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			c, ok := ClaimsFromContext(r.Context())
			if !ok {
				writeAuthorizationError(w, authorizationError(CodeTokenMissing, http.StatusUnauthorized, "missing bearer token", nil))
				return
			}

			mode := opts.ConnectionValidationMode
			if mode == "" {
				mode = ConnectionValidationLive
			}
			switch mode {
			case ConnectionValidationLive:
				if opts.ConnectionValidator == nil {
					writeAuthorizationError(w, authorizationError(CodeConnectionRevoked, http.StatusForbidden, "active connection validation required", nil))
					return
				}
				active, err := opts.ConnectionValidator(r.Context(), c)
				if err != nil || !active {
					writeAuthorizationError(w, authorizationError(CodeConnectionRevoked, http.StatusForbidden, "connection revoked", err))
					return
				}
			case ConnectionValidationOfflineDevelopment:
				maxTTL := opts.OfflineMaxTokenTTL
				issuedTTL := c.Expiry.Sub(c.IssuedAt)
				if maxTTL <= 0 || maxTTL > MaxOfflineDevelopmentTokenTTL || c.IssuedAt.IsZero() || !c.Expiry.After(c.IssuedAt) || issuedTTL > maxTTL {
					writeAuthorizationError(w, authorizationError(CodeConnectionRevoked, http.StatusForbidden, "offline development token policy denied", nil))
					return
				}
			default:
				writeAuthorizationError(w, authorizationError(CodeConnectionRevoked, http.StatusForbidden, "active connection validation required", nil))
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func requireAudience(audience string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			c, ok := ClaimsFromContext(r.Context())
			if !ok {
				writeAuthorizationError(w, authorizationError(CodeTokenMissing, http.StatusUnauthorized, "missing bearer token", nil))
				return
			}
			matched := false
			for _, actual := range c.Audience {
				if actual == audience {
					matched = true
					break
				}
			}
			if !matched {
				writeAuthorizationError(w, authorizationError(CodeAudienceMismatch, http.StatusUnauthorized, "token audience mismatch", nil))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func requireApproval(validate ApprovalValidator) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			c, ok := ClaimsFromContext(r.Context())
			if !ok {
				writeAuthorizationError(w, authorizationError(CodeTokenMissing, http.StatusUnauthorized, "missing bearer token", nil))
				return
			}
			token := strings.TrimSpace(r.Header.Get("X-Approval-Token"))
			if token == "" {
				writeAuthorizationError(w, authorizationError(CodeApprovalRequired, http.StatusPreconditionRequired, "approval required", nil))
				return
			}
			valid, err := validate(r, token, c)
			if err != nil || !valid {
				writeAuthorizationError(w, authorizationError(CodeApprovalRequired, http.StatusPreconditionRequired, "approval required", err))
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

func writeAuthorizationError(w http.ResponseWriter, err *AuthorizationError) {
	w.Header().Set("Content-Type", "application/json")
	if err.Status == http.StatusUnauthorized {
		w.Header().Set("WWW-Authenticate", "Bearer")
	}
	w.WriteHeader(err.Status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Message, "code": string(err.Code)})
}
