package auth

import (
	"net/http"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	oauthrs "github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go"
	"go.uber.org/zap"
)

// defaultStepUpWindow is the recent-auth window used when none is configured.
const defaultStepUpWindow = 15 * time.Minute

// Middleware verifies Ory/WorkOS JWTs, resolves the local user, and is the
// single place a public bearer token becomes an Actor (RFC 011). It also hosts
// the authorization policy helpers (policy.go) that read that Actor.
type Middleware struct {
	verifier        *oauthrs.Verifier
	client          *ent.Client
	enricher        Enricher
	freeTierCredits int
	log             *zap.Logger

	// RFC 011 identity/authorization plane.
	audit        *Audit
	issuers      IssuerPolicy
	stepUpWindow time.Duration
	entitlements EntitlementChecker
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
		audit:           NewAudit(log),
		stepUpWindow:    defaultStepUpWindow,
	}
}

// SetIssuerPolicy configures the issuer→type/kind classification used to label
// audit events and to derive the actor kind (RFC 011). Without it, every issuer
// classifies as "unknown" and tokens resolve to user actors.
func (m *Middleware) SetIssuerPolicy(p IssuerPolicy) { m.issuers = p }

// SetStepUpWindow configures the recent-auth window for RequireStepUp.
func (m *Middleware) SetStepUpWindow(d time.Duration) {
	if d > 0 {
		m.stepUpWindow = d
	}
}

// SetEntitlements installs the entitlement checker for RequireEntitlement.
func (m *Middleware) SetEntitlements(c EntitlementChecker) { m.entitlements = c }

// RequireJWT verifies the bearer token, upserts the local user, and attaches
// the *ent.User, the raw oauthrs.Claims (for scope checks), and the resolved
// Actor (RFC 011) to the request context. It emits auth.token.accepted /
// auth.token.rejected audit events with bounded labels. Validation fails closed:
// no route ever gets a best-effort actor from an invalid token. Mounted globally
// except on /v1/config and /oauth-hooks/*.
func (m *Middleware) RequireJWT(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		routeGroup := RouteGroup(r.URL.Path)
		if m.verifier == nil {
			// No JWKS reachable at boot (e.g. local dev without an IdP). Fail
			// closed on authed routes rather than accepting unverified tokens.
			m.audit.TokenRejected(r.Context(), IssuerTypeUnknown, m.issuers.WorkOSIssuer, routeGroup, ReasonUnavailable)
			httpx.Error(w, http.StatusServiceUnavailable, "authentication unavailable", "auth_unavailable")
			return
		}
		raw := oauthrs.BearerToken(r)
		if raw == "" {
			m.audit.TokenRejected(r.Context(), IssuerTypeUnknown, m.issuers.WorkOSIssuer, routeGroup, ReasonMissingToken)
			httpx.Error(w, http.StatusUnauthorized, "missing bearer token", "unauthorized")
			return
		}
		claims, err := m.verifier.Verify(raw)
		if err != nil {
			// Classify the issuer best-effort from the UNVERIFIED token only to
			// label the rejection metric; the token itself is already rejected.
			issuerType := m.issuers.IssuerType(unverifiedIssuer(raw))
			m.audit.TokenRejected(r.Context(), issuerType, m.issuers.WorkOSIssuer, routeGroup, classifyRejection(err))
			m.log.Debug("token verification failed", zap.Error(err))
			httpx.Error(w, http.StatusUnauthorized, "invalid or expired token", "unauthorized")
			return
		}
		u, err := m.ResolveUser(r.Context(), claims)
		if err != nil {
			m.audit.TokenRejected(r.Context(), m.issuers.IssuerType(claims.Issuer), m.issuers.WorkOSIssuer, routeGroup, ReasonResolveFailed)
			m.log.Error("identity resolution failed", zap.Error(err))
			httpx.Error(w, http.StatusInternalServerError, "identity resolution failed", "internal_error")
			return
		}

		actor := ActorFromUser(u, claims)
		ctx := WithUser(r.Context(), u)
		ctx = oauthrs.WithClaims(ctx, claims)
		ctx = WithActor(ctx, actor)
		httpx.SetLogUserID(ctx, u.ID.String()) // enrich the access log (RFC 010)

		audience := m.issuers.WorkOSIssuer
		if len(claims.Audience) > 0 {
			audience = claims.Audience[0]
		}
		m.audit.TokenAccepted(ctx, m.issuers.IssuerType(claims.Issuer), audience, routeGroup)

		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
