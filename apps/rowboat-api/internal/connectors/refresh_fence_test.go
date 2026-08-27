package connectors_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/connectorauditevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mcpconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/connectors"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/workosauth"
	"go.uber.org/zap"
)

type gatedResultCache struct {
	connectors.RefreshCache
	missedResult sync.Once
	foundResult  sync.Once
	missed       chan struct{}
	found        chan struct{}
	release      <-chan struct{}
}

func (c *gatedResultCache) Get(ctx context.Context, key string) ([]byte, bool, error) {
	value, ok, err := c.RefreshCache.Get(ctx, key)
	if err != nil || !strings.Contains(key, "connectors:refresh:result:v2:") {
		return value, ok, err
	}
	if !ok {
		c.missedResult.Do(func() { close(c.missed) })
		return value, false, nil
	}
	c.foundResult.Do(func() { close(c.found) })
	select {
	case <-c.release:
		return value, true, nil
	case <-ctx.Done():
		return nil, false, ctx.Err()
	}
}

func waitSignal(t *testing.T, signal <-chan struct{}, name string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(5 * time.Second):
		t.Fatalf("timed out waiting for %s", name)
	}
}

func TestCachedRefreshResultIsFencedAcrossReplicas(t *testing.T) {
	for _, tc := range []struct {
		name             string
		reconnect        bool
		denyFinalEntitle bool
		wantStatus       int
	}{
		{name: "tombstone", wantStatus: http.StatusGone},
		{name: "reconnect_with_reduced_scopes", reconnect: true, wantStatus: http.StatusGone},
		{name: "authoritative_entitlement_rechecked_before_mint", denyFinalEntitle: true, wantStatus: http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var entitlementCalls atomic.Int64
			var entitlementServer *httptest.Server
			registry := connectors.DefaultRegistry()
			if tc.denyFinalEntitle {
				var registryErr error
				registry, registryErr = connectors.LoadRegistry([]byte(`[{
					"name":"canvas","displayName":"Canvas","description":"Canvas test connector",
					"mcpUrl":"https://canvas.test/mcp","authType":"oauth","audience":"mcp:canvas",
					"authoritativeEntitlementRequired":true,
					"scopes":[
						{"name":"canvas:invoices.read","displayName":"Read invoices","description":"Read invoices","grantTier":"required","risk":"low"},
						{"name":"canvas:customers.read","displayName":"Read customers","description":"Read customers","grantTier":"required","risk":"low"}
					],
					"mcpTools":[{"name":"invoice.lookup","trustTier":"read"}]
				}]`))
				if registryErr != nil {
					t.Fatalf("load entitlement test registry: %v", registryErr)
				}
				entitlementServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					if entitlementCalls.Add(1) >= 4 {
						_, _ = w.Write([]byte(`{"allowed":false,"reason":"user_banned"}`))
						return
					}
					_, _ = w.Write([]byte(`{"allowed":true,"reason":""}`))
				}))
				t.Cleanup(entitlementServer.Close)
				if err := registry.ConfigureProductEntitlements(
					map[string]string{"canvas": entitlementServer.URL},
					map[string]string{"canvas": "test-product-entitlement-key-32-bytes"},
				); err != nil {
					t.Fatalf("configure product entitlement: %v", err)
				}
			}

			refreshStarted := make(chan struct{})
			allowRefresh := make(chan struct{})
			var refreshStartedOnce sync.Once
			var refreshHits atomic.Int64
			ory := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/oauth2/revoke" {
					w.WriteHeader(http.StatusOK)
					return
				}
				if r.URL.Path != "/oauth2/token" {
					w.WriteHeader(http.StatusNotFound)
					return
				}
				_ = r.ParseForm()
				if r.Form.Get("grant_type") != "refresh_token" {
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				hit := refreshHits.Add(1)
				refreshStartedOnce.Do(func() { close(refreshStarted) })
				<-allowRefresh
				w.Header().Set("Content-Type", "application/json")
				_, _ = fmt.Fprintf(w, `{"access_token":"access-%d","refresh_token":"refresh-%d","expires_in":3600,"token_type":"Bearer","scope":"canvas:invoices.read canvas:customers.read"}`, hit, hit)
			}))
			t.Cleanup(ory.Close)

			client, user, replicaA := setup(t, registry)
			sealer, err := crypto.NewSealer("test-key")
			if err != nil {
				t.Fatal(err)
			}
			sharedCache := workosauth.NewMemoryRefreshCache()
			replicaA.SetRefreshDedup(sharedCache, sealer)
			replicaA.SetOryBaseURL(ory.URL)

			releaseCachedResult := make(chan struct{})
			replicaBCache := &gatedResultCache{
				RefreshCache: sharedCache,
				missed:       make(chan struct{}),
				found:        make(chan struct{}),
				release:      releaseCachedResult,
			}
			replicaB := connectors.New(client, sealer, registry, connectors.Config{
				OryPublicURL:          ory.URL,
				OryBrokerClientID:     "broker",
				OryBrokerClientSecret: "secret",
				PublicBaseURL:         "https://api.test",
				DeepLinkScheme:        "solomon-ai",
			}, zap.NewNop())
			replicaB.SetResourceTokenIssuer(newTestResourceTokenIssuer(t))
			replicaB.SetRefreshDedup(replicaBCache, sealer)

			ctx := auth.WithUser(context.Background(), user)
			sealedRefresh, err := sealer.SealString("refresh-initial")
			if err != nil {
				t.Fatal(err)
			}
			connection := client.MCPConnection.Create().
				SetUser(user).
				SetConnector("canvas").
				SetOrganizationID("org_1").
				SetAudience("mcp:canvas").
				SetScopes([]string{"canvas:invoices.read", "canvas:customers.read"}).
				SetRefreshTokenEncrypted(sealedRefresh).
				SetStatus("active").
				SaveX(ctx)

			callToken := func(handler *connectors.Handler) int {
				recorder := httptest.NewRecorder()
				request := httptest.NewRequest(
					http.MethodPost,
					"/v1/connections/canvas/mcp-token",
					strings.NewReader(`{"audience":"mcp:canvas","requestedScopes":["canvas:invoices.read","canvas:customers.read"]}`),
				).WithContext(withParam(auth.WithUser(context.Background(), user), "name", "canvas"))
				handler.MCPToken(recorder, request)
				return recorder.Code
			}

			replicaAResult := make(chan int, 1)
			go func() { replicaAResult <- callToken(replicaA) }()
			waitSignal(t, refreshStarted, "replica A provider refresh")

			replicaBResult := make(chan int, 1)
			go func() { replicaBResult <- callToken(replicaB) }()
			waitSignal(t, replicaBCache.missed, "replica B initial cache miss")
			close(allowRefresh)
			waitSignal(t, replicaBCache.found, "replica B cached refresh result")
			if code := <-replicaAResult; code != http.StatusOK {
				t.Fatalf("replica A mint status = %d, want 200", code)
			}

			if tc.denyFinalEntitle {
				if got := entitlementCalls.Load(); got != 3 {
					t.Fatalf("entitlement calls before cached result release = %d, want 3", got)
				}
			} else {
				deleteRecorder := httptest.NewRecorder()
				replicaA.Delete(deleteRecorder, httptest.NewRequest(http.MethodDelete, "/v1/connections/canvas", nil).
					WithContext(withParam(auth.WithUser(context.Background(), user), "name", "canvas")))
				if deleteRecorder.Code != http.StatusNoContent {
					t.Fatalf("disconnect status = %d, want 204", deleteRecorder.Code)
				}
				tombstone := client.MCPConnection.GetX(auth.WithInternal(context.Background()), connection.ID)
				if tombstone.Status != "revoked" || tombstone.CredentialGeneration != 3 {
					t.Fatalf("disconnect did not fence cached generation: status=%q generation=%d", tombstone.Status, tombstone.CredentialGeneration)
				}
				if tc.reconnect {
					reconnectedRefresh, sealErr := sealer.SealString("refresh-reconnected")
					if sealErr != nil {
						t.Fatal(sealErr)
					}
					reconnected, reconnectErr := tombstone.Update().
						Where(mcpconnection.CredentialGenerationEQ(tombstone.CredentialGeneration), mcpconnection.StatusEQ("revoked")).
						SetRefreshTokenEncrypted(reconnectedRefresh).
						AddCredentialGeneration(1).
						SetScopes([]string{"canvas:invoices.read"}).
						SetAudience("mcp:canvas").
						SetStatus("active").
						SetConnectedAt(time.Now().UTC()).
						ClearRevokedAt().
						ClearRevokedReason().
						ClearRevokedBy().
						ClearRevocationAttemptedAt().
						ClearRevocationSucceeded().
						Save(ctx)
					if reconnectErr != nil {
						t.Fatalf("reconnect reduced-scope row: %v", reconnectErr)
					}
					if reconnected.CredentialGeneration != 4 || len(reconnected.Scopes) != 1 {
						t.Fatalf("reconnected row generation/scopes = %d/%v", reconnected.CredentialGeneration, reconnected.Scopes)
					}
				}
			}

			close(releaseCachedResult)
			if code := <-replicaBResult; code != tc.wantStatus {
				t.Fatalf("replica B cached-result status = %d, want %d", code, tc.wantStatus)
			}
			if got := refreshHits.Load(); got != 1 {
				t.Fatalf("provider refresh hits = %d, want 1", got)
			}
			if got := client.ConnectorAuditEvent.Query().Where(connectorauditevent.EventTypeEQ("token.minted")).CountX(auth.WithInternal(context.Background())); got != 1 {
				t.Fatalf("token.minted audit count = %d, want only replica A mint", got)
			}
			if tc.denyFinalEntitle {
				if got := entitlementCalls.Load(); got != 4 {
					t.Fatalf("entitlement calls after cached result release = %d, want 4", got)
				}
				if current := client.MCPConnection.GetX(auth.WithInternal(context.Background()), connection.ID); current.Status != "invalidated" || current.CredentialGeneration != 3 {
					t.Fatalf("authoritative denial did not invalidate current generation: status=%q generation=%d", current.Status, current.CredentialGeneration)
				}
			}
			if tc.reconnect {
				if code := callToken(replicaA); code != http.StatusForbidden {
					t.Fatalf("broad mint after reduced-scope reconnect = %d, want 403", code)
				}
				if got := refreshHits.Load(); got != 1 {
					t.Fatalf("reduced-scope rejection reached provider, refresh hits = %d", got)
				}
			}
		})
	}
}
