package auth

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
)

const (
	maxHookBody       = 1 << 20
	hookSignatureSkew = 5 * time.Minute
)

// RequireHookHMAC enforces the oauth-consent signed hook contract. Requests
// authenticate timestamp.nonce.body with base64url HMAC-SHA256. Responses are
// buffered, signed over their exact body, and echo the request nonce.
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

			timestamp := r.Header.Get("X-Hook-Timestamp")
			nonce := r.Header.Get("X-Hook-Nonce")
			supplied := r.Header.Get("X-Hook-Signature")
			millis, err := strconv.ParseInt(timestamp, 10, 64)
			decodedNonce, nonceErr := base64.RawURLEncoding.DecodeString(nonce)
			if len(r.Header.Values("X-Hook-Timestamp")) != 1 || len(r.Header.Values("X-Hook-Nonce")) != 1 ||
				len(r.Header.Values("X-Hook-Signature")) != 1 || err != nil || timestamp == "" || timestamp != strings.TrimSpace(timestamp) ||
				nonce == "" || nonce != strings.TrimSpace(nonce) || nonceErr != nil || len(decodedNonce) == 0 || len(decodedNonce) > 64 ||
				time.Since(time.UnixMilli(millis)).Abs() > hookSignatureSkew || !strings.HasPrefix(supplied, "sha256=") {
				httpx.Error(w, http.StatusUnauthorized, "invalid hook signature headers", "unauthorized")
				return
			}
			got := strings.TrimPrefix(supplied, "sha256=")
			expected := hookSignature(secret, timestamp, nonce, body)
			if got == "" || !hmac.Equal([]byte(got), []byte(expected)) {
				httpx.Error(w, http.StatusUnauthorized, "invalid hook signature", "unauthorized")
				return
			}

			r.Body = io.NopCloser(bytes.NewReader(body))
			ctx := WithInternal(r.Context())
			ctx = WithActor(ctx, &Actor{Kind: KindInternal, ServiceName: "oauth-hook"})
			buffered := &hookResponseWriter{header: make(http.Header), status: http.StatusOK}
			next.ServeHTTP(buffered, r.WithContext(ctx))
			for key, values := range buffered.header {
				for _, value := range values {
					w.Header().Add(key, value)
				}
			}
			responseTimestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
			w.Header().Set("X-Hook-Timestamp", responseTimestamp)
			w.Header().Set("X-Hook-Nonce", nonce)
			w.Header().Set("X-Hook-Signature", "sha256="+hookSignature(secret, responseTimestamp, nonce, buffered.body.Bytes()))
			w.WriteHeader(buffered.status)
			_, _ = w.Write(buffered.body.Bytes())
		})
	}
}

func hookSignature(secret, timestamp, nonce string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp))
	_, _ = mac.Write([]byte("."))
	_, _ = mac.Write([]byte(nonce))
	_, _ = mac.Write([]byte("."))
	_, _ = mac.Write(body)
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

type hookResponseWriter struct {
	header http.Header
	body   bytes.Buffer
	status int
	wrote  bool
}

func (w *hookResponseWriter) Header() http.Header { return w.header }
func (w *hookResponseWriter) WriteHeader(status int) {
	if w.wrote {
		return
	}
	w.status = status
	w.wrote = true
}
func (w *hookResponseWriter) Write(body []byte) (int, error) {
	if !w.wrote {
		w.WriteHeader(http.StatusOK)
	}
	return w.body.Write(body)
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
