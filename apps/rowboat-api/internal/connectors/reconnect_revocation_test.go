package connectors

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/connectorcredentialcleanupjob"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"go.uber.org/zap"
)

func openReconnectTestDatabase(t *testing.T) (*db.DB, *crypto.Sealer) {
	t.Helper()
	database, err := db.Open(t.Context(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	sealer, err := crypto.NewSealer("reconnect-revocation-test")
	if err != nil {
		t.Fatal(err)
	}
	return database, sealer
}

func TestReconnectEscrowRollsBackWithReplacement(t *testing.T) {
	database, sealer := openReconnectTestDatabase(t)
	client := database.Client
	owner := client.User.Create().SetEmail("rollback@example.invalid").SetWorkosUserID("rollback-user").SetWorkosOrgID("rollback-org").SaveX(t.Context())
	ctx := auth.WithUser(t.Context(), owner)
	connector, ok := DefaultRegistry().Get("canvas")
	if !ok {
		t.Fatal("canvas connector missing")
	}
	h := New(client, sealer, DefaultRegistry(), Config{}, zap.NewNop())
	oldSealed, _ := sealer.SealString("refresh-old")
	connection := client.MCPConnection.Create().SetUser(owner).SetConnector(connector.Name).SetAudience(connector.Audience).SetOrganizationID(connectorOrganizationID(owner)).SetScopes([]string{"canvas:invoices.read"}).SetRefreshTokenEncrypted(oldSealed).SetStatus("active").SetConnectedAt(time.Now()).SaveX(ctx)

	tx, err := client.Tx(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, cleanupID, err := h.upsertConnectionWithClient(ctx, tx.Client(), owner, connector, "refresh-new", []string{"canvas:invoices.read"}, time.Now().Add(-time.Second)); err != nil || cleanupID == [16]byte{} {
		t.Fatalf("upsert cleanup = %s, %v", cleanupID, err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if got := client.ConnectorCredentialCleanupJob.Query().CountX(auth.WithInternal(t.Context())); got != 0 {
		t.Fatalf("cleanup rows after rollback = %d", got)
	}
	stored := client.MCPConnection.GetX(ctx, connection.ID)
	plain, err := sealer.OpenString(stored.RefreshTokenEncrypted)
	if err != nil || plain != "refresh-old" {
		t.Fatalf("current credential after rollback = %q, %v", plain, err)
	}
}

func TestReconnectCrashAfterCommitLeavesDurableSupersededGrant(t *testing.T) {
	database, sealer := openReconnectTestDatabase(t)
	client := database.Client
	owner := client.User.Create().SetEmail("crash@example.invalid").SetWorkosUserID("crash-user").SetWorkosOrgID("crash-org").SaveX(t.Context())
	ctx := auth.WithUser(t.Context(), owner)
	connector, ok := DefaultRegistry().Get("canvas")
	if !ok {
		t.Fatal("canvas connector missing")
	}
	var revoked atomic.Int64
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/revoke" {
			revoked.Add(1)
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(provider.Close)
	h := New(client, sealer, DefaultRegistry(), Config{OryPublicURL: provider.URL}, zap.NewNop())
	oldSealed, _ := sealer.SealString("refresh-old")
	connection := client.MCPConnection.Create().SetUser(owner).SetConnector(connector.Name).SetAudience(connector.Audience).SetOrganizationID(connectorOrganizationID(owner)).SetScopes([]string{"canvas:invoices.read"}).SetRefreshTokenEncrypted(oldSealed).SetStatus("active").SetConnectedAt(time.Now()).SaveX(ctx)

	tx, err := client.Tx(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, cleanupID, err := h.upsertConnectionWithClient(ctx, tx.Client(), owner, connector, "refresh-new", []string{"canvas:invoices.read"}, time.Now().Add(-time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if revoked.Load() != 0 {
		t.Fatal("provider revoke happened before post-commit processing")
	}
	job := client.ConnectorCredentialCleanupJob.GetX(auth.WithInternal(t.Context()), cleanupID)
	plainOld, err := sealer.OpenString(job.RefreshTokenEncrypted)
	if err != nil || plainOld != "refresh-old" {
		t.Fatalf("escrowed credential = %q, %v", plainOld, err)
	}
	stored := client.MCPConnection.GetX(ctx, connection.ID)
	plainCurrent, err := sealer.OpenString(stored.RefreshTokenEncrypted)
	if err != nil || plainCurrent != "refresh-new" {
		t.Fatalf("current credential = %q, %v", plainCurrent, err)
	}
	completed, err := h.ProcessCredentialCleanupJobs(t.Context(), 10)
	if err != nil || completed != 1 {
		t.Fatalf("cleanup after restart = %d, %v", completed, err)
	}
	if revoked.Load() != 1 {
		t.Fatalf("provider revokes = %d", revoked.Load())
	}
}

func TestReconnectAmbiguousRevokeRetainsRetryAndNeverRevokesCurrent(t *testing.T) {
	database, sealer := openReconnectTestDatabase(t)
	client := database.Client
	owner := client.User.Create().SetEmail("ambiguous-revoke@example.invalid").SetWorkosUserID("ambiguous-revoke-user").SetWorkosOrgID("ambiguous-revoke-org").SaveX(t.Context())
	ctx := auth.WithUser(t.Context(), owner)
	connector, ok := DefaultRegistry().Get("canvas")
	if !ok {
		t.Fatal("canvas connector missing")
	}
	var attempts atomic.Int64
	var mu sync.Mutex
	var tokens []string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/oauth2/revoke" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_ = r.ParseForm()
		mu.Lock()
		tokens = append(tokens, r.Form.Get("token"))
		mu.Unlock()
		if attempts.Add(1) <= 3 {
			hijacker := w.(http.Hijacker)
			conn, _, _ := hijacker.Hijack()
			_ = conn.Close()
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(provider.Close)
	h := New(client, sealer, DefaultRegistry(), Config{OryPublicURL: provider.URL}, zap.NewNop())
	oldSealed, _ := sealer.SealString("refresh-old")
	connection := client.MCPConnection.Create().SetUser(owner).SetConnector(connector.Name).SetAudience(connector.Audience).SetOrganizationID(connectorOrganizationID(owner)).SetScopes([]string{"canvas:invoices.read"}).SetRefreshTokenEncrypted(oldSealed).SetStatus("active").SetConnectedAt(time.Now()).SaveX(ctx)

	replace := func(next string) [16]byte {
		tx, err := client.Tx(ctx)
		if err != nil {
			t.Fatal(err)
		}
		_, cleanupID, err := h.upsertConnectionWithClient(ctx, tx.Client(), owner, connector, next, []string{"canvas:invoices.read"}, time.Now().Add(-time.Second))
		if err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
		return cleanupID
	}
	firstCleanup := replace("refresh-current")
	h.revokeSupersededCredential(context.Background(), firstCleanup)
	job := client.ConnectorCredentialCleanupJob.GetX(auth.WithInternal(t.Context()), firstCleanup)
	if job.Status != "pending" || job.Attempts != 1 || job.LastErrorCode != "provider_revoke_unconfirmed" {
		t.Fatalf("ambiguous revoke job = status %q attempts %d error %q", job.Status, job.Attempts, job.LastErrorCode)
	}
	_ = replace("refresh-newer")
	if _, err := h.ProcessCredentialCleanupJobs(t.Context(), 10); err != nil {
		t.Fatal(err)
	}
	stored := client.MCPConnection.GetX(ctx, connection.ID)
	plainCurrent, err := sealer.OpenString(stored.RefreshTokenEncrypted)
	if err != nil || plainCurrent != "refresh-newer" {
		t.Fatalf("newer current credential = %q, %v", plainCurrent, err)
	}
	mu.Lock()
	defer mu.Unlock()
	for _, token := range tokens {
		if token == "refresh-newer" {
			t.Fatalf("revoked current/newer credential %q; attempts = %v", token, tokens)
		}
	}
	if len(tokens) < 5 {
		t.Fatalf("revocation attempts = %v", tokens)
	}
	seenOld, seenIntermediate := false, false
	for _, token := range tokens {
		seenOld = seenOld || token == "refresh-old"
		seenIntermediate = seenIntermediate || token == "refresh-current"
	}
	if !seenOld || !seenIntermediate {
		t.Fatalf("superseded credentials were not both revoked: %v", tokens)
	}
	if count := client.ConnectorCredentialCleanupJob.Query().Where(connectorcredentialcleanupjob.IDEQ(firstCleanup)).CountX(auth.WithInternal(t.Context())); count != 0 {
		t.Fatalf("completed superseded cleanup retained %d rows", count)
	}
}
