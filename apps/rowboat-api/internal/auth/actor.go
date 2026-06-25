package auth

import (
	"context"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	oauthrs "github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go"
	"github.com/google/uuid"
)

// ActorKind enumerates the trust principals rowboat-api authorizes (RFC 011).
// Every authenticated request resolves to exactly one Actor of one kind; route
// handlers read the Actor instead of parsing raw JWT claims.
type ActorKind string

const (
	// KindUser is a human WorkOS identity (WorkOS-direct mode, current prod).
	KindUser ActorKind = "user"
	// KindService is a first-party backend identity carrying a signed service
	// token (deferred: minted only when connector volume grows; see RFC 011).
	KindService ActorKind = "service"
	// KindConnectorResource is a broker-minted, audience-bound resource token
	// for a product MCP/API (deferred broker mode; see RFC 012).
	KindConnectorResource ActorKind = "connector_resource"
	// KindWidget is a hosted-platform widget session (deferred; see RFC 015).
	KindWidget ActorKind = "widget"
	// KindInternal is a trusted process entrypoint authenticated by the shared
	// internal secret / webhook HMAC. It is NOT derived from a public token and
	// is installed only after local service authentication succeeds (RFC 011).
	KindInternal ActorKind = "internal"
)

// Actor is the single resolved identity for an authenticated request (RFC 011
// "Actor extraction"). Handlers and policy helpers read this rather than the
// raw token so that authorization is uniform across token modes.
type Actor struct {
	Kind ActorKind

	// UserID is the local rowboat-api user UUID. Never exposed as a
	// cross-product identifier. Zero for non-user actors.
	UserID uuid.UUID
	// WorkOSUserID is the canonical human identity (WorkOS user id).
	WorkOSUserID string

	// OrganizationID is the local organization UUID when a local org mapping
	// exists. Nil until org entities are modeled (future); WorkOSOrgID is the
	// canonical source meanwhile.
	OrganizationID *uuid.UUID
	// WorkOSOrgID is the WorkOS organization id when the token carries one.
	WorkOSOrgID string

	// ServiceName identifies a service actor (e.g. "service:scheduler").
	ServiceName string

	// Scopes and Permissions are authorization grants carried by the token.
	// Scopes come from the OAuth `scope`/`scp` claim; Permissions from the
	// WorkOS `permissions` claim.
	Scopes      []string
	Permissions []string

	// TokenIssuer is the verified `iss`. TokenID is the `jti` when present
	// (used for local emergency revocation lists; RFC 011 revocation).
	TokenIssuer string
	TokenID     string

	// AuthTime is the WorkOS `auth_time` (seconds) when present: the moment the
	// human last authenticated, used by step-up recent-auth checks. Zero means
	// the token did not assert one.
	AuthTime int64
	// AuthMethods is the `amr` claim (authentication method references) when
	// present, used by MFA step-up checks.
	AuthMethods []string
}

// mfaMethods are the `amr` values that count as a multi-factor authentication.
var mfaMethods = map[string]bool{
	"mfa": true, "otp": true, "totp": true, "sms": true, "hwk": true,
	"swk": true, "pop": true, "webauthn": true, "fido": true, "u2f": true,
}

// HasMFA reports whether the token asserted a multi-factor authentication
// method reference.
func (a *Actor) HasMFA() bool {
	for _, m := range a.AuthMethods {
		if mfaMethods[m] {
			return true
		}
	}
	return false
}

// HasScope reports whether the actor was granted the given scope.
func (a *Actor) HasScope(scope string) bool {
	for _, s := range a.Scopes {
		if s == scope {
			return true
		}
	}
	return false
}

// HasPermission reports whether the actor holds the given permission.
func (a *Actor) HasPermission(p string) bool {
	for _, have := range a.Permissions {
		if have == p {
			return true
		}
	}
	return false
}

// IssuerPolicy maps configured token issuers to their bounded issuer type so
// audit events and metrics can label by issuer type without leaking the raw
// issuer string. The zero value classifies every issuer as "unknown".
type IssuerPolicy struct {
	// WorkOSIssuer is the human-identity issuer (WorkOS AuthKit / custom domain).
	WorkOSIssuer string
	// ServiceIssuer mints first-party service tokens (RFC 011 service token).
	ServiceIssuer string
	// BrokerIssuer mints connector resource tokens (deferred broker mode).
	BrokerIssuer string
}

// Bounded issuer-type labels. Never label metrics by the raw issuer string.
const (
	IssuerTypeWorkOS  = "workos"
	IssuerTypeService = "service"
	IssuerTypeBroker  = "broker"
	IssuerTypeUnknown = "unknown"
)

// IssuerType classifies a raw `iss` value into a bounded label. An empty
// configured issuer never matches, so a misconfiguration classifies as unknown
// rather than silently mislabeling.
func (p IssuerPolicy) IssuerType(iss string) string {
	switch {
	case iss == "":
		return IssuerTypeUnknown
	case p.WorkOSIssuer != "" && iss == p.WorkOSIssuer:
		return IssuerTypeWorkOS
	case p.ServiceIssuer != "" && iss == p.ServiceIssuer:
		return IssuerTypeService
	case p.BrokerIssuer != "" && iss == p.BrokerIssuer:
		return IssuerTypeBroker
	default:
		return IssuerTypeUnknown
	}
}

// Kind maps a token's issuer to the actor kind it produces. Unknown/WorkOS
// issuers resolve to a user actor (the WorkOS-direct surface); service and
// broker issuers resolve to their respective kinds for the deferred modes.
func (p IssuerPolicy) Kind(iss string) ActorKind {
	switch p.IssuerType(iss) {
	case IssuerTypeService:
		return KindService
	case IssuerTypeBroker:
		return KindConnectorResource
	default:
		return KindUser
	}
}

// ActorFromUser builds a user Actor from a resolved local user and the verified
// claims. This is the WorkOS-direct path: the actor kind is always user.
func ActorFromUser(u *ent.User, c *oauthrs.Claims) *Actor {
	a := &Actor{
		Kind:         KindUser,
		UserID:       u.ID,
		WorkOSUserID: u.WorkosUserID,
		WorkOSOrgID:  u.WorkosOrgID,
	}
	if c != nil {
		a.WorkOSOrgID = firstNonEmpty(c.WorkOSOrgID, u.WorkosOrgID)
		a.Scopes = c.Scopes
		a.Permissions = permissionsFromClaims(c)
		a.TokenIssuer = c.Issuer
		a.TokenID = rawString(c, "jti")
		a.AuthTime = rawInt64(c, "auth_time")
		a.AuthMethods = rawStringSlice(c, "amr")
	}
	return a
}

// rawStringSlice returns a claim that is a JSON array of strings (or a single
// string) from the raw set, or nil.
func rawStringSlice(c *oauthrs.Claims, key string) []string {
	if c == nil || c.Raw == nil {
		return nil
	}
	switch v := c.Raw[key].(type) {
	case []any:
		out := make([]string, 0, len(v))
		for _, e := range v {
			if s, ok := e.(string); ok && s != "" {
				out = append(out, s)
			}
		}
		if len(out) == 0 {
			return nil
		}
		return out
	case string:
		if v == "" {
			return nil
		}
		return []string{v}
	default:
		return nil
	}
}

// permissionsFromClaims extracts the WorkOS `permissions` claim (array of
// strings) from the raw claim set, returning nil when absent.
func permissionsFromClaims(c *oauthrs.Claims) []string {
	if c == nil || c.Raw == nil {
		return nil
	}
	arr, ok := c.Raw["permissions"].([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, v := range arr {
		if s, ok := v.(string); ok && s != "" {
			out = append(out, s)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// rawString returns a top-level string claim from the raw set, or "".
func rawString(c *oauthrs.Claims, key string) string {
	if c == nil || c.Raw == nil {
		return ""
	}
	s, _ := c.Raw[key].(string)
	return s
}

// rawInt64 returns a numeric claim (JSON numbers decode to float64) as int64.
func rawInt64(c *oauthrs.Claims, key string) int64 {
	if c == nil || c.Raw == nil {
		return 0
	}
	switch v := c.Raw[key].(type) {
	case float64:
		return int64(v)
	case int64:
		return v
	case int:
		return int64(v)
	default:
		return 0
	}
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

type actorKey struct{}

// WithActor returns a context carrying the resolved actor.
func WithActor(ctx context.Context, a *Actor) context.Context {
	return context.WithValue(ctx, actorKey{}, a)
}

// ActorFromCtx returns the resolved actor, if any.
func ActorFromCtx(ctx context.Context) (*Actor, bool) {
	a, ok := ctx.Value(actorKey{}).(*Actor)
	return a, ok && a != nil
}
