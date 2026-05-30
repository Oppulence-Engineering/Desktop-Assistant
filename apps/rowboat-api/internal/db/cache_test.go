package db_test

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"go.uber.org/zap"
)

// TestQueryCacheOptIn proves entcache is opt-in: a read wrapped with DB.Cached
// is served from the cache (so it misses a concurrent external write), while a
// plain read goes straight to the database.
func TestQueryCacheOptIn(t *testing.T) {
	dsn := "file:cacheoptin?mode=memory&cache=shared&_pragma=foreign_keys(1)"
	d, err := db.Open(context.Background(), appconfig.Config{DatabaseURL: dsn, AutoMigrate: true}, zap.NewNop())
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	ctx := context.Background()

	d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("u1").SaveX(ctx)

	// Warm the cache: 1 user.
	if n := d.Client.User.Query().CountX(d.Cached(ctx, time.Minute)); n != 1 {
		t.Fatalf("warm cached count = %d, want 1", n)
	}

	// Insert a second user via a separate connection (bypasses entcache, so it
	// won't invalidate).
	raw, err := sql.Open("sqlite", dsn)
	if err != nil {
		t.Fatalf("raw open: %v", err)
	}
	defer func() { _ = raw.Close() }()
	if _, err := raw.ExecContext(ctx,
		`INSERT INTO users (id, created_at, updated_at, email, workos_user_id) VALUES ('11111111-1111-1111-1111-111111111111', datetime('now'), datetime('now'), 'b@x.co', 'u2')`,
	); err != nil {
		t.Fatalf("raw insert: %v", err)
	}

	// Cached read still sees the stale count → cache hit.
	if n := d.Client.User.Query().CountX(d.Cached(ctx, time.Minute)); n != 1 {
		t.Fatalf("cached read should be stale (1), got %d", n)
	}
	// Plain read is fresh (opt-in default = uncached).
	if n := d.Client.User.Query().CountX(ctx); n != 2 {
		t.Fatalf("uncached read should be fresh (2), got %d", n)
	}
}
