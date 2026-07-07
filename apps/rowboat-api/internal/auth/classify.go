package auth

import (
	"errors"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

// Bounded token-rejection reasons (RFC 011 Observability: metrics may label by
// rejection reason only from this fixed allowlist — never by the raw error or a
// user/issuer identifier).
const (
	ReasonMissingToken     = "missing_token"
	ReasonMalformed        = "malformed"
	ReasonExpired          = "expired"
	ReasonNotYetValid      = "not_yet_valid"
	ReasonBadIssuer        = "bad_issuer"
	ReasonBadAudience      = "bad_audience"
	ReasonInvalidSignature = "invalid_signature"
	ReasonMissingClaim     = "missing_claim"
	// ReasonUnverifiable covers a JWKS/keyfunc failure, including an unknown
	// `kid` after an on-demand refresh miss.
	ReasonUnverifiable = "unverifiable"
	// ReasonUnavailable is used when the verifier itself is not ready (no JWKS
	// reachable at boot); the request fails closed.
	ReasonUnavailable = "unavailable"
	// ReasonResolveFailed covers a verified token whose local identity could not
	// be resolved (e.g. missing workos_user_id, DB error).
	ReasonResolveFailed = "resolve_failed"
	// ReasonInvalid is the catch-all for any other validation failure.
	ReasonInvalid = "invalid"
)

// classifyRejection maps a Verify error to a bounded rejection reason. The
// order matters: signature/unverifiable failures are checked before the
// claim-level reasons because the jwt library can wrap several together.
func classifyRejection(err error) string {
	switch {
	case err == nil:
		return ""
	case errors.Is(err, jwt.ErrTokenMalformed):
		return ReasonMalformed
	case errors.Is(err, jwt.ErrTokenSignatureInvalid):
		return ReasonInvalidSignature
	case errors.Is(err, jwt.ErrTokenUnverifiable):
		return ReasonUnverifiable
	case errors.Is(err, jwt.ErrTokenExpired):
		return ReasonExpired
	case errors.Is(err, jwt.ErrTokenNotValidYet), errors.Is(err, jwt.ErrTokenUsedBeforeIssued):
		return ReasonNotYetValid
	case errors.Is(err, jwt.ErrTokenInvalidIssuer):
		return ReasonBadIssuer
	case errors.Is(err, jwt.ErrTokenInvalidAudience):
		return ReasonBadAudience
	case errors.Is(err, jwt.ErrTokenRequiredClaimMissing):
		return ReasonMissingClaim
	default:
		return ReasonInvalid
	}
}

// Bounded route groups for metric labels. Adding a new route surface means
// adding a case here so the label set stays a fixed allowlist.
const (
	RouteGroupConfig         = "config"
	RouteGroupAuth           = "auth"
	RouteGroupAccount        = "account"
	RouteGroupBackgroundTask = "background_tasks"
	RouteGroupLLM            = "llm"
	RouteGroupVoice          = "voice"
	RouteGroupTranscription  = "transcription"
	RouteGroupSearch         = "search"
	RouteGroupConnectors     = "connectors"
	RouteGroupEvents         = "events"
	RouteGroupInternal       = "internal"
	RouteGroupOAuthHooks     = "oauth_hooks"
	RouteGroupGraphQL        = "graphql"
	RouteGroupOther          = "other"
)

// routeGroupPrefixes maps a path prefix to its bounded route group. Ordered
// longest/most-specific first so /v1/google-oauth resolves before /v1/google.
var routeGroupPrefixes = []struct {
	prefix string
	group  string
}{
	{"/v1/config", RouteGroupConfig},
	{"/v1/auth/", RouteGroupAuth},
	{"/v1/me", RouteGroupAccount},
	{"/v1/feedback", RouteGroupAccount},
	{"/v1/background-task", RouteGroupBackgroundTask}, // covers -tasks and -task-runs
	{"/v1/llm", RouteGroupLLM},
	{"/v1/voice", RouteGroupVoice},
	{"/v1/transcription", RouteGroupTranscription},
	{"/v1/search", RouteGroupSearch},
	{"/v1/connectors", RouteGroupConnectors},
	{"/v1/connections", RouteGroupConnectors},
	{"/v1/google-oauth", RouteGroupConnectors},
	{"/v1/slack-oauth", RouteGroupConnectors},
	{"/oauth/", RouteGroupConnectors},
	{"/v1/events", RouteGroupEvents},
	{"/v1/webhooks/", RouteGroupEvents},
	{"/v1/internal", RouteGroupInternal},
	{"/oauth-hooks/", RouteGroupOAuthHooks},
	{"/graphql", RouteGroupGraphQL},
}

// RouteGroup classifies a request path into a bounded route-group label. It is
// prefix-based so per-resource subpaths (/v1/background-tasks/{slug}/runs) all
// roll up to one group. Unknown paths classify as "other".
func RouteGroup(path string) string {
	for _, p := range routeGroupPrefixes {
		if strings.HasPrefix(path, p.prefix) {
			return p.group
		}
	}
	return RouteGroupOther
}

// unverifiedIssuer parses the `iss` claim WITHOUT validating the signature. It
// is used ONLY to label the rejection metric of an already-rejected token
// (RFC 011 token validation step 1: "parse claims without trusting them").
// Never trust this value for an authorization decision.
func unverifiedIssuer(tokenString string) string {
	var claims jwt.MapClaims
	parser := jwt.NewParser()
	if _, _, err := parser.ParseUnverified(tokenString, &claims); err != nil {
		return ""
	}
	iss, _ := claims["iss"].(string)
	return iss
}
