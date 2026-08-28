package connectors

import (
	"context"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/workosauth"
	"go.uber.org/zap"
)

func TestConnectorRefreshLeaseRenewalPreventsThirdOwner(t *testing.T) {
	cache := workosauth.NewMemoryRefreshCache()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	const ttl = 120 * time.Millisecond
	const key = "test:connector-refresh-renewal"

	owner, acquired, err := cache.TryLock(ctx, key, ttl)
	if err != nil || !acquired {
		t.Fatalf("acquire initial lease = (%v, %v)", acquired, err)
	}
	stop := keepConnectorRefreshLease(ctx, cancel, cache, key, owner, ttl, zap.NewNop())

	// Cross several original lease boundaries. A successor, and therefore a
	// third provider refresh, must remain unable to start while renewal runs.
	time.Sleep(3 * ttl)
	if _, acquired, err := cache.TryLock(ctx, key, ttl); err != nil || acquired {
		t.Fatalf("third owner acquired during renewed refresh = (%v, %v)", acquired, err)
	}

	stop()
	if err := cache.Unlock(ctx, key, owner); err != nil {
		t.Fatalf("owner unlock: %v", err)
	}
	if _, acquired, err := cache.TryLock(ctx, key, ttl); err != nil || !acquired {
		t.Fatalf("successor acquire after completion = (%v, %v)", acquired, err)
	}
}
