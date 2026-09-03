package oauthrs

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	EntitlementConnectorHeader = "X-Rowboat-Connector"
	EntitlementTimestampHeader = "X-Rowboat-Timestamp"
	EntitlementRequestIDHeader = "X-Rowboat-Request-ID"
	EntitlementSignatureHeader = "X-Rowboat-Signature"

	defaultEntitlementMaxAge     = 5 * time.Minute
	defaultEntitlementFutureSkew = time.Minute
	defaultPostgresReplayEntries = int64(1_000_000)
	postgresReplayAdvisoryLock   = int64(0x5242454e5452504c) // "RBENTRPL"
)

var (
	ErrEntitlementRequestInvalid = errors.New("oauthrs: invalid entitlement request signature")
	ErrEntitlementRequestReplay  = errors.New("oauthrs: entitlement request replayed")
	ErrEntitlementReplayStore    = errors.New("oauthrs: entitlement replay store unavailable")
	entitlementRequestIDPattern  = regexp.MustCompile(`^[A-Za-z0-9._-]{16,128}$`)
)

// EntitlementReplayStore atomically claims a signed request ID through its
// expiry. Production products should back this interface with a shared store so
// replay protection spans every replica.
type EntitlementReplayStore interface {
	Claim(context.Context, string, time.Time) (bool, error)
}

// EntitlementRequestVerifier validates broker-to-product HMAC requests and
// atomically consumes their signed request IDs.
type EntitlementRequestVerifier struct {
	key        []byte
	connector  string
	store      EntitlementReplayStore
	maxAge     time.Duration
	futureSkew time.Duration
	now        func() time.Time
}

// EntitlementRequestVerifierConfig configures the signed request verifier.
type EntitlementRequestVerifierConfig struct {
	SigningKey  []byte
	Connector   string
	ReplayStore EntitlementReplayStore
	MaxAge      time.Duration
	FutureSkew  time.Duration
	Now         func() time.Time
}

func NewEntitlementRequestVerifier(cfg EntitlementRequestVerifierConfig) (*EntitlementRequestVerifier, error) {
	if len(cfg.SigningKey) < 32 {
		return nil, errors.New("oauthrs: entitlement signing key must be at least 32 bytes")
	}
	connector := strings.TrimSpace(cfg.Connector)
	if connector == "" {
		return nil, errors.New("oauthrs: entitlement connector is required")
	}
	if cfg.ReplayStore == nil {
		return nil, errors.New("oauthrs: shared entitlement replay store is required")
	}
	if cfg.MaxAge < 0 || cfg.FutureSkew < 0 {
		return nil, errors.New("oauthrs: entitlement request time bounds must not be negative")
	}
	if cfg.MaxAge == 0 {
		cfg.MaxAge = defaultEntitlementMaxAge
	}
	if cfg.FutureSkew == 0 {
		cfg.FutureSkew = defaultEntitlementFutureSkew
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &EntitlementRequestVerifier{
		key: append([]byte(nil), cfg.SigningKey...), connector: connector, store: cfg.ReplayStore,
		maxAge: cfg.MaxAge, futureSkew: cfg.FutureSkew, now: cfg.Now,
	}, nil
}

// Verify validates the timestamp, connector, request ID, signature, and shared
// replay claim. The request ID is part of the signed canonical bytes.
func (v *EntitlementRequestVerifier) Verify(ctx context.Context, header http.Header, body []byte) error {
	rawTimestamp := strings.TrimSpace(header.Get(EntitlementTimestampHeader))
	timestamp, err := time.Parse(time.RFC3339, rawTimestamp)
	if err != nil {
		return ErrEntitlementRequestInvalid
	}
	now := v.now().UTC()
	if now.Sub(timestamp) > v.maxAge || timestamp.Sub(now) > v.futureSkew {
		return ErrEntitlementRequestInvalid
	}
	requestID := strings.TrimSpace(header.Get(EntitlementRequestIDHeader))
	if !entitlementRequestIDPattern.MatchString(requestID) {
		return ErrEntitlementRequestInvalid
	}
	if subtle.ConstantTimeCompare([]byte(header.Get(EntitlementConnectorHeader)), []byte(v.connector)) != 1 {
		return ErrEntitlementRequestInvalid
	}
	signature, err := parseEntitlementSignature(header.Get(EntitlementSignatureHeader))
	if err != nil {
		return ErrEntitlementRequestInvalid
	}
	expected := entitlementRequestMAC(v.key, rawTimestamp, requestID, body)
	if !hmac.Equal(signature, expected) {
		return ErrEntitlementRequestInvalid
	}
	claimed, err := v.store.Claim(ctx, requestID, timestamp.Add(v.maxAge+v.futureSkew))
	if err != nil {
		return fmt.Errorf("%w: %v", ErrEntitlementReplayStore, err)
	}
	if !claimed {
		return ErrEntitlementRequestReplay
	}
	return nil
}

// SignEntitlementRequest returns the canonical sha256= HMAC value covering the
// exact timestamp, request ID, and body bytes.
func SignEntitlementRequest(key []byte, timestamp, requestID string, body []byte) (string, error) {
	if len(key) < 32 || strings.TrimSpace(timestamp) == "" || !entitlementRequestIDPattern.MatchString(requestID) {
		return "", ErrEntitlementRequestInvalid
	}
	return "sha256=" + hex.EncodeToString(entitlementRequestMAC(key, timestamp, requestID, body)), nil
}

// NewEntitlementRequestID returns a 128-bit cryptographically random request ID.
func NewEntitlementRequestID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("oauthrs: entitlement request ID: %w", err)
	}
	return hex.EncodeToString(value), nil
}

func entitlementRequestMAC(key []byte, timestamp, requestID string, body []byte) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(timestamp))
	_, _ = mac.Write([]byte("\n"))
	_, _ = mac.Write([]byte(requestID))
	_, _ = mac.Write([]byte("\n"))
	_, _ = mac.Write(body)
	return mac.Sum(nil)
}

func parseEntitlementSignature(raw string) ([]byte, error) {
	if !strings.HasPrefix(raw, "sha256=") {
		return nil, ErrEntitlementRequestInvalid
	}
	signature, err := hex.DecodeString(strings.TrimPrefix(raw, "sha256="))
	if err != nil || len(signature) != sha256.Size {
		return nil, ErrEntitlementRequestInvalid
	}
	return signature, nil
}

// MemoryEntitlementReplayStore is bounded and concurrency-safe. It is suitable
// for one-process products and tests. Multi-replica production products must use
// one shared store instance or a distributed implementation such as Postgres.
type MemoryEntitlementReplayStore struct {
	mu         sync.Mutex
	maxEntries int
	entries    map[string]time.Time
	now        func() time.Time
}

func NewMemoryEntitlementReplayStore(maxEntries int) (*MemoryEntitlementReplayStore, error) {
	if maxEntries <= 0 {
		return nil, errors.New("oauthrs: replay-store capacity must be positive")
	}
	return &MemoryEntitlementReplayStore{maxEntries: maxEntries, entries: map[string]time.Time{}, now: time.Now}, nil
}

func (s *MemoryEntitlementReplayStore) Claim(_ context.Context, requestID string, expiresAt time.Time) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	for id, expiry := range s.entries {
		if !expiry.After(now) {
			delete(s.entries, id)
		}
	}
	if expiry, exists := s.entries[requestID]; exists && expiry.After(now) {
		return false, nil
	}
	if len(s.entries) >= s.maxEntries {
		return false, errors.New("bounded replay store is full")
	}
	s.entries[requestID] = expiresAt
	return true, nil
}

// PostgresEntitlementReplayStore shares replay claims across product replicas.
// Call EnsureSchema once at startup before accepting entitlement requests.
type PostgresEntitlementReplayStore struct {
	DB         *sql.DB
	MaxEntries int64
}

func (s PostgresEntitlementReplayStore) EnsureSchema(ctx context.Context) error {
	if s.DB == nil {
		return errors.New("nil Postgres replay database")
	}
	_, err := s.DB.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS oauthrs_entitlement_request_replays (
 request_id text PRIMARY KEY,
 expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS oauthrs_entitlement_request_replays_expires_at
 ON oauthrs_entitlement_request_replays(expires_at);`)
	return err
}

func (s PostgresEntitlementReplayStore) Claim(ctx context.Context, requestID string, expiresAt time.Time) (bool, error) {
	if s.DB == nil {
		return false, errors.New("nil Postgres replay database")
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1)`, postgresReplayAdvisoryLock); err != nil {
		return false, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM oauthrs_entitlement_request_replays WHERE expires_at <= now()`); err != nil {
		return false, err
	}
	maxEntries := s.MaxEntries
	if maxEntries <= 0 {
		maxEntries = defaultPostgresReplayEntries
	}
	result, err := tx.ExecContext(ctx, `
INSERT INTO oauthrs_entitlement_request_replays(request_id,expires_at)
SELECT $1,$2
WHERE (SELECT count(*) FROM oauthrs_entitlement_request_replays) < $3
ON CONFLICT(request_id) DO NOTHING`, requestID, expiresAt, maxEntries)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	if rows == 1 {
		return true, nil
	}
	var replay bool
	if err := s.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM oauthrs_entitlement_request_replays WHERE request_id=$1 AND expires_at > now())`, requestID).Scan(&replay); err != nil {
		return false, err
	}
	if replay {
		return false, nil
	}
	return false, errors.New("bounded Postgres replay store is full")
}
