package connectors

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/connectorauditevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mcpconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/workosauth"
	"go.uber.org/zap"
)

const runtimeAPIKeyRegistry = `[{
  "name":"canvas",
  "displayName":"Canvas",
  "description":"Canvas",
  "mcpUrls":{"development":"https://canvas.dev.example/mcp","staging":"https://canvas.staging.example/mcp","production":"https://canvas.example/mcp"},
  "authType":"api_key",
  "audiences":{"development":"canvas-dev-api","staging":"canvas-staging-api","production":"canvas-api"},
  "authoritativeEntitlementRequired":true,
  "environments":["development","staging","production"],
  "scopes":[{"name":"canvas:invoices.read","displayName":"Read invoices","description":"Read invoices","grantTier":"required","risk":"low"}],
  "mcpTools":[{"name":"invoice.lookup","trustTier":"read"}]
}]`

const runtimeOAuthRegistry = `[{
  "name":"canvas",
  "displayName":"Canvas",
  "description":"Canvas",
  "mcpUrl":"https://canvas.example/mcp",
  "authType":"oauth",
  "audience":"canvas-api",
  "scopes":[{"name":"canvas:invoices.read","displayName":"Read invoices","description":"Read invoices","grantTier":"required","risk":"low"}],
  "mcpTools":[{"name":"invoice.lookup","trustTier":"read"}]
}]`

type countingIssuer struct{ calls atomic.Int64 }

func (i *countingIssuer) Mint(ResourceTokenClaims) (string, time.Time, error) {
	i.calls.Add(1)
	return "header.payload.signature", time.Now().Add(5 * time.Minute), nil
}
func (*countingIssuer) JWKS() map[string]any { return map[string]any{"keys": []any{}} }

func runtimeTestDB(t *testing.T) (*ent.Client, *ent.User, *crypto.Sealer) {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + strings.ReplaceAll(t.Name(), "/", "_") + "?mode=memory&cache=shared&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	ctx := auth.WithInternal(context.Background())
	owner := d.Client.User.Create().SetEmail("owner@example.com").SetWorkosUserID("user_1").SetWorkosOrgID("org_1").SaveX(ctx)
	sealer, err := crypto.NewSealer("runtime-lifecycle-test-key")
	if err != nil {
		t.Fatal(err)
	}
	return d.Client, owner, sealer
}

func runtimeRegistry(t *testing.T, raw, endpoint string) *Registry {
	t.Helper()
	registry, err := LoadRegistryForEnvironment([]byte(raw), "development", nil)
	if err != nil {
		t.Fatal(err)
	}
	if endpoint != "" {
		err = registry.ConfigureProductEntitlements(
			map[string]string{"canvas": endpoint},
			map[string]string{"canvas": "01234567890123456789012345678901"},
		)
	}
	if err != nil {
		t.Fatal(err)
	}
	return registry
}

func seedRuntimeAPIKey(t *testing.T, client *ent.Client, owner *ent.User, sealer *crypto.Sealer) *ent.MCPConnection {
	t.Helper()
	sealed, err := sealer.SealString("vendor-api-key")
	if err != nil {
		t.Fatal(err)
	}
	return client.MCPConnection.Create().SetUser(owner).SetConnector("canvas").SetAudience("canvas-dev-api").
		SetOrganizationID("org_1").SetScopes([]string{"canvas:invoices.read"}).SetAPIKeyEncrypted(sealed).
		SaveX(auth.WithInternal(context.Background()))
}

func newRuntimeResolver(client *ent.Client, sealer *crypto.Sealer, registry *Registry, issuer ResourceTokenIssuer, cfg Config) *MCPRuntimeResolver {
	resolver := NewMCPRuntimeResolver(client, sealer, registry, cfg)
	resolver.SetResourceTokenIssuer(issuer)
	resolver.SetRefreshDedup(workosauth.NewMemoryRefreshCache(), sealer, zap.NewNop())
	return resolver
}

func auditTypes(t *testing.T, client *ent.Client, owner *ent.User) []string {
	t.Helper()
	events := client.ConnectorAuditEvent.Query().Where(connectorauditevent.HasUserWith()).AllX(auth.WithUser(context.Background(), owner))
	out := make([]string, 0, len(events))
	for _, event := range events {
		out = append(out, event.EventType)
	}
	return out
}

func containsAudit(events []string, target string) bool {
	for _, event := range events {
		if event == target {
			return true
		}
	}
	return false
}

func TestWorkerRuntimeProductDenialAndDowngradeInvalidateBeforeMint(t *testing.T) {
	var allowed atomic.Bool
	allowed.Store(true)
	var signed atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Rowboat-Signature") != "" && r.Header.Get("X-Rowboat-Request-ID") != "" {
			signed.Store(true)
		}
		w.Header().Set("Content-Type", "application/json")
		if allowed.Load() {
			_, _ = w.Write([]byte(`{"allowed":true,"reason":""}`))
			return
		}
		_, _ = w.Write([]byte(`{"allowed":false,"reason":"scope_not_in_plan"}`))
	}))
	t.Cleanup(server.Close)

	client, owner, sealer := runtimeTestDB(t)
	connection := seedRuntimeAPIKey(t, client, owner, sealer)
	issuer := &countingIssuer{}
	resolver := newRuntimeResolver(client, sealer, runtimeRegistry(t, runtimeAPIKeyRegistry, server.URL), issuer, Config{})

	if _, _, _, err := resolver.ResolveMCP(context.Background(), owner.ID.String(), "canvas"); err != nil {
		t.Fatalf("initial resolve: %v", err)
	}
	if !signed.Load() || issuer.calls.Load() != 1 {
		t.Fatalf("signed=%v issuer_calls=%d", signed.Load(), issuer.calls.Load())
	}

	allowed.Store(false)
	if _, _, _, err := resolver.ResolveMCP(context.Background(), owner.ID.String(), "canvas"); err == nil || !strings.Contains(err.Error(), "scope_not_in_plan") {
		t.Fatalf("downgrade error = %v", err)
	}
	if issuer.calls.Load() != 1 {
		t.Fatalf("downgrade minted another token: calls=%d", issuer.calls.Load())
	}
	current := client.MCPConnection.GetX(auth.WithInternal(context.Background()), connection.ID)
	if current.Status != "invalidated" || current.CredentialGeneration != connection.CredentialGeneration+1 || len(current.APIKeyEncrypted) != 0 {
		t.Fatalf("downgrade tombstone = %+v", current)
	}
	events := auditTypes(t, client, owner)
	for _, want := range []string{"token_minted", "entitlement.check", "token.minted", "token_mint_rejected", "connection_invalidated", "token.revoked"} {
		if !containsAudit(events, want) {
			t.Fatalf("missing audit %q in %v", want, events)
		}
	}
}

func TestWorkerRuntimeRejectsOrganizationMismatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"allowed":true,"reason":""}`))
	}))
	t.Cleanup(server.Close)
	client, owner, sealer := runtimeTestDB(t)
	seedRuntimeAPIKey(t, client, owner, sealer)
	issuer := &countingIssuer{}
	resolver := newRuntimeResolver(client, sealer, runtimeRegistry(t, runtimeAPIKeyRegistry, server.URL), issuer, Config{})

	client.User.UpdateOneID(owner.ID).SetWorkosOrgID("org_2").ExecX(auth.WithInternal(context.Background()))
	if _, _, _, err := resolver.ResolveMCP(context.Background(), owner.ID.String(), "canvas"); err == nil || !strings.Contains(err.Error(), "not connected") {
		t.Fatalf("organization mismatch error = %v", err)
	}
	if issuer.calls.Load() != 0 {
		t.Fatalf("organization mismatch minted %d tokens", issuer.calls.Load())
	}
}

func TestWorkerRuntimeEmergencyDisableBlocksReplicaMint(t *testing.T) {
	client, owner, sealer := runtimeTestDB(t)
	seedRuntimeAPIKey(t, client, owner, sealer)
	registry, err := LoadRegistryForEnvironment([]byte(runtimeAPIKeyRegistry), "production", []string{"canvas"})
	if err != nil {
		t.Fatal(err)
	}
	if err := registry.ConfigureProductEntitlementsJSON("", ""); err != nil {
		t.Fatal(err)
	}
	issuer := &countingIssuer{}
	resolverA := newRuntimeResolver(client, sealer, registry, issuer, Config{})
	resolverB := newRuntimeResolver(client, sealer, registry, issuer, Config{})
	for _, resolver := range []*MCPRuntimeResolver{resolverA, resolverB} {
		if _, _, _, err := resolver.ResolveMCP(context.Background(), owner.ID.String(), "canvas"); err == nil || !strings.Contains(err.Error(), "connector_disabled") {
			t.Fatalf("emergency disable error = %v", err)
		}
	}
	if issuer.calls.Load() != 0 {
		t.Fatalf("emergency-disabled replicas minted %d tokens", issuer.calls.Load())
	}
}

func TestWorkerRuntimeMultiReplicaLifecycleRaceFencesMint(t *testing.T) {
	requestStarted := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		once.Do(func() { close(requestStarted) })
		<-release
		_, _ = w.Write([]byte(`{"allowed":true,"reason":""}`))
	}))
	t.Cleanup(server.Close)
	client, owner, sealer := runtimeTestDB(t)
	connection := seedRuntimeAPIKey(t, client, owner, sealer)
	issuer := &countingIssuer{}
	registry := runtimeRegistry(t, runtimeAPIKeyRegistry, server.URL)
	resolverA := newRuntimeResolver(client, sealer, registry, issuer, Config{})
	_ = newRuntimeResolver(client, sealer, registry, issuer, Config{}) // second replica shares DB and deployment policy

	errCh := make(chan error, 1)
	go func() {
		_, _, _, err := resolverA.ResolveMCP(context.Background(), owner.ID.String(), "canvas")
		errCh <- err
	}()
	select {
	case <-requestStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("entitlement request did not start")
	}
	client.MCPConnection.UpdateOneID(connection.ID).Where(
		mcpconnection.CredentialGenerationEQ(connection.CredentialGeneration),
		mcpconnection.StatusEQ("active"),
	).SetStatus("invalidated").AddCredentialGeneration(1).ClearAPIKeyEncrypted().ExecX(auth.WithInternal(context.Background()))
	close(release)
	if err := <-errCh; !errors.Is(err, errConnectorCredentialSuperseded) && (err == nil || !strings.Contains(err.Error(), errConnectorCredentialSuperseded.Error())) {
		t.Fatalf("race error = %v", err)
	}
	if issuer.calls.Load() != 0 {
		t.Fatalf("lifecycle loser minted %d tokens", issuer.calls.Load())
	}
}

func TestWorkerRuntimeScopeDowngradeRaceFencesMint(t *testing.T) {
	requestStarted := make(chan struct{})
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(requestStarted)
		<-release
		_, _ = w.Write([]byte(`{"allowed":true,"reason":""}`))
	}))
	t.Cleanup(server.Close)
	client, owner, sealer := runtimeTestDB(t)
	connection := seedRuntimeAPIKey(t, client, owner, sealer)
	issuer := &countingIssuer{}
	registry := runtimeRegistry(t, runtimeAPIKeyRegistry, server.URL)
	resolverA := newRuntimeResolver(client, sealer, registry, issuer, Config{})
	_ = newRuntimeResolver(client, sealer, registry, issuer, Config{})

	errCh := make(chan error, 1)
	go func() {
		_, _, _, err := resolverA.ResolveMCP(context.Background(), owner.ID.String(), "canvas")
		errCh <- err
	}()
	select {
	case <-requestStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("entitlement request did not start")
	}
	client.MCPConnection.UpdateOneID(connection.ID).
		Where(mcpconnection.CredentialGenerationEQ(connection.CredentialGeneration), mcpconnection.StatusEQ("active")).
		ClearScopes().ExecX(auth.WithInternal(context.Background()))
	close(release)
	if err := <-errCh; !errors.Is(err, errConnectorCredentialSuperseded) && (err == nil || !strings.Contains(err.Error(), errConnectorCredentialSuperseded.Error())) {
		t.Fatalf("scope downgrade race error = %v", err)
	}
	if issuer.calls.Load() != 0 {
		t.Fatalf("scope downgrade loser minted %d tokens", issuer.calls.Load())
	}
}

func TestWorkerRuntimeRefreshFailureGenerationFenceAndFamilyInvalidation(t *testing.T) {
	t.Run("stale invalid grant cannot poison reconnect", func(t *testing.T) {
		started := make(chan struct{})
		release := make(chan struct{})
		ory := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/oauth2/token" {
				close(started)
				<-release
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
				return
			}
			w.WriteHeader(http.StatusOK)
		}))
		t.Cleanup(ory.Close)
		client, owner, sealer := runtimeTestDB(t)
		registry := runtimeRegistry(t, runtimeOAuthRegistry, "")
		oldRefresh, _ := sealer.SealString("old-refresh")
		connection := client.MCPConnection.Create().SetUser(owner).SetConnector("canvas").SetAudience("canvas-api").
			SetOrganizationID("org_1").SetScopes([]string{"canvas:invoices.read"}).SetRefreshTokenEncrypted(oldRefresh).
			SaveX(auth.WithInternal(context.Background()))
		resolver := newRuntimeResolver(client, sealer, registry, &countingIssuer{}, Config{OryPublicURL: ory.URL})
		errCh := make(chan error, 1)
		go func() {
			_, _, _, err := resolver.ResolveMCP(context.Background(), owner.ID.String(), "canvas")
			errCh <- err
		}()
		<-started
		newRefresh, _ := sealer.SealString("new-refresh")
		client.MCPConnection.UpdateOneID(connection.ID).Where(mcpconnection.CredentialGenerationEQ(connection.CredentialGeneration)).
			SetRefreshTokenEncrypted(newRefresh).AddCredentialGeneration(1).SetStatus("active").ExecX(auth.WithInternal(context.Background()))
		close(release)
		if err := <-errCh; err == nil {
			t.Fatal("refresh unexpectedly succeeded")
		}
		current := client.MCPConnection.GetX(auth.WithInternal(context.Background()), connection.ID)
		opened, _ := sealer.OpenString(current.RefreshTokenEncrypted)
		if current.Status != "active" || current.CredentialGeneration != connection.CredentialGeneration+1 || opened != "new-refresh" {
			t.Fatalf("stale failure poisoned reconnect: status=%s generation=%d refresh=%q", current.Status, current.CredentialGeneration, opened)
		}
	})

	t.Run("family reuse invalidates and audits", func(t *testing.T) {
		ory := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/oauth2/token" {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"invalid_grant","error_description":"refresh token reuse detected for token family"}`))
				return
			}
			w.WriteHeader(http.StatusOK)
		}))
		t.Cleanup(ory.Close)
		client, owner, sealer := runtimeTestDB(t)
		registry := runtimeRegistry(t, runtimeOAuthRegistry, "")
		sealed, _ := sealer.SealString("family-refresh")
		connection := client.MCPConnection.Create().SetUser(owner).SetConnector("canvas").SetAudience("canvas-api").
			SetOrganizationID("org_1").SetScopes([]string{"canvas:invoices.read"}).SetRefreshTokenEncrypted(sealed).
			SaveX(auth.WithInternal(context.Background()))
		resolver := newRuntimeResolver(client, sealer, registry, &countingIssuer{}, Config{OryPublicURL: ory.URL})
		if _, _, _, err := resolver.ResolveMCP(context.Background(), owner.ID.String(), "canvas"); err == nil {
			t.Fatal("refresh-family reuse unexpectedly succeeded")
		}
		current := client.MCPConnection.GetX(auth.WithInternal(context.Background()), connection.ID)
		if current.Status != "invalidated" || current.CredentialGeneration != connection.CredentialGeneration+1 || len(current.RefreshTokenEncrypted) != 0 {
			t.Fatalf("family invalidation = %+v", current)
		}
		events := auditTypes(t, client, owner)
		for _, want := range []string{"connection_invalidated", "token.reuse_detected", "token.revoked"} {
			if !containsAudit(events, want) {
				t.Fatalf("missing audit %q in %v", want, events)
			}
		}
	})
}

func TestWorkerRuntimeCachedRefreshReloadFailureDoesNotRevokeFamily(t *testing.T) {
	var revokeHits atomic.Int64
	ory := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/revoke" {
			revokeHits.Add(1)
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(ory.Close)
	client, owner, sealer := runtimeTestDB(t)
	registry := runtimeRegistry(t, runtimeOAuthRegistry, "")
	sealed, _ := sealer.SealString("cached-old-refresh")
	connection := client.MCPConnection.Create().SetUser(owner).SetConnector("canvas").SetAudience("canvas-api").
		SetOrganizationID("org_1").SetScopes([]string{"canvas:invoices.read"}).SetRefreshTokenEncrypted(sealed).
		SaveX(auth.WithInternal(context.Background()))
	cache := workosauth.NewMemoryRefreshCache()
	resolver := NewMCPRuntimeResolver(client, sealer, registry, Config{OryPublicURL: ory.URL})
	resolver.SetResourceTokenIssuer(&countingIssuer{})
	resolver.SetRefreshDedup(cache, sealer, zap.NewNop())

	bound := newConnectorRefreshContext("canvas", connection.ID.String(), "org_1", connection.CredentialGeneration, "canvas-api", connection.Scopes)
	keyMaterial, err := json.Marshal(struct {
		Context      connectorRefreshContext `json:"context"`
		RefreshToken string                  `json:"refresh_token"`
	}{Context: bound, RefreshToken: "cached-old-refresh"})
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(keyMaterial)
	resultKey := "connectors:refresh:result:v2:" + hex.EncodeToString(sum[:])
	if err := resolver.refresh.store(context.Background(), resultKey, &connectorRefreshResult{
		Context: bound, CurrentCredentialGeneration: connection.CredentialGeneration + 1,
		Token: oryToken{AccessToken: "cached-access", RefreshToken: "cached-next-refresh", Scope: "canvas:invoices.read"},
	}); err != nil {
		t.Fatal(err)
	}

	if _, _, _, err := resolver.ResolveMCP(context.Background(), owner.ID.String(), "canvas"); err == nil || !strings.Contains(err.Error(), errConnectorCredentialSuperseded.Error()) {
		t.Fatalf("cached reload failure = %v", err)
	}
	if revokeHits.Load() != 0 {
		t.Fatalf("cached lifecycle-owned refresh family was revoked %d times", revokeHits.Load())
	}
}
