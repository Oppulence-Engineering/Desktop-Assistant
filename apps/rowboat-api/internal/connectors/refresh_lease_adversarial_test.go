package connectors

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/workosauth"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

type shortLeaseCache struct {
	RefreshCache
	ttl time.Duration
}

type failResultSetCache struct{ RefreshCache }

func refreshLeaseTestClient(t *testing.T) *ent.Client {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)", AutoMigrate: true}, zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d.Client
}

func (c *failResultSetCache) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if strings.Contains(key, "connectors:refresh:result:v2:") {
		return errors.New("injected result cache failure")
	}
	return c.RefreshCache.Set(ctx, key, value, ttl)
}

func (c *shortLeaseCache) TryLock(ctx context.Context, key string, _ time.Duration) (string, bool, error) {
	return c.RefreshCache.TryLock(ctx, key, c.ttl)
}

func (c *shortLeaseCache) Renew(ctx context.Context, key, owner string, _ time.Duration) (bool, error) {
	return c.RefreshCache.Renew(ctx, key, owner, c.ttl)
}

func TestExpiredConnectorHolderCannotPersistPublishOrDeleteSuccessor(t *testing.T) {
	providerStarted := make(chan struct{})
	releaseProvider := make(chan struct{})
	var providerCalls atomic.Int64
	var revokeCalls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/revoke" {
			revokeCalls.Add(1)
			w.WriteHeader(http.StatusOK)
			return
		}
		providerCalls.Add(1)
		close(providerStarted)
		<-releaseProvider
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(oryToken{
			AccessToken: "access-a", RefreshToken: "refresh-a", ExpiresIn: 3600,
		})
	}))
	t.Cleanup(server.Close)

	sealer, err := crypto.NewSealer("connector-refresh-lease-test")
	if err != nil {
		t.Fatal(err)
	}
	cache := &shortLeaseCache{RefreshCache: workosauth.NewMemoryRefreshCache(), ttl: 80 * time.Millisecond}
	d := refreshDeduper{cache: cache, sealer: sealer, client: refreshLeaseTestClient(t), log: zap.NewNop()}
	bound := newConnectorRefreshContext("canvas", "11111111-1111-1111-1111-111111111111", "org-1", 1, "mcp:canvas", []string{"read"})
	ory := newOryClient(server.URL, "client", "secret")
	var persists atomic.Int64
	result := make(chan error, 1)
	go func() {
		_, err := d.refresh(context.Background(), bound, ory, "refresh-old", func(context.Context, *oryToken, uuid.UUID) (int64, error) {
			persists.Add(1)
			return 2, nil
		})
		result <- err
	}()

	select {
	case <-providerStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("provider refresh did not start")
	}
	time.Sleep(100 * time.Millisecond)

	keyMaterial, _ := json.Marshal(struct {
		Context      connectorRefreshContext `json:"context"`
		RefreshToken string                  `json:"refresh_token"`
	}{Context: bound, RefreshToken: "refresh-old"})
	sum := sha256.Sum256(keyMaterial)
	lockKey := "connectors:refresh:lock:v2:" + hex.EncodeToString(sum[:])
	ownerB, acquired, err := cache.TryLock(t.Context(), lockKey, connectorRefreshLockTTL)
	if err != nil || !acquired {
		t.Fatalf("successor acquire after expiry = (%v, %v)", acquired, err)
	}
	if _, acquired, err := cache.TryLock(t.Context(), lockKey, connectorRefreshLockTTL); err != nil || acquired {
		t.Fatalf("third refresh acquired while successor owns lock = (%v, %v)", acquired, err)
	}

	close(releaseProvider)
	if err := <-result; !errors.Is(err, errConnectorRefreshInProgress) {
		t.Fatalf("stale holder result = %v, want refresh in progress", err)
	}
	if persists.Load() != 0 {
		t.Fatalf("stale holder persisted %d times", persists.Load())
	}
	if providerCalls.Load() != 1 {
		t.Fatalf("provider calls = %d, want 1", providerCalls.Load())
	}
	if revokeCalls.Load() != 1 {
		t.Fatalf("orphan revoke calls = %d, want 1", revokeCalls.Load())
	}
	if count := d.client.ConnectorCredentialCleanupJob.Query().CountX(auth.WithInternal(t.Context())); count != 0 {
		t.Fatalf("cleanup jobs after confirmed revoke = %d, want 0", count)
	}
	if _, acquired, err := cache.TryLock(t.Context(), lockKey, connectorRefreshLockTTL); err != nil || acquired {
		t.Fatalf("stale holder unlock deleted successor = (%v, %v)", acquired, err)
	}
	_ = cache.Unlock(t.Context(), lockKey, ownerB)
}

func TestConnectorCacheWriteFailureRetainsOwnedLease(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(oryToken{AccessToken: "access", RefreshToken: "refresh-new", ExpiresIn: 3600})
	}))
	t.Cleanup(server.Close)
	sealer, err := crypto.NewSealer("connector-refresh-cache-failure")
	if err != nil {
		t.Fatal(err)
	}
	cache := &failResultSetCache{RefreshCache: workosauth.NewMemoryRefreshCache()}
	d := refreshDeduper{cache: cache, sealer: sealer, client: refreshLeaseTestClient(t), log: zap.NewNop()}
	bound := newConnectorRefreshContext("canvas", "22222222-2222-2222-2222-222222222222", "org-1", 1, "mcp:canvas", []string{"read"})
	result, err := d.refresh(t.Context(), bound, newOryClient(server.URL, "client", "secret"), "refresh-old", func(ctx context.Context, _ *oryToken, cleanupID uuid.UUID) (int64, error) {
		if cleanupID != uuid.Nil {
			if err := d.client.ConnectorCredentialCleanupJob.DeleteOneID(cleanupID).Exec(auth.WithInternal(ctx)); err != nil {
				return 0, err
			}
		}
		return 2, nil
	})
	if err != nil || result == nil {
		t.Fatalf("refresh with cache failure = (%v, %v)", result, err)
	}

	keyMaterial, _ := json.Marshal(struct {
		Context      connectorRefreshContext `json:"context"`
		RefreshToken string                  `json:"refresh_token"`
	}{Context: bound, RefreshToken: "refresh-old"})
	sum := sha256.Sum256(keyMaterial)
	lockKey := "connectors:refresh:lock:v2:" + hex.EncodeToString(sum[:])
	if _, acquired, err := cache.TryLock(t.Context(), lockKey, connectorRefreshLockTTL); err != nil || acquired {
		t.Fatalf("cache failure released lease = (%v, %v)", acquired, err)
	}
}

func TestLeaseLossRevokeFailurePersistsCredentialOnlyRetry(t *testing.T) {
	var revokeCalls atomic.Int64
	failRevokes := atomic.Bool{}
	failRevokes.Store(true)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/oauth2/revoke" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		revokeCalls.Add(1)
		if failRevokes.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)

	sealer, err := crypto.NewSealer("connector-cleanup-retry-test")
	if err != nil {
		t.Fatal(err)
	}
	client := refreshLeaseTestClient(t)
	d := refreshDeduper{client: client, sealer: sealer, log: zap.NewNop()}
	bound := newConnectorRefreshContext("canvas", "33333333-3333-3333-3333-333333333333", "org-1", 7, "mcp:canvas", []string{"read"})
	jobID, err := d.enqueueCredentialCleanup(t.Context(), bound, "refresh-orphan")
	if err != nil {
		t.Fatal(err)
	}
	d.compensateCredential(t.Context(), newOryClient(server.URL, "client", "secret"), jobID, "refresh-orphan", "lease_lost_before_persist")
	job := client.ConnectorCredentialCleanupJob.GetX(auth.WithInternal(t.Context()), jobID)
	if job.Status != "pending" || job.LastErrorCode != "provider_revoke_unconfirmed" || job.Attempts != 1 {
		t.Fatalf("durable cleanup state = status %q error %q attempts %d", job.Status, job.LastErrorCode, job.Attempts)
	}
	if revokeCalls.Load() != 3 {
		t.Fatalf("bounded synchronous revoke calls = %d, want 3", revokeCalls.Load())
	}

	failRevokes.Store(false)
	h := New(client, sealer, DefaultRegistry(), Config{OryPublicURL: server.URL, OryBrokerClientID: "client", OryBrokerClientSecret: "secret"}, zap.NewNop())
	completed, err := h.ProcessCredentialCleanupJobs(t.Context(), 25)
	if err != nil || completed != 1 {
		t.Fatalf("durable cleanup retry = (%d, %v), want (1, nil)", completed, err)
	}
	if count := client.ConnectorCredentialCleanupJob.Query().CountX(auth.WithInternal(t.Context())); count != 0 {
		t.Fatalf("cleanup jobs after retry = %d, want 0", count)
	}
}

func TestAdoptedCleanupIsNeverRevokedAfterAmbiguousPersistError(t *testing.T) {
	var revokeCalls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		revokeCalls.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)
	sealer, _ := crypto.NewSealer("connector-adoption-race-test")
	client := refreshLeaseTestClient(t)
	d := refreshDeduper{client: client, sealer: sealer, log: zap.NewNop()}
	bound := newConnectorRefreshContext("canvas", "44444444-4444-4444-4444-444444444444", "org-1", 2, "mcp:canvas", []string{"read"})
	jobID, err := d.enqueueCredentialCleanup(t.Context(), bound, "refresh-adopted")
	if err != nil {
		t.Fatal(err)
	}
	client.ConnectorCredentialCleanupJob.DeleteOneID(jobID).ExecX(auth.WithInternal(t.Context()))
	d.compensateCredential(t.Context(), newOryClient(server.URL, "client", "secret"), jobID, "refresh-adopted", "ambiguous_commit")
	if revokeCalls.Load() != 0 {
		t.Fatalf("adopted credential was revoked %d times", revokeCalls.Load())
	}
}
