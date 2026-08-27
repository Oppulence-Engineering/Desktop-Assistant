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
	"testing"
	"time"

	oauthrs "github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go"
)

func TestRSAResourceTokenIssuerProducesVerifiableBoundedActorToken(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	issuer, err := NewRSAResourceTokenIssuer(pemBytes, "kid-1", "https://broker.test", 5*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(issuer.JWKS())
	}))
	defer jwks.Close()
	verifier, err := oauthrs.New(context.Background(), oauthrs.Config{
		IssuerURL: "https://broker.test", Audience: "mcp:canvas", JWKSURL: jwks.URL,
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

func TestRSAResourceTokenIssuerRejectsUnsafeConfiguration(t *testing.T) {
	if _, err := NewRSAResourceTokenIssuer([]byte("not pem"), "kid", "https://broker.test", time.Minute); err == nil {
		t.Fatal("invalid PEM accepted")
	}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	if _, err := NewRSAResourceTokenIssuer(pemBytes, "kid", "https://broker.test", 16*time.Minute); err == nil {
		t.Fatal("overlong token TTL accepted")
	}
}
