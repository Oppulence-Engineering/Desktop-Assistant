package connectors_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/connectorauditevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mcpconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/connectors"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/google/uuid"
)

func TestHTTPRefreshFailurePersistsAfterRequestCancellation(t *testing.T) {
	for _, tc := range []struct {
		name       string
		response   string
		wantStatus string
		wantCode   string
		wantAudits []string
	}{
		{
			name:       "invalid_grant",
			response:   `{"error":"invalid_grant","error_description":"expired refresh token"}`,
			wantStatus: "reauth_required",
			wantCode:   `"code":"reauth_required"`,
			wantAudits: []string{"connection_reauth_required", "token.revoked"},
		},
		{
			name:       "refresh family reuse",
			response:   `{"error":"invalid_grant","error_description":"refresh token reuse detected; token family invalidated"}`,
			wantStatus: "invalidated",
			wantCode:   `"code":"connection_revoked"`,
			wantAudits: []string{"connection_invalidated", "token.reuse_detected", "token.revoked"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			providerStarted := make(chan struct{})
			releaseProvider := make(chan struct{})
			var once sync.Once
			ory := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/oauth2/token" {
					w.WriteHeader(http.StatusOK)
					return
				}
				once.Do(func() { close(providerStarted) })
				<-releaseProvider
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(tc.response))
			}))
			t.Cleanup(ory.Close)

			client, owner, h := setup(t, connectors.DefaultRegistry())
			h.SetOryBaseURL(ory.URL)
			connection := createOAuthConnection(t, client, owner, "request-cancel-refresh")

			requestCtx, cancelRequest := context.WithCancel(auth.WithUser(context.Background(), owner))
			recorder := httptest.NewRecorder()
			done := make(chan struct{})
			go func() {
				defer close(done)
				h.MCPToken(recorder, httptest.NewRequest(http.MethodPost, "/v1/connections/canvas/mcp-token", nil).
					WithContext(withParam(requestCtx, "name", "canvas")))
			}()
			waitSignal(t, providerStarted, "provider refresh")
			cancelRequest()
			close(releaseProvider)
			waitSignal(t, done, "canceled refresh completion")

			if recorder.Code != http.StatusBadGateway || !strings.Contains(recorder.Body.String(), tc.wantCode) {
				t.Fatalf("refresh response = %d %s", recorder.Code, recorder.Body.String())
			}
			current := client.MCPConnection.GetX(auth.WithInternal(context.Background()), connection.ID)
			if current.Status != tc.wantStatus || current.CredentialGeneration != connection.CredentialGeneration+1 || len(current.RefreshTokenEncrypted) != 0 {
				t.Fatalf("terminal row = status %q generation %d refresh-bytes %d", current.Status, current.CredentialGeneration, len(current.RefreshTokenEncrypted))
			}
			for _, eventType := range tc.wantAudits {
				if got := client.ConnectorAuditEvent.Query().Where(connectorauditevent.EventTypeEQ(eventType), connectorauditevent.ConnectionIDEQ(connection.ID)).CountX(auth.WithInternal(context.Background())); got != 1 {
					t.Fatalf("audit %q count = %d, want 1", eventType, got)
				}
			}
			if err := h.RefreshFailurePersistenceReady(context.Background()); err != nil {
				t.Fatalf("acknowledged terminal transition failed readiness: %v", err)
			}
		})
	}
}

func TestHTTPRefreshReuseAuditFailureFailsClosedForIssuedToken(t *testing.T) {
	ory := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/oauth2/token" {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_grant","error_description":"refresh token replayed; token family invalid"}`))
	}))
	t.Cleanup(ory.Close)

	registry := connectors.DefaultRegistry()
	client, owner, h := setup(t, registry)
	h.SetOryBaseURL(ory.URL)
	connection := createOAuthConnection(t, client, owner, "audit-failure-refresh")
	sealer, err := crypto.NewSealer("test-key")
	if err != nil {
		t.Fatal(err)
	}
	connector, ok := registry.Get("canvas")
	if !ok {
		t.Fatal("canvas connector missing")
	}
	lifecycle := connectors.NewLifecycleService(client, sealer, registry, nil)
	lifecycle.SetIssuer(newTestResourceTokenIssuer(t))
	minted, err := lifecycle.MintResourceToken(auth.WithInternal(context.Background()), owner, connector, connection, connection.Scopes)
	if err != nil {
		t.Fatalf("mint already-issued resource token: %v", err)
	}
	binding := resourceTokenStatusBinding(t, minted.Token)
	if active, code := connectionStatusDecision(t, h, binding); code != http.StatusOK || !active {
		t.Fatalf("issued token before reuse: code=%d active=%v", code, active)
	}

	client.Use(func(next ent.Mutator) ent.Mutator {
		return ent.MutateFunc(func(ctx context.Context, mutation ent.Mutation) (ent.Value, error) {
			if _, ok := mutation.(*ent.ConnectorAuditEventMutation); ok && mutation.Op().Is(ent.OpCreate) {
				return nil, errors.New("injected refresh invalidation audit failure")
			}
			return next.Mutate(ctx, mutation)
		})
	})

	recorder := httptest.NewRecorder()
	h.MCPToken(recorder, httptest.NewRequest(http.MethodPost, "/v1/connections/canvas/mcp-token", nil).
		WithContext(withParam(auth.WithUser(context.Background(), owner), "name", "canvas")))
	if recorder.Code != http.StatusServiceUnavailable || !strings.Contains(recorder.Body.String(), `"code":"lifecycle_unavailable"`) {
		t.Fatalf("audit failure response = %d %s", recorder.Code, recorder.Body.String())
	}
	current := client.MCPConnection.GetX(auth.WithInternal(context.Background()), connection.ID)
	if current.Status != "active" || current.CredentialGeneration != connection.CredentialGeneration {
		t.Fatalf("audit failure transaction did not roll back atomically: status=%q generation=%d", current.Status, current.CredentialGeneration)
	}
	for _, eventType := range []string{"connection_invalidated", "token.reuse_detected", "token.revoked"} {
		if got := client.ConnectorAuditEvent.Query().Where(connectorauditevent.EventTypeEQ(eventType), connectorauditevent.ConnectionIDEQ(connection.ID)).CountX(auth.WithInternal(context.Background())); got != 0 {
			t.Fatalf("audit failure left %d partial %q events", got, eventType)
		}
	}
	if err := h.RefreshFailurePersistenceReady(context.Background()); err == nil {
		t.Fatal("unacknowledged terminal transition did not fail readiness")
	}
	if active, code := connectionStatusDecision(t, h, binding); code != http.StatusOK || active {
		t.Fatalf("already-issued token remained live after reuse signal: code=%d active=%v", code, active)
	}
}

func TestHTTPRefreshFailureGenerationReplacementIsFenced(t *testing.T) {
	providerStarted := make(chan struct{})
	releaseProvider := make(chan struct{})
	var once sync.Once
	ory := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/oauth2/token" {
			w.WriteHeader(http.StatusOK)
			return
		}
		once.Do(func() { close(providerStarted) })
		<-releaseProvider
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_grant","error_description":"refresh token reuse detected for token family"}`))
	}))
	t.Cleanup(ory.Close)

	client, owner, h := setup(t, connectors.DefaultRegistry())
	h.SetOryBaseURL(ory.URL)
	connection := createOAuthConnection(t, client, owner, "generation-race-refresh")
	sealer, err := crypto.NewSealer("test-key")
	if err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		defer close(done)
		h.MCPToken(recorder, httptest.NewRequest(http.MethodPost, "/v1/connections/canvas/mcp-token", nil).
			WithContext(withParam(auth.WithUser(context.Background(), owner), "name", "canvas")))
	}()
	waitSignal(t, providerStarted, "provider refresh")
	newRefresh, err := sealer.SealString("replacement-refresh-token")
	if err != nil {
		t.Fatal(err)
	}
	client.MCPConnection.UpdateOneID(connection.ID).
		Where(mcpconnection.CredentialGenerationEQ(connection.CredentialGeneration), mcpconnection.StatusEQ("active")).
		SetRefreshTokenEncrypted(newRefresh).
		AddCredentialGeneration(1).
		ExecX(auth.WithUser(context.Background(), owner))
	close(releaseProvider)
	waitSignal(t, done, "generation-fenced refresh completion")

	current := client.MCPConnection.GetX(auth.WithInternal(context.Background()), connection.ID)
	plain, err := sealer.OpenString(current.RefreshTokenEncrypted)
	if err != nil {
		t.Fatal(err)
	}
	if current.Status != "active" || current.CredentialGeneration != connection.CredentialGeneration+1 || plain != "replacement-refresh-token" {
		t.Fatalf("replacement generation was poisoned: status=%q generation=%d refresh=%q", current.Status, current.CredentialGeneration, plain)
	}
	if got := client.ConnectorAuditEvent.Query().Where(connectorauditevent.EventTypeEQ("connection_invalidated"), connectorauditevent.ConnectionIDEQ(connection.ID)).CountX(auth.WithInternal(context.Background())); got != 0 {
		t.Fatalf("stale generation wrote %d invalidation audits", got)
	}
	if err := h.RefreshFailurePersistenceReady(context.Background()); err != nil {
		t.Fatalf("generation replacement incorrectly failed readiness: %v", err)
	}
}

func createOAuthConnection(t *testing.T, client *ent.Client, owner *ent.User, refresh string) *ent.MCPConnection {
	t.Helper()
	sealer, err := crypto.NewSealer("test-key")
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := sealer.SealString(refresh)
	if err != nil {
		t.Fatal(err)
	}
	return client.MCPConnection.Create().
		SetID(uuid.New()).
		SetUser(owner).
		SetConnector("canvas").
		SetAudience("mcp:canvas").
		SetOrganizationID("org_1").
		SetScopes([]string{"canvas:invoices.read", "canvas:customers.read"}).
		SetRefreshTokenEncrypted(sealed).
		SetStatus("active").
		SaveX(auth.WithUser(context.Background(), owner))
}

func connectionStatusDecision(t *testing.T, h *connectors.Handler, binding map[string]any) (bool, int) {
	t.Helper()
	body, err := json.Marshal(binding)
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	h.ConnectionStatus(recorder, httptest.NewRequest(http.MethodPost, "/v1/internal/connections/status", strings.NewReader(string(body))).
		WithContext(invalidationContext("canvas-api", []string{"canvas"}, nil)))
	var response struct {
		Active bool `json:"active"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode connection status: code=%d err=%v body=%s", recorder.Code, err, recorder.Body.String())
	}
	return response.Active, recorder.Code
}
