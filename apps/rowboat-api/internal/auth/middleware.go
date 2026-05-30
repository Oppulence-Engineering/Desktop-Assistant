package auth

import (
	"net/http"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	oauthrs "github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go"
	"go.uber.org/zap"
)

// Middleware verifies Ory/WorkOS JWTs and resolves the local user.
type Middleware struct {
	verifier        *oauthrs.Verifier
	client          *ent.Client
	enricher        Enricher
	freeTierCredits int
	log             *zap.Logger
}

// NewMiddleware builds the auth middleware. A nil enricher defaults to noop.
func NewMiddleware(verifier *oauthrs.Verifier, client *ent.Client, enricher Enricher, freeTierCredits int, log *zap.Logger) *Middleware {
	if enricher == nil {
		enricher = NoopEnricher{}
	}
	return &Middleware{
		verifier:        verifier,
		client:          client,
		enricher:        enricher,
		freeTierCredits: freeTierCredits,
		log:             log,
	}
}

// RequireJWT verifies the bearer token, upserts the local user, and attaches
// both the *ent.User and the raw oauthrs.Claims (for scope checks) to the
// request context. Mounted globally except on /v1/config and /oauth-hooks/*.
func (m *Middleware) RequireJWT(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if m.verifier == nil {
			// No JWKS reachable at boot (e.g. local dev without an IdP). Fail
			// closed on authed routes rather than accepting unverified tokens.
			httpx.Error(w, http.StatusServiceUnavailable, "authentication unavailable", "auth_unavailable")
			return
		}
		raw := oauthrs.BearerToken(r)
		if raw == "" {
			httpx.Error(w, http.StatusUnauthorized, "missing bearer token", "unauthorized")
			return
		}
		claims, err := m.verifier.Verify(raw)
		if err != nil {
			m.log.Debug("token verification failed", zap.Error(err))
			httpx.Error(w, http.StatusUnauthorized, "invalid or expired token", "unauthorized")
			return
		}
		u, err := m.ResolveUser(r.Context(), claims)
		if err != nil {
			m.log.Error("identity resolution failed", zap.Error(err))
			httpx.Error(w, http.StatusInternalServerError, "identity resolution failed", "internal_error")
			return
		}

		ctx := WithUser(r.Context(), u)
		ctx = oauthrs.WithClaims(ctx, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
