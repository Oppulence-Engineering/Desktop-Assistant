package auth

import (
	"fmt"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestClassifyRejection(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"nil", nil, ""},
		{"malformed", fmt.Errorf("verify: %w", jwt.ErrTokenMalformed), ReasonMalformed},
		{"bad signature", fmt.Errorf("verify: %w", jwt.ErrTokenSignatureInvalid), ReasonInvalidSignature},
		{"unverifiable (unknown kid)", fmt.Errorf("verify: %w", jwt.ErrTokenUnverifiable), ReasonUnverifiable},
		{"expired", fmt.Errorf("verify: %w", jwt.ErrTokenExpired), ReasonExpired},
		{"not yet valid", fmt.Errorf("verify: %w", jwt.ErrTokenNotValidYet), ReasonNotYetValid},
		{"used before issued", fmt.Errorf("verify: %w", jwt.ErrTokenUsedBeforeIssued), ReasonNotYetValid},
		{"bad issuer", fmt.Errorf("verify: %w", jwt.ErrTokenInvalidIssuer), ReasonBadIssuer},
		{"bad audience", fmt.Errorf("verify: %w", jwt.ErrTokenInvalidAudience), ReasonBadAudience},
		{"missing claim", fmt.Errorf("verify: %w", jwt.ErrTokenRequiredClaimMissing), ReasonMissingClaim},
		{"other", fmt.Errorf("some unrelated error"), ReasonInvalid},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := classifyRejection(c.err); got != c.want {
				t.Errorf("classifyRejection(%v) = %q, want %q", c.err, got, c.want)
			}
		})
	}
}

func TestRouteGroup(t *testing.T) {
	cases := map[string]string{
		"/v1/config":               RouteGroupConfig,
		"/v1/auth/workos/exchange": RouteGroupAuth,
		"/v1/me":                   RouteGroupAccount,
		"/v1/feedback":             RouteGroupAccount,
		"/v1/background-tasks/foo/runs/bar/events": RouteGroupBackgroundTask,
		"/v1/background-task-runs":                 RouteGroupBackgroundTask,
		"/v1/llm/chat/completions":                 RouteGroupLLM,
		"/v1/voice/text-to-speech/x":               RouteGroupVoice,
		"/v1/transcription/quota":                  RouteGroupTranscription,
		"/v1/search/exa":                           RouteGroupSearch,
		"/v1/connectors":                           RouteGroupConnectors,
		"/v1/connections/canvas/mcp-token":         RouteGroupConnectors,
		"/v1/google-oauth/claim":                   RouteGroupConnectors,
		"/v1/slack-oauth/claim":                    RouteGroupConnectors,
		"/oauth/google/start":                      RouteGroupConnectors,
		"/v1/events":                               RouteGroupEvents,
		"/v1/webhooks/google":                      RouteGroupEvents,
		"/v1/internal/events":                      RouteGroupInternal,
		"/oauth-hooks/pre-consent":                 RouteGroupOAuthHooks,
		"/graphql":                                 RouteGroupGraphQL,
		"/something-else":                          RouteGroupOther,
	}
	for path, want := range cases {
		if got := RouteGroup(path); got != want {
			t.Errorf("RouteGroup(%q) = %q, want %q", path, got, want)
		}
	}
}

func TestUnverifiedIssuer(t *testing.T) {
	// Build an unsigned-ish token with a known iss; ParseUnverified ignores the
	// signature so any signing secret works.
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"iss": "https://auth.solomon-ai.co",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	signed, err := tok.SignedString([]byte("whatever"))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if got := unverifiedIssuer(signed); got != "https://auth.solomon-ai.co" {
		t.Errorf("unverifiedIssuer = %q", got)
	}
	if got := unverifiedIssuer("not-a-jwt"); got != "" {
		t.Errorf("unverifiedIssuer(garbage) = %q, want empty", got)
	}
}

func TestIssuerPolicy(t *testing.T) {
	p := IssuerPolicy{
		WorkOSIssuer:  "https://auth.solomon-ai.co",
		ServiceIssuer: "rowboat-internal",
		BrokerIssuer:  "rowboat-broker",
	}
	cases := []struct {
		iss      string
		wantType string
		wantKind ActorKind
	}{
		{"https://auth.solomon-ai.co", IssuerTypeWorkOS, KindUser},
		{"rowboat-internal", IssuerTypeService, KindService},
		{"rowboat-broker", IssuerTypeBroker, KindConnectorResource},
		{"https://evil.example.com", IssuerTypeUnknown, KindUser},
		{"", IssuerTypeUnknown, KindUser},
	}
	for _, c := range cases {
		if got := p.IssuerType(c.iss); got != c.wantType {
			t.Errorf("IssuerType(%q) = %q, want %q", c.iss, got, c.wantType)
		}
		if got := p.Kind(c.iss); got != c.wantKind {
			t.Errorf("Kind(%q) = %q, want %q", c.iss, got, c.wantKind)
		}
	}

	// Zero-value policy classifies everything as unknown (fail-safe labeling).
	var zero IssuerPolicy
	if got := zero.IssuerType("https://auth.solomon-ai.co"); got != IssuerTypeUnknown {
		t.Errorf("zero IssuerType = %q, want unknown", got)
	}
}
