// Command connector-reencrypt inventories, re-encrypts, and retirement-gates
// every connector credential payload protected by DB_ENCRYPTION_KEY.
//
// Usage:
//
//	connector-reencrypt inventory
//	connector-reencrypt reseal --state-file /var/lib/rowboat/connector-reseal.json
//	connector-reencrypt retirement-gate [--retire-key-id old-key]
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	appcrypto "github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto/reseal"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/telemetry"
	redis "github.com/redis/go-redis/v9"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := run(ctx, os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "connector-reencrypt error:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	if len(args) == 0 {
		return errors.New("usage: connector-reencrypt <inventory|reseal|retirement-gate> [flags]")
	}
	flags := flag.NewFlagSet(args[0], flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	batchSize := flags.Int("batch-size", 250, "rows/Redis keys processed per checkpoint")
	stateFile := flags.String("state-file", "connector-reseal-state.json", "durable reseal checkpoint path")
	retireKeyID := flags.String("retire-key-id", "", "key ID to retirement-gate; defaults to DB_ENCRYPTION_RETIRING_KEY_IDS")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected arguments: %s", strings.Join(flags.Args(), " "))
	}
	if *batchSize <= 0 || *batchSize > 5000 {
		return errors.New("--batch-size must be between 1 and 5000")
	}

	cfg := appconfig.Load()
	primaryKeyID, keyring, err := cfg.DBEncryptionKeyring()
	if err != nil {
		return err
	}
	sealer, err := appcrypto.NewKeyringSealer(primaryKeyID, keyring)
	if err != nil {
		return err
	}
	log, err := telemetry.NewLogger(cfg)
	if err != nil {
		return err
	}
	cfg.AutoMigrate = false
	database, err := db.Open(ctx, cfg, log)
	if err != nil {
		return err
	}
	defer database.Close()

	var cache reseal.Cache
	var redisClient *redis.Client
	if strings.TrimSpace(cfg.RedisURL) != "" {
		options, err := redis.ParseURL(cfg.RedisURL)
		if err != nil {
			return fmt.Errorf("parse REDIS_URL: %w", err)
		}
		redisClient = redis.NewClient(options)
		if err := redisClient.Ping(ctx).Err(); err != nil {
			return fmt.Errorf("connect Redis: %w", err)
		}
		defer redisClient.Close()
		cache = redisResealCache{client: redisClient}
	}

	runner := reseal.Runner{
		Store:     reseal.SQLStore{DB: database.SQLDB(), Dialect: database.Dialect},
		Cache:     cache,
		Sealer:    sealer,
		BatchSize: *batchSize,
	}

	switch args[0] {
	case "inventory":
		report, err := runner.Inventory(ctx)
		if printErr := printReport(report); printErr != nil {
			return printErr
		}
		return err
	case "reseal":
		state, err := loadCheckpoint(*stateFile)
		if err != nil {
			return err
		}
		report, err := runner.Reseal(ctx, &state, func(next reseal.Checkpoint) error {
			return writeCheckpoint(*stateFile, next)
		})
		if printErr := printReport(report); printErr != nil {
			return printErr
		}
		return err
	case "retirement-gate":
		ids := cfg.DBEncryptionRetiringKeyIDs
		if strings.TrimSpace(*retireKeyID) != "" {
			ids = []string{strings.TrimSpace(*retireKeyID)}
		}
		if len(ids) == 0 {
			return errors.New("set --retire-key-id or DB_ENCRYPTION_RETIRING_KEY_IDS")
		}
		for _, keyID := range ids {
			report, gateErr := runner.RetirementGate(ctx, keyID)
			if printErr := printReport(report); printErr != nil {
				return printErr
			}
			if gateErr != nil {
				return gateErr
			}
		}
		return nil
	default:
		return fmt.Errorf("unknown command %q", args[0])
	}
}

func printReport(report reseal.Report) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(report)
}

func loadCheckpoint(path string) (reseal.Checkpoint, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return reseal.Checkpoint{}, nil
	}
	if err != nil {
		return reseal.Checkpoint{}, fmt.Errorf("read checkpoint: %w", err)
	}
	var state reseal.Checkpoint
	if err := json.Unmarshal(data, &state); err != nil {
		return state, fmt.Errorf("decode checkpoint: %w", err)
	}
	return state, nil
}

func writeCheckpoint(path string, state reseal.Checkpoint) error {
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(dir, ".connector-reseal-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

type redisResealCache struct{ client *redis.Client }

func (c redisResealCache) Scan(ctx context.Context, cursor uint64, pattern string, count int64) ([]string, uint64, error) {
	return c.client.Scan(ctx, cursor, pattern, count).Result()
}

func (c redisResealCache) Get(ctx context.Context, key string) ([]byte, bool, error) {
	value, err := c.client.Get(ctx, key).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, false, nil
	}
	return value, err == nil, err
}

func (c redisResealCache) CompareAndSwap(ctx context.Context, key string, old, replacement []byte) (bool, error) {
	const script = `
local current = redis.call('GET', KEYS[1])
if not current or current ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
return 1`
	result, err := c.client.Eval(ctx, script, []string{key}, old, replacement).Int()
	return result == 1, err
}
