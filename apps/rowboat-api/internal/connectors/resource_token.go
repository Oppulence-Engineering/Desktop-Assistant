package connectors

import (
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
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

// ResourceTokenClaims binds a short-lived product token to its actor, tenant,
// connection, connector, audience, scopes, and trust tier.
type ResourceTokenClaims struct {
	TokenID        string
	UserID         string
	OrganizationID string
	ConnectionID   string
	ConnectorID    string
	Audience       string
	Scopes         []string
	TrustTier      string
}

// ResourceTokenIssuer mints connector-bound resource tokens and publishes JWKS.
type ResourceTokenIssuer interface {
	Mint(ResourceTokenClaims) (token string, expiresAt time.Time, err error)
	JWKS() map[string]any
}

// RSAResourceTokenIssuer signs with one active private key while publishing a
// verification keyring that can overlap old and new keys during staged rotation.
type RSAResourceTokenIssuer struct {
	privateKey       *rsa.PrivateKey
	keyID            string
	issuer           string
	ttl              time.Duration
	verificationKeys map[string]*rsa.PublicKey
}

// NewRSAResourceTokenIssuer validates that activeKeyID exists in the configured
// verification keyring and that its public key matches activePrivateKeyPEM.
// verificationKeyringJSON is a JSON object mapping kid to RSA public/private PEM.
func NewRSAResourceTokenIssuer(activePrivateKeyPEM []byte, activeKeyID, issuer string, ttl time.Duration, verificationKeyringJSON ...[]byte) (*RSAResourceTokenIssuer, error) {
	activeKeyID = strings.TrimSpace(activeKeyID)
	issuer = strings.TrimRight(strings.TrimSpace(issuer), "/")
	if activeKeyID == "" {
		return nil, errors.New("connector resource token active key ID is required")
	}
	if issuer == "" {
		return nil, errors.New("connector resource token issuer is required")
	}
	privateKey, err := parseRSAPrivateKey(activePrivateKeyPEM)
	if err != nil {
		return nil, err
	}
	if privateKey.N.BitLen() < 2048 {
		return nil, errors.New("connector resource token RSA key must be at least 2048 bits")
	}
	if ttl == 0 {
		ttl = defaultResourceTokenTTL
	}
	if ttl <= 0 || ttl > maxResourceTokenTTL {
		return nil, fmt.Errorf("connector resource token TTL must be between 1ns and %s", maxResourceTokenTTL)
	}

	var configured map[string]string
	if len(verificationKeyringJSON) == 0 {
		configured = map[string]string{activeKeyID: string(activePrivateKeyPEM)}
	} else if err := json.Unmarshal(verificationKeyringJSON[0], &configured); err != nil {
		return nil, fmt.Errorf("parse connector resource token verification keyring: %w", err)
	}
	if len(configured) == 0 {
		return nil, errors.New("connector resource token verification keyring is required")
	}
	keys := make(map[string]*rsa.PublicKey, len(configured))
	for kid, keyPEM := range configured {
		kid = strings.TrimSpace(kid)
		if kid == "" {
			return nil, errors.New("connector resource token verification key ID must not be empty")
		}
		publicKey, parseErr := parseRSAPublicKey([]byte(keyPEM))
		if parseErr != nil {
			return nil, fmt.Errorf("parse connector resource token verification key %q: %w", kid, parseErr)
		}
		if publicKey.N.BitLen() < 2048 {
			return nil, fmt.Errorf("connector resource token verification key %q must be at least 2048 bits", kid)
		}
		keys[kid] = publicKey
	}
	primary, ok := keys[activeKeyID]
	if !ok {
		return nil, fmt.Errorf("connector resource token active key %q is not present in verification keyring", activeKeyID)
	}
	if primary.E != privateKey.E || primary.N.Cmp(privateKey.N) != 0 {
		return nil, fmt.Errorf("connector resource token active key %q does not match signing private key", activeKeyID)
	}
	return &RSAResourceTokenIssuer{privateKey: privateKey, keyID: activeKeyID, issuer: issuer, ttl: ttl, verificationKeys: keys}, nil
}

func parseRSAPrivateKey(privateKeyPEM []byte) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode(privateKeyPEM)
	if block == nil {
		return nil, errors.New("connector resource token private key is not valid PEM")
	}
	if parsed, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return parsed, nil
	}
	if parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		key, ok := parsed.(*rsa.PrivateKey)
		if !ok {
			return nil, errors.New("connector resource token private key must be RSA")
		}
		return key, nil
	}
	return nil, errors.New("connector resource token private key must be PKCS#1 or PKCS#8 RSA")
}

func parseRSAPublicKey(keyPEM []byte) (*rsa.PublicKey, error) {
	block, _ := pem.Decode(keyPEM)
	if block == nil {
		return nil, errors.New("key is not valid PEM")
	}
	if privateKey, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return &privateKey.PublicKey, nil
	}
	if parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		if privateKey, ok := parsed.(*rsa.PrivateKey); ok {
			return &privateKey.PublicKey, nil
		}
	}
	if publicKey, err := x509.ParsePKCS1PublicKey(block.Bytes); err == nil {
		return publicKey, nil
	}
	if parsed, err := x509.ParsePKIXPublicKey(block.Bytes); err == nil {
		if publicKey, ok := parsed.(*rsa.PublicKey); ok {
			return publicKey, nil
		}
	}
	return nil, errors.New("key must contain an RSA public or private key")
}

// Mint creates a short-lived RS256 resource token with strict connector bindings.
func (i *RSAResourceTokenIssuer) Mint(c ResourceTokenClaims) (string, time.Time, error) {
	if i == nil || i.privateKey == nil {
		return "", time.Time{}, errors.New("connector resource token issuer is not configured")
	}
	if strings.TrimSpace(c.UserID) == "" || strings.TrimSpace(c.ConnectionID) == "" || strings.TrimSpace(c.ConnectorID) == "" || strings.TrimSpace(c.Audience) == "" {
		return "", time.Time{}, errors.New("connector resource token actor, connection, connector, and audience are required")
	}
	now := time.Now().UTC()
	expiresAt := now.Add(i.ttl)
	jti := strings.TrimSpace(c.TokenID)
	if jti == "" {
		jti = uuid.NewString()
	}
	ext := map[string]any{
		"user_id": c.UserID, "workos_user_id": c.UserID, "connection_id": c.ConnectionID,
		"connector_id": c.ConnectorID, "token_id": jti, "trust_tier": c.TrustTier,
	}
	if c.OrganizationID != "" {
		ext["organization_id"] = c.OrganizationID
		ext["workos_org_id"] = c.OrganizationID
	}
	claims := jwt.MapClaims{
		"iss": i.issuer, "aud": []string{c.Audience}, "sub": c.UserID,
		"iat": now.Unix(), "nbf": now.Unix(), "exp": expiresAt.Unix(), "jti": jti,
		"scope": strings.Join(c.Scopes, " "), "ext": ext,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = i.keyID
	signed, err := token.SignedString(i.privateKey)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("sign connector resource token: %w", err)
	}
	return signed, expiresAt, nil
}

// JWKS publishes the full overlapping verification keyring in stable kid order.
func (i *RSAResourceTokenIssuer) JWKS() map[string]any {
	if i == nil || len(i.verificationKeys) == 0 {
		return map[string]any{"keys": []any{}}
	}
	kids := make([]string, 0, len(i.verificationKeys))
	for kid := range i.verificationKeys {
		kids = append(kids, kid)
	}
	slicesSort(kids)
	keys := make([]map[string]string, 0, len(kids))
	for _, kid := range kids {
		key := i.verificationKeys[kid]
		e := big.NewInt(int64(key.E)).Bytes()
		keys = append(keys, map[string]string{
			"kty": "RSA", "use": "sig", "alg": "RS256", "kid": kid,
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(e),
		})
	}
	return map[string]any{"keys": keys}
}

func slicesSort(values []string) {
	for i := 1; i < len(values); i++ {
		for j := i; j > 0 && values[j] < values[j-1]; j-- {
			values[j], values[j-1] = values[j-1], values[j]
		}
	}
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
