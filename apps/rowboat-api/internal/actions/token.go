package actions

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// tokenPrefix makes an action approval token recognizable in logs and headers,
// and distinct from other token families (agt_ agent tokens, etc.).
const tokenPrefix = "acta_"

// tokenKind tags the signed envelope so an action approval token can never be
// verified as some other HMAC-signed envelope that happens to share the secret.
const tokenKind = "action_approval"

// Token errors surfaced by Verify. They are deliberately coarse so a caller
// never learns *why* a forged token failed beyond the security-relevant class.
var (
	// ErrTokenMalformed means the token could not be parsed as a signed envelope.
	ErrTokenMalformed = errors.New("actions: malformed approval token")
	// ErrTokenSignature means the HMAC did not verify (forged or wrong secret).
	ErrTokenSignature = errors.New("actions: approval token signature mismatch")
	// ErrTokenExpired means the token's own expiry has passed.
	ErrTokenExpired = errors.New("actions: approval token expired")
	// ErrTokenKind means the envelope was signed for a different purpose.
	ErrTokenKind = errors.New("actions: wrong approval token kind")
)

// Claims binds an approval token to exactly one action proposal, its exact
// params, and the approving operator. The signature covers every claim, so a
// tampered token (swapped target, kind, params, or operator) fails Verify.
type Claims struct {
	ProposalID string `json:"pid"`
	Target     string `json:"tgt"`
	Kind       string `json:"knd"`
	ParamsHash string `json:"ph"`
	UserID     string `json:"uid"`
	StepUp     bool   `json:"su"`
}

// envelope is the signed payload: kind tag + claims + issued/expiry timestamps.
type envelope struct {
	Kind   string          `json:"k"`
	Claims json.RawMessage `json:"c"`
	Iat    int64           `json:"iat"`
	Exp    int64           `json:"exp"`
}

// Signer mints and verifies approval tokens with one shared HMAC-SHA256 secret.
type Signer struct{ secret []byte }

// NewSigner builds a signer. An empty secret is rejected so the broker fails
// closed rather than signing (and trusting) tokens with a zero key.
func NewSigner(secret string) (*Signer, error) {
	if strings.TrimSpace(secret) == "" {
		return nil, errors.New("actions: signing secret is required")
	}
	return &Signer{secret: []byte(secret)}, nil
}

// Mint returns a signed, opaque token carrying the claims and expiring after
// ttl. The returned string is the ONLY time the token exists in the clear; the
// broker stores only its hash.
func (s *Signer) Mint(claims Claims, now time.Time, ttl time.Duration) (string, time.Time, error) {
	raw, err := json.Marshal(claims)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("actions: marshal claims: %w", err)
	}
	exp := now.Add(ttl)
	env := envelope{Kind: tokenKind, Claims: raw, Iat: now.Unix(), Exp: exp.Unix()}
	body, err := json.Marshal(env)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("actions: marshal envelope: %w", err)
	}
	payload := base64.RawURLEncoding.EncodeToString(body)
	sig := s.sign(payload)
	return tokenPrefix + payload + "." + sig, exp, nil
}

// Verify checks the signature, kind, and expiry, and returns the claims. It
// does NOT check single-use — that is the broker's DB-backed responsibility.
func (s *Signer) Verify(token string, now time.Time) (*Claims, error) {
	rest, ok := strings.CutPrefix(token, tokenPrefix)
	if !ok {
		return nil, ErrTokenMalformed
	}
	payload, sig, ok := strings.Cut(rest, ".")
	if !ok {
		return nil, ErrTokenMalformed
	}
	// Constant-time signature comparison before touching the payload.
	if subtle.ConstantTimeCompare([]byte(sig), []byte(s.sign(payload))) != 1 {
		return nil, ErrTokenSignature
	}
	body, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return nil, ErrTokenMalformed
	}
	var env envelope
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, ErrTokenMalformed
	}
	if env.Kind != tokenKind {
		return nil, ErrTokenKind
	}
	if now.Unix() >= env.Exp {
		return nil, ErrTokenExpired
	}
	var claims Claims
	if err := json.Unmarshal(env.Claims, &claims); err != nil {
		return nil, ErrTokenMalformed
	}
	return &claims, nil
}

// Hash returns the SHA-256 hex digest of a token — the single-use ledger key
// stored in the ApprovalToken row. Storing the hash (never the token) means a
// database read can never yield a usable token.
func Hash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return fmt.Sprintf("%x", sum)
}

// sign computes the base64url HMAC-SHA256 of the payload.
func (s *Signer) sign(payload string) string {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// ParamsHash is the canonical SHA-256 hex of an action's params JSON. It is
// order-independent: params are re-marshaled through Go's map encoder (which
// sorts keys recursively), so semantically equal params hash equally and an
// edit that changes any value produces a different hash — invalidating any
// prior token bound to the old params.
func ParamsHash(paramsJSON string) (string, error) {
	trimmed := strings.TrimSpace(paramsJSON)
	if trimmed == "" {
		trimmed = "null"
	}
	var v any
	if err := json.Unmarshal([]byte(trimmed), &v); err != nil {
		return "", fmt.Errorf("actions: params is not valid JSON: %w", err)
	}
	canonical, err := json.Marshal(v)
	if err != nil {
		return "", fmt.Errorf("actions: canonicalize params: %w", err)
	}
	sum := sha256.Sum256(canonical)
	return fmt.Sprintf("%x", sum), nil
}
