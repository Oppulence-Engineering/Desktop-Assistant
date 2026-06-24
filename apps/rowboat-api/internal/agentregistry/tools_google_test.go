package agentregistry

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
)

func TestGoogleToolsRegistered(t *testing.T) {
	cat := DefaultCatalog()
	for _, name := range []string{"connector.read.gmail", "connector.read.calendar"} {
		c, ok := cat.Get(name)
		if !ok {
			t.Fatalf("capability %q not registered in DefaultCatalog", name)
		}
		// Read-only connector reads auto-execute (no approval).
		if c.TrustTier != TierRead {
			t.Fatalf("%q tier = %q, want read", name, c.TrustTier)
		}
		if RequiresApproval(c.TrustTier) {
			t.Fatalf("%q must not require approval", name)
		}
	}
}

func TestGmailDraftCapabilityIsApprovalTier(t *testing.T) {
	c, ok := DefaultCatalog().Get("connector.write.gmail_draft")
	if !ok {
		t.Fatal("connector.write.gmail_draft not registered")
	}
	// Drafting is an outward-facing act → approval-eligible.
	if c.TrustTier != TierAct || !RequiresApproval(c.TrustTier) {
		t.Fatalf("gmail_draft tier = %q, want act (approval-eligible)", c.TrustTier)
	}
}

func TestGoogleToolUnavailableWhenUnconfigured(t *testing.T) {
	for _, name := range []string{"connector.read.gmail", "connector.read.calendar", "connector.write.gmail_draft"} {
		cap, _ := DefaultCatalog().Get(name)
		// No Google deps and no user id → graceful "unavailable", never a panic.
		tool := cap.Build(ToolDeps{})
		if tool.Name() != name {
			t.Fatalf("unavailable tool name = %q, want %q", tool.Name(), name)
		}
		out, err := tool.Invoke(context.Background(), backgroundtaskruntime.ToolScope{}, json.RawMessage(`{"query":"x"}`))
		if err != nil {
			t.Fatalf("invoke: %v", err)
		}
		if !strings.Contains(string(out), "not configured") {
			t.Fatalf("expected unavailable observation, got %s", out)
		}
	}
}
