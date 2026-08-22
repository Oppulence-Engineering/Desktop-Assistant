// Command migrate manages Rowboat's database schema.
//
//	migrate apply              # apply PostgreSQL Atlas files; auto-migrate SQLite
//	migrate dump [name]        # write a PostgreSQL baseline migration
//	migrate diff <name>        # diff Ent against MIGRATION_DEV_URL
//	migrate hash               # rewrite migrations/postgres/atlas.sum
//	migrate validate           # verify migration names and checksums
package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	atlasmigrate "ariga.io/atlas/sql/migrate"
	"entgo.io/ent/dialect"
	entschema "entgo.io/ent/dialect/sql/schema"
	entmigrate "github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/migrate"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db" // registers sqlite/pgx drivers
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/telemetry"
	_ "github.com/lib/pq" // Ent's versioned-diff helper opens the canonical "postgres" driver.
)

const (
	postgresMigrationDir = "migrations/postgres"
	postgresBaseline     = "20260821000000"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "migrate error:", err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) < 2 {
		return fmt.Errorf("usage: migrate <apply|dump|diff|hash|validate> [name]")
	}
	ctx := context.Background()
	switch os.Args[1] {
	case "apply":
		return apply(ctx)
	case "dump":
		name := postgresBaseline + "_baseline"
		if len(os.Args) >= 3 {
			name = os.Args[2]
		}
		return dumpPostgres(ctx, name)
	case "diff":
		if len(os.Args) != 3 {
			return fmt.Errorf("usage: migrate diff <name>")
		}
		return diff(ctx, os.Args[2])
	case "hash":
		return hashDirectory()
	case "validate":
		return validateDirectory()
	default:
		return fmt.Errorf("unknown command %q", os.Args[1])
	}
}

func apply(ctx context.Context) error {
	cfg := appconfig.Load()
	if !isPostgres(cfg.DatabaseURL) {
		log, err := telemetry.NewLogger(cfg)
		if err != nil {
			return err
		}
		cfg.AutoMigrate = true
		database, err := db.Open(ctx, cfg, log)
		if err != nil {
			return err
		}
		defer func() { _ = database.Close() }()
		fmt.Println("SQLite schema auto-migrated")
		return nil
	}
	if err := validateDirectory(); err != nil {
		return err
	}
	return applyPostgres(ctx, cfg.DatabaseURL)
}

// dumpPostgres renders the current Ent schema using PostgreSQL types. It is
// intended only for establishing a reviewed baseline, not routine changes.
func dumpPostgres(ctx context.Context, name string) error {
	if err := validateMigrationName(name); err != nil {
		return err
	}
	if err := os.MkdirAll(postgresMigrationDir, 0o750); err != nil {
		return err
	}
	out := filepath.Join(postgresMigrationDir, name+".sql")
	file, err := os.OpenFile(out, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600) // #nosec G304,G703 -- allowlisted basename under fixed directory
	if err != nil {
		return err
	}
	defer func() { _ = file.Close() }()

	ddl, err := entschema.DDL(ctx, entschema.DDLArgs{
		Dialect:     dialect.Postgres,
		Version:     "15.0.0",
		HashSymbols: true,
		Tables:      entmigrate.Tables,
	})
	if err != nil {
		return err
	}
	if _, err := file.WriteString(ddl); err != nil {
		return err
	}
	if err := hashDirectory(); err != nil {
		return err
	}
	fmt.Printf("wrote %s\n", out)
	return nil
}

func diff(ctx context.Context, name string) error {
	if err := validateMigrationName(name); err != nil {
		return err
	}
	devURL := os.Getenv("MIGRATION_DEV_URL")
	if !isPostgres(devURL) {
		return fmt.Errorf("MIGRATION_DEV_URL must be a disposable PostgreSQL database URL")
	}
	directory, err := atlasmigrate.NewLocalDir(postgresMigrationDir)
	if err != nil {
		return err
	}
	return entmigrate.NamedDiff(ctx, devURL, name,
		entschema.WithDir(directory),
		entschema.WithMigrationMode(entschema.ModeReplay),
		entschema.WithDialect(dialect.Postgres),
		entschema.WithFormatter(atlasmigrate.DefaultFormatter),
	)
}

func hashDirectory() error {
	directory, err := atlasmigrate.NewLocalDir(postgresMigrationDir)
	if err != nil {
		return err
	}
	sum, err := directory.Checksum()
	if err != nil {
		return err
	}
	return atlasmigrate.WriteSumFile(directory, sum)
}

func validateDirectory() error {
	directory, err := atlasmigrate.NewLocalDir(postgresMigrationDir)
	if err != nil {
		return err
	}
	files, err := directory.Files()
	if err != nil {
		return err
	}
	if len(files) == 0 {
		return fmt.Errorf("PostgreSQL migration directory is empty")
	}
	for _, file := range files {
		if err := validateMigrationName(strings.TrimSuffix(file.Name(), filepath.Ext(file.Name()))); err != nil {
			return fmt.Errorf("%s: %w", file.Name(), err)
		}
	}
	if err := atlasmigrate.Validate(directory); err != nil {
		return fmt.Errorf("validate Atlas migration directory: %w", err)
	}
	fmt.Printf("validated %d PostgreSQL Atlas migration(s)\n", len(files))
	return nil
}

func validateMigrationName(name string) error {
	if !migrationNamePattern.MatchString(name) {
		return fmt.Errorf("migration name must begin with a 14-digit UTC version and contain only letters, digits, underscore, or hyphen")
	}
	if _, err := time.Parse("20060102150405", name[:14]); err != nil {
		return fmt.Errorf("migration version is not a valid UTC timestamp: %w", err)
	}
	return nil
}

func isPostgres(url string) bool {
	return strings.HasPrefix(url, "postgres://") || strings.HasPrefix(url, "postgresql://") || strings.Contains(url, "host=")
}

var migrationNamePattern = regexp.MustCompile(`^[0-9]{14}_[A-Za-z0-9][A-Za-z0-9_-]{0,112}$`)
