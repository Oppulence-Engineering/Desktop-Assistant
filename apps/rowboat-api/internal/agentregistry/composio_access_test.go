package agentregistry

import (
	"slices"
	"testing"
)

var composioTools = []string{
	"connector.read.composio_tool_search",
	"connector.read.composio_tool_describe",
	"connector.write.composio_tool_execute",
}

// A capability that no agent lists is unreachable however well it is built, so
// membership of the built-in allowlists is the thing that makes Composio usable.
// Every built-in carries it, the shared-channel Slack agent included.
func TestComposioToolsAreReachableFromTheBuiltInAgents(t *testing.T) {
	loader, err := NewLoader(nil, DefaultCatalog())
	if err != nil {
		t.Fatalf("NewLoader: %v", err)
	}
	bySlug := map[string]*Spec{}
	for _, builtin := range loader.Builtins() {
		bySlug[builtin.Slug] = builtin
	}
	for _, slug := range []string{"assistant", "concierge", "concierge-slack"} {
		agent, ok := bySlug[slug]
		if !ok {
			t.Fatalf("missing built-in agent %q", slug)
		}
		for _, tool := range composioTools {
			if !slices.Contains(agent.EnabledTools, tool) {
				t.Fatalf("%s cannot reach %q", slug, tool)
			}
		}
	}
}

func TestComposioCapabilitiesAreRegistered(t *testing.T) {
	catalog := DefaultCatalog()
	for _, tool := range composioTools {
		if _, ok := catalog.Get(tool); !ok {
			t.Fatalf("catalog is missing %q", tool)
		}
	}
}

// The long tail runs without an approval pause by deliberate product choice.
// Raising the execute tool back to the act tier would stop every call, so the
// tier is asserted rather than left to a future edit.
func TestComposioExecuteRunsWithoutAnApprovalPause(t *testing.T) {
	execute, ok := DefaultCatalog().Get("connector.write.composio_tool_execute")
	if !ok {
		t.Fatal("catalog is missing the Composio execute capability")
	}
	if execute.TrustTier != TierWrite {
		t.Fatalf("trust tier = %q, want %q", execute.TrustTier, TierWrite)
	}
	if RequiresApproval(execute.TrustTier) {
		t.Fatal("the Composio execute tool must not pause for approval")
	}
	for _, tool := range composioTools[:2] {
		capability, _ := DefaultCatalog().Get(tool)
		if RequiresApproval(capability.TrustTier) {
			t.Fatalf("%q is a read and must not pause for approval", tool)
		}
	}
}
