// Command migrate manages the database schema.
//
//	migrate apply              # auto-migrate DATABASE_URL to the current schema
//	migrate dump [name]        # write the full schema DDL to migrations/<name>.sql
//
// `apply` is safe for dev and first deploys. For controlled, versioned
// migrations in production, generate diffs with Atlas against a dev database
// (https://atlasgo.io) — `dump` produces the initial baseline.
package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db" // also registers the sqlite/pgx drivers
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/telemetry"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "migrate error:", err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) < 2 {
		return fmt.Errorf("usage: migrate <apply|dump> [name]")
	}
	cfg := appconfig.Load()
	log, _ := telemetry.NewLogger(cfg)
	ctx := context.Background()

	switch os.Args[1] {
	case "apply":
		cfg.AutoMigrate = true
		d, err := db.Open(ctx, cfg, log)
		if err != nil {
			return err
		}
		defer func() { _ = d.Close() }()
		fmt.Println("schema applied")
		return nil

	case "dump":
		name := "0001_init"
		if len(os.Args) >= 3 {
			name = fmt.Sprintf("%s_%s", time.Now().UTC().Format("20060102150405"), os.Args[2])
		}
		return dump(ctx, name)

	default:
		return fmt.Errorf("unknown command %q", os.Args[1])
	}
}

// dump renders the CREATE-table DDL for the current schema and writes it to
// migrations/<name>.sql.
func dump(ctx context.Context, name string) error {
	sqlDB, err := sql.Open("sqlite", "file:dump?mode=memory&_pragma=foreign_keys(1)")
	if err != nil {
		return err
	}
	defer func() { _ = sqlDB.Close() }()
	client := ent.NewClient(ent.Driver(entsql.OpenDB(dialect.SQLite, sqlDB)))

	if err := os.MkdirAll("migrations", 0o755); err != nil {
		return err
	}
	out := filepath.Join("migrations", name+".sql")
	f, err := os.Create(out)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()

	if err := client.Schema.WriteTo(ctx, f); err != nil {
		return err
	}
	fmt.Printf("wrote %s\n", out)
	return nil
}
