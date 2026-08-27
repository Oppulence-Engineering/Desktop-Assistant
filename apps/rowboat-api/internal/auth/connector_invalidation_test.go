package auth_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	oauthrs "github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go"
	"github.com/golang-jwt/jwt/v5"
)

const invalidationHMACSecret = "connector-invalidation-test-secret-32-bytes"

func signedInvalidationRequest(t *testing.T, principal, secret, body string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/internal/connections/invalidate", strings.NewReader(body))
	timestamp := fmt.Sprint(time.Now().UnixMilli())
	nonce := base64.RawURLEncoding.EncodeToString([]byte("0123456789abcdef"))
	bodyHash := sha256.Sum256([]byte(body))
	canonical := strings.Join([]string{
		"v1", req.Method, req.URL.EscapedPath(), principal, timestamp, nonce, hex.EncodeToString(bodyHash[:]),
	}, "\n")
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(canonical))
	req.Header.Set("X-Connector-Principal", principal)
	req.Header.Set("X-Connector-Timestamp", timestamp)
	req.Header.Set("X-Connector-Nonce", nonce)
	req.Header.Set("X-Connector-Signature", "sha256="+hex.EncodeToString(mac.Sum(nil)))
	return req
}

func TestConnectorInvalidationHMACPrincipalAndReplay(t *testing.T) {
	configured := `[
		{"principal":"canvas-service","connectors":["canvas"],"selector_classes":["user","organization"],"hmac_secret":"` + invalidationHMACSecret + `"},
		{"principal":"platform-ops","capability":"platform_admin","hmac_secret":"` + invalidationHMACSecret + `"}
	]`
	authn, err := auth.NewConnectorInvalidationAuth(configured, nil, auth.NewMemoryHookNonceStore())
	if err != nil {
		t.Fatal(err)
	}
	var actor auth.Actor
	var gotBody string
	handler := authn.Require(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resolved, ok := auth.ActorFromCtx(r.Context())
		if !ok {
			t.Fatal("missing service actor")
		}
		actor = *resolved
		raw, _ := io.ReadAll(r.Body)
		gotBody = string(raw)
		w.WriteHeader(http.StatusNoContent)
	}))
	body := `{"workos_user_id":"user_1","connector":"canvas"}`
	req := signedInvalidationRequest(t, "canvas-service", invalidationHMACSecret, body)
	replayReq := httptest.NewRequest(http.MethodPost, "/v1/internal/connections/invalidate", strings.NewReader(body))
	replayReq.Header = req.Header.Clone()
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("signed request: got %d: %s", rec.Code, rec.Body.String())
	}
	if gotBody != body || actor.Kind != auth.KindService || actor.ServiceName != "canvas-service" ||
		!actor.HasCapability(auth.ConnectorInvalidationCapabilityProduct) || !actor.AllowsConnector("canvas") ||
		!actor.AllowsSelectorClass(auth.ConnectorInvalidationSelectorUser) {
		t.Fatalf("scoped actor/body = %+v / %q", actor, gotBody)
	}

	replay := httptest.NewRecorder()
	handler.ServeHTTP(replay, replayReq)
	if replay.Code != http.StatusConflict {
		t.Fatalf("replay: got %d, want 409: %s", replay.Code, replay.Body.String())
	}
}

func TestConnectorInvalidationPolicyIsProductScopedAndAdminExplicit(t *testing.T) {
	product := &auth.Actor{
		Kind: auth.KindService, ServiceName: "canvas-service",
		Capabilities:           []string{auth.ConnectorInvalidationCapabilityProduct},
		AllowedConnectors:      []string{"canvas"},
		AllowedSelectorClasses: []string{auth.ConnectorInvalidationSelectorUser},
	}
	if !auth.ConnectorInvalidationPolicyAllows(product, "canvas", []string{auth.ConnectorInvalidationSelectorUser}) {
		t.Fatal("product principal should be allowed for its connector and selector")
	}
	if auth.ConnectorInvalidationPolicyAllows(product, "cadence", []string{auth.ConnectorInvalidationSelectorUser}) {
		t.Fatal("product principal crossed connector boundary")
	}
	if auth.ConnectorInvalidationPolicyAllows(product, "canvas", []string{auth.ConnectorInvalidationSelectorOrganization}) {
		t.Fatal("product principal crossed selector-class boundary")
	}
	if auth.ConnectorInvalidationPolicyAllows(product, "", []string{auth.ConnectorInvalidationSelectorConnector}) {
		t.Fatal("product principal received global invalidation")
	}
	admin := &auth.Actor{
		Kind: auth.KindService, ServiceName: "platform-ops",
		Capabilities: []string{auth.ConnectorInvalidationCapabilityPlatformAdmin},
	}
	if !auth.ConnectorInvalidationPolicyAllows(admin, "", []string{auth.ConnectorInvalidationSelectorOrganization}) {
		t.Fatal("explicit platform admin should be allowed global control")
	}
}

func TestConnectorInvalidationJWTPrincipalRequiresSubjectPolicyAndScope(t *testing.T) {
	jwksURL, key := jwksServerMW(t)
	verifier, err := oauthrs.NewGeneric(context.Background(), oauthrs.GenericConfig{
		IssuerURL:                 testIssuer,
		Audience:                  "connector-invalidation",
		JWKSURL:                   jwksURL,
		AllowedJWKSOrigins:        []string{jwksURL},
		AllowLocalhostDevelopment: true,
		ValidMethods:              []string{"RS256"},
	})
	if err != nil {
		t.Fatal(err)
	}
	authn, err := auth.NewConnectorInvalidationAuth(`[{"principal":"canvas-jwt","connectors":["canvas"],"selector_classes":["connection"]}]`, verifier, auth.NewMemoryHookNonceStore())
	if err != nil {
		t.Fatal(err)
	}
	handler := authn.Require(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		actor, ok := auth.ActorFromCtx(r.Context())
		if !ok || actor.ServiceName != "canvas-jwt" || !actor.AllowsConnector("canvas") {
			t.Fatalf("unexpected JWT actor: %+v", actor)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	token := signMW(t, key, jwt.MapClaims{
		"iss": testIssuer, "aud": "connector-invalidation", "sub": "canvas-jwt",
		"scope": auth.ConnectorInvalidationJWTRequiredScope,
		"exp":   time.Now().Add(time.Minute).Unix(),
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/internal/connections/invalidate", strings.NewReader(`{"connection_id":"00000000-0000-0000-0000-000000000001","connector":"canvas"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("JWT principal: got %d: %s", rec.Code, rec.Body.String())
	}

	for name, tc := range map[string]struct {
		subject string
		scope   string
		want    int
	}{
		"unknown subject": {subject: "other-product", scope: auth.ConnectorInvalidationJWTRequiredScope, want: http.StatusForbidden},
		"missing scope":   {subject: "canvas-jwt", scope: "other:scope", want: http.StatusUnauthorized},
	} {
		t.Run(name, func(t *testing.T) {
			bad := signMW(t, key, jwt.MapClaims{
				"iss": testIssuer, "aud": "connector-invalidation", "sub": tc.subject,
				"scope": tc.scope, "exp": time.Now().Add(time.Minute).Unix(),
			})
			r := httptest.NewRequest(http.MethodPost, "/v1/internal/connections/invalidate", strings.NewReader(`{}`))
			r.Header.Set("Authorization", "Bearer "+bad)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if w.Code != tc.want {
				t.Fatalf("got %d, want %d: %s", w.Code, tc.want, w.Body.String())
			}
		})
	}
}
