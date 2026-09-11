package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/composioapi"
)

// Composio covers the governed long tail: products Oppulence does not model as
// relationship sensors. Discovery is two reads, and every side effect goes
// through one act-tier tool the runtime gates behind human approval.

// NewComposioToolSearchTool builds connector.read.composio_tool_search. The
// catalog is global, so this read carries no user scope.
func NewComposioToolSearchTool(client *composioapi.Client) Tool {
	return &composioToolSearchTool{client: client}
}

type composioToolSearchTool struct {
	client *composioapi.Client
}

func (t *composioToolSearchTool) Name() string { return "connector.read.composio_tool_search" }
func (t *composioToolSearchTool) AuditInfo(args json.RawMessage) ToolAudit {
	var in struct {
		Toolkit string `json:"toolkit"`
	}
	_ = json.Unmarshal(args, &in)
	operation := "composio.tools.search"
	if toolkit := strings.TrimSpace(in.Toolkit); toolkit != "" {
		operation += "." + strings.ToLower(toolkit)
	}
	return ToolAudit{TrustTier: TierRead, Connector: "composio", Operation: operation}
}
func (t *composioToolSearchTool) Description() string {
	return "Find actions available in the user's Composio-connected products, such as Jira or Asana. Returns tool slugs with a short description. Use this before composio_tool_execute. This is an action catalog, not a source of relationship evidence, so nothing it returns may be cited as proof."
}
func (t *composioToolSearchTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"query":{"type":"string","description":"Free-text search, such as \"create issue\"."},"toolkit":{"type":"string","description":"Optional product slug to narrow the search, such as \"jira\"."},"limit":{"type":"integer","description":"Max tools (1-25)."}}}`)
}
func (t *composioToolSearchTool) Invoke(ctx context.Context, _ ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		Query   string `json:"query"`
		Toolkit string `json:"toolkit"`
		Limit   int    `json:"limit"`
	}
	if len(args) > 0 {
		if err := json.Unmarshal(args, &in); err != nil {
			return nil, fmt.Errorf("invalid Composio search arguments: %w", err)
		}
	}
	if t.client == nil {
		return nil, &RuntimeError{Code: CodeConnectorUnavailable, Message: "Composio is not configured on this server"}
	}
	tools, err := t.client.SearchTools(ctx, in.Query, in.Toolkit, in.Limit)
	if err != nil {
		return nil, classifyComposioToolError("search tools", err)
	}
	return json.Marshal(map[string]any{"tools": tools})
}

// NewComposioToolDescribeTool builds connector.read.composio_tool_describe.
func NewComposioToolDescribeTool(client *composioapi.Client) Tool {
	return &composioToolDescribeTool{client: client}
}

type composioToolDescribeTool struct {
	client *composioapi.Client
}

func (t *composioToolDescribeTool) Name() string { return "connector.read.composio_tool_describe" }
func (t *composioToolDescribeTool) AuditInfo(_ json.RawMessage) ToolAudit {
	return ToolAudit{TrustTier: TierRead, Connector: "composio", Operation: "composio.tools.describe"}
}
func (t *composioToolDescribeTool) Description() string {
	return "Read the input schema of one Composio tool so its arguments can be filled correctly before execution."
}
func (t *composioToolDescribeTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"slug":{"type":"string","description":"Tool slug from composio_tool_search."}},"required":["slug"]}`)
}
func (t *composioToolDescribeTool) Invoke(ctx context.Context, _ ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		Slug string `json:"slug"`
	}
	if err := json.Unmarshal(args, &in); err != nil {
		return nil, fmt.Errorf("invalid Composio describe arguments: %w", err)
	}
	if t.client == nil {
		return nil, &RuntimeError{Code: CodeConnectorUnavailable, Message: "Composio is not configured on this server"}
	}
	detail, err := t.client.DescribeTool(ctx, in.Slug)
	if err != nil {
		return nil, classifyComposioToolError("describe tool", err)
	}
	return json.Marshal(detail)
}

// NewComposioToolExecuteTool builds connector.write.composio_tool_execute. It
// is the single seam through which every long-tail side effect leaves the
// product, and it runs without an approval pause by deliberate product choice.
func NewComposioToolExecuteTool(client *composioapi.Client, userID uuid.UUID) Tool {
	return &composioToolExecuteTool{client: client, userID: userID}
}

type composioToolExecuteTool struct {
	client *composioapi.Client
	userID uuid.UUID
}

func (t *composioToolExecuteTool) Name() string { return "connector.write.composio_tool_execute" }
func (t *composioToolExecuteTool) AuditInfo(args json.RawMessage) ToolAudit {
	var in struct {
		Slug string `json:"slug"`
	}
	_ = json.Unmarshal(args, &in)
	// The slug is the whole identity of the side effect, so the audit trail
	// names the action that ran rather than a generic "composio call".
	operation := "composio.tools.execute"
	if slug := strings.TrimSpace(in.Slug); slug != "" {
		operation += "." + strings.ToLower(slug)
	}
	// Write, not act: the long tail runs without stopping for approval. The
	// audit record is what makes an action reviewable after the fact, so the
	// slug above is the only trace of what was done.
	return ToolAudit{TrustTier: TierWrite, Connector: "composio", Operation: operation}
}
func (t *composioToolExecuteTool) Description() string {
	return "Run one Composio tool in a connected product, such as creating a Jira issue. Call composio_tool_describe first so the arguments match the tool's schema."
}
func (t *composioToolExecuteTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"slug":{"type":"string","description":"Tool slug from composio_tool_search."},"arguments":{"type":"object","description":"Arguments matching the schema from composio_tool_describe."}},"required":["slug"]}`)
}
func (t *composioToolExecuteTool) Invoke(ctx context.Context, _ ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		Slug      string          `json:"slug"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(args, &in); err != nil {
		return nil, fmt.Errorf("invalid Composio execute arguments: %w", err)
	}
	if t.client == nil {
		return nil, &RuntimeError{Code: CodeConnectorUnavailable, Message: "Composio is not configured on this server"}
	}
	result, err := t.client.ExecuteTool(ctx, t.userID, in.Slug, in.Arguments)
	if err != nil {
		return nil, classifyComposioToolError("execute tool", err)
	}
	// Composio reports a refused action in the body with a 200, so a failure
	// here has to be raised rather than returned as a successful tool result.
	if !result.Successful {
		message := strings.TrimSpace(result.Error)
		if message == "" {
			message = "Composio reported the action did not succeed"
		}
		return nil, fmt.Errorf("composio execute %s: %s", in.Slug, message)
	}
	return json.Marshal(map[string]any{"slug": in.Slug, "status": "executed", "data": result.Data})
}

func classifyComposioToolError(operation string, err error) error {
	if errors.Is(err, composioapi.ErrNotConfigured) {
		return &RuntimeError{Code: CodeConnectorUnavailable, Message: "Composio is not configured on this server", Cause: err}
	}
	if errors.Is(err, composioapi.ErrNoConnection) {
		return &RuntimeError{
			Code:    CodeConnectorUnavailable,
			Message: "that product is not connected yet; link it under Settings, Connected Accounts, More products",
			Cause:   err,
		}
	}
	if errors.Is(err, composioapi.ErrUnauthorized) {
		return &RuntimeError{Code: CodeConnectorUnavailable, Message: "Composio rejected this deployment's project key", Cause: err}
	}
	return fmt.Errorf("composio %s: %w", operation, err)
}

var _ Tool = (*composioToolSearchTool)(nil)
var _ Tool = (*composioToolDescribeTool)(nil)
var _ Tool = (*composioToolExecuteTool)(nil)
