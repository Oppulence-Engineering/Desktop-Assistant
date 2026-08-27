package connectors

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	oauthrs "github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go"
)

func privatePEM(t *testing.T, key *rsa.PrivateKey) []byte {
	t.Helper()
	return pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
}

func publicPEM(t *testing.T, key *rsa.PrivateKey) string {
	t.Helper()
	der, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))
}

func keyringJSON(t *testing.T, keys map[string]*rsa.PrivateKey) []byte {
	t.Helper()
	values := make(map[string]string, len(keys))
	for kid, key := range keys {
		values[kid] = publicPEM(t, key)
	}
	encoded, err := json.Marshal(values)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func newTestIssuer(t *testing.T, key *rsa.PrivateKey, kid string, ring map[string]*rsa.PrivateKey) *RSAResourceTokenIssuer {
	t.Helper()
	issuer, err := NewRSAResourceTokenIssuer(privatePEM(t, key), kid, "https://broker.test", 5*time.Minute, keyringJSON(t, ring))
	if err != nil {
		t.Fatal(err)
	}
	return issuer
}

func mintTestToken(t *testing.T, issuer *RSAResourceTokenIssuer) string {
	t.Helper()
	token, _, err := issuer.Mint(ResourceTokenClaims{
		UserID: "user_1", OrganizationID: "org_1", ConnectionID: "conn_1",
		ConnectorID: "canvas", Audience: "mcp:canvas",
		Scopes: []string{"canvas:invoices.read"}, TrustTier: "low",
	})
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func TestRSAResourceTokenIssuerProducesVerifiableBoundedActorToken(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	issuer := newTestIssuer(t, key, "kid-1", map[string]*rsa.PrivateKey{"kid-1": key})
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(issuer.JWKS())
	}))
	defer jwks.Close()
	verifier, err := oauthrs.New(context.Background(), oauthrs.Config{
		IssuerURL: "https://broker.test", Audience: "mcp:canvas", JWKSURL: jwks.URL,
		AllowedJWKSOrigins: []string{jwks.URL}, AllowLocalhostDevelopment: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	token, expiresAt, err := issuer.Mint(ResourceTokenClaims{
		UserID: "user_1", OrganizationID: "org_1", ConnectionID: "conn_1",
		ConnectorID: "canvas", Audience: "mcp:canvas",
		Scopes: []string{"canvas:invoices.read"}, TrustTier: "low",
	})
	if err != nil {
		t.Fatal(err)
	}
	if ttl := time.Until(expiresAt); ttl <= 4*time.Minute || ttl > 5*time.Minute {
		t.Fatalf("token TTL = %s", ttl)
	}
	claims, err := verifier.Verify(token)
	if err != nil {
		t.Fatal(err)
	}
	if claims.UserID != "user_1" || claims.OrganizationID != "org_1" || claims.ConnectionID != "conn_1" || claims.ConnectorID != "canvas" || claims.TrustTier != "low" || !claims.HasScope("canvas:invoices.read") {
		t.Fatalf("unexpected claims: %+v", claims)
	}
}

func TestRSAResourceTokenIssuerStagedRotationAndUnknownKidRefetch(t *testing.T) {
	oldKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	newKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	oldOnly := newTestIssuer(t, oldKey, "old", map[string]*rsa.PrivateKey{"old": oldKey})
	overlapOld := newTestIssuer(t, oldKey, "old", map[string]*rsa.PrivateKey{"old": oldKey, "new": newKey})
	overlapNew := newTestIssuer(t, newKey, "new", map[string]*rsa.PrivateKey{"old": oldKey, "new": newKey})
	newOnly := newTestIssuer(t, newKey, "new", map[string]*rsa.PrivateKey{"new": newKey})

	var mu sync.RWMutex
	published := oldOnly
	fetches := 0
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		mu.Lock()
		fetches++
		current := published
		mu.Unlock()
		_ = json.NewEncoder(w).Encode(current.JWKS())
	}))
	defer jwks.Close()
	verifier, err := oauthrs.New(context.Background(), oauthrs.Config{IssuerURL: "https://broker.test", Audience: "mcp:canvas", JWKSURL: jwks.URL, AllowedJWKSOrigins: []string{jwks.URL}, AllowLocalhostDevelopment: true})
	if err != nil {
		t.Fatal(err)
	}
	oldToken := mintTestToken(t, oldOnly)
	if _, err := verifier.Verify(oldToken); err != nil {
		t.Fatalf("old token before rotation: %v", err)
	}

	mu.Lock()
	published = overlapOld
	mu.Unlock()
	newToken := mintTestToken(t, overlapNew)
	before := fetches
	if _, err := verifier.Verify(newToken); err != nil {
		t.Fatalf("new token after overlap publication: %v", err)
	}
	if fetches <= before {
		t.Fatal("unknown new kid did not trigger JWKS refetch")
	}
	if _, err := verifier.Verify(oldToken); err != nil {
		t.Fatalf("old token during overlap: %v", err)
	}

	mu.Lock()
	published = newOnly
	mu.Unlock()
	// A fresh verifier models the post-TTL retirement stage and must accept new.
	retiredVerifier, err := oauthrs.New(context.Background(), oauthrs.Config{IssuerURL: "https://broker.test", Audience: "mcp:canvas", JWKSURL: jwks.URL, AllowedJWKSOrigins: []string{jwks.URL}, AllowLocalhostDevelopment: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := retiredVerifier.Verify(newToken); err != nil {
		t.Fatalf("new token after retirement: %v", err)
	}
}

func TestRSAResourceTokenIssuerRejectsUnsafeConfiguration(t *testing.T) {
	if _, err := NewRSAResourceTokenIssuer([]byte("not pem"), "kid", "https://broker.test", time.Minute, []byte(`{"kid":"bad"}`)); err == nil {
		t.Fatal("invalid PEM accepted")
	}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewRSAResourceTokenIssuer(privatePEM(t, key), "kid", "https://broker.test", 16*time.Minute, keyringJSON(t, map[string]*rsa.PrivateKey{"kid": key})); err == nil {
		t.Fatal("overlong token TTL accepted")
	}
	if _, err := NewRSAResourceTokenIssuer(privatePEM(t, key), "missing", "https://broker.test", time.Minute, keyringJSON(t, map[string]*rsa.PrivateKey{"kid": key})); err == nil {
		t.Fatal("active key missing from verification keyring accepted")
	}
	other, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewRSAResourceTokenIssuer(privatePEM(t, key), "kid", "https://broker.test", time.Minute, keyringJSON(t, map[string]*rsa.PrivateKey{"kid": other})); err == nil {
		t.Fatal("mismatched active signing and verification keys accepted")
	}
}
