package auth

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
)

const (
	maxHookBody       = 1 << 20
	hookSignatureSkew = 5 * time.Minute
	hookSignatureV1   = "v1"
)

// ErrHookNonceReplayed indicates that an authenticated hook nonce was reused.
var ErrHookNonceReplayed = errors.New("hook nonce already reserved")

// HookNonceStore atomically reserves authenticated request nonces until expiry.
// Implementations must be shared by every API replica in production.
type HookNonceStore interface {
	Reserve(context.Context, string, time.Time) error
}

// PostgresHookNonceStore uses the unique nonce primary key as the cross-replica
// replay barrier. The migration creates hook_nonce_reservations.
type PostgresHookNonceStore struct{ db *sql.DB }

// NewPostgresHookNonceStore creates a cross-replica nonce reservation store.
func NewPostgresHookNonceStore(db *sql.DB) *PostgresHookNonceStore {
	return &PostgresHookNonceStore{db: db}
}

// Reserve atomically records a nonce until its authentication window expires.
func (s *PostgresHookNonceStore) Reserve(ctx context.Context, nonce string, expiresAt time.Time) error {
	if s == nil || s.db == nil {
		return errors.New("hook nonce store is not configured")
	}
	var inserted bool
	err := s.db.QueryRowContext(ctx, `
WITH purged AS (
  DELETE FROM hook_nonce_reservations WHERE expires_at < NOW()
)
INSERT INTO hook_nonce_reservations (nonce, expires_at)
VALUES ($1, $2)
ON CONFLICT (nonce) DO NOTHING
RETURNING true`, nonce, expiresAt.UTC()).Scan(&inserted)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrHookNonceReplayed
	}
	return err
}

// MemoryHookNonceStore is intended for hermetic tests and single-process local
// development. Production wiring always uses PostgresHookNonceStore.
type MemoryHookNonceStore struct {
	mu     sync.Mutex
	nonces map[string]time.Time
}

// NewMemoryHookNonceStore creates a process-local nonce store for tests and development.
func NewMemoryHookNonceStore() *MemoryHookNonceStore {
	return &MemoryHookNonceStore{nonces: make(map[string]time.Time)}
}

// Reserve records a nonce unless an unexpired reservation already exists.
func (s *MemoryHookNonceStore) Reserve(_ context.Context, nonce string, expiresAt time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for value, expiry := range s.nonces {
		if expiry.Before(now) {
			delete(s.nonces, value)
		}
	}
	if expiry, exists := s.nonces[nonce]; exists && !expiry.Before(now) {
		return ErrHookNonceReplayed
	}
	s.nonces[nonce] = expiresAt
	return nil
}

// RequireHookHMAC enforces the oauth-consent signed hook contract. Version 1
// binds method, escaped path, timestamp, nonce, and the SHA-256 body digest.
// Authenticated nonces are atomically reserved before the handler is invoked.
func RequireHookHMAC(secret string, nonceStore HookNonceStore) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if secret == "" || nonceStore == nil {
				httpx.Error(w, http.StatusInternalServerError, "hook authentication not configured", "internal_error")
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
				nonce == "" || nonce != strings.TrimSpace(nonce) || nonceErr != nil || len(decodedNonce) < 16 || len(decodedNonce) > 64 ||
				time.Since(time.UnixMilli(millis)).Abs() > hookSignatureSkew || !strings.HasPrefix(supplied, "sha256=") {
				httpx.Error(w, http.StatusUnauthorized, "invalid hook signature headers", "unauthorized")
				return
			}
			got := strings.TrimPrefix(supplied, "sha256=")
			expected := HookSignatureV1(secret, r.Method, r.URL.EscapedPath(), timestamp, nonce, body)
			if got == "" || !hmac.Equal([]byte(got), []byte(expected)) {
				httpx.Error(w, http.StatusUnauthorized, "invalid hook signature", "unauthorized")
				return
			}
			if err := nonceStore.Reserve(r.Context(), nonce, time.UnixMilli(millis).Add(hookSignatureSkew)); err != nil {
				if errors.Is(err, ErrHookNonceReplayed) {
					httpx.Error(w, http.StatusConflict, "hook nonce already used", "replay_detected")
				} else {
					httpx.Error(w, http.StatusServiceUnavailable, "hook replay protection unavailable", "unavailable")
				}
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
			w.Header().Set("X-Hook-Signature", "sha256="+HookSignatureV1(secret, r.Method, r.URL.EscapedPath(), responseTimestamp, nonce, buffered.body.Bytes()))
			w.WriteHeader(buffered.status)
			_, _ = w.Write(buffered.body.Bytes())
		})
	}
}

// HookSignatureV1 returns the base64url HMAC for the canonical, versioned hook
// message. Newline delimiters and a fixed-width body digest avoid ambiguity.
func HookSignatureV1(secret, method, path, timestamp, nonce string, body []byte) string {
	digest := sha256.Sum256(body)
	canonical := strings.Join([]string{
		hookSignatureV1,
		strings.ToUpper(method),
		path,
		timestamp,
		nonce,
		hex.EncodeToString(digest[:]),
	}, "\n")
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(canonical))
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
// a static shared secret in X-Internal-Secret, compared in constant time.
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
			ctx = WithActor(ctx, &Actor{Kind: KindInternal, ServiceName: "internal-api"})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
