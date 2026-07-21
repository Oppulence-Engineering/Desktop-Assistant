// Package agenttoken mints and verifies the durable agent runtime's short-lived
// signed tokens (RFC 027 / RFC 012): per-invocation money-moving approval tokens
// (carrying the MFA step-up assertion) and session continuation tokens. Both are
// HMAC-SHA256-signed envelopes tagged with a kind so an approval token can never
// be replayed as a continuation token (or vice versa). The signature binds every
// claim, so a tampered token (changed amount, recipient, session, or mfa flag)
// fails verification.
package agenttoken

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

// Kind tags the envelope so kinds are not interchangeable.
type Kind string

const (
	// KindApproval identifies a signed approval token.
	KindApproval Kind = "approval"
	// KindContinuation identifies a signed continuation token.
	KindContinuation Kind = "continuation"
)

// tokenPrefix makes a token recognizable in logs/headers (and keeps the
// money-moving "appr_"-style shape callers expect).
const tokenPrefix = "agt_"

// Errors returned by Verify.
var (
	ErrMalformed   = errors.New("agenttoken: malformed token")
	ErrSignature   = errors.New("agenttoken: signature mismatch")
	ErrExpired     = errors.New("agenttoken: token expired")
	ErrNotYetValid = errors.New("agenttoken: token issued in the future")
	ErrKind        = errors.New("agenttoken: wrong token kind")
	ErrClaims      = errors.New("agenttoken: invalid claims")
)

// ApprovalClaims binds a money-moving approval token to exactly one approval
// gate, the resolving user, and whether an MFA step-up backed it (RFC 012).
type ApprovalClaims struct {
	ApprovalID string `json:"aid"`
	UserID     string `json:"uid"`
	SessionID  string `json:"sid"`
	TrustTier  string `json:"tier"`
	MFA        bool   `json:"mfa"`
}

// ContinuationClaims encodes the stable session workflow id (survives
// ContinueAsNew) bound to its owner so the token cannot be forged or reused
// across tenants.
type ContinuationClaims struct {
	WorkflowID string `json:"wf"`
	SessionID  string `json:"sid"`
	UserID     string `json:"uid"`
}

// envelope is the signed payload: kind + claims + expiry.
type envelope struct {
	Kind   Kind            `json:"k"`
	Claims json.RawMessage `json:"c"`
	Iat    int64           `json:"iat"`
	Exp    int64           `json:"exp"`
}

// Signer mints and verifies tokens with one shared secret.
type Signer struct{ secret []byte }

// NewSigner builds a signer. An empty secret is rejected: callers must fail
// closed rather than sign with a zero key.
func NewSigner(secret string) (*Signer, error) {
	if strings.TrimSpace(secret) == "" {
		return nil, errors.New("agenttoken: signing secret is required")
	}
	return &Signer{secret: []byte(secret)}, nil
}

// MintApproval issues a money-moving approval token valid for ttl.
func (s *Signer) MintApproval(c ApprovalClaims, now time.Time, ttl time.Duration) (string, error) {
	return s.mint(KindApproval, c, now, ttl)
}

// MintContinuation issues a session continuation token valid for ttl.
func (s *Signer) MintContinuation(c ContinuationClaims, now time.Time, ttl time.Duration) (string, error) {
	return s.mint(KindContinuation, c, now, ttl)
}

func (s *Signer) mint(kind Kind, claims any, now time.Time, ttl time.Duration) (string, error) {
	if ttl <= 0 {
		return "", fmt.Errorf("%w: ttl must be positive", ErrClaims)
	}
	if err := validateClaims(kind, claims); err != nil {
		return "", err
	}
	raw, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	env := envelope{Kind: kind, Claims: raw, Iat: now.Unix(), Exp: now.Add(ttl).Unix()}
	body, err := json.Marshal(env)
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(body)
	sig := base64.RawURLEncoding.EncodeToString(s.sign(payload))
	return tokenPrefix + payload + "." + sig, nil
}

// VerifyApproval verifies an approval token and returns its claims.
func (s *Signer) VerifyApproval(token string, now time.Time) (ApprovalClaims, error) {
	var c ApprovalClaims
	err := s.verify(KindApproval, token, now, &c)
	return c, err
}

// VerifyContinuation verifies a continuation token and returns its claims.
func (s *Signer) VerifyContinuation(token string, now time.Time) (ContinuationClaims, error) {
	var c ContinuationClaims
	err := s.verify(KindContinuation, token, now, &c)
	return c, err
}

func (s *Signer) verify(kind Kind, token string, now time.Time, out any) error {
	token = strings.TrimSpace(token)
	if !strings.HasPrefix(token, tokenPrefix) {
		return ErrMalformed
	}
	token = strings.TrimPrefix(token, tokenPrefix)
	payload, sig, ok := strings.Cut(token, ".")
	if !ok || payload == "" || sig == "" {
		return ErrMalformed
	}
	want := base64.RawURLEncoding.EncodeToString(s.sign(payload))
	if subtle.ConstantTimeCompare([]byte(want), []byte(sig)) != 1 {
		return ErrSignature
	}
	body, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return ErrMalformed
	}
	var env envelope
	if err := json.Unmarshal(body, &env); err != nil {
		return ErrMalformed
	}
	if env.Kind != kind {
		return ErrKind
	}
	if env.Iat <= 0 || env.Exp <= env.Iat {
		return ErrMalformed
	}
	if env.Iat > now.Add(time.Minute).Unix() {
		return ErrNotYetValid
	}
	if now.Unix() >= env.Exp {
		return ErrExpired
	}
	if err := json.Unmarshal(env.Claims, out); err != nil {
		return fmt.Errorf("agenttoken: decode claims: %w", err)
	}
	if err := validateClaims(kind, out); err != nil {
		return err
	}
	return nil
}

func validateClaims(kind Kind, claims any) error {
	missing := false
	switch kind {
	case KindApproval:
		var c ApprovalClaims
		switch v := claims.(type) {
		case ApprovalClaims:
			c = v
		case *ApprovalClaims:
			if v != nil {
				c = *v
			}
		default:
			missing = true
		}
		missing = missing || strings.TrimSpace(c.ApprovalID) == "" || strings.TrimSpace(c.UserID) == "" ||
			strings.TrimSpace(c.SessionID) == "" || strings.TrimSpace(c.TrustTier) == ""
	case KindContinuation:
		var c ContinuationClaims
		switch v := claims.(type) {
		case ContinuationClaims:
			c = v
		case *ContinuationClaims:
			if v != nil {
				c = *v
			}
		default:
			missing = true
		}
		missing = missing || strings.TrimSpace(c.WorkflowID) == "" || strings.TrimSpace(c.SessionID) == "" || strings.TrimSpace(c.UserID) == ""
	default:
		return ErrKind
	}
	if missing {
		return ErrClaims
	}
	return nil
}

func (s *Signer) sign(payload string) []byte {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(payload))
	return mac.Sum(nil)
}
