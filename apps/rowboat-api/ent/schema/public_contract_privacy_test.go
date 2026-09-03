package schema_test

import (
	"os"
	"strings"
	"testing"
)

func TestGeneratedPublicContractsExcludeConnectorCredentialCustody(t *testing.T) {
	for _, contract := range []string{"../../internal/gqlapi/ent.graphql", "../../api/openapi.json"} {
		raw, err := os.ReadFile(contract)
		if err != nil {
			t.Fatalf("read generated contract %s: %v", contract, err)
		}
		body := string(raw)
		for _, forbidden := range []string{
			"ConnectorRevocationJob", "ConnectorCredentialCleanupJob", "ConnectorCredentialRecovery",
			"refresh_token_encrypted", "api_key_encrypted",
		} {
			if strings.Contains(body, forbidden) {
				t.Fatalf("public contract %s exposes internal credential custody token %q", contract, forbidden)
			}
		}
	}
}
