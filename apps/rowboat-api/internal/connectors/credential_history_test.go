package connectors_test

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/connectors"
	rowboatcrypto "github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
)

func assertCredentialMaterialAbsent(t *testing.T, client *ent.Client, forbidden ...[]byte) {
	t.Helper()
	ctx := auth.WithInternal(t.Context())
	sealer, err := rowboatcrypto.NewSealer("test-key")
	if err != nil {
		t.Fatalf("create test sealer: %v", err)
	}
	forbiddenPlaintext := make([][]byte, 0, len(forbidden))
	for _, secret := range forbidden {
		if plain, openErr := sealer.Open(secret); openErr == nil && len(plain) > 0 {
			forbiddenPlaintext = append(forbiddenPlaintext, plain)
		}
	}

	check := func(store string, values ...[]byte) {
		t.Helper()
		for _, value := range values {
			for _, secret := range forbidden {
				if len(secret) > 0 && bytes.Equal(value, secret) {
					t.Fatalf("%s retained forbidden credential bytes", store)
				}
			}
			plain, openErr := sealer.Open(value)
			if openErr != nil {
				plain = value
			}
			for _, secret := range forbiddenPlaintext {
				if bytes.Contains(plain, secret) {
					t.Fatalf("%s retained forbidden credential plaintext", store)
				}
			}
		}
	}

	for _, row := range client.MCPConnection.Query().AllX(ctx) {
		check("mcp_connections", row.RefreshTokenEncrypted, row.APIKeyEncrypted)
	}
	for _, row := range client.OAuthConnection.Query().AllX(ctx) {
		check("oauth_connections", row.RefreshTokenEncrypted)
	}
	pending := client.OAuthPending.Query().AllX(ctx)
	for _, row := range pending {
		check("oauth_pendings", row.PayloadEncrypted)
	}
	cleanup := client.ConnectorCredentialCleanupJob.Query().AllX(ctx)
	for _, row := range cleanup {
		check("connector_credential_cleanup_jobs", row.RefreshTokenEncrypted)
	}
	revocations := client.ConnectorRevocationJob.Query().AllX(ctx)
	for _, row := range revocations {
		check("connector_revocation_jobs", row.RefreshTokenEncrypted)
	}

	historyJSON, err := json.Marshal(struct {
		MCP   any `json:"mcp"`
		OAuth any `json:"oauth"`
	}{
		MCP:   client.MCPConnectionHistory.Query().AllX(ctx),
		OAuth: client.OAuthConnectionHistory.Query().AllX(ctx),
	})
	if err != nil {
		t.Fatalf("marshal connection history: %v", err)
	}
	serialized := string(historyJSON)
	if strings.Contains(serialized, "refresh_token_encrypted") || strings.Contains(serialized, "api_key_encrypted") {
		t.Fatalf("history serialized a credential field: %s", serialized)
	}
	for _, secret := range forbidden {
		if len(secret) > 0 && strings.Contains(serialized, base64.StdEncoding.EncodeToString(secret)) {
			t.Fatal("history serialized forbidden credential bytes")
		}
	}
}

func TestConnectionHistoryStoresCredentialMetadataOnly(t *testing.T) {
	client, user, _ := setup(t, connectors.DefaultRegistry())
	userCtx := auth.WithUser(t.Context(), user)
	internalCtx := auth.WithInternal(t.Context())

	mcpSecret := []byte("sealed-mcp-history-secret")
	mcp := client.MCPConnection.Create().
		SetUser(user).
		SetConnector("canvas").
		SetAudience("mcp:canvas").
		SetOrganizationID("org_1").
		SetRefreshTokenEncrypted(mcpSecret).
		SaveX(userCtx)
	if !mcp.RefreshTokenPresent || mcp.APIKeyPresent {
		t.Fatalf("MCP credential flags = refresh %v api-key %v", mcp.RefreshTokenPresent, mcp.APIKeyPresent)
	}
	mcp = mcp.Update().ClearRefreshTokenEncrypted().AddCredentialGeneration(1).SaveX(userCtx)
	if mcp.RefreshTokenPresent || mcp.CredentialGeneration != 2 {
		t.Fatalf("cleared MCP metadata = present %v generation %d", mcp.RefreshTokenPresent, mcp.CredentialGeneration)
	}
	mcpHistory := client.MCPConnectionHistory.Query().AllX(internalCtx)
	if len(mcpHistory) != 2 {
		t.Fatalf("MCP history metadata = %+v", mcpHistory)
	}
	var sawMCPPresentGeneration1, sawMCPAbsentGeneration2 bool
	for _, row := range mcpHistory {
		sawMCPPresentGeneration1 = sawMCPPresentGeneration1 || row.RefreshTokenPresent && row.CredentialGeneration == 1
		sawMCPAbsentGeneration2 = sawMCPAbsentGeneration2 || !row.RefreshTokenPresent && row.CredentialGeneration == 2
	}
	if !sawMCPPresentGeneration1 || !sawMCPAbsentGeneration2 {
		t.Fatalf("MCP history metadata = %+v", mcpHistory)
	}

	oauthSecret := []byte("sealed-oauth-history-secret")
	oauth := client.OAuthConnection.Create().
		SetUser(user).
		SetProvider("google").
		SetExternalAccountID("history@example.com").
		SetRefreshTokenEncrypted(oauthSecret).
		SaveX(userCtx)
	if !oauth.RefreshTokenPresent || oauth.CredentialGeneration != 1 {
		t.Fatalf("OAuth credential metadata = present %v generation %d", oauth.RefreshTokenPresent, oauth.CredentialGeneration)
	}
	oauth = oauth.Update().SetRefreshTokenEncrypted([]byte("sealed-oauth-history-replacement")).SaveX(userCtx)
	if !oauth.RefreshTokenPresent || oauth.CredentialGeneration != 2 {
		t.Fatalf("OAuth replacement metadata = present %v generation %d", oauth.RefreshTokenPresent, oauth.CredentialGeneration)
	}
	oauthHistory := client.OAuthConnectionHistory.Query().AllX(internalCtx)
	if len(oauthHistory) != 2 {
		t.Fatalf("OAuth history metadata = %+v", oauthHistory)
	}
	var sawOAuthGeneration1, sawOAuthGeneration2 bool
	for _, row := range oauthHistory {
		sawOAuthGeneration1 = sawOAuthGeneration1 || row.RefreshTokenPresent && row.CredentialGeneration == 1
		sawOAuthGeneration2 = sawOAuthGeneration2 || row.RefreshTokenPresent && row.CredentialGeneration == 2
	}
	if !sawOAuthGeneration1 || !sawOAuthGeneration2 {
		t.Fatalf("OAuth history metadata = %+v", oauthHistory)
	}

	assertCredentialMaterialAbsent(t, client, mcpSecret, oauthSecret)
}

func TestReconnectDoesNotRetainPriorCredential(t *testing.T) {
	client, user, _ := setup(t, connectors.DefaultRegistry())
	userCtx := auth.WithUser(t.Context(), user)
	sealer, err := rowboatcrypto.NewSealer("test-key")
	if err != nil {
		t.Fatal(err)
	}
	prior, err := sealer.SealString("refresh-before-reconnect")
	if err != nil {
		t.Fatal(err)
	}
	replacement, err := sealer.SealString("refresh-after-reconnect")
	if err != nil {
		t.Fatal(err)
	}

	connection := client.MCPConnection.Create().
		SetUser(user).
		SetConnector("canvas").
		SetAudience("mcp:canvas").
		SetOrganizationID("org_1").
		SetRefreshTokenEncrypted(prior).
		SaveX(userCtx)
	connection.Update().
		SetRefreshTokenEncrypted(replacement).
		AddCredentialGeneration(1).
		SaveX(userCtx)

	assertCredentialMaterialAbsent(t, client, prior)
}
