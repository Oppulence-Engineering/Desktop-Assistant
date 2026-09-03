package connectors

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/workosauth"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

type shortLeaseCache struct {
	RefreshCache
	ttl time.Duration
}

type failResultSetCache struct{ RefreshCache }

func refreshLeaseTestClient(t *testing.T) *ent.Client {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)", AutoMigrate: true}, zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d.Client
}

func (c *failResultSetCache) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if strings.Contains(key, "connectors:refresh:result:v2:") {
		return errors.New("injected result cache failure")
	}
	return c.RefreshCache.Set(ctx, key, value, ttl)
}

func (c *shortLeaseCache) TryLock(ctx context.Context, key string, _ time.Duration) (string, bool, error) {
	return c.RefreshCache.TryLock(ctx, key, c.ttl)
}

func (c *shortLeaseCache) Renew(ctx context.Context, key, owner string, _ time.Duration) (bool, error) {
	return c.RefreshCache.Renew(ctx, key, owner, c.ttl)
}

func TestExpiredConnectorHolderCannotPersistPublishOrDeleteSuccessor(t *testing.T) {
	providerStarted := make(chan struct{})
	releaseProvider := make(chan struct{})
	var providerCalls atomic.Int64
	var revokeCalls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/revoke" {
			revokeCalls.Add(1)
			w.WriteHeader(http.StatusOK)
			return
		}
		providerCalls.Add(1)
		close(providerStarted)
		<-releaseProvider
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(oryToken{
			AccessToken: "access-a", RefreshToken: "refresh-a", ExpiresIn: 3600,
		})
	}))
	t.Cleanup(server.Close)

	sealer, err := crypto.NewSealer("connector-refresh-lease-test")
	if err != nil {
		t.Fatal(err)
	}
	cache := &shortLeaseCache{RefreshCache: workosauth.NewMemoryRefreshCache(), ttl: 80 * time.Millisecond}
	d := refreshDeduper{cache: cache, sealer: sealer, client: refreshLeaseTestClient(t), log: zap.NewNop()}
	bound := newConnectorRefreshContext("canvas", "11111111-1111-1111-1111-111111111111", "org-1", 1, "mcp:canvas", []string{"read"})
	ory := newOryClient(server.URL, "client", "secret")
	var persists atomic.Int64
	result := make(chan error, 1)
	go func() {
		_, err := d.refresh(context.Background(), bound, ory, "refresh-old", func(context.Context, *oryToken, uuid.UUID) (int64, error) {
			persists.Add(1)
			return 2, nil
		})
		result <- err
	}()

	select {
	case <-providerStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("provider refresh did not start")
	}
	time.Sleep(100 * time.Millisecond)

	keyMaterial, _ := json.Marshal(struct {
		Context      connectorRefreshContext `json:"context"`
		RefreshToken string                  `json:"refresh_token"`
	}{Context: bound, RefreshToken: "refresh-old"})
	sum := sha256.Sum256(keyMaterial)
	lockKey := "connectors:refresh:lock:v2:" + hex.EncodeToString(sum[:])
	ownerB, acquired, err := cache.TryLock(t.Context(), lockKey, connectorRefreshLockTTL)
	if err != nil || !acquired {
		t.Fatalf("successor acquire after expiry = (%v, %v)", acquired, err)
	}
	if _, acquired, err := cache.TryLock(t.Context(), lockKey, connectorRefreshLockTTL); err != nil || acquired {
		t.Fatalf("third refresh acquired while successor owns lock = (%v, %v)", acquired, err)
	}

	close(releaseProvider)
	if err := <-result; !errors.Is(err, errConnectorRefreshInProgress) {
		t.Fatalf("stale holder result = %v, want refresh in progress", err)
	}
	if persists.Load() != 0 {
		t.Fatalf("stale holder persisted %d times", persists.Load())
	}
	if providerCalls.Load() != 1 {
		t.Fatalf("provider calls = %d, want 1", providerCalls.Load())
	}
	if revokeCalls.Load() != 1 {
		t.Fatalf("orphan revoke calls = %d, want 1", revokeCalls.Load())
	}
	if count := d.client.ConnectorCredentialCleanupJob.Query().CountX(auth.WithInternal(t.Context())); count != 0 {
		t.Fatalf("cleanup jobs after confirmed revoke = %d, want 0", count)
	}
	if _, acquired, err := cache.TryLock(t.Context(), lockKey, connectorRefreshLockTTL); err != nil || acquired {
		t.Fatalf("stale holder unlock deleted successor = (%v, %v)", acquired, err)
	}
	_ = cache.Unlock(t.Context(), lockKey, ownerB)
}

func TestConnectorCacheWriteFailureRetainsOwnedLease(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(oryToken{AccessToken: "access", RefreshToken: "refresh-new", ExpiresIn: 3600})
	}))
	t.Cleanup(server.Close)
	sealer, err := crypto.NewSealer("connector-refresh-cache-failure")
	if err != nil {
		t.Fatal(err)
	}
	cache := &failResultSetCache{RefreshCache: workosauth.NewMemoryRefreshCache()}
	d := refreshDeduper{cache: cache, sealer: sealer, client: refreshLeaseTestClient(t), log: zap.NewNop()}
	bound := newConnectorRefreshContext("canvas", "22222222-2222-2222-2222-222222222222", "org-1", 1, "mcp:canvas", []string{"read"})
	result, err := d.refresh(t.Context(), bound, newOryClient(server.URL, "client", "secret"), "refresh-old", func(ctx context.Context, _ *oryToken, cleanupID uuid.UUID) (int64, error) {
		if cleanupID != uuid.Nil {
			if err := d.client.ConnectorCredentialCleanupJob.DeleteOneID(cleanupID).Exec(auth.WithInternal(ctx)); err != nil {
				return 0, err
			}
		}
		return 2, nil
	})
	if err != nil || result == nil {
		t.Fatalf("refresh with cache failure = (%v, %v)", result, err)
	}

	keyMaterial, _ := json.Marshal(struct {
		Context      connectorRefreshContext `json:"context"`
		RefreshToken string                  `json:"refresh_token"`
	}{Context: bound, RefreshToken: "refresh-old"})
	sum := sha256.Sum256(keyMaterial)
	lockKey := "connectors:refresh:lock:v2:" + hex.EncodeToString(sum[:])
	if _, acquired, err := cache.TryLock(t.Context(), lockKey, connectorRefreshLockTTL); err != nil || acquired {
		t.Fatalf("cache failure released lease = (%v, %v)", acquired, err)
	}
}

func TestLeaseLossRevokeFailurePersistsCredentialOnlyRetry(t *testing.T) {
	var revokeCalls atomic.Int64
	failRevokes := atomic.Bool{}
	failRevokes.Store(true)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/oauth2/revoke" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		revokeCalls.Add(1)
		if failRevokes.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)

	sealer, err := crypto.NewSealer("connector-cleanup-retry-test")
	if err != nil {
		t.Fatal(err)
	}
	client := refreshLeaseTestClient(t)
	d := refreshDeduper{client: client, sealer: sealer, log: zap.NewNop()}
	bound := newConnectorRefreshContext("canvas", "33333333-3333-3333-3333-333333333333", "org-1", 7, "mcp:canvas", []string{"read"})
	jobID, err := d.enqueueCredentialCleanup(t.Context(), bound, "refresh-orphan")
	if err != nil {
		t.Fatal(err)
	}
	d.compensateCredential(t.Context(), newOryClient(server.URL, "client", "secret"), jobID, "refresh-orphan", "lease_lost_before_persist")
	job := client.ConnectorCredentialCleanupJob.GetX(auth.WithInternal(t.Context()), jobID)
	if job.Status != "pending" || job.LastErrorCode != "provider_revoke_unconfirmed" || job.Attempts != 1 {
		t.Fatalf("durable cleanup state = status %q error %q attempts %d", job.Status, job.LastErrorCode, job.Attempts)
	}
	if revokeCalls.Load() != 3 {
		t.Fatalf("bounded synchronous revoke calls = %d, want 3", revokeCalls.Load())
	}

	failRevokes.Store(false)
	h := New(client, sealer, DefaultRegistry(), Config{OryPublicURL: server.URL, OryBrokerClientID: "client", OryBrokerClientSecret: "secret"}, zap.NewNop())
	completed, err := h.ProcessCredentialCleanupJobs(t.Context(), 25)
	if err != nil || completed != 1 {
		t.Fatalf("durable cleanup retry = (%d, %v), want (1, nil)", completed, err)
	}
	if count := client.ConnectorCredentialCleanupJob.Query().CountX(auth.WithInternal(t.Context())); count != 0 {
		t.Fatalf("cleanup jobs after retry = %d, want 0", count)
	}
}

func TestAdoptedCleanupIsNeverRevokedAfterAmbiguousPersistError(t *testing.T) {
	var revokeCalls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		revokeCalls.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)
	sealer, _ := crypto.NewSealer("connector-adoption-race-test")
	client := refreshLeaseTestClient(t)
	d := refreshDeduper{client: client, sealer: sealer, log: zap.NewNop()}
	bound := newConnectorRefreshContext("canvas", "44444444-4444-4444-4444-444444444444", "org-1", 2, "mcp:canvas", []string{"read"})
	jobID, err := d.enqueueCredentialCleanup(t.Context(), bound, "refresh-adopted")
	if err != nil {
		t.Fatal(err)
	}
	client.ConnectorCredentialCleanupJob.DeleteOneID(jobID).ExecX(auth.WithInternal(t.Context()))
	d.compensateCredential(t.Context(), newOryClient(server.URL, "client", "secret"), jobID, "refresh-adopted", "ambiguous_commit")
	if revokeCalls.Load() != 0 {
		t.Fatalf("adopted credential was revoked %d times", revokeCalls.Load())
	}
}

func TestCleanupInsertAndProviderRevokeFailureRetainsRecoveryAcrossRestart(t *testing.T) {
	var revokeCalls atomic.Int64
	var allowRevoke atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/revoke" {
			revokeCalls.Add(1)
			if !allowRevoke.Load() {
				http.Error(w, "retry", http.StatusServiceUnavailable)
				return
			}
			w.WriteHeader(http.StatusOK)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(oryToken{AccessToken: "access-new", RefreshToken: "refresh-recovery", ExpiresIn: 3600})
	}))
	t.Cleanup(server.Close)

	databasePath := filepath.Join(t.TempDir(), "credential-recovery.db")
	openClient := func() (*db.DB, *ent.Client) {
		t.Helper()
		database, err := db.Open(context.Background(), appconfig.Config{DatabaseURL: "file:" + databasePath + "?_pragma=foreign_keys(1)", AutoMigrate: true}, zap.NewNop())
		if err != nil {
			t.Fatal(err)
		}
		return database, database.Client
	}
	firstDB, client := openClient()
	client.Use(func(next ent.Mutator) ent.Mutator {
		return ent.MutateFunc(func(ctx context.Context, mutation ent.Mutation) (ent.Value, error) {
			if _, ok := mutation.(*ent.ConnectorCredentialCleanupJobMutation); ok && mutation.Op().Is(ent.OpCreate) {
				return nil, errors.New("injected cleanup insert failure")
			}
			return next.Mutate(ctx, mutation)
		})
	})
	sealer, err := crypto.NewSealer("connector-recovery-restart-test")
	if err != nil {
		t.Fatal(err)
	}
	custody := newCredentialCustodySupervisor(zap.NewNop(), 1, 4)
	t.Cleanup(custody.close)
	d := refreshDeduper{cache: workosauth.NewMemoryRefreshCache(), sealer: sealer, client: client, log: zap.NewNop(), custody: custody}
	bound := newConnectorRefreshContext("canvas", uuid.NewString(), "org-1", 1, "mcp:canvas", []string{"read"})
	var persists atomic.Int64
	_, refreshErr := d.refresh(t.Context(), bound, newOryClient(server.URL, "client", "secret"), "refresh-old", func(context.Context, *oryToken, uuid.UUID) (int64, error) {
		persists.Add(1)
		return 2, nil
	})
	if refreshErr == nil || !strings.Contains(refreshErr.Error(), "encrypted recovery journal") {
		t.Fatalf("refresh error = %v, want durable recovery journal", refreshErr)
	}
	if persists.Load() != 0 {
		t.Fatalf("persist called %d times after unconfirmed revoke", persists.Load())
	}
	if revokeCalls.Load() != 3 {
		t.Fatalf("bounded revoke calls = %d, want 3", revokeCalls.Load())
	}
	recovery := client.ConnectorCredentialRecovery.Query().OnlyX(auth.WithInternal(t.Context()))
	plain, err := sealer.OpenString(recovery.RefreshTokenEncrypted)
	if err != nil || plain != "refresh-recovery" {
		t.Fatalf("recovery credential = %q, %v", plain, err)
	}
	if count := client.ConnectorCredentialCleanupJob.Query().CountX(auth.WithInternal(t.Context())); count != 0 {
		t.Fatalf("primary cleanup rows = %d, want 0", count)
	}
	if err := firstDB.Close(); err != nil {
		t.Fatal(err)
	}

	// A fresh database client and handler model a process restart. The encrypted
	// journal, not process memory, supplies the credential for the retry.
	secondDB, restartedClient := openClient()
	t.Cleanup(func() { _ = secondDB.Close() })
	allowRevoke.Store(true)
	restarted := New(restartedClient, sealer, nil, Config{OryPublicURL: server.URL}, zap.NewNop())
	completed, err := restarted.ProcessCredentialCleanupJobs(t.Context(), 25)
	if err != nil {
		t.Fatal(err)
	}
	if completed != 1 {
		t.Fatalf("completed recoveries = %d, want 1", completed)
	}
	if count := restartedClient.ConnectorCredentialRecovery.Query().CountX(auth.WithInternal(t.Context())); count != 0 {
		t.Fatalf("recovery rows after restart cleanup = %d, want 0", count)
	}
}

func TestProviderResponseCrashBoundaryPrecedesAllFallibleLocalWork(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(oryToken{AccessToken: "access", RefreshToken: "refresh-unavoidable-window", ExpiresIn: 3600})
	}))
	t.Cleanup(server.Close)
	sealer, err := crypto.NewSealer("connector-provider-response-boundary")
	if err != nil {
		t.Fatal(err)
	}
	client := refreshLeaseTestClient(t)
	d := refreshDeduper{cache: workosauth.NewMemoryRefreshCache(), sealer: sealer, client: client, log: zap.NewNop()}
	boundary := errors.New("simulated process termination immediately after provider response")
	d.afterProviderResponseForTest = func() { panic(boundary) }
	bound := newConnectorRefreshContext("canvas", uuid.NewString(), "org-1", 1, "mcp:canvas", []string{"read"})

	func() {
		defer func() {
			recovered := recover()
			if recovered == nil || !strings.Contains(fmt.Sprint(recovered), boundary.Error()) {
				t.Fatalf("recovered %v, want exact provider-response boundary", recovered)
			}
		}()
		_, _ = d.refresh(t.Context(), bound, newOryClient(server.URL, "client", "secret"), "refresh-old", func(context.Context, *oryToken, uuid.UUID) (int64, error) {
			t.Fatal("persistence ran beyond simulated process termination")
			return 0, nil
		})
	}()
	if count := client.ConnectorCredentialCleanupJob.Query().CountX(auth.WithInternal(t.Context())); count != 0 {
		t.Fatalf("cleanup rows at irreducible crash boundary = %d, want 0", count)
	}
	if count := client.ConnectorCredentialRecovery.Query().CountX(auth.WithInternal(t.Context())); count != 0 {
		t.Fatalf("recovery rows at irreducible crash boundary = %d, want 0", count)
	}
}

func TestRefreshProviderInvocationIsDeniedBeyondCustodyCapacity(t *testing.T) {
	const callers = 14
	supervisor := newCredentialCustodySupervisor(zap.NewNop(), 1, 1)
	sealer, err := crypto.NewSealer("refresh-hard-custody-capacity")
	if err != nil {
		t.Fatal(err)
	}
	deduper := refreshDeduper{
		cache:   workosauth.NewMemoryRefreshCache(),
		sealer:  sealer,
		log:     zap.NewNop(),
		custody: supervisor,
	}

	releaseProvider := make(chan struct{})
	providerStarted := make(chan struct{}, int(supervisor.capacity))
	var providerCalls atomic.Int64
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		providerCalls.Add(1)
		providerStarted <- struct{}{}
		<-releaseProvider
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
	}))
	t.Cleanup(provider.Close)
	ory := newOryClient(provider.URL, "client", "secret")

	startRefresh := func(i int, done chan<- error) {
		bound := newConnectorRefreshContext("canvas", uuid.NewString(), fmt.Sprintf("org-%d", i), 1, "mcp:canvas", []string{"read"})
		_, refreshErr := deduper.refresh(context.Background(), bound, ory, fmt.Sprintf("refresh-old-%d", i), nil)
		done <- refreshErr
	}

	admittedDone := make(chan error, int(supervisor.capacity))
	for i := 0; i < int(supervisor.capacity); i++ {
		go startRefresh(i, admittedDone)
	}
	for i := 0; i < int(supervisor.capacity); i++ {
		select {
		case <-providerStarted:
		case <-time.After(5 * time.Second):
			t.Fatal("timed out filling custody capacity with provider operations")
		}
	}

	excessDone := make(chan error, callers-int(supervisor.capacity))
	for i := int(supervisor.capacity); i < callers; i++ {
		go startRefresh(i, excessDone)
	}
	for i := int(supervisor.capacity); i < callers; i++ {
		select {
		case refreshErr := <-excessDone:
			if !errors.Is(refreshErr, errCredentialCustodySaturated) {
				t.Fatalf("excess refresh %d error = %v, want custody saturation", i, refreshErr)
			}
		case <-time.After(5 * time.Second):
			t.Fatalf("excess refresh %d did not fail before provider invocation", i)
		}
		if got := supervisor.pending.Load(); got > supervisor.capacity {
			t.Fatalf("pending exceeded hard capacity: pending=%d capacity=%d", got, supervisor.capacity)
		}
	}
	if got := providerCalls.Load(); got != supervisor.capacity {
		t.Fatalf("provider calls = %d, want hard capacity %d", got, supervisor.capacity)
	}

	close(releaseProvider)
	for i := 0; i < int(supervisor.capacity); i++ {
		select {
		case refreshErr := <-admittedDone:
			if !isOAuthErrorCode(refreshErr, "invalid_grant") {
				t.Fatalf("admitted refresh %d error = %v", i, refreshErr)
			}
		case <-time.After(5 * time.Second):
			t.Fatalf("admitted refresh %d did not finish", i)
		}
	}
	if err := supervisor.closeContext(context.Background()); err != nil {
		t.Fatalf("drain refresh custody supervisor: %v", err)
	}
}

func TestAccessOnlyRefreshCredentialIsRevokedBeforePermitRelease(t *testing.T) {
	var revokeCalls atomic.Int64
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/revoke" {
			revokeCalls.Add(1)
			w.WriteHeader(http.StatusOK)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(oryToken{AccessToken: "access-only-live-credential", ExpiresIn: 3600})
	}))
	t.Cleanup(provider.Close)

	client := refreshLeaseTestClient(t)
	sealer, err := crypto.NewSealer("access-only-refresh-custody")
	if err != nil {
		t.Fatal(err)
	}
	supervisor := newCredentialCustodySupervisor(zap.NewNop(), 1, 1)
	deduper := refreshDeduper{
		cache: workosauth.NewMemoryRefreshCache(), sealer: sealer, client: client,
		log: zap.NewNop(), custody: supervisor,
	}
	bound := newConnectorRefreshContext("canvas", uuid.NewString(), "org-access-only", 1, "mcp:canvas", []string{"read"})
	_, refreshErr := deduper.refresh(context.Background(), bound, newOryClient(provider.URL, "client", "secret"), "refresh-old", func(context.Context, *oryToken, uuid.UUID) (int64, error) {
		t.Fatal("access-only provider credential must not reach connection persistence")
		return 0, nil
	})
	if refreshErr == nil || !strings.Contains(refreshErr.Error(), "omitted a replacement refresh credential") {
		t.Fatalf("access-only refresh error = %v", refreshErr)
	}
	if got := revokeCalls.Load(); got != 1 {
		t.Fatalf("access-only provider credential revoke calls = %d, want 1", got)
	}
	if got := client.ConnectorCredentialRecovery.Query().CountX(auth.WithInternal(context.Background())); got != 0 {
		t.Fatalf("access-only recovery rows after confirmed revoke = %d, want 0", got)
	}
	if got := supervisor.pending.Load(); got != 0 {
		t.Fatalf("access-only provider permit remained reserved: pending=%d", got)
	}
	if err := supervisor.closeContext(context.Background()); err != nil {
		t.Fatalf("drain access-only refresh custody: %v", err)
	}
}
