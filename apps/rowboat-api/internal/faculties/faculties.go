// Package faculties is the HTTP client for the Oppulence portfolio faculties
// (RFC 008): Conduit (the evidence plane) and Eigen (the foresight engine). The
// cloud agent reaches each faculty as a runtime tool that POSTs an operation to
// the faculty's configured endpoint, authenticated with a short-lived signed
// delegation token plus the acting user's id (on-behalf-of). The signing secret
// stays server-side and never enters model prompts or logs.
package faculties

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"github.com/google/uuid"
)

const (
	delegationPrefix = "rbd_"
	defaultTTL       = 5 * time.Minute
)

var (
	ErrMalformedDelegation = errors.New("faculties: malformed delegation token")
	ErrDelegationSignature = errors.New("faculties: delegation signature mismatch")
	ErrDelegationExpired   = errors.New("faculties: delegation token expired")
	ErrDelegationBody      = errors.New("faculties: delegation body hash mismatch")
	ErrDelegationIssuer    = errors.New("faculties: delegation issuer mismatch")
	ErrDelegationAudience  = errors.New("faculties: delegation audience mismatch")
	ErrDelegationMethod    = errors.New("faculties: delegation method mismatch")
	ErrDelegationPath      = errors.New("faculties: delegation path mismatch")
)

// DelegationClaims are signed into every faculty request.
type DelegationClaims struct {
	Issuer     string `json:"iss"`
	Audience   string `json:"aud"`
	Subject    string `json:"sub,omitempty"`
	Method     string `json:"method"`
	Path       string `json:"path"`
	BodySHA256 string `json:"bodySha256"`
	Nonce      string `json:"jti"`
	IssuedAt   int64  `json:"iat"`
	ExpiresAt  int64  `json:"exp"`
}

// DelegationExpectation is what a receiving faculty service expects for one
// inbound endpoint.
type DelegationExpectation struct {
	Issuer   string
	Audience string
	Method   string
	Path     string
}

// Client calls one faculty's HTTP API.
type Client struct {
	http          *outbound.Client
	baseURL       string
	name          string
	issuer        string
	signingSecret []byte
	now           func() time.Time
	ttl           time.Duration
}

// New builds a faculty client. Returns nil when the faculty is not configured
// (no base URL, issuer, or signing secret), so the corresponding tool reports
// itself unavailable rather than calling an unauthenticated endpoint.
func New(name, baseURL, issuer, signingSecret string, policy outbound.Policy) *Client {
	if strings.TrimSpace(name) == "" || strings.TrimSpace(baseURL) == "" || strings.TrimSpace(issuer) == "" || strings.TrimSpace(signingSecret) == "" {
		return nil
	}
	policy.Name = "faculty-" + name
	if policy.Timeout == 0 {
		policy.Timeout = 30 * time.Second
	}
	return &Client{
		http:          outbound.NewClient(policy),
		baseURL:       strings.TrimRight(baseURL, "/"),
		name:          strings.TrimSpace(name),
		issuer:        strings.TrimSpace(issuer),
		signingSecret: []byte(signingSecret),
		now:           time.Now,
		ttl:           defaultTTL,
	}
}

// Call POSTs body to path on behalf of userID and returns the faculty's raw JSON
// response (passed through to the model). A non-JSON 200 body is wrapped so the
// transcript always carries valid JSON.
func (c *Client) Call(ctx context.Context, userID, path string, body any) (json.RawMessage, error) {
	if c == nil {
		// Must not read c.name here — c is the nil receiver.
		return nil, fmt.Errorf("faculties: client not configured")
	}
	reqBody, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	token, err := c.mintDelegation(userID, http.MethodPost, path, reqBody)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(reqBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	if userID != "" {
		req.Header.Set("X-Rowboat-User", userID)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("faculties: %s request: %w", c.name, err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := outbound.ReadAll(resp.Body, c.http.MaxResponseBytes())
	if err != nil {
		return nil, fmt.Errorf("faculties: %s read response: %w", c.name, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("faculties: %s returned status %d", c.name, resp.StatusCode)
	}
	if !json.Valid(raw) {
		wrapped, _ := json.Marshal(map[string]string{"raw": string(raw)})
		return wrapped, nil
	}
	return raw, nil
}

func (c *Client) mintDelegation(userID, method, path string, body []byte) (string, error) {
	now := c.now().UTC()
	claims := DelegationClaims{
		Issuer:     c.issuer,
		Audience:   c.name,
		Subject:    userID,
		Method:     method,
		Path:       path,
		BodySHA256: bodyHash(body),
		Nonce:      uuid.NewString(),
		IssuedAt:   now.Unix(),
		ExpiresAt:  now.Add(c.ttl).Unix(),
	}
	raw, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(raw)
	sig := base64.RawURLEncoding.EncodeToString(sign(c.signingSecret, payload))
	return delegationPrefix + payload + "." + sig, nil
}

// VerifyDelegation verifies a token minted by Client and checks that it is
// bound to the supplied request body. Faculty services use this on ingress.
func VerifyDelegation(token, signingSecret string, body []byte, now time.Time) (DelegationClaims, error) {
	var claims DelegationClaims
	if strings.TrimSpace(signingSecret) == "" {
		return claims, ErrDelegationSignature
	}
	token = strings.TrimSpace(token)
	if strings.HasPrefix(token, "Bearer ") {
		token = strings.TrimSpace(strings.TrimPrefix(token, "Bearer "))
	}
	if !strings.HasPrefix(token, delegationPrefix) {
		return claims, ErrMalformedDelegation
	}
	token = strings.TrimPrefix(token, delegationPrefix)
	payload, gotSig, ok := strings.Cut(token, ".")
	if !ok || payload == "" || gotSig == "" {
		return claims, ErrMalformedDelegation
	}
	wantSig := base64.RawURLEncoding.EncodeToString(sign([]byte(signingSecret), payload))
	if subtle.ConstantTimeCompare([]byte(wantSig), []byte(gotSig)) != 1 {
		return claims, ErrDelegationSignature
	}
	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return claims, ErrMalformedDelegation
	}
	if err := json.Unmarshal(raw, &claims); err != nil {
		return claims, ErrMalformedDelegation
	}
	if now.UTC().Unix() > claims.ExpiresAt {
		return claims, ErrDelegationExpired
	}
	if claims.BodySHA256 != bodyHash(body) {
		return claims, ErrDelegationBody
	}
	return claims, nil
}

// VerifyDelegationFor verifies a signed delegation token and enforces the
// receiver-side endpoint binding. Internal services should call this variant
// with their expected issuer/audience/method/path before accepting a request.
func VerifyDelegationFor(token, signingSecret string, expect DelegationExpectation, body []byte, now time.Time) (DelegationClaims, error) {
	claims, err := VerifyDelegation(token, signingSecret, body, now)
	if err != nil {
		return claims, err
	}
	if expect.Issuer != "" && claims.Issuer != expect.Issuer {
		return claims, ErrDelegationIssuer
	}
	if expect.Audience != "" && claims.Audience != expect.Audience {
		return claims, ErrDelegationAudience
	}
	if expect.Method != "" && !strings.EqualFold(claims.Method, expect.Method) {
		return claims, ErrDelegationMethod
	}
	if expect.Path != "" && claims.Path != expect.Path {
		return claims, ErrDelegationPath
	}
	return claims, nil
}

func sign(secret []byte, payload string) []byte {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(payload))
	return mac.Sum(nil)
}

func bodyHash(body []byte) string {
	sum := sha256.Sum256(body)
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
