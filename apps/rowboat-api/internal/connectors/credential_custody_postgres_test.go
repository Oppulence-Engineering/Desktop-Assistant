//go:build postgresintegration

package connectors

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/connectorcredentialcleanupjob"
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

func TestReconnectSupersededGrantEscrowIsAtomicPostgres(t *testing.T) {
	database := openCredentialCustodyPostgres(t)
	client := database.Client
	suffix := uuid.NewString()
	owner := client.User.Create().SetEmail("reconnect-pg-" + suffix + "@example.invalid").SetWorkosUserID("reconnect-pg-" + suffix).SetWorkosOrgID("reconnect-pg-org-" + suffix).SaveX(t.Context())
	ctx := auth.WithUser(t.Context(), owner)
	sealer, err := crypto.NewSealer("reconnect-postgres-atomic")
	if err != nil {
		t.Fatal(err)
	}
	connector, ok := DefaultRegistry().Get("canvas")
	if !ok {
		t.Fatal("canvas connector missing")
	}
	h := New(client, sealer, DefaultRegistry(), Config{}, zap.NewNop())
	oldSealed, err := sealer.SealString("refresh-old-" + suffix)
	if err != nil {
		t.Fatal(err)
	}
	connection := client.MCPConnection.Create().SetUser(owner).SetConnector(connector.Name).SetAudience(connector.Audience).SetOrganizationID(connectorOrganizationID(owner)).SetScopes([]string{"canvas:invoices.read"}).SetRefreshTokenEncrypted(oldSealed).SetStatus("active").SetConnectedAt(time.Now()).SaveX(ctx)

	rollbackTx, err := client.Tx(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := h.upsertConnectionWithClient(ctx, rollbackTx.Client(), owner, connector, "refresh-rolled-back-"+suffix, []string{"canvas:invoices.read"}, time.Now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := rollbackTx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if got := client.ConnectorCredentialCleanupJob.Query().Where(connectorcredentialcleanupjob.ConnectionIDEQ(connection.ID)).CountX(auth.WithInternal(t.Context())); got != 0 {
		t.Fatalf("rollback left %d superseded credential escrows", got)
	}

	commitTx, err := client.Tx(ctx)
	if err != nil {
		t.Fatal(err)
	}
	updated, cleanupID, err := h.upsertConnectionWithClient(ctx, commitTx.Client(), owner, connector, "refresh-current-"+suffix, []string{"canvas:invoices.read"}, time.Now().Add(-time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if err := commitTx.Commit(); err != nil {
		t.Fatal(err)
	}
	job := client.ConnectorCredentialCleanupJob.GetX(auth.WithInternal(t.Context()), cleanupID)
	escrowed, err := sealer.OpenString(job.RefreshTokenEncrypted)
	if err != nil || escrowed != "refresh-old-"+suffix {
		t.Fatalf("escrowed superseded grant = %q, %v", escrowed, err)
	}
	current := client.MCPConnection.GetX(ctx, updated.ID)
	currentPlain, err := sealer.OpenString(current.RefreshTokenEncrypted)
	if err != nil || currentPlain != "refresh-current-"+suffix {
		t.Fatalf("installed current grant = %q, %v", currentPlain, err)
	}
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

func TestCredentialCustodyCapacityFloodPostgresRedisDualOutage(t *testing.T) {
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
	var allowRecovery atomic.Bool
	client.Use(func(next ent.Mutator) ent.Mutator {
		return ent.MutateFunc(func(ctx context.Context, mutation ent.Mutation) (ent.Value, error) {
			switch mutation.(type) {
			case *ent.ConnectorCredentialCleanupJobMutation:
				if mutation.Op().Is(ent.OpCreate) {
					return nil, errors.New("injected cleanup persistence outage")
				}
			case *ent.ConnectorCredentialRecoveryMutation:
				if mutation.Op().Is(ent.OpCreate) && !allowRecovery.Load() {
					return nil, errors.New("injected recovery persistence outage")
				}
			}
			return next.Mutate(ctx, mutation)
		})
	})
	sealer, err := crypto.NewSealer("connector-postgres-redis-capacity-flood")
	if err != nil {
		t.Fatal(err)
	}
	supervisor := newCredentialCustodySupervisor(zap.NewNop(), 1, 1)
	deduper := refreshDeduper{cache: cache, sealer: sealer, client: client, log: zap.NewNop(), custody: supervisor}

	providerStarted := make(chan struct{}, int(supervisor.capacity))
	var providerCalls atomic.Int64
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/revoke" {
			http.Error(w, "provider revocation unavailable", http.StatusServiceUnavailable)
			return
		}
		call := providerCalls.Add(1)
		providerStarted <- struct{}{}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(oryToken{AccessToken: fmt.Sprintf("access-%d", call), RefreshToken: fmt.Sprintf("refresh-flood-%d", call), ExpiresIn: 3600})
	}))
	t.Cleanup(provider.Close)
	ory := newOryClient(provider.URL, "client", "secret")

	startRefresh := func(i int, done chan<- error) {
		bound := newConnectorRefreshContext("canvas", uuid.NewString(), fmt.Sprintf("org-flood-%d", i), 1, "mcp:canvas", []string{"read"})
		_, refreshErr := deduper.refresh(t.Context(), bound, ory, fmt.Sprintf("refresh-old-%d", i), func(context.Context, *oryToken, uuid.UUID) (int64, error) {
			t.Errorf("refresh %d reached connection persistence during dual outage", i)
			return 0, nil
		})
		done <- refreshErr
	}

	admittedDone := make(chan error, int(supervisor.capacity))
	for i := 0; i < int(supervisor.capacity); i++ {
		go startRefresh(i, admittedDone)
	}
	for i := 0; i < int(supervisor.capacity); i++ {
		select {
		case <-providerStarted:
		case <-time.After(10 * time.Second):
			t.Fatal("timed out filling PostgreSQL/Redis custody capacity")
		}
	}

	const excess = 8
	excessDone := make(chan error, excess)
	for i := 0; i < excess; i++ {
		go startRefresh(100+i, excessDone)
	}
	for i := 0; i < excess; i++ {
		select {
		case refreshErr := <-excessDone:
			if !errors.Is(refreshErr, errCredentialCustodySaturated) {
				t.Fatalf("excess PostgreSQL/Redis refresh %d error = %v", i, refreshErr)
			}
		case <-time.After(10 * time.Second):
			t.Fatalf("excess PostgreSQL/Redis refresh %d did not fail before provider invocation", i)
		}
	}
	if got := providerCalls.Load(); got != supervisor.capacity {
		t.Fatalf("provider calls during capacity flood = %d, want %d", got, supervisor.capacity)
	}
	if got := supervisor.pending.Load(); got != supervisor.capacity {
		t.Fatalf("reserved custody during dual outage = %d, want %d", got, supervisor.capacity)
	}

	allowRecovery.Store(true)
	for i := 0; i < int(supervisor.capacity); i++ {
		select {
		case refreshErr := <-admittedDone:
			if refreshErr == nil || !strings.Contains(refreshErr.Error(), "encrypted recovery journal") {
				t.Fatalf("admitted PostgreSQL/Redis refresh %d error = %v", i, refreshErr)
			}
		case <-time.After(15 * time.Second):
			t.Fatalf("admitted PostgreSQL/Redis refresh %d did not establish recovery", i)
		}
	}
	if got := client.ConnectorCredentialRecovery.Query().Where(connectorcredentialrecovery.ConnectorEQ("canvas")).CountX(auth.WithInternal(t.Context())); got < int(supervisor.capacity) {
		t.Fatalf("durable recovery rows = %d, want at least %d", got, supervisor.capacity)
	}
	if err := supervisor.closeContext(context.Background()); err != nil {
		t.Fatalf("drain PostgreSQL/Redis custody flood: %v", err)
	}
}
