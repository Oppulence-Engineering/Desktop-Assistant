package oauthrs_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	oauthrs "github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go"
	"github.com/golang-jwt/jwt/v5"
)

const testKID = "test-key-1"

// jwksServer serves a single-RSA-key JWKS and returns the matching private key.
func jwksServer(t *testing.T) (*httptest.Server, *rsa.PrivateKey) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("gen key: %v", err)
	}
	n := base64.RawURLEncoding.EncodeToString(key.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())
	jwks := map[string]any{
		"keys": []map[string]string{
			{"kty": "RSA", "use": "sig", "alg": "RS256", "kid": testKID, "n": n, "e": e},
		},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(jwks)
	}))
	t.Cleanup(srv.Close)
	return srv, key
}

func sign(t *testing.T, key *rsa.PrivateKey, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = testKID
	s, err := tok.SignedString(key)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return s
}

func newVerifier(t *testing.T, jwksURL string) *oauthrs.Verifier {
	t.Helper()
	v, err := oauthrs.New(context.Background(), oauthrs.Config{
		IssuerURL: "https://oauth.solomon-ai.co",
		Audience:  "rowboat-api",
		JWKSURL:   jwksURL,
	})
	if err != nil {
		t.Fatalf("new verifier: %v", err)
	}
	return v
}

func TestVerifyValidToken(t *testing.T) {
	srv, key := jwksServer(t)
	v := newVerifier(t, srv.URL)

	tokenStr := sign(t, key, jwt.MapClaims{
		"sub":   "user_internal_id",
		"iss":   "https://oauth.solomon-ai.co",
		"aud":   "rowboat-api",
		"exp":   time.Now().Add(time.Hour).Unix(),
		"scope": "invoices:read customers:read",
		"ext": map[string]any{
			"workos_user_id": "user_abc123",
			"email":          "u@example.com",
		},
	})

	claims, err := v.Verify(tokenStr)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.WorkOSUserID != "user_abc123" {
		t.Errorf("workos id = %q", claims.WorkOSUserID)
	}
	if claims.Email != "u@example.com" {
		t.Errorf("email = %q", claims.Email)
	}
	if !claims.HasAllScopes("invoices:read", "customers:read") {
		t.Errorf("scopes = %v", claims.Scopes)
	}
	if claims.HasScope("transactions:write") {
		t.Error("must not have ungranted scope")
	}
}

func TestVerifyScpArrayClaim(t *testing.T) {
	srv, key := jwksServer(t)
	v := newVerifier(t, srv.URL)
	tokenStr := sign(t, key, jwt.MapClaims{
		"iss": "https://oauth.solomon-ai.co", "aud": "rowboat-api",
		"exp": time.Now().Add(time.Hour).Unix(),
		"scp": []any{"a:read", "b:write"},
	})
	claims, err := v.Verify(tokenStr)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !claims.HasAllScopes("a:read", "b:write") {
		t.Errorf("scp scopes = %v", claims.Scopes)
	}
}

func TestVerifyRejectsWrongAudience(t *testing.T) {
	srv, key := jwksServer(t)
	v := newVerifier(t, srv.URL)
	tokenStr := sign(t, key, jwt.MapClaims{
		"iss": "https://oauth.solomon-ai.co", "aud": "canvas-api",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	if _, err := v.Verify(tokenStr); err == nil {
		t.Fatal("expected wrong-audience rejection")
	}
}

func TestVerifyRejectsWrongIssuer(t *testing.T) {
	srv, key := jwksServer(t)
	v := newVerifier(t, srv.URL)
	tokenStr := sign(t, key, jwt.MapClaims{
		"iss": "https://evil.example.com", "aud": "rowboat-api",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	if _, err := v.Verify(tokenStr); err == nil {
		t.Fatal("expected wrong-issuer rejection")
	}
}

func TestVerifyRejectsExpired(t *testing.T) {
	srv, key := jwksServer(t)
	v := newVerifier(t, srv.URL)
	tokenStr := sign(t, key, jwt.MapClaims{
		"iss": "https://oauth.solomon-ai.co", "aud": "rowboat-api",
		"exp": time.Now().Add(-time.Minute).Unix(),
	})
	if _, err := v.Verify(tokenStr); err == nil {
		t.Fatal("expected expired-token rejection")
	}
}

func TestVerifyRejectsHS256AlgConfusion(t *testing.T) {
	srv, _ := jwksServer(t)
	v := newVerifier(t, srv.URL)
	// Attacker signs HS256 using the (public) modulus bytes as the HMAC secret.
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"iss": "https://oauth.solomon-ai.co", "aud": "rowboat-api",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	tok.Header["kid"] = testKID
	forged, _ := tok.SignedString([]byte("anything"))
	if _, err := v.Verify(forged); err == nil {
		t.Fatal("expected HS256 to be rejected (alg confusion)")
	}
}

// TestNewDiscoversJWKSFromIssuer covers the WorkOS-direct path: the caller
// configures only the issuer, the verifier discovers jwks_uri from its OIDC
// metadata, and a token carrying the user id in `sub` (WorkOS AuthKit shape,
// no `ext`) resolves WorkOSUserID via the sub fallback.
func TestNewDiscoversJWKSFromIssuer(t *testing.T) {
	jwks, key := jwksServer(t)

	disco := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/.well-known/openid-configuration" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"issuer": "x", "jwks_uri": jwks.URL})
	}))
	t.Cleanup(disco.Close)

	v, err := oauthrs.New(context.Background(), oauthrs.Config{
		IssuerURL: disco.URL, // token `iss` must match; JWKSURL omitted → discovered
		Audience:  "rowboat-api",
	})
	if err != nil {
		t.Fatalf("new with discovery: %v", err)
	}
	tokenStr := sign(t, key, jwt.MapClaims{
		"sub": "user_abc123", "iss": disco.URL, "aud": "rowboat-api",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	claims, err := v.Verify(tokenStr)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.WorkOSUserID != "user_abc123" {
		t.Errorf("WorkOSUserID = %q, want sub fallback %q", claims.WorkOSUserID, "user_abc123")
	}
}

func TestNewRequiresJWKSOrIssuer(t *testing.T) {
	if _, err := oauthrs.New(context.Background(), oauthrs.Config{Audience: "rowboat-api"}); err == nil {
		t.Fatal("expected error when both JWKSURL and IssuerURL are empty")
	}
}

func TestRequireMiddleware(t *testing.T) {
	srv, key := jwksServer(t)
	v := newVerifier(t, srv.URL)

	var sawWorkOSID string
	h := v.Require(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, _ := oauthrs.ClaimsFromContext(r.Context())
		sawWorkOSID = c.WorkOSUserID
		w.WriteHeader(http.StatusOK)
	}))

	// Missing bearer → 401.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("missing bearer: want 401, got %d", rec.Code)
	}

	// Valid bearer → 200 + claims in context.
	tokenStr := sign(t, key, jwt.MapClaims{
		"iss": "https://oauth.solomon-ai.co", "aud": "rowboat-api",
		"exp": time.Now().Add(time.Hour).Unix(),
		"ext": map[string]any{"workos_user_id": "user_xyz"},
	})
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("valid bearer: want 200, got %d", rec.Code)
	}
	if sawWorkOSID != "user_xyz" {
		t.Fatalf("claims not in context: %q", sawWorkOSID)
	}
}

func TestRequireScopesMiddleware(t *testing.T) {
	srv, key := jwksServer(t)
	v := newVerifier(t, srv.URL)
	tokenStr := sign(t, key, jwt.MapClaims{
		"iss": "https://oauth.solomon-ai.co", "aud": "rowboat-api",
		"exp": time.Now().Add(time.Hour).Unix(), "scope": "invoices:read",
	})

	guard := oauthrs.RequireScopes("invoices:write")
	final := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	h := v.Require(guard(final))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403 for missing scope, got %d", rec.Code)
	}
}
