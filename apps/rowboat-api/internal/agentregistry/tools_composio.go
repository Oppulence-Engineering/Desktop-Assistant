package agentregistry

import (
	"encoding/json"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
)

// Composio runs in every channel, including shared Slack sessions: these
// capabilities are deliberately not wrapped in the owner-scope channel guard
// the other connector tools use.

// ComposioToolSearchCapability finds actions in the user's connected products.
func ComposioToolSearchCapability() Capability {
	return Capability{
		Name:        "connector.read.composio_tool_search",
		Description: "Find actions available in the user's Composio-connected products, such as Jira or Asana. Returns tool slugs with a short description. This is an action catalog, not relationship evidence, so nothing it returns may be cited as proof.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"query":{"type":"string","description":"free-text search, such as \"create issue\""},"toolkit":{"type":"string","description":"optional product slug, such as \"jira\""},"limit":{"type":"integer","description":"max tools (1-25)"}}}`),
		TrustTier:   TierRead,
		Kind:        KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			if d.Composio == nil || !d.Composio.Configured() {
				return newUnavailableTool("connector.read.composio_tool_search", "the Composio tool search is not configured on this server")
			}
			return backgroundtaskruntime.NewComposioToolSearchTool(d.Composio)
		},
	}
}

// ComposioToolDescribeCapability reads one tool's input schema.
func ComposioToolDescribeCapability() Capability {
	return Capability{
		Name:        "connector.read.composio_tool_describe",
		Description: "Read the input schema of one Composio tool so its arguments can be filled correctly before execution.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"slug":{"type":"string","description":"tool slug from composio_tool_search"}},"required":["slug"]}`),
		TrustTier:   TierRead,
		Kind:        KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			if d.Composio == nil || !d.Composio.Configured() {
				return newUnavailableTool("connector.read.composio_tool_describe", "the Composio tool schema read is not configured on this server")
			}
			return backgroundtaskruntime.NewComposioToolDescribeTool(d.Composio)
		},
	}
}

// ComposioToolExecuteCapability runs one long-tail action. It is the only
// Composio seam with a side effect, and it auto-executes: the audit record, not
// an approval pause, is what makes the action reviewable.
func ComposioToolExecuteCapability() Capability {
	return Capability{
		Name:        "connector.write.composio_tool_execute",
		Description: "Run one Composio tool in a connected product, such as creating a Jira issue. Call composio_tool_describe first so the arguments match the tool's schema.",
		Parameters:  json.RawMessage(`{"type":"object","properties":{"slug":{"type":"string","description":"tool slug from composio_tool_search"},"arguments":{"type":"object","description":"arguments matching the schema from composio_tool_describe"}},"required":["slug"]}`),
		TrustTier:   TierWrite,
		Kind:        KindTool,
		Build: func(d ToolDeps) backgroundtaskruntime.Tool {
			uid, err := uuid.Parse(d.UserID)
			if err != nil || d.Composio == nil || !d.Composio.Configured() {
				return newUnavailableTool("connector.write.composio_tool_execute", "the Composio action tool is not configured on this server")
			}
			return backgroundtaskruntime.NewComposioToolExecuteTool(d.Composio, uid)
		},
	}
}
