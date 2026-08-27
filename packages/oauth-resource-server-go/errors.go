package oauthrs

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/golang-jwt/jwt/v5"
)

// ErrorCode is a stable RFC 012 resource-server denial code.
type ErrorCode string

const (
	CodeTokenMissing          ErrorCode = "token_missing"
	CodeTokenExpired          ErrorCode = "token_expired"
	CodeTokenInvalidSignature ErrorCode = "token_invalid_signature"
	CodeAudienceMismatch      ErrorCode = "audience_mismatch"
	CodeScopeMissing          ErrorCode = "scope_missing"
	CodeConnectionRevoked     ErrorCode = "connection_revoked"
	CodeApprovalRequired      ErrorCode = "approval_required"
)

// AuthorizationError is returned for every deny-by-default authorization
// failure. Code and Status are safe to expose to callers; Cause is retained for
// server-side diagnostics and is not written to HTTP responses.
type AuthorizationError struct {
	Code    ErrorCode
	Status  int
	Message string
	Cause   error
}

func (e *AuthorizationError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("oauthrs: %s: %v", e.Code, e.Cause)
	}
	return fmt.Sprintf("oauthrs: %s", e.Code)
}

func (e *AuthorizationError) Unwrap() error { return e.Cause }

func authorizationError(code ErrorCode, status int, message string, cause error) *AuthorizationError {
	return &AuthorizationError{Code: code, Status: status, Message: message, Cause: cause}
}

func classifyTokenError(err error) *AuthorizationError {
	// Signature and algorithm failures take precedence over claim failures when a
	// parser reports both. This prevents a forged expired token from being
	// misreported as merely expired.
	if errors.Is(err, jwt.ErrTokenSignatureInvalid) || errors.Is(err, jwt.ErrTokenUnverifiable) || errors.Is(err, jwt.ErrTokenMalformed) {
		return authorizationError(CodeTokenInvalidSignature, http.StatusUnauthorized, "invalid token signature", err)
	}
	if errors.Is(err, jwt.ErrTokenInvalidAudience) {
		return authorizationError(CodeAudienceMismatch, http.StatusUnauthorized, "token audience mismatch", err)
	}
	if errors.Is(err, jwt.ErrTokenExpired) {
		return authorizationError(CodeTokenExpired, http.StatusUnauthorized, "token expired", err)
	}
	// RFC 012 intentionally exposes a small fixed code set. Issuer, nbf, iat,
	// malformed-claim, and key lookup failures are deliberately collapsed to the
	// non-oracular invalid-token code.
	return authorizationError(CodeTokenInvalidSignature, http.StatusUnauthorized, "invalid token signature", err)
}
