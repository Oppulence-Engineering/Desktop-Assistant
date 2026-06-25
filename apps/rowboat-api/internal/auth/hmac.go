package auth

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"io"
	"net/http"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
)

const maxHookBody = 1 << 20 // 1 MiB

// RequireHookHMAC verifies that X-Hook-Signature is the HMAC-SHA256 of the raw
// request body keyed by the shared secret. It is used on /oauth-hooks/* (called
// by Ory, not by users) and marks the request as an internal caller so handlers
// may read across tenants. Fails closed if the secret is unset.
func RequireHookHMAC(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if secret == "" {
				httpx.Error(w, http.StatusInternalServerError, "hook secret not configured", "internal_error")
				return
			}
			body, ok := httpx.ReadBody(w, r, maxHookBody)
			_ = r.Body.Close()
			if !ok {
				return
			}

			mac := hmac.New(sha256.New, []byte(secret))
			_, _ = mac.Write(body)
			expected := hex.EncodeToString(mac.Sum(nil))

			got := strings.TrimPrefix(r.Header.Get("X-Hook-Signature"), "sha256=")
			if !hmac.Equal([]byte(got), []byte(expected)) {
				httpx.Error(w, http.StatusUnauthorized, "invalid hook signature", "unauthorized")
				return
			}

			// Restore the body for the downstream handler and mark internal.
			r.Body = io.NopCloser(bytes.NewReader(body))
			ctx := WithInternal(r.Context())
			ctx = WithActor(ctx, &Actor{Kind: KindInternal, ServiceName: "oauth-hook"})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireInternalSecret guards server-to-server endpoints (/v1/internal/*) with
// a static shared secret in X-Internal-Secret, compared in constant time. Marks
// the request as an internal caller. Fails closed if the secret is unset.
func RequireInternalSecret(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if secret == "" {
				httpx.Error(w, http.StatusInternalServerError, "internal secret not configured", "internal_error")
				return
			}
			got := r.Header.Get("X-Internal-Secret")
			if subtle.ConstantTimeCompare([]byte(got), []byte(secret)) != 1 {
				httpx.Error(w, http.StatusUnauthorized, "invalid internal secret", "unauthorized")
				return
			}
			ctx := WithInternal(r.Context())
			ctx = WithActor(ctx, &Actor{Kind: KindInternal, ServiceName: "internal"})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
