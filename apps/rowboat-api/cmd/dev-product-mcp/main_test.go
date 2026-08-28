package main

import (
	"crypto/tls"
	"net/http/httptest"
	"testing"

	oauthrs "github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go"
	"github.com/stretchr/testify/require"
)

func TestCanonicalArgumentsDigestIsStableAndStrict(t *testing.T) {
	left, err := canonicalArgumentsDigest(map[string]any{
		"z": []any{float64(2), map[string]any{"b": true, "a": "x"}},
		"a": "first",
	})
	require.NoError(t, err)
	right, err := canonicalArgumentsDigest(map[string]any{
		"a": "first",
		"z": []any{float64(2), map[string]any{"a": "x", "b": true}},
	})
	require.NoError(t, err)
	require.Equal(t, left, right)
	require.True(t, isCanonicalArgumentsDigest(left))
	require.False(t, isCanonicalArgumentsDigest("digest-payrun-1"))
}

func TestApprovalRedemptionBindingUsesAuthenticatedActorSessionAndConfig(t *testing.T) {
	claims := &oauthrs.Claims{
		Issuer:       "https://issuer.example/",
		Audience:     []string{"dev-product-api"},
		UserID:       "user-a",
		ConnectionID: "conn-a",
		ConnectorID:  "dev-product",
		TokenID:      "token-session-a",
	}
	digest, err := canonicalArgumentsDigest(map[string]any{"resource_id": "payrun-1"})
	require.NoError(t, err)
	request := httptest.NewRequest("POST", "https://product.example/v1/approvals/redeem", nil)
	request.TLS = &tls.ConnectionState{}
	valid := approvalRedemptionRequest{
		Code: "completion-code", Verifier: "pkce-verifier", DesktopChallengeID: "desktop-challenge",
		ConnectionID: claims.ConnectionID, Tool: paymentTool, ArgumentsDigest: digest,
		Actor: claims.UserID, Action: paymentAction, ProductSessionID: claims.TokenID,
		ProductConfigDigest: claimsProductConfigDigest(claims),
	}

	binding, err := approvalRedemptionBindingFor(request, claims, valid)
	require.NoError(t, err)
	require.Equal(t, "https://product.example", binding.ProductOrigin)
	require.Equal(t, claims.UserID, binding.Actor)
	require.Equal(t, claims.TokenID, binding.ProductSessionID)
	require.Equal(t, claimsProductConfigDigest(claims), binding.ProductConfigDigest)

	cases := map[string]func(*approvalRedemptionRequest){
		"empty tool":         func(body *approvalRedemptionRequest) { body.Tool = "" },
		"wrong tool":         func(body *approvalRedemptionRequest) { body.Tool = "payments.cancel" },
		"wrong actor":        func(body *approvalRedemptionRequest) { body.Actor = "user-b" },
		"wrong connection":   func(body *approvalRedemptionRequest) { body.ConnectionID = "conn-b" },
		"wrong arguments":    func(body *approvalRedemptionRequest) { body.ArgumentsDigest = "not-canonical" },
		"wrong session":      func(body *approvalRedemptionRequest) { body.ProductSessionID = "token-session-b" },
		"wrong config":       func(body *approvalRedemptionRequest) { body.ProductConfigDigest = digest },
		"wrong action":       func(body *approvalRedemptionRequest) { body.Action = "payment.cancel" },
		"self asserted only": func(body *approvalRedemptionRequest) { body.Actor = "user-b" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			body := valid
			mutate(&body)
			_, err := approvalRedemptionBindingFor(request, claims, body)
			require.Error(t, err)
		})
	}
}

func TestApprovalBearerIsDeterministicAndExactBound(t *testing.T) {
	binding := approvalRedemptionBinding{
		ProductOrigin: "https://product.example", DesktopChallengeID: "challenge", ConnectionID: "conn-a",
		Tool: paymentTool, ArgumentsDigest: digestParts("args", "payrun-1"), Actor: "user-a", Action: paymentAction,
		ProductSessionID: "session-a", ProductConfigDigest: digestParts("config", "a"),
	}
	first := approvalBearer("code", "verifier", "payrun-1", binding)
	second := approvalBearer("code", "verifier", "payrun-1", binding)
	require.Equal(t, first, second)

	changed := binding
	changed.Tool = "payments.cancel"
	require.NotEqual(t, first, approvalBearer("code", "verifier", "payrun-1", changed))
	changed = binding
	changed.Actor = "user-b"
	require.NotEqual(t, first, approvalBearer("code", "verifier", "payrun-1", changed))
	changed = binding
	changed.ArgumentsDigest = digestParts("args", "payrun-2")
	require.NotEqual(t, first, approvalBearer("code", "verifier", "payrun-1", changed))
}

func TestCanonicalProductOriginAndAmbiguousCommitFixtureGate(t *testing.T) {
	origin, err := canonicalProductOrigin("HTTPS://Product.Example:443/")
	require.NoError(t, err)
	require.Equal(t, "https://product.example:443", origin)
	_, err = canonicalProductOrigin("https://product.example/path")
	require.Error(t, err)

	t.Setenv("PRODUCT_MCP_FIXTURE_SECRET", "fixture-secret")
	r := httptest.NewRequest("POST", "https://product.example/v1/approvals/redeem", nil)
	r.Header.Set("X-Fixture-Secret", "fixture-secret")
	r.Header.Set("X-Fixture-Approval-Commit", "committed-without-ack")
	require.True(t, fixtureAmbiguousApprovalCommit(r))
	r.Header.Set("X-Fixture-Secret", "wrong")
	require.False(t, fixtureAmbiguousApprovalCommit(r))
}
