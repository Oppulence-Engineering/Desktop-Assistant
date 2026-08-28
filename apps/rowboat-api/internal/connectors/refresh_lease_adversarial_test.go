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

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/workosauth"
	"go.uber.org/zap"
)

type shortLeaseCache struct {
	RefreshCache
	ttl time.Duration
}

type failResultSetCache struct{ RefreshCache }

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
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
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
	d := refreshDeduper{cache: cache, sealer: sealer, log: zap.NewNop()}
	bound := newConnectorRefreshContext("canvas", "connection-1", "org-1", 1, "mcp:canvas", []string{"read"})
	ory := newOryClient(server.URL, "client", "secret")
	var persists atomic.Int64
	result := make(chan error, 1)
	go func() {
		_, err := d.refresh(context.Background(), bound, ory, "refresh-old", func(context.Context, *oryToken) (int64, error) {
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
	d := refreshDeduper{cache: cache, sealer: sealer, log: zap.NewNop()}
	bound := newConnectorRefreshContext("canvas", "connection-cache-fail", "org-1", 1, "mcp:canvas", []string{"read"})
	result, err := d.refresh(t.Context(), bound, newOryClient(server.URL, "client", "secret"), "refresh-old", func(context.Context, *oryToken) (int64, error) {
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
