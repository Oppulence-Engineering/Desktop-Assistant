package main

import (
	"context"
	"database/sql"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

// This test uses two independent database clients, not two goroutines sharing a
// transaction, so it deterministically exercises the same compare-and-swap
// boundary used by reconnect, refresh error, and revocation job claims.
func TestConnectorLifecycleSQLiteTwoClientCAS(t *testing.T) {
	dsn := "file:" + filepath.Join(t.TempDir(), "lifecycle.db") + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
	db1, err := sql.Open("sqlite", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db1.Close(); err != nil {
			t.Errorf("close first lifecycle database: %v", err)
		}
	})
	db2, err := sql.Open("sqlite", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db2.Close(); err != nil {
			t.Errorf("close second lifecycle database: %v", err)
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := db1.ExecContext(ctx, `CREATE TABLE connections(id TEXT PRIMARY KEY, credential_generation INTEGER NOT NULL, status TEXT NOT NULL, credential TEXT);
CREATE TABLE jobs(id TEXT PRIMARY KEY, status TEXT NOT NULL, claim_id TEXT, claimed_until DATETIME);`); err != nil {
		t.Fatal(err)
	}
	if _, err := db1.ExecContext(ctx, `INSERT INTO connections VALUES('c',1,'active','old'); INSERT INTO jobs VALUES('j','pending',NULL,NULL);`); err != nil {
		t.Fatal(err)
	}

	start := make(chan struct{})
	var winners atomic.Int32
	var wg sync.WaitGroup
	for i, db := range []*sql.DB{db1, db2} {
		wg.Add(1)
		go func(i int, db *sql.DB) {
			defer wg.Done()
			<-start
			res, execErr := db.ExecContext(ctx, `UPDATE connections SET credential_generation=credential_generation+1,credential=? WHERE id='c' AND credential_generation=1`, []string{"replacement-a", "replacement-b"}[i])
			if execErr == nil {
				if n, _ := res.RowsAffected(); n == 1 {
					winners.Add(1)
				}
			}
		}(i, db)
	}
	close(start)
	wg.Wait()
	if winners.Load() != 1 {
		t.Fatalf("credential CAS winners=%d, want 1", winners.Load())
	}
	res, err := db1.ExecContext(ctx, `UPDATE connections SET status='revoked',credential=NULL WHERE id='c' AND credential_generation=1`)
	if err != nil {
		t.Fatal(err)
	}
	if n, _ := res.RowsAffected(); n != 0 {
		t.Fatal("stale revoke cleared replacement grant")
	}

	start = make(chan struct{})
	winners.Store(0)
	for i, db := range []*sql.DB{db1, db2} {
		wg.Add(1)
		go func(i int, db *sql.DB) {
			defer wg.Done()
			<-start
			res, execErr := db.ExecContext(ctx, `UPDATE jobs SET status='processing',claim_id=?,claimed_until=? WHERE id='j' AND status='pending'`, []string{"claim-a", "claim-b"}[i], time.Now().Add(time.Minute))
			if execErr == nil {
				if n, _ := res.RowsAffected(); n == 1 {
					winners.Add(1)
				}
			}
		}(i, db)
	}
	close(start)
	wg.Wait()
	if winners.Load() != 1 {
		t.Fatalf("job claim winners=%d, want 1", winners.Load())
	}
}
