package connectors

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/connectorrevocationjob"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mcpconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
)

// revocationProvider stands in for the OAuth provider's revocation endpoint.
func revocationProvider(t *testing.T, status int) (*httptest.Server, *atomic.Int64) {
	t.Helper()
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(status)
	}))
	t.Cleanup(server.Close)
	return server, &calls
}

func revokeTestHandler(client *ent.Client, sealer *crypto.Sealer, providerURL string) *Handler {
	return New(client, sealer, DefaultRegistry(), Config{OryPublicURL: providerURL, OryBrokerClientID: "broker", OryBrokerClientSecret: "secret"}, zap.NewNop())
}

func revokeTestUser(t *testing.T, client *ent.Client, name string) *ent.User {
	t.Helper()
	return client.User.Create().SetEmail(name + "@example.invalid").SetWorkosUserID("user_" + name).SetWorkosOrgID("org_" + name).SaveX(auth.WithInternal(t.Context()))
}

func revokeTestConnection(t *testing.T, client *ent.Client, sealer *crypto.Sealer, owner *ent.User, name, status string, scopes []string) *ent.MCPConnection {
	t.Helper()
	connector, ok := DefaultRegistry().Get(name)
	if !ok {
		t.Fatalf("%s connector missing from the default registry", name)
	}
	sealed, err := sealer.SealString("refresh-" + name + "-" + owner.WorkosUserID)
	if err != nil {
		t.Fatal(err)
	}
	return client.MCPConnection.Create().SetUser(owner).SetConnector(connector.Name).SetAudience(connector.Audience).
		SetOrganizationID(connectorOrganizationID(owner)).SetScopes(scopes).SetRefreshTokenEncrypted(sealed).
		SetStatus(status).SetConnectedAt(time.Now()).SaveX(auth.WithUser(t.Context(), owner))
}

func TestRevokeAllForUserWithoutConnectionsRevokesNothing(t *testing.T) {
	database, sealer := openReconnectTestDatabase(t)
	provider, calls := revocationProvider(t, http.StatusOK)
	h := revokeTestHandler(database.Client, sealer, provider.URL)
	owner := revokeTestUser(t, database.Client, "empty")

	n, err := h.RevokeAllForUser(t.Context(), owner)
	if err != nil || n != 0 {
		t.Fatalf("RevokeAllForUser = %d, %v; want 0, nil", n, err)
	}
	if calls.Load() != 0 {
		t.Fatalf("provider revocations = %d, want 0", calls.Load())
	}
}

func TestRevokeAllForUserRevokesEveryLiveConnectionAtTheProvider(t *testing.T) {
	database, sealer := openReconnectTestDatabase(t)
	client := database.Client
	provider, calls := revocationProvider(t, http.StatusOK)
	h := revokeTestHandler(client, sealer, provider.URL)
	owner := revokeTestUser(t, client, "leaving")
	first := revokeTestConnection(t, client, sealer, owner, "canvas", "active", []string{"canvas:invoices.read"})
	second := revokeTestConnection(t, client, sealer, owner, "hubspot", "active", []string{})

	n, err := h.RevokeAllForUser(t.Context(), owner)
	if err != nil || n != 2 {
		t.Fatalf("RevokeAllForUser = %d, %v; want 2, nil", n, err)
	}
	if calls.Load() != 2 {
		t.Fatalf("provider revocations = %d, want 2", calls.Load())
	}
	ctx := auth.WithUser(t.Context(), owner)
	for _, connection := range []*ent.MCPConnection{first, second} {
		got := client.MCPConnection.GetX(ctx, connection.ID)
		if got.Status != "revoked" || got.RevokedReason != "account_deleted" || got.RevokedBy != "user" {
			t.Errorf("%s: status %q reason %q by %q", got.Connector, got.Status, got.RevokedReason, got.RevokedBy)
		}
		if len(got.RefreshTokenEncrypted) != 0 {
			t.Errorf("%s: the refresh token is still stored on the connection", got.Connector)
		}
		if !got.RevocationSucceeded {
			t.Errorf("%s: RevocationSucceeded = false after a successful provider revoke", got.Connector)
		}
	}
}

func TestRevokeAllForUserSkipsConnectionsThatAreAlreadyClosed(t *testing.T) {
	database, sealer := openReconnectTestDatabase(t)
	client := database.Client
	provider, calls := revocationProvider(t, http.StatusOK)
	h := revokeTestHandler(client, sealer, provider.URL)
	owner := revokeTestUser(t, client, "closed")
	live := revokeTestConnection(t, client, sealer, owner, "canvas", "active", []string{"canvas:invoices.read"})
	revoked := revokeTestConnection(t, client, sealer, owner, "hubspot", "revoked", []string{})
	invalidated := revokeTestConnection(t, client, sealer, owner, "github", "invalidated", []string{})

	n, err := h.RevokeAllForUser(t.Context(), owner)
	if err != nil || n != 1 {
		t.Fatalf("RevokeAllForUser = %d, %v; want 1, nil", n, err)
	}
	if calls.Load() != 1 {
		t.Fatalf("provider revocations = %d, want 1", calls.Load())
	}
	ctx := auth.WithUser(t.Context(), owner)
	if got := client.MCPConnection.GetX(ctx, live.ID); got.Status != "revoked" {
		t.Errorf("live connection status = %q, want revoked", got.Status)
	}
	for _, closed := range []*ent.MCPConnection{revoked, invalidated} {
		got := client.MCPConnection.GetX(ctx, closed.ID)
		if got.Status != closed.Status || got.RevokedReason == "account_deleted" {
			t.Errorf("%s: an already closed connection was touched (status %q, reason %q)", got.Connector, got.Status, got.RevokedReason)
		}
	}
}

func TestRevokeAllForUserLeavesOtherUsersConnectionsAlone(t *testing.T) {
	database, sealer := openReconnectTestDatabase(t)
	client := database.Client
	provider, _ := revocationProvider(t, http.StatusOK)
	h := revokeTestHandler(client, sealer, provider.URL)
	owner := revokeTestUser(t, client, "owner")
	other := revokeTestUser(t, client, "other")
	revokeTestConnection(t, client, sealer, owner, "canvas", "active", []string{"canvas:invoices.read"})
	theirs := revokeTestConnection(t, client, sealer, other, "canvas", "active", []string{"canvas:invoices.read"})

	if _, err := h.RevokeAllForUser(t.Context(), owner); err != nil {
		t.Fatal(err)
	}
	got := client.MCPConnection.GetX(auth.WithUser(t.Context(), other), theirs.ID)
	if got.Status != "active" || len(got.RefreshTokenEncrypted) == 0 {
		t.Fatalf("another user's connection = status %q, token kept %v", got.Status, len(got.RefreshTokenEncrypted) > 0)
	}
}

func TestRevokeAllForUserKeepsADurableJobWhenTheProviderIsDown(t *testing.T) {
	database, sealer := openReconnectTestDatabase(t)
	client := database.Client
	provider, _ := revocationProvider(t, http.StatusServiceUnavailable)
	h := revokeTestHandler(client, sealer, provider.URL)
	owner := revokeTestUser(t, client, "outage")
	connection := revokeTestConnection(t, client, sealer, owner, "canvas", "active", []string{"canvas:invoices.read"})

	n, err := h.RevokeAllForUser(t.Context(), owner)
	if err != nil || n != 1 {
		t.Fatalf("RevokeAllForUser = %d, %v; want 1, nil (the outage must not block account deletion)", n, err)
	}
	if got := client.MCPConnection.GetX(auth.WithUser(t.Context(), owner), connection.ID); got.Status != "revoked" {
		t.Fatalf("connection status = %q, want revoked locally", got.Status)
	}
	job := client.ConnectorRevocationJob.Query().Where(connectorrevocationjob.ConnectionIDEQ(connection.ID)).OnlyX(auth.WithInternal(t.Context()))
	if job.Status != "pending" || job.OwnerID != owner.ID || len(job.RefreshTokenEncrypted) == 0 {
		t.Fatalf("revocation job = status %q owner %s token kept %v; want a pending job that can retry", job.Status, job.OwnerID, len(job.RefreshTokenEncrypted) > 0)
	}
}

func TestRevocationJobForADeletedAccountRetriesWhenTheProviderFails(t *testing.T) {
	database, sealer := openReconnectTestDatabase(t)
	client := database.Client
	provider, calls := revocationProvider(t, http.StatusInternalServerError)
	h := revokeTestHandler(client, sealer, provider.URL)
	sealed, err := sealer.SealString("refresh-of-deleted-account")
	if err != nil {
		t.Fatal(err)
	}
	internal := auth.WithInternal(t.Context())
	job := client.ConnectorRevocationJob.Create().
		SetConnectionID(uuid.New()).SetOwnerID(uuid.New()).SetConnector("canvas").
		SetRefreshTokenEncrypted(sealed).SetCredentialGeneration(2).
		SetTerminalStatus("revoked").SetTerminalReason("account_deleted").SetTerminalActor("user").
		SetStatus("pending").SetNextAttemptAt(time.Now().Add(-time.Minute)).SaveX(internal)

	completed, err := h.ProcessRevocationJobs(t.Context(), 10)
	if err != nil || completed != 0 {
		t.Fatalf("ProcessRevocationJobs = %d, %v; want 0, nil", completed, err)
	}
	if calls.Load() != 1 {
		t.Fatalf("provider revocations = %d, want 1", calls.Load())
	}
	got := client.ConnectorRevocationJob.Query().Where(connectorrevocationjob.IDEQ(job.ID)).OnlyX(internal)
	if got.Status != "pending" || got.Attempts != 1 || got.LastError != "provider_revoke_failed" || len(got.RefreshTokenEncrypted) == 0 {
		t.Fatalf("job = status %q attempts %d error %q token kept %v; want a pending retry", got.Status, got.Attempts, got.LastError, len(got.RefreshTokenEncrypted) > 0)
	}
	if !got.NextAttemptAt.After(time.Now()) {
		t.Error("the retry is not scheduled in the future")
	}
}

func TestRevocationJobForADeletedAccountWaitsWhenTheCredentialCannotBeOpened(t *testing.T) {
	database, sealer := openReconnectTestDatabase(t)
	client := database.Client
	provider, calls := revocationProvider(t, http.StatusOK)
	h := revokeTestHandler(client, sealer, provider.URL)
	internal := auth.WithInternal(t.Context())
	job := client.ConnectorRevocationJob.Create().
		SetConnectionID(uuid.New()).SetOwnerID(uuid.New()).SetConnector("canvas").
		SetRefreshTokenEncrypted([]byte("not-a-sealed-credential")).SetCredentialGeneration(2).
		SetTerminalStatus("revoked").SetTerminalReason("account_deleted").SetTerminalActor("user").
		SetStatus("pending").SetNextAttemptAt(time.Now().Add(-time.Minute)).SaveX(internal)

	if completed, err := h.ProcessRevocationJobs(t.Context(), 10); err != nil || completed != 0 {
		t.Fatalf("ProcessRevocationJobs = %d, %v; want 0, nil", completed, err)
	}
	if calls.Load() != 0 {
		t.Fatal("called the provider with an unreadable credential")
	}
	got := client.ConnectorRevocationJob.Query().Where(connectorrevocationjob.IDEQ(job.ID)).OnlyX(internal)
	if got.Status != "pending" || got.LastError != "credential_open_failed" {
		t.Fatalf("job = status %q error %q; want pending with credential_open_failed", got.Status, got.LastError)
	}
}

var _ = mcpconnection.StatusEQ
