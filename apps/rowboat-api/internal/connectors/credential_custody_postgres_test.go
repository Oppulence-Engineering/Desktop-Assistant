//go:build postgresintegration

package connectors

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/connectorcredentialrecovery"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/workosauth"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

func openCredentialCustodyPostgres(t *testing.T) *db.DB {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("ROWBOAT_TEST_PG_DSN")
	}
	if dsn == "" {
		t.Skip("DATABASE_URL or ROWBOAT_TEST_PG_DSN is required")
	}
	database, err := db.Open(context.Background(), appconfig.Config{DatabaseURL: dsn}, zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
}

func TestCredentialAdoptionAmbiguousCommitsPostgres(t *testing.T) {
	runAmbiguousCommitScenario(t, openCredentialCustodyPostgres(t))
}

func TestCredentialRecoveryPostgresRedisRestart(t *testing.T) {
	redisURL := os.Getenv("ROWBOAT_TEST_REDIS_URL")
	if redisURL == "" {
		t.Skip("ROWBOAT_TEST_REDIS_URL is required")
	}
	database := openCredentialCustodyPostgres(t)
	cache, err := workosauth.NewRedisRefreshCache(t.Context(), redisURL)
	if err != nil {
		t.Fatal(err)
	}
	client := database.Client
	client.Use(func(next ent.Mutator) ent.Mutator {
		return ent.MutateFunc(func(ctx context.Context, mutation ent.Mutation) (ent.Value, error) {
			if _, ok := mutation.(*ent.ConnectorCredentialCleanupJobMutation); ok && mutation.Op().Is(ent.OpCreate) {
				return nil, errors.New("injected cleanup insert failure")
			}
			return next.Mutate(ctx, mutation)
		})
	})
	sealer, err := crypto.NewSealer("connector-postgres-redis-recovery")
	if err != nil {
		t.Fatal(err)
	}
	var allowRevoke atomic.Bool
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/revoke" {
			if !allowRevoke.Load() {
				http.Error(w, "retry", http.StatusServiceUnavailable)
				return
			}
			w.WriteHeader(http.StatusOK)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(oryToken{AccessToken: "access", RefreshToken: "refresh-pg-redis-recovery", ExpiresIn: 3600})
	}))
	t.Cleanup(provider.Close)
	deduper := refreshDeduper{cache: cache, sealer: sealer, client: client, log: zap.NewNop()}
	bound := newConnectorRefreshContext("canvas", uuid.NewString(), "org-pg-redis", 1, "mcp:canvas", []string{"read"})
	_, refreshErr := deduper.refresh(t.Context(), bound, newOryClient(provider.URL, "client", "secret"), "refresh-old", func(context.Context, *oryToken, uuid.UUID) (int64, error) {
		t.Fatal("unconfirmed provider revoke must not reach connection persistence")
		return 0, nil
	})
	if refreshErr == nil || !strings.Contains(refreshErr.Error(), "encrypted recovery journal") {
		t.Fatalf("refresh error = %v", refreshErr)
	}
	recovery := client.ConnectorCredentialRecovery.Query().Where(connectorcredentialrecovery.OwnerIDEQ(bound.ConnectionID)).OnlyX(auth.WithInternal(t.Context()))
	plain, err := sealer.OpenString(recovery.RefreshTokenEncrypted)
	if err != nil || plain != "refresh-pg-redis-recovery" {
		t.Fatalf("durable recovery = %q, %v", plain, err)
	}

	// Recreate both external clients to model an application process restart.
	allowRevoke.Store(true)
	restartedDatabase := openCredentialCustodyPostgres(t)
	restartedCache, err := workosauth.NewRedisRefreshCache(t.Context(), redisURL)
	if err != nil {
		t.Fatal(err)
	}
	restarted := New(restartedDatabase.Client, sealer, nil, Config{OryPublicURL: provider.URL}, zap.NewNop())
	restarted.SetRefreshDedup(restartedCache, sealer)
	completed, err := restarted.ProcessCredentialCleanupJobs(t.Context(), 25)
	if err != nil {
		t.Fatal(err)
	}
	if completed < 1 {
		t.Fatalf("completed recoveries = %d, want at least 1", completed)
	}
	if count := restartedDatabase.Client.ConnectorCredentialRecovery.Query().Where(connectorcredentialrecovery.OwnerIDEQ(bound.ConnectionID)).CountX(auth.WithInternal(t.Context())); count != 0 {
		t.Fatalf("recovery rows after restart = %d", count)
	}
}
