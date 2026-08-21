// Package db opens the ent client over Postgres (pgx) in production or a
// pure-Go SQLite database for local dev / tests, and installs the client-level
// hooks and interceptors that enforce audit logging, append-only ledgers, and
// per-user tenant isolation.
//
// Tenant protection is intentionally dual-layered: native Ent privacy rejects
// missing viewers, while client interceptors and hooks add the exact row-level
// predicates for reads and writes.
package db

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"time"

	"ariga.io/entcache"
	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	_ "github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/runtime" // stitch schema defaults, validators, and privacy policies
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	redisv8 "github.com/go-redis/redis/v8"
	"go.uber.org/zap"

	_ "github.com/jackc/pgx/v5/stdlib" // postgres driver "pgx"
	_ "modernc.org/sqlite"             // pure-Go sqlite driver "sqlite"
)

// DB bundles the ent client with the raw *sql.DB (for health pings) and the
// dialect in use.
type DB struct {
	Client  *ent.Client
	Dialect string

	cacheLevels []entcache.AddGetDeleter
	sqlDB       *sql.DB
	log         *zap.Logger
}

// Open connects, installs hooks + interceptors, and (optionally) runs
// auto-migration. An empty DATABASE_URL falls back to a local sqlite file so
// the service is fully functional in local development with no external DB.
func Open(ctx context.Context, cfg appconfig.Config, log *zap.Logger) (*DB, error) {
	driverName, dsn, dlct := resolveDSN(cfg.DatabaseURL)

	sqlDB, err := sql.Open(driverName, dsn)
	if err != nil {
		return nil, fmt.Errorf("db: open %s: %w", dlct, err)
	}
	if dlct == dialect.SQLite {
		// SQLite is single-writer; a connection pool causes "database is locked".
		sqlDB.SetMaxOpenConns(1)
	} else {
		// Postgres (pgx) over database/sql defaults to MaxOpenConns=0 (unlimited)
		// and ConnMaxLifetime=0 (connections never recycled), which can exhaust
		// the server's connection slots and pin stale connections. Bound the pool
		// and recycle connections so usage stays predictable.
		maxOpen := cfg.DBMaxOpenConns
		if maxOpen <= 0 {
			maxOpen = 20
		}
		maxIdle := cfg.DBMaxIdleConns
		if maxIdle < 0 {
			maxIdle = 0
		}
		if maxIdle > maxOpen {
			maxIdle = maxOpen
		}
		sqlDB.SetMaxOpenConns(maxOpen)
		sqlDB.SetMaxIdleConns(maxIdle)
		if cfg.DBConnMaxLifetime > 0 {
			sqlDB.SetConnMaxLifetime(cfg.DBConnMaxLifetime)
		}
		if cfg.DBConnMaxIdleTime > 0 {
			sqlDB.SetConnMaxIdleTime(cfg.DBConnMaxIdleTime)
		}
	}

	base := entsql.OpenDB(dlct, sqlDB)

	// PostgreSQL schema changes are reviewed, checksummed Atlas migrations. Do
	// not let an application process silently mutate production DDL because an
	// environment variable was set incorrectly. SQLite keeps auto-migration for
	// local development and hermetic tests.
	if cfg.AutoMigrate {
		if dlct == dialect.Postgres {
			_ = sqlDB.Close()
			return nil, fmt.Errorf("db: PostgreSQL auto-migration is disabled; run cmd/migrate apply")
		}
		// Auto-migrate on the RAW driver: Atlas's schema introspection
		// type-asserts query results to *sql.Rows, which entcache wraps in a
		// recorder. Running migration before/outside entcache avoids that panic.
		if err := dropLegacyOAuthProviderUserIndex(ctx, sqlDB); err != nil {
			_ = sqlDB.Close()
			return nil, fmt.Errorf("db: drop legacy oauth index: %w", err)
		}
		raw := ent.NewClient(ent.Driver(base))
		if err := raw.Schema.Create(ctx); err != nil {
			_ = sqlDB.Close()
			return nil, fmt.Errorf("db: auto-migrate: %w", err)
		}
		log.Info("db schema auto-migrated", zap.String("dialect", dlct))
	}

	// entcache in opt-in (context-level) mode: queries are uncached by default —
	// only requests that call DB.Cached are served from the shared cache. This
	// keeps every read-after-write/upsert path correct with no per-call opt-out.
	levels := buildCacheLevels(cfg, log)
	drv := entcache.NewDriver(base, entcache.ContextLevel(), entcache.TTL(5*time.Minute))
	client := ent.NewClient(ent.Driver(drv))

	d := &DB{Client: client, Dialect: dlct, cacheLevels: levels, sqlDB: sqlDB, log: log}

	registerHooks(client, log)
	registerInterceptors(client, log)
	client.WithHistory() // activate enthistory triggers (writes *_history rows)

	log.Info("database connected", zap.String("dialect", dlct), zap.String("driver", driverName))
	return d, nil
}

func dropLegacyOAuthProviderUserIndex(ctx context.Context, sqlDB *sql.DB) error {
	_, err := sqlDB.ExecContext(ctx, `DROP INDEX IF EXISTS oauthconnection_provider_user_oauth_connections`)
	return err
}

// buildCacheLevels assembles the shared cache tiers: an in-process LRU L1 (per
// replica) plus a Redis L2 shared across replicas when REDIS_URL is set.
//
// NOTE: entcache pins go-redis/v8, so the L2 client here is v8 — distinct from
// the v9 client the rate limiter uses. Both talk to the same Redis instance.
func buildCacheLevels(cfg appconfig.Config, log *zap.Logger) []entcache.AddGetDeleter {
	levels := []entcache.AddGetDeleter{entcache.NewLRU(2048)}
	if cfg.RedisURL != "" {
		if opt, err := redisv8.ParseURL(cfg.RedisURL); err == nil {
			levels = append(levels, entcache.NewRedis(redisv8.NewClient(opt)))
			log.Info("ent query cache: lru(L1) + redis(L2)")
		} else {
			log.Warn("ent cache: redis url parse failed, using lru only", zap.Error(err))
		}
	}
	return levels
}

// Cached returns a context that opts this request's queries into the shared
// cache for the given TTL. Use only on staleness-tolerant reads (e.g. the
// /v1/me subscription join). Without it, queries hit the database directly.
func (d *DB) Cached(ctx context.Context, ttl time.Duration) context.Context {
	if len(d.cacheLevels) == 0 {
		return ctx
	}
	c := entcache.NewContext(ctx, d.cacheLevels...)
	if ttl > 0 {
		c = entcache.WithTTL(c, ttl)
	}
	return c
}

// resolveDSN maps a configured DATABASE_URL to a (driver, dsn, dialect) triple.
func resolveDSN(databaseURL string) (driver, dsn, dlct string) {
	switch {
	case databaseURL == "":
		// Local dev default: a sqlite file with foreign keys enabled.
		return "sqlite", "file:rowboat-dev.db?cache=shared&_pragma=foreign_keys(1)", dialect.SQLite
	case strings.HasPrefix(databaseURL, "postgres://"), strings.HasPrefix(databaseURL, "postgresql://"):
		return "pgx", databaseURL, dialect.Postgres
	case strings.HasPrefix(databaseURL, "file:"), strings.HasPrefix(databaseURL, "sqlite:"), databaseURL == ":memory:":
		return "sqlite", strings.TrimPrefix(databaseURL, "sqlite:"), dialect.SQLite
	default:
		// Assume a postgres DSN in keyword form (host=... dbname=...).
		return "pgx", databaseURL, dialect.Postgres
	}
}

// Ping verifies connectivity (used by the /readyz probe).
func (d *DB) Ping(ctx context.Context) error {
	return d.sqlDB.PingContext(ctx)
}

// Close releases the connection pool.
func (d *DB) Close() error {
	return d.Client.Close()
}
