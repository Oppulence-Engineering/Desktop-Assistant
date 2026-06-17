package auth

import (
	"context"
	"net/http"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"go.uber.org/zap"
)

// Authorization middleware (RFC 011 "Authorization middleware"). Authentication
// (RequireJWT / RequireInternalSecret) proves who the caller is and attaches an
// Actor; these helpers prove the caller may do this specific thing. They are
// mounted AFTER an authentication middleware and fail closed: no Actor in
// context → 401; policy not satisfied → 403. High-risk checks are explicit and
// auditable (every denial emits auth.authz.denied) rather than a generic
// admin=true branch.

// EntitlementChecker reports whether an actor is entitled to a named product
// capability (e.g. "llm", "voice"). It is supplied by the billing/entitlement
// layer via Middleware.SetEntitlements; when unset, RequireEntitlement fails
// closed.
type EntitlementChecker func(ctx context.Context, a *Actor, name string) (bool, error)

// StepUpLevel encodes the recency/assurance a sensitive action requires
// (RFC 011 step-up policy). Levels are policy, not UI convention.
type StepUpLevel string

const (
	// StepUpSession requires a current, valid session (any accepted user token
	// satisfies this).
	StepUpSession StepUpLevel = "session"
	// StepUpRecentAuth requires the human to have authenticated within the
	// configured recent-auth window (e.g. 10–15 minutes).
	StepUpRecentAuth StepUpLevel = "recent_auth"
	// StepUpMFA requires the token to assert a multi-factor authentication
	// method reference.
	StepUpMFA StepUpLevel = "mfa"
)

// actorOr401 returns the request actor or writes a 401 and returns false.
func actorOr401(w http.ResponseWriter, r *http.Request) (*Actor, bool) {
	a, ok := ActorFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return nil, false
	}
	return a, true
}

// deny writes a 403 (or supplied status) and records the authorization denial.
func (m *Middleware) deny(w http.ResponseWriter, r *http.Request, status int, msg, code, policy string) {
	m.audit.AuthzDenied(r.Context(), policy, RouteGroup(r.URL.Path))
	httpx.Error(w, status, msg, code)
}

// RequireUser admits only human user actors.
func (m *Middleware) RequireUser() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			a, ok := actorOr401(w, r)
			if !ok {
				return
			}
			if a.Kind != KindUser {
				m.deny(w, r, http.StatusForbidden, "user identity required", "user_required", "require_user")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireOrg admits user actors that have an organization selected. Routes that
// touch tenant data should mount this once orgs are enabled (RFC 011 org
// mapping): a token without an org claim is admitted only to org-free routes.
func (m *Middleware) RequireOrg() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			a, ok := actorOr401(w, r)
			if !ok {
				return
			}
			if a.WorkOSOrgID == "" && a.OrganizationID == nil {
				m.deny(w, r, http.StatusForbidden, "organization selection required", "org_required", "require_org")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireServiceScope admits only service actors holding the named scope
// (RFC 011 service token). Service tokens are short-lived and scoped.
func (m *Middleware) RequireServiceScope(scope string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			a, ok := actorOr401(w, r)
			if !ok {
				return
			}
			if a.Kind != KindService || !a.HasScope(scope) {
				m.deny(w, r, http.StatusForbidden, "service scope required", "insufficient_scope", "require_service_scope")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireConnectorScope admits only broker-minted connector resource actors
// holding the named product scope (deferred broker mode; see RFC 012).
func (m *Middleware) RequireConnectorScope(scope string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			a, ok := actorOr401(w, r)
			if !ok {
				return
			}
			if a.Kind != KindConnectorResource || !a.HasScope(scope) {
				m.deny(w, r, http.StatusForbidden, "connector scope required", "insufficient_scope", "require_connector_scope")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequirePermission admits actors holding the named WorkOS permission.
func (m *Middleware) RequirePermission(permission string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			a, ok := actorOr401(w, r)
			if !ok {
				return
			}
			if !a.HasPermission(permission) {
				m.deny(w, r, http.StatusForbidden, "missing required permission", "forbidden", "require_permission")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireEntitlement admits actors entitled to a named product capability. It
// fails closed (503) when no entitlement checker is configured rather than
// silently allowing the call.
func (m *Middleware) RequireEntitlement(name string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			a, ok := actorOr401(w, r)
			if !ok {
				return
			}
			if m.entitlements == nil {
				m.deny(w, r, http.StatusServiceUnavailable, "entitlements unavailable", "entitlements_unavailable", "require_entitlement")
				return
			}
			allowed, err := m.entitlements(r.Context(), a, name)
			if err != nil {
				m.log.Error("entitlement check failed", zap.Error(err))
				m.deny(w, r, http.StatusServiceUnavailable, "entitlement check failed", "entitlements_unavailable", "require_entitlement")
				return
			}
			if !allowed {
				m.deny(w, r, http.StatusForbidden, "not entitled to "+name, "entitlement_required", "require_entitlement")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireStepUp enforces the recency/assurance a sensitive action requires.
// Step-up is policy, not UI: a denial returns 403 step_up_required with the
// required level so the client can trigger re-authentication.
func (m *Middleware) RequireStepUp(level StepUpLevel) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			a, ok := actorOr401(w, r)
			if !ok {
				return
			}
			if m.satisfiesStepUp(a, level) {
				next.ServeHTTP(w, r)
				return
			}
			m.audit.AuthzDenied(r.Context(), "require_step_up", RouteGroup(r.URL.Path))
			httpx.ErrorWith(w, http.StatusForbidden, "step-up authentication required", "step_up_required",
				map[string]any{"stepUpRequired": string(level)})
		})
	}
}

// satisfiesStepUp reports whether the actor meets the step-up level. Recent-auth
// and MFA fail closed when the token does not assert the needed claim.
func (m *Middleware) satisfiesStepUp(a *Actor, level StepUpLevel) bool {
	switch level {
	case StepUpSession:
		// A current, valid user token already proves a live session.
		return a.Kind == KindUser
	case StepUpRecentAuth:
		if a.AuthTime == 0 {
			return false
		}
		window := m.stepUpWindow
		if window <= 0 {
			window = 15 * time.Minute
		}
		authedAt := time.Unix(a.AuthTime, 0)
		return time.Since(authedAt) <= window
	case StepUpMFA:
		return a.HasMFA()
	default:
		return false
	}
}
