package workosauth_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/workosauth"
)

func TestMemoryRefreshLockOwnershipAndRenewal(t *testing.T) {
	testRefreshLockOwnership(t, workosauth.NewMemoryRefreshCache())
}

func TestRedisRefreshLockOwnershipAndRenewal(t *testing.T) {
	redisURL := os.Getenv("ROWBOAT_TEST_REDIS_URL")
	if redisURL == "" {
		t.Skip("ROWBOAT_TEST_REDIS_URL is not set")
	}
	cache, err := workosauth.NewRedisRefreshCache(t.Context(), redisURL)
	if err != nil {
		t.Fatalf("connect test Redis: %v", err)
	}
	testRefreshLockOwnership(t, cache)
}

func testRefreshLockOwnership(t *testing.T, cache workosauth.RefreshCache) {
	t.Helper()
	ctx := context.Background()
	key := "test:refresh-lock:" + t.Name()
	const lease = 180 * time.Millisecond

	ownerA, acquired, err := cache.TryLock(ctx, key, lease)
	if err != nil || !acquired || ownerA == "" {
		t.Fatalf("owner A acquire = (%q, %v, %v)", ownerA, acquired, err)
	}
	if owner, acquired, err := cache.TryLock(ctx, key, lease); err != nil || acquired || owner != "" {
		t.Fatalf("contended acquire = (%q, %v, %v), want not acquired", owner, acquired, err)
	}

	time.Sleep(110 * time.Millisecond)
	if owned, err := cache.Renew(ctx, key, ownerA, lease); err != nil || !owned {
		t.Fatalf("owner A renewal = (%v, %v)", owned, err)
	}
	time.Sleep(110 * time.Millisecond)
	if _, acquired, err := cache.TryLock(ctx, key, lease); err != nil || acquired {
		t.Fatalf("acquire during renewed lease = (%v, %v), want contended", acquired, err)
	}

	time.Sleep(100 * time.Millisecond)
	ownerB, acquired, err := cache.TryLock(ctx, key, lease)
	if err != nil || !acquired || ownerB == "" || ownerB == ownerA {
		t.Fatalf("owner B reacquire = (%q, %v, %v), owner A %q", ownerB, acquired, err, ownerA)
	}
	if owned, err := cache.Renew(ctx, key, ownerA, lease); err != nil || owned {
		t.Fatalf("stale owner renewal = (%v, %v), want false", owned, err)
	}
	if err := cache.Unlock(ctx, key, ownerA); err != nil {
		t.Fatalf("stale owner unlock: %v", err)
	}
	if _, acquired, err := cache.TryLock(ctx, key, lease); err != nil || acquired {
		t.Fatalf("stale unlock deleted successor = (%v, %v)", acquired, err)
	}
	if err := cache.Unlock(ctx, key, ownerB); err != nil {
		t.Fatalf("owner B unlock: %v", err)
	}
	if _, acquired, err := cache.TryLock(ctx, key, lease); err != nil || !acquired {
		t.Fatalf("acquire after owner unlock = (%v, %v)", acquired, err)
	}
}
