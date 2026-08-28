package oauthrs_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
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

func signWithMethod(t *testing.T, method jwt.SigningMethod, key any, kid string, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(method, claims)
	tok.Header["kid"] = kid
	s, err := tok.SignedString(key)
	if err != nil {
		t.Fatalf("sign with %s: %v", method.Alg(), err)
	}
	return s
}

func validClaims() jwt.MapClaims {
	return jwt.MapClaims{
		"sub": "usr_123", "iss": "https://oauth.solomon-ai.co", "aud": "rowboat-api",
		"exp": time.Now().Add(time.Hour).Unix(), "iat": time.Now().Unix(), "nbf": time.Now().Add(-time.Second).Unix(),
		"jti": "tok_123", "scope": "canvas.read canvas.watch",
		"organization_id": "org_123", "connection_id": "conn_123", "connector_id": "canvas", "credential_generation": 1, "trust_tier": "act",
	}
}

func errorCode(t *testing.T, err error) oauthrs.ErrorCode {
	t.Helper()
	authErr, ok := err.(*oauthrs.AuthorizationError)
	if !ok {
		t.Fatalf("error type = %T, want *AuthorizationError (%v)", err, err)
	}
	return authErr.Code
}

func newVerifier(t *testing.T, jwksURL string) *oauthrs.Verifier {
	t.Helper()
	v, err := oauthrs.NewGeneric(context.Background(), oauthrs.GenericConfig{
		IssuerURL:                 "https://oauth.solomon-ai.co",
		Audience:                  "rowboat-api",
		JWKSURL:                   jwksURL,
		AllowedJWKSOrigins:        []string{jwksURL},
		AllowLocalhostDevelopment: true,
	})
	if err != nil {
		t.Fatalf("new verifier: %v", err)
	}
	return v
}

func TestPrimaryVerifierRequiresExactlyRS256WhileGenericRemainsExplicitlyConfigurable(t *testing.T) {
	srv, _ := jwksServer(t)
	base := oauthrs.Config{
		IssuerURL: "https://oauth.solomon-ai.co", Audience: "rowboat-api", JWKSURL: srv.URL,
		AllowedJWKSOrigins: []string{srv.URL}, AllowLocalhostDevelopment: true,
	}
	for _, methods := range [][]string{{"RS384"}, {"RS256", "RS384"}, {"rs256"}} {
		cfg := base
		cfg.ValidMethods = methods
		if _, err := oauthrs.New(context.Background(), cfg); err == nil || !strings.Contains(err.Error(), "exactly RS256") {
			t.Fatalf("primary methods %v error = %v", methods, err)
		}
	}
	base.ValidMethods = []string{"RS256"}
	if _, err := oauthrs.New(context.Background(), base); err != nil {
		t.Fatalf("exact RS256 primary config rejected: %v", err)
	}
	generic := oauthrs.GenericConfig(base)
	generic.ValidMethods = []string{"RS384"}
	if _, err := oauthrs.NewGeneric(context.Background(), generic); err != nil {
		t.Fatalf("explicit generic algorithm configuration rejected: %v", err)
	}
}

func TestVerifyValidToken(t *testing.T) {
	srv, key := jwksServer(t)
	v := newVerifier(t, srv.URL)

	tokenStr := sign(t, key, jwt.MapClaims{
		"sub":                   "user_internal_id",
		"iss":                   "https://oauth.solomon-ai.co",
		"aud":                   "rowboat-api",
		"exp":                   time.Now().Add(time.Hour).Unix(),
		"scope":                 "invoices:read customers:read",
		"iat":                   time.Now().Unix(),
		"nbf":                   time.Now().Add(-time.Second).Unix(),
		"jti":                   "tok_abc",
		"connection_id":         "conn_abc",
		"connector_id":          "canvas",
		"credential_generation": 1,
		"trust_tier":            "read",
		"ext": map[string]any{
			"workos_user_id":  "user_abc123",
			"organization_id": "org_abc",
			"email":           "u@example.com",
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
	if claims.UserID != "user_abc123" || claims.OrganizationID != "org_abc" || claims.ConnectionID != "conn_abc" || claims.ConnectorID != "canvas" || claims.TokenID != "tok_abc" || claims.TrustTier != "read" {
		t.Errorf("normalized actor = %#v", claims)
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
	} else if code := errorCode(t, err); code != oauthrs.CodeAudienceMismatch {
		t.Fatalf("code = %q", code)
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
		"exp": time.Now().Add(-2 * time.Minute).Unix(),
	})
	if _, err := v.Verify(tokenStr); err == nil {
		t.Fatal("expected expired-token rejection")
	} else if code := errorCode(t, err); code != oauthrs.CodeTokenExpired {
		t.Fatalf("code = %q", code)
	}
}

func TestVerifyValidatesNBFAndIATWithSkew(t *testing.T) {
	srv, key := jwksServer(t)
	v := newVerifier(t, srv.URL)

	for name, claim := range map[string]string{"nbf": "nbf", "iat": "iat"} {
		t.Run(name+" beyond skew", func(t *testing.T) {
			claims := validClaims()
			claims[claim] = time.Now().Add(2 * time.Minute).Unix()
			tokenStr := sign(t, key, claims)
			if _, err := v.Verify(tokenStr); err == nil {
				t.Fatalf("expected future %s rejection", claim)
			} else if code := errorCode(t, err); code != oauthrs.CodeTokenInvalidSignature {
				t.Fatalf("code = %q", code)
			}
		})
		t.Run(name+" within skew", func(t *testing.T) {
			claims := validClaims()
			claims[claim] = time.Now().Add(30 * time.Second).Unix()
			if _, err := v.Verify(sign(t, key, claims)); err != nil {
				t.Fatalf("within-skew %s rejected: %v", claim, err)
			}
		})
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
	} else if code := errorCode(t, err); code != oauthrs.CodeTokenInvalidSignature {
		t.Fatalf("code = %q", code)
	}
}

func TestVerifyRejectsOtherAsymmetricAlgorithmByDefault(t *testing.T) {
	srv, key := jwksServer(t)
	v := newVerifier(t, srv.URL)
	tokenStr := signWithMethod(t, jwt.SigningMethodRS512, key, testKID, validClaims())
	if _, err := v.Verify(tokenStr); err == nil {
		t.Fatal("expected RS512 rejection under RS256-only default")
	} else if code := errorCode(t, err); code != oauthrs.CodeTokenInvalidSignature {
		t.Fatalf("code = %q", code)
	}
}

func TestVerifyRefetchesJWKSForUnknownKID(t *testing.T) {
	key1, _ := rsa.GenerateKey(rand.Reader, 2048)
	key2, _ := rsa.GenerateKey(rand.Reader, 2048)
	jwk := func(key *rsa.PrivateKey, kid string) map[string]string {
		return map[string]string{
			"kty": "RSA", "use": "sig", "alg": "RS256", "kid": kid,
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}
	}
	var rotated atomic.Bool
	var requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		keys := []map[string]string{jwk(key1, "kid-1")}
		if rotated.Load() {
			keys = append(keys, jwk(key2, "kid-2"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": keys})
	}))
	t.Cleanup(srv.Close)
	v := newVerifier(t, srv.URL)
	rotated.Store(true)
	tokenStr := signWithMethod(t, jwt.SigningMethodRS256, key2, "kid-2", validClaims())
	if _, err := v.Verify(tokenStr); err != nil {
		t.Fatalf("unknown kid should trigger refetch: %v", err)
	}
	if requests.Load() < 2 {
		t.Fatalf("JWKS requests = %d, want at least 2", requests.Load())
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

	v, err := oauthrs.NewGeneric(context.Background(), oauthrs.GenericConfig{
		IssuerURL:                 disco.URL, // token `iss` must match; JWKSURL omitted → discovered
		Audience:                  "rowboat-api",
		AllowedJWKSOrigins:        []string{jwks.URL},
		AllowLocalhostDevelopment: true,
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

func TestRFCVerifierFailsClosedAndGenericIsExplicit(t *testing.T) {
	srv, key := jwksServer(t)
	base := oauthrs.Config{
		IssuerURL:                 "https://oauth.solomon-ai.co",
		Audience:                  "rowboat-api",
		JWKSURL:                   srv.URL,
		AllowedJWKSOrigins:        []string{srv.URL},
		AllowLocalhostDevelopment: true,
	}
	for _, mutate := range []func(*oauthrs.Config){
		func(c *oauthrs.Config) { c.IssuerURL = "" },
		func(c *oauthrs.Config) { c.Audience = "" },
	} {
		cfg := base
		mutate(&cfg)
		if _, err := oauthrs.New(context.Background(), cfg); err == nil {
			t.Fatal("primary constructor must require exact issuer and audience")
		}
	}
	v, err := oauthrs.New(context.Background(), base)
	if err != nil {
		t.Fatal(err)
	}
	missingActor := sign(t, key, jwt.MapClaims{
		"iss": base.IssuerURL, "aud": base.Audience,
		"sub": "usr_123", "exp": time.Now().Add(time.Hour).Unix(),
	})
	if _, err := v.Verify(missingActor); err == nil {
		t.Fatal("primary verifier accepted missing RFC 012 actor claims")
	}
	generic, err := oauthrs.NewGeneric(context.Background(), oauthrs.GenericConfig(base))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := generic.Verify(missingActor); err != nil {
		t.Fatalf("explicit generic verifier rejected generic token: %v", err)
	}
}

func TestRFCVerifierRequiredOrganization(t *testing.T) {
	srv, key := jwksServer(t)
	v, err := oauthrs.New(context.Background(), oauthrs.Config{
		IssuerURL: "https://oauth.solomon-ai.co", Audience: "rowboat-api", JWKSURL: srv.URL,
		AllowedJWKSOrigins: []string{srv.URL}, AllowLocalhostDevelopment: true,
		RequiredOrganizationID: "org_required",
	})
	if err != nil {
		t.Fatal(err)
	}
	claims := validClaims()
	claims["organization_id"] = "org_other"
	if _, err := v.Verify(sign(t, key, claims)); err == nil {
		t.Fatal("accepted token for the wrong required organization")
	}
}

func TestRFCVerifierRequiresOrganizationIssuedAtAndNotBefore(t *testing.T) {
	srv, key := jwksServer(t)
	v, err := oauthrs.New(context.Background(), oauthrs.Config{
		IssuerURL: "https://oauth.solomon-ai.co", Audience: "rowboat-api", JWKSURL: srv.URL,
		AllowedJWKSOrigins: []string{srv.URL}, AllowLocalhostDevelopment: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, claim := range []string{"organization_id", "iat", "nbf"} {
		claims := validClaims()
		delete(claims, claim)
		if _, err := v.Verify(sign(t, key, claims)); err == nil {
			t.Fatalf("primary verifier accepted token missing %s", claim)
		}
	}
}

func TestRemoteURLPolicyRejectsUnsafeURLs(t *testing.T) {
	base := oauthrs.Config{IssuerURL: "https://issuer.example", Audience: "api"}
	for _, raw := range []string{
		"http://keys.example/jwks", "https://user@keys.example/jwks",
		"https://keys.example/jwks#fragment", "https://127.0.0.1/jwks",
	} {
		cfg := base
		cfg.JWKSURL = raw
		cfg.AllowedJWKSOrigins = []string{"https://keys.example"}
		if _, err := oauthrs.New(context.Background(), cfg); err == nil {
			t.Fatalf("unsafe JWKS URL accepted: %s", raw)
		}
	}
}

func TestUnknownKIDRefreshIsCoalescedAndNegativeCached(t *testing.T) {
	var requests atomic.Int64
	srv, key := jwksServer(t)
	counting := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		resp, err := http.Get(srv.URL)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		_, _ = io.Copy(w, resp.Body)
	}))
	t.Cleanup(counting.Close)
	v, err := oauthrs.NewGeneric(context.Background(), oauthrs.GenericConfig{
		IssuerURL: "https://oauth.solomon-ai.co", Audience: "rowboat-api", JWKSURL: counting.URL,
		AllowedJWKSOrigins: []string{counting.URL}, AllowLocalhostDevelopment: true,
		UnknownKIDCacheTTL: time.Minute,
	})
	if err != nil {
		t.Fatal(err)
	}
	unknown := signWithMethod(t, jwt.SigningMethodRS256, key, "never-present", validClaims())
	start := make(chan struct{})
	var done atomic.Int64
	for range 12 {
		go func() { <-start; _, _ = v.Verify(unknown); done.Add(1) }()
	}
	close(start)
	deadline := time.Now().Add(2 * time.Second)
	for done.Load() != 12 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if got := requests.Load(); got != 2 {
		t.Fatalf("requests = %d, want eager load + one coalesced miss refresh", got)
	}
	_, _ = v.Verify(unknown)
	if got := requests.Load(); got != 2 {
		t.Fatalf("negative-cached miss refetched JWKS: %d", got)
	}
}

func TestUnknownKIDRefreshCooldownLimitsDistinctKidsAndAllowsRotation(t *testing.T) {
	key1, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	key2, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	jwk := func(key *rsa.PrivateKey, kid string) map[string]string {
		return map[string]string{
			"kty": "RSA", "use": "sig", "alg": "RS256", "kid": kid,
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}
	}
	var requests atomic.Int64
	var rotated atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		keys := []map[string]string{jwk(key1, "kid-1")}
		if rotated.Load() {
			keys = append(keys, jwk(key2, "kid-2"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": keys})
	}))
	t.Cleanup(srv.Close)

	var nowNanos atomic.Int64
	nowNanos.Store(time.Date(2026, time.August, 27, 0, 0, 0, 0, time.UTC).UnixNano())
	now := func() time.Time { return time.Unix(0, nowNanos.Load()) }
	advance := func(d time.Duration) { nowNanos.Add(int64(d)) }
	v, err := oauthrs.NewGeneric(context.Background(), oauthrs.GenericConfig{
		IssuerURL: "https://oauth.solomon-ai.co", Audience: "rowboat-api", JWKSURL: srv.URL,
		AllowedJWKSOrigins: []string{srv.URL}, AllowLocalhostDevelopment: true,
		UnknownKIDCacheTTL: 2 * time.Second, UnknownKIDRefreshCooldown: 10 * time.Second,
		Now: now,
	})
	if err != nil {
		t.Fatal(err)
	}

	for _, kid := range []string{"attacker-1", "attacker-2"} {
		_, _ = v.Verify(signWithMethod(t, jwt.SigningMethodRS256, key1, kid, validClaims()))
	}
	if got := requests.Load(); got != 2 {
		t.Fatalf("requests after sequential distinct kids = %d, want init + one refresh", got)
	}
	advance(3 * time.Second) // individual negative cache expired, issuer cooldown has not
	_, _ = v.Verify(signWithMethod(t, jwt.SigningMethodRS256, key1, "attacker-3", validClaims()))
	if got := requests.Load(); got != 2 {
		t.Fatalf("distinct kid bypassed issuer cooldown: requests = %d", got)
	}

	advance(8 * time.Second)
	rotated.Store(true)
	rotatedToken := signWithMethod(t, jwt.SigningMethodRS256, key2, "kid-2", validClaims())
	if _, err := v.Verify(rotatedToken); err != nil {
		t.Fatalf("legitimate rotation after cooldown failed: %v", err)
	}
	if got := requests.Load(); got != 3 {
		t.Fatalf("requests after rotation = %d, want one post-cooldown refresh", got)
	}
}

func TestJWKSCacheBoundRetiresKnownKeyAndFailsClosedOnOutage(t *testing.T) {
	oldKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	activeKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	jwk := func(key *rsa.PrivateKey, kid string) map[string]string {
		return map[string]string{
			"kty": "RSA", "use": "sig", "alg": "RS256", "kid": kid,
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}
	}

	var state atomic.Int32
	var requests atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		switch state.Load() {
		case 0:
			_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{jwk(oldKey, "old")}})
		case 1:
			_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{jwk(oldKey, "old"), jwk(activeKey, "active")}})
		case 2:
			_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{jwk(activeKey, "active")}})
		default:
			http.Error(w, "unavailable", http.StatusServiceUnavailable)
		}
	}))
	t.Cleanup(srv.Close)

	var nowNanos atomic.Int64
	nowNanos.Store(time.Date(2026, time.August, 28, 0, 0, 0, 0, time.UTC).UnixNano())
	now := func() time.Time { return time.Unix(0, nowNanos.Load()) }
	advance := func(d time.Duration) { nowNanos.Add(int64(d)) }
	verifier, err := oauthrs.NewGeneric(context.Background(), oauthrs.GenericConfig{
		IssuerURL: "https://oauth.solomon-ai.co", Audience: "rowboat-api", JWKSURL: srv.URL,
		AllowedJWKSOrigins: []string{srv.URL}, AllowLocalhostDevelopment: true,
		JWKSCacheTTL: time.Second, Now: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	oldToken := signWithMethod(t, jwt.SigningMethodRS256, oldKey, "old", validClaims())
	activeToken := signWithMethod(t, jwt.SigningMethodRS256, activeKey, "active", validClaims())

	if _, err := verifier.Verify(oldToken); err != nil {
		t.Fatalf("initial old key rejected: %v", err)
	}
	state.Store(1)
	advance(time.Second - time.Nanosecond)
	if _, err := verifier.Verify(oldToken); err != nil {
		t.Fatalf("fresh cached old key rejected before bound: %v", err)
	}
	if got := requests.Load(); got != 1 {
		t.Fatalf("cache refreshed before configured bound: requests = %d", got)
	}
	advance(time.Nanosecond)
	if _, err := verifier.Verify(activeToken); err != nil {
		t.Fatalf("overlap refresh rejected active key: %v", err)
	}
	if _, err := verifier.Verify(oldToken); err != nil {
		t.Fatalf("overlap refresh rejected old key: %v", err)
	}

	state.Store(2)
	advance(time.Second - time.Nanosecond)
	if _, err := verifier.Verify(oldToken); err != nil {
		t.Fatalf("old key was retired before the positive cache bound: %v", err)
	}
	advance(time.Nanosecond)
	if _, err := verifier.Verify(oldToken); err == nil {
		t.Fatal("retired old key remained trusted after the positive cache bound")
	}
	if _, err := verifier.Verify(activeToken); err != nil {
		t.Fatalf("active key rejected after retirement refresh: %v", err)
	}
	if got := requests.Load(); got != 3 {
		t.Fatalf("requests after overlap and retirement = %d, want 3", got)
	}

	state.Store(3)
	advance(time.Second)
	if _, err := verifier.Verify(activeToken); err == nil {
		t.Fatal("expired positive cache trusted the active key during JWKS outage")
	}
	if got := requests.Load(); got != 4 {
		t.Fatalf("outage refresh requests = %d, want 4", got)
	}
	state.Store(2)
	if _, err := verifier.Verify(activeToken); err != nil {
		t.Fatalf("active key did not recover after JWKS outage: %v", err)
	}
	if got := requests.Load(); got != 5 {
		t.Fatalf("recovery refresh requests = %d, want 5", got)
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
	if !strings.Contains(rec.Body.String(), `"code":"token_missing"`) {
		t.Fatalf("missing bearer body = %s", rec.Body.String())
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
	if !strings.Contains(rec.Body.String(), `"code":"scope_missing"`) {
		t.Fatalf("body = %s", rec.Body.String())
	}
}

func TestRequireMCPTokenParityContract(t *testing.T) {
	srv, key := jwksServer(t)
	v := newVerifier(t, srv.URL)
	tokenStr := sign(t, key, validClaims())
	final := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	activeConnection := func(context.Context, *oauthrs.Claims) (bool, error) { return true, nil }

	run := func(t *testing.T, opts oauthrs.MCPTokenOptions, approval string) *httptest.ResponseRecorder {
		t.Helper()
		h := v.RequireMCPToken(opts)(final)
		req := httptest.NewRequest(http.MethodPost, "/money", nil)
		req.Header.Set("Authorization", "Bearer "+tokenStr)
		if approval != "" {
			req.Header.Set("X-Approval-Token", approval)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	tests := []struct {
		name     string
		opts     oauthrs.MCPTokenOptions
		approval string
		status   int
		code     oauthrs.ErrorCode
	}{
		{name: "all scopes pass", opts: oauthrs.MCPTokenOptions{RequiredScopes: []string{"canvas.read", "canvas.watch"}, ConnectionValidator: activeConnection}, status: 204},
		{name: "route audience pass", opts: oauthrs.MCPTokenOptions{Audience: "rowboat-api", ConnectionValidator: activeConnection}, status: 204},
		{name: "route audience fail", opts: oauthrs.MCPTokenOptions{Audience: "mcp:other"}, status: 401, code: oauthrs.CodeAudienceMismatch},
		{name: "all scopes fail", opts: oauthrs.MCPTokenOptions{RequiredScopes: []string{"canvas.read", "canvas.write"}}, status: 403, code: oauthrs.CodeScopeMissing},
		{name: "any scope pass", opts: oauthrs.MCPTokenOptions{AnyScopes: []string{"canvas.write", "canvas.watch"}, ConnectionValidator: activeConnection}, status: 204},
		{name: "any scope fail", opts: oauthrs.MCPTokenOptions{AnyScopes: []string{"canvas.write", "canvas.pay"}}, status: 403, code: oauthrs.CodeScopeMissing},
		{name: "live validator missing", opts: oauthrs.MCPTokenOptions{}, status: 403, code: oauthrs.CodeConnectionRevoked},
		{name: "connection revoked", opts: oauthrs.MCPTokenOptions{ConnectionValidator: func(context.Context, *oauthrs.Claims) (bool, error) { return false, nil }}, status: 403, code: oauthrs.CodeConnectionRevoked},
		{name: "connection status unavailable", opts: oauthrs.MCPTokenOptions{ConnectionValidator: func(context.Context, *oauthrs.Claims) (bool, error) { return false, context.DeadlineExceeded }}, status: 403, code: oauthrs.CodeConnectionRevoked},
		{name: "approval missing", opts: oauthrs.MCPTokenOptions{ConnectionValidator: activeConnection, ApprovalValidator: func(*http.Request, string, *oauthrs.Claims) (bool, error) { return true, nil }}, status: 428, code: oauthrs.CodeApprovalRequired},
		{name: "approval invalid", approval: "bad", opts: oauthrs.MCPTokenOptions{ConnectionValidator: activeConnection, ApprovalValidator: func(_ *http.Request, token string, _ *oauthrs.Claims) (bool, error) { return token == "good", nil }}, status: 428, code: oauthrs.CodeApprovalRequired},
		{name: "approval valid", approval: "good", opts: oauthrs.MCPTokenOptions{ConnectionValidator: activeConnection, ApprovalValidator: func(req *http.Request, token string, claims *oauthrs.Claims) (bool, error) {
			return req.URL.Path == "/money" && token == "good" && claims.ConnectionID == "conn_123", nil
		}}, status: 204},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := run(t, tt.opts, tt.approval)
			if rec.Code != tt.status {
				t.Fatalf("status = %d, want %d: %s", rec.Code, tt.status, rec.Body.String())
			}
			if tt.code != "" && !strings.Contains(rec.Body.String(), `"code":"`+string(tt.code)+`"`) {
				t.Fatalf("body = %s", rec.Body.String())
			}
		})
	}
}

func TestRequireMCPTokenDisconnectDeniesImmediately(t *testing.T) {
	srv, key := jwksServer(t)
	v := newVerifier(t, srv.URL)
	tokenStr := sign(t, key, validClaims())
	active := true
	checks := 0
	h := v.RequireMCPToken(oauthrs.MCPTokenOptions{
		ConnectionValidator: func(context.Context, *oauthrs.Claims) (bool, error) {
			checks++
			return active, nil
		},
	})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))

	request := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/mcp", nil)
		req.Header.Set("Authorization", "Bearer "+tokenStr)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	if rec := request(); rec.Code != http.StatusNoContent {
		t.Fatalf("active connection: want 204, got %d: %s", rec.Code, rec.Body.String())
	}
	active = false
	if rec := request(); rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), `"code":"connection_revoked"`) {
		t.Fatalf("disconnected connection: want immediate 403 connection_revoked, got %d: %s", rec.Code, rec.Body.String())
	}
	if checks != 2 {
		t.Fatalf("connection validator checks = %d, want one per request", checks)
	}
}

func TestRequireMCPTokenOfflineDevelopmentRequiresBoundedIssuedTTL(t *testing.T) {
	srv, key := jwksServer(t)
	v := newVerifier(t, srv.URL)
	final := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	now := time.Now().Truncate(time.Second)

	run := func(claims jwt.MapClaims, opts oauthrs.MCPTokenOptions) *httptest.ResponseRecorder {
		tokenStr := sign(t, key, claims)
		req := httptest.NewRequest(http.MethodPost, "/mcp", nil)
		req.Header.Set("Authorization", "Bearer "+tokenStr)
		rec := httptest.NewRecorder()
		v.RequireMCPToken(opts)(final).ServeHTTP(rec, req)
		return rec
	}

	bounded := validClaims()
	bounded["iat"] = now.Unix()
	bounded["exp"] = now.Add(2 * time.Minute).Unix()
	offline := oauthrs.MCPTokenOptions{
		ConnectionValidationMode: oauthrs.ConnectionValidationOfflineDevelopment,
		OfflineMaxTokenTTL:       2 * time.Minute,
	}
	if rec := run(bounded, offline); rec.Code != http.StatusNoContent {
		t.Fatalf("bounded offline token: want 204, got %d: %s", rec.Code, rec.Body.String())
	}

	longLived := validClaims()
	longLived["iat"] = now.Unix()
	longLived["exp"] = now.Add(time.Hour).Unix()
	missingIssuedAt := validClaims()
	delete(missingIssuedAt, "iat")
	missingIssuedAt["exp"] = now.Add(2 * time.Minute).Unix()
	for name, testCase := range map[string]struct {
		claims jwt.MapClaims
		opts   oauthrs.MCPTokenOptions
	}{
		"missing bound":        {bounded, oauthrs.MCPTokenOptions{ConnectionValidationMode: oauthrs.ConnectionValidationOfflineDevelopment}},
		"bound above hard cap": {bounded, oauthrs.MCPTokenOptions{ConnectionValidationMode: oauthrs.ConnectionValidationOfflineDevelopment, OfflineMaxTokenTTL: oauthrs.MaxOfflineDevelopmentTokenTTL + time.Second}},
		"token exceeds bound":  {longLived, offline},
		"issued at missing":    {missingIssuedAt, offline},
	} {
		t.Run(name, func(t *testing.T) {
			rec := run(testCase.claims, testCase.opts)
			if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), `"code":"connection_revoked"`) {
				t.Fatalf("want 403 connection_revoked, got %d: %s", rec.Code, rec.Body.String())
			}
		})
	}
}
