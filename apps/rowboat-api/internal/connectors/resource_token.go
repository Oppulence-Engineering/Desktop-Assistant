package connectors

import (
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const (
	defaultResourceTokenTTL = 5 * time.Minute
	maxResourceTokenTTL     = 15 * time.Minute
)

// ResourceTokenClaims is the bounded actor and authorization context carried by
// an RFC 012 product token. Provider access and refresh credentials are never
// included in this envelope.
type ResourceTokenClaims struct {
	UserID         string
	OrganizationID string
	ConnectionID   string
	ConnectorID    string
	Audience       string
	Scopes         []string
	TrustTier      string
}

// ResourceTokenIssuer mints short-lived, audience-bound product tokens and
// publishes the matching public key set for product resource servers.
type ResourceTokenIssuer interface {
	Mint(ResourceTokenClaims) (token string, expiresAt time.Time, err error)
	JWKS() map[string]any
}

// RSAResourceTokenIssuer signs RFC 012 resource tokens with RS256.
type RSAResourceTokenIssuer struct {
	privateKey *rsa.PrivateKey
	keyID      string
	issuer     string
	ttl        time.Duration
}

// NewRSAResourceTokenIssuer parses an RSA private key in PKCS#1 or PKCS#8 PEM
// form. The TTL is capped at 15 minutes by the RFC 012 resource-token contract.
func NewRSAResourceTokenIssuer(privateKeyPEM []byte, keyID, issuer string, ttl time.Duration) (*RSAResourceTokenIssuer, error) {
	keyID = strings.TrimSpace(keyID)
	issuer = strings.TrimRight(strings.TrimSpace(issuer), "/")
	if keyID == "" {
		return nil, errors.New("connector resource token key ID is required")
	}
	if issuer == "" {
		return nil, errors.New("connector resource token issuer is required")
	}
	block, _ := pem.Decode(privateKeyPEM)
	if block == nil {
		return nil, errors.New("connector resource token private key is not valid PEM")
	}
	var key *rsa.PrivateKey
	if parsed, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		key = parsed
	} else if parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		var ok bool
		key, ok = parsed.(*rsa.PrivateKey)
		if !ok {
			return nil, errors.New("connector resource token private key must be RSA")
		}
	} else {
		return nil, errors.New("connector resource token private key must be PKCS#1 or PKCS#8 RSA")
	}
	if key.N.BitLen() < 2048 {
		return nil, errors.New("connector resource token RSA key must be at least 2048 bits")
	}
	if ttl == 0 {
		ttl = defaultResourceTokenTTL
	}
	if ttl <= 0 || ttl > maxResourceTokenTTL {
		return nil, fmt.Errorf("connector resource token TTL must be between 1ns and %s", maxResourceTokenTTL)
	}
	return &RSAResourceTokenIssuer{privateKey: key, keyID: keyID, issuer: issuer, ttl: ttl}, nil
}

// Mint creates one short-lived RS256 token with standard OAuth scope plus the
// normalized connector actor fields consumed by both resource-server libraries.
func (i *RSAResourceTokenIssuer) Mint(c ResourceTokenClaims) (string, time.Time, error) {
	if i == nil || i.privateKey == nil {
		return "", time.Time{}, errors.New("connector resource token issuer is not configured")
	}
	if strings.TrimSpace(c.UserID) == "" || strings.TrimSpace(c.ConnectionID) == "" || strings.TrimSpace(c.ConnectorID) == "" || strings.TrimSpace(c.Audience) == "" {
		return "", time.Time{}, errors.New("connector resource token actor, connection, connector, and audience are required")
	}
	now := time.Now().UTC()
	expiresAt := now.Add(i.ttl)
	jti := uuid.NewString()
	ext := map[string]any{
		"user_id":        c.UserID,
		"workos_user_id": c.UserID,
		"connection_id":  c.ConnectionID,
		"connector_id":   c.ConnectorID,
		"token_id":       jti,
		"trust_tier":     c.TrustTier,
	}
	if c.OrganizationID != "" {
		ext["organization_id"] = c.OrganizationID
		ext["workos_org_id"] = c.OrganizationID
	}
	claims := jwt.MapClaims{
		"iss":   i.issuer,
		"aud":   []string{c.Audience},
		"sub":   c.UserID,
		"iat":   now.Unix(),
		"nbf":   now.Unix(),
		"exp":   expiresAt.Unix(),
		"jti":   jti,
		"scope": strings.Join(c.Scopes, " "),
		"ext":   ext,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = i.keyID
	signed, err := token.SignedString(i.privateKey)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("sign connector resource token: %w", err)
	}
	return signed, expiresAt, nil
}

// JWKS returns the public RS256 key only. Private key material is never exposed.
func (i *RSAResourceTokenIssuer) JWKS() map[string]any {
	if i == nil || i.privateKey == nil {
		return map[string]any{"keys": []any{}}
	}
	e := big.NewInt(int64(i.privateKey.PublicKey.E)).Bytes()
	return map[string]any{"keys": []map[string]string{{
		"kty": "RSA",
		"use": "sig",
		"alg": "RS256",
		"kid": i.keyID,
		"n":   base64.RawURLEncoding.EncodeToString(i.privateKey.N.Bytes()),
		"e":   base64.RawURLEncoding.EncodeToString(e),
	}}}
}

func trustTierForScopes(registry *Registry, connector string, scopes []string) string {
	rank := map[string]int{"low": 0, "medium": 1, "high": 2, "money-moving": 3}
	tier := "low"
	for _, scope := range registry.definitionsForScopes(connector, scopes) {
		if rank[scope.Risk] > rank[tier] {
			tier = scope.Risk
		}
	}
	return tier
}
