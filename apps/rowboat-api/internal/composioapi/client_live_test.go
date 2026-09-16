//go:build composiolive

package composioapi_test

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/composioapi"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

// TestExecuteToolReachesALiveConnectedAccount proves the full brokered path: the
// project key, the user scope, and one real product account. Unit tests mock the
// transport, so only this test can show that a tool call reaches the product.
//
// It calls a read-only tool and changes nothing. Run it with:
//
//	COMPOSIO_API_KEY=... COMPOSIO_LIVE_USER_ID=<uuid> COMPOSIO_LIVE_TOOL=GMAIL_GET_PROFILE \
//	  go test -tags composiolive ./internal/composioapi -run TestExecuteToolReachesALiveConnectedAccount -v
//
// Find a user id with an active connection in the Composio dashboard, or with
// GET /connected_accounts.
func TestExecuteToolReachesALiveConnectedAccount(t *testing.T) {
	key, rawUser := os.Getenv("COMPOSIO_API_KEY"), os.Getenv("COMPOSIO_LIVE_USER_ID")
	slug := os.Getenv("COMPOSIO_LIVE_TOOL")
	if key == "" || rawUser == "" || slug == "" {
		t.Skip("set COMPOSIO_API_KEY, COMPOSIO_LIVE_USER_ID, and COMPOSIO_LIVE_TOOL")
	}
	userID, err := uuid.Parse(rawUser)
	if err != nil {
		t.Fatalf("COMPOSIO_LIVE_USER_ID is not a uuid: %v", err)
	}
	ctx := context.Background()
	client := composioapi.New(key, outbound.Policy{})

	connections, err := client.ListConnections(ctx, userID)
	if err != nil {
		t.Fatalf("list connections: %v", err)
	}
	if len(connections) == 0 {
		t.Fatalf("user %s has no Composio connection to execute against", userID)
	}

	result, err := client.ExecuteTool(ctx, userID, slug, json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("execute %s: %v", slug, err)
	}
	// Composio reports a refused action in the body with a 200, so the flag is
	// the only proof the product ran the call.
	if !result.Successful {
		t.Fatalf("execute %s reported failure: %s", slug, result.Error)
	}
	if len(result.Data) == 0 {
		t.Fatalf("execute %s returned no data", slug)
	}
}
