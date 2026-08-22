//go:build pgconcurrency

// Package backgroundscheduler Postgres concurrency tests. The at-most-once
// cross-replica guarantee relies on Postgres `INSERT ... ON CONFLICT DO NOTHING`
// semantics, which differ from sqlite — so these run only against real Postgres
// and only under the `pgconcurrency` build tag (the default suite stays on the
// fast sqlite path). Provide a DSN via ROWBOAT_TEST_PG_DSN; CI starts a Postgres
// service for this job.
//
//	go test -tags=pgconcurrency -race ./internal/backgroundscheduler/...
package backgroundscheduler

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/backgroundtask"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"go.uber.org/zap"
)

const pgRacers = 64

func pgClient(t *testing.T) *ent.Client {
	t.Helper()
	dsn := os.Getenv("ROWBOAT_TEST_PG_DSN")
	if dsn == "" {
		t.Skip("ROWBOAT_TEST_PG_DSN not set; skipping Postgres concurrency tests")
	}
	sqlDB, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open postgres schema connection: %v", err)
	}
	schemaClient := ent.NewClient(ent.Driver(entsql.OpenDB(dialect.Postgres, sqlDB)))
	if err := schemaClient.Schema.Create(context.Background()); err != nil {
		_ = schemaClient.Close()
		t.Fatalf("create postgres test schema: %v", err)
	}
	if err := schemaClient.Close(); err != nil {
		t.Fatalf("close postgres schema connection: %v", err)
	}
	d, err := db.Open(context.Background(), appconfig.Config{DatabaseURL: dsn, AutoMigrate: false}, zap.NewNop())
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d.Client
}

// pgTask creates a fresh user + api task (unique per test run) with the user
// edge loaded, as Acquire requires.
func pgTask(t *testing.T, client *ent.Client) *ent.BackgroundTask {
	t.Helper()
	ctx := auth.WithInternal(context.Background())
	nonce := fmt.Sprintf("%s-%d", t.Name(), time.Now().UnixNano())
	u := client.User.Create().
		SetEmail(nonce + "@x.co").SetWorkosUserID("wid-" + nonce).SaveX(ctx)
	client.BackgroundTask.Create().
		SetUser(u).SetSlug("task-" + nonce).SetName("t").SetInstructions("x").SetExecutionTarget("api").
		SaveX(ctx)
	return client.BackgroundTask.Query().Where(backgroundtask.SlugEQ("task-" + nonce)).WithUser().OnlyX(ctx)
}

// raceAcquire runs pgRacers concurrent Acquire calls on one key and returns how
// many won, plus any unexpected error.
func raceAcquire(ctx context.Context, l *EntLeases, task *ent.BackgroundTask, key string) (won int, firstErr error) {
	var wg sync.WaitGroup
	var mu sync.Mutex
	for i := 0; i < pgRacers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, ok, err := l.Acquire(ctx, task, "cron", key, fmt.Sprintf("owner-%d", i), time.Minute)
			mu.Lock()
			defer mu.Unlock()
			if err != nil && firstErr == nil {
				firstErr = err
			}
			if ok {
				won++
			}
		}(i)
	}
	wg.Wait()
	return won, firstErr
}

// TestPgAcquireConcurrentInsert: N racers on a fresh cycle → exactly one wins
// the INSERT (the Postgres unique-conflict guarantee).
func TestPgAcquireConcurrentInsert(t *testing.T) {
	client := pgClient(t)
	ctx := auth.WithInternal(context.Background())
	task := pgTask(t, client)
	l := NewEntLeases(client, zap.NewNop())

	won, err := raceAcquire(ctx, l, task, "cron:concurrent-insert")
	if err != nil {
		t.Fatalf("acquire error: %v", err)
	}
	if won != 1 {
		t.Fatalf("expected exactly 1 winner, got %d", won)
	}
}

// TestPgAcquireConcurrentSteal: seed an expired lease, then N racers attempt to
// steal it → exactly one wins the revision-guarded CAS.
func TestPgAcquireConcurrentSteal(t *testing.T) {
	client := pgClient(t)
	ctx := auth.WithInternal(context.Background())
	task := pgTask(t, client)
	l := NewEntLeases(client, zap.NewNop())

	// Seed: acquire with an already-expired lease (the prior owner "crashed").
	if _, ok, err := l.Acquire(ctx, task, "cron", "cron:concurrent-steal", "crashed", -time.Second); err != nil || !ok {
		t.Fatalf("seed expired lease: ok=%v err=%v", ok, err)
	}
	won, err := raceAcquire(ctx, l, task, "cron:concurrent-steal")
	if err != nil {
		t.Fatalf("steal error: %v", err)
	}
	if won != 1 {
		t.Fatalf("expected exactly 1 steal winner, got %d", won)
	}
}

// TestPgFullCycleConcurrent: N racers each run Acquire→(fake start)→Complete on
// one cycle; exactly one Acquire wins, and the cycle ends fired.
func TestPgFullCycleConcurrent(t *testing.T) {
	client := pgClient(t)
	ctx := auth.WithInternal(context.Background())
	task := pgTask(t, client)
	l := NewEntLeases(client, zap.NewNop())

	var wg sync.WaitGroup
	var mu sync.Mutex
	completed := 0
	for i := 0; i < pgRacers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			lease, ok, err := l.Acquire(ctx, task, "cron", "cron:full-cycle", fmt.Sprintf("owner-%d", i), time.Minute)
			if err != nil || !ok {
				return
			}
			if err := l.Complete(ctx, lease, fmt.Sprintf("sched-cron-%d", i)); err == nil {
				mu.Lock()
				completed++
				mu.Unlock()
			}
		}(i)
	}
	wg.Wait()
	if completed != 1 {
		t.Fatalf("expected exactly one completed cycle, got %d", completed)
	}
}
