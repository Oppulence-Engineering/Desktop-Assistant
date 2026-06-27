package backgroundtaskruntime

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

const mcpProtocolVersion = "2025-11-25"

// MCPConnectorResolver resolves a connected user's MCP endpoint and credential.
// Implementations must resolve credentials from userID server-side; model text
// only selects the connector name and tool arguments.
type MCPConnectorResolver interface {
	ResolveMCP(ctx context.Context, userID, connector string) (mcpURL, tokenType, accessToken string, err error)
}

// MCPConnectorClient is the narrow MCP surface exposed to cloud tasks.
type MCPConnectorClient interface {
	ListTools(ctx context.Context, mcpURL, tokenType, accessToken string) (json.RawMessage, error)
	CallTool(ctx context.Context, mcpURL, tokenType, accessToken, toolName string, args json.RawMessage) (json.RawMessage, error)
}

// MCPConnectorPolicy allowlists the upstream tools callable for one connector.
type MCPConnectorPolicy struct {
	Name  string
	Tools []MCPToolPolicy
}

// MCPToolPolicy is one upstream MCP tool allowlist entry.
type MCPToolPolicy struct {
	Name      string `json:"name"`
	TrustTier string `json:"trustTier"`
}

// MCPHTTPClient calls MCP streamable HTTP endpoints with per-call sessions.
type MCPHTTPClient struct {
	http *outbound.Client
}

// NewMCPHTTPClient builds a bounded MCP HTTP client.
func NewMCPHTTPClient(policy outbound.Policy) *MCPHTTPClient {
	policy.Name = "mcp-connectors"
	if policy.Timeout == 0 {
		policy.Timeout = 30 * time.Second
	}
	if policy.MaxResponseBytes == 0 {
		policy.MaxResponseBytes = 4 << 20
	}
	return &MCPHTTPClient{http: outbound.NewClient(policy)}
}

// ListTools returns the tools exposed by one MCP HTTP endpoint.
func (c *MCPHTTPClient) ListTools(ctx context.Context, mcpURL, tokenType, accessToken string) (json.RawMessage, error) {
	sessionID, err := c.initialize(ctx, mcpURL, tokenType, accessToken)
	if err != nil {
		return nil, err
	}
	req := mcpRPCRequest{JSONRPC: "2.0", ID: "tools-list", Method: "tools/list", Params: map[string]any{}}
	result, _, err := c.post(ctx, mcpURL, tokenType, accessToken, sessionID, req, "tools-list")
	return result, err
}

// CallTool invokes one MCP tool through the configured HTTP endpoint.
func (c *MCPHTTPClient) CallTool(ctx context.Context, mcpURL, tokenType, accessToken, toolName string, args json.RawMessage) (json.RawMessage, error) {
	sessionID, err := c.initialize(ctx, mcpURL, tokenType, accessToken)
	if err != nil {
		return nil, err
	}
	if len(args) == 0 || string(args) == "null" {
		args = json.RawMessage(`{}`)
	}
	req := mcpRPCRequest{
		JSONRPC: "2.0",
		ID:      "tools-call",
		Method:  "tools/call",
		Params: map[string]any{
			"name":      toolName,
			"arguments": args,
		},
	}
	result, _, err := c.post(ctx, mcpURL, tokenType, accessToken, sessionID, req, "tools-call")
	return result, err
}

func (c *MCPHTTPClient) initialize(ctx context.Context, mcpURL, tokenType, accessToken string) (string, error) {
	if c == nil || c.http == nil {
		return "", fmt.Errorf("mcp client not configured")
	}
	req := mcpRPCRequest{
		JSONRPC: "2.0",
		ID:      "initialize",
		Method:  "initialize",
		Params: map[string]any{
			"protocolVersion": mcpProtocolVersion,
			"capabilities":    map[string]any{},
			"clientInfo": map[string]string{
				"name":    "rowboat-cloud-task",
				"version": "0",
			},
		},
	}
	_, sessionID, err := c.post(ctx, mcpURL, tokenType, accessToken, "", req, "initialize")
	if err != nil {
		return "", err
	}
	notification := mcpRPCRequest{JSONRPC: "2.0", Method: "notifications/initialized"}
	if _, _, err := c.post(ctx, mcpURL, tokenType, accessToken, sessionID, notification, ""); err != nil {
		return "", err
	}
	return sessionID, nil
}

type mcpRPCRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      string `json:"id,omitempty"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

type mcpRPCError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

type mcpRPCResponse struct {
	ID     any             `json:"id"`
	Result json.RawMessage `json:"result"`
	Error  *mcpRPCError    `json:"error"`
}

func (c *MCPHTTPClient) post(ctx context.Context, mcpURL, tokenType, accessToken, sessionID string, body any, responseID string) (json.RawMessage, string, error) {
	reqBody, err := json.Marshal(body)
	if err != nil {
		return nil, "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, mcpURL, bytes.NewReader(reqBody))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", mcpProtocolVersion)
	if sessionID != "" {
		req.Header.Set("Mcp-Session-Id", sessionID)
	}
	if accessToken != "" {
		req.Header.Set("Authorization", authHeader(tokenType, accessToken))
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("mcp request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := outbound.ReadAll(resp.Body, c.http.MaxResponseBytes())
	if err != nil {
		return nil, "", fmt.Errorf("mcp read response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("mcp returned status %d", resp.StatusCode)
	}
	if responseID == "" {
		return nil, resp.Header.Get("Mcp-Session-Id"), nil
	}
	result, err := parseMCPResponse(resp.Header.Get("Content-Type"), raw, responseID)
	if err != nil {
		return nil, "", err
	}
	session := resp.Header.Get("Mcp-Session-Id")
	if session == "" {
		session = sessionID
	}
	return result, session, nil
}

func parseMCPResponse(contentType string, raw []byte, responseID string) (json.RawMessage, error) {
	if strings.Contains(strings.ToLower(contentType), "text/event-stream") {
		return parseMCPSSE(raw, responseID)
	}
	return parseMCPJSON(raw, responseID)
}

func parseMCPSSE(raw []byte, responseID string) (json.RawMessage, error) {
	for _, event := range strings.Split(string(raw), "\n\n") {
		var data []string
		for _, line := range strings.Split(event, "\n") {
			line = strings.TrimRight(line, "\r")
			if after, ok := strings.CutPrefix(line, "data:"); ok {
				data = append(data, strings.TrimSpace(after))
			}
		}
		if len(data) == 0 {
			continue
		}
		if result, err := parseMCPJSON([]byte(strings.Join(data, "\n")), responseID); err == nil {
			return result, nil
		}
	}
	return nil, fmt.Errorf("mcp response did not include json-rpc result %q", responseID)
}

func parseMCPJSON(raw []byte, responseID string) (json.RawMessage, error) {
	var resp mcpRPCResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		return nil, fmt.Errorf("mcp decode response: %w", err)
	}
	if !mcpIDMatches(resp.ID, responseID) {
		return nil, fmt.Errorf("mcp response id mismatch")
	}
	if resp.Error != nil {
		return nil, fmt.Errorf("mcp error %d: %s", resp.Error.Code, resp.Error.Message)
	}
	if len(resp.Result) == 0 {
		return json.RawMessage(`{}`), nil
	}
	return resp.Result, nil
}

func mcpIDMatches(id any, want string) bool {
	if want == "" {
		return true
	}
	switch v := id.(type) {
	case string:
		return v == want
	case float64:
		return fmt.Sprintf("%.0f", v) == want
	default:
		return fmt.Sprint(v) == want
	}
}

func authHeader(tokenType, token string) string {
	tokenType = strings.TrimSpace(tokenType)
	if tokenType == "" {
		tokenType = "Bearer"
	}
	return tokenType + " " + token
}

// NewMCPListToolsTool builds connector.mcp.list_tools for configured MCP
// connectors.
func NewMCPListToolsTool(resolver MCPConnectorResolver, client MCPConnectorClient, connectorNames []string, policies ...MCPConnectorPolicy) Tool {
	return &mcpListToolsTool{resolver: resolver, client: client, policy: newMCPPolicySet(connectorNames, policies)}
}

type mcpListToolsTool struct {
	resolver MCPConnectorResolver
	client   MCPConnectorClient
	policy   mcpPolicySet
}

func (t *mcpListToolsTool) Name() string { return "connector.mcp.list_tools" }
func (t *mcpListToolsTool) AuditInfo(args json.RawMessage) ToolAudit {
	return ToolAudit{TrustTier: TierRead, Connector: mcpConnectorFromArgs(args), Operation: "mcp.tools.list"}
}
func (t *mcpListToolsTool) Description() string {
	return "List tools exposed by one of the user's connected MCP connectors."
}
func (t *mcpListToolsTool) JSONSchema() json.RawMessage {
	return mcpConnectorSchema(t.policy.connectorNames, nil)
}
func (t *mcpListToolsTool) Invoke(ctx context.Context, scope ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		Connector string `json:"connector"`
	}
	if err := json.Unmarshal(args, &in); err != nil {
		return nil, fmt.Errorf("invalid mcp list_tools arguments: %w", err)
	}
	connector := strings.TrimSpace(in.Connector)
	if connector == "" {
		return mcpObservation("connector is required")
	}
	if !t.policy.connectorAllowed(connector) {
		return mcpObservation("connector " + connector + " is not configured")
	}
	if t.resolver == nil {
		return mcpObservation("MCP tools are not configured")
	}
	mcpURL, tokenType, token, err := t.resolver.ResolveMCP(ctx, scope.UserID, connector)
	if err != nil {
		return mcpObservation(err.Error())
	}
	if t.client == nil {
		return mcpObservation("MCP tools are not configured")
	}
	result, err := t.client.ListTools(ctx, mcpURL, tokenType, token)
	if err != nil {
		return mcpObservation(err.Error())
	}
	return json.Marshal(map[string]any{"connector": connector, "tools": result, "allowedTools": t.policy.allowedTools(connector)})
}

// NewMCPCallTool builds connector.mcp.call_tool for configured MCP connectors.
func NewMCPCallTool(resolver MCPConnectorResolver, client MCPConnectorClient, connectorNames []string, policies ...MCPConnectorPolicy) Tool {
	return &mcpCallTool{resolver: resolver, client: client, policy: newMCPPolicySet(connectorNames, policies)}
}

type mcpCallTool struct {
	resolver MCPConnectorResolver
	client   MCPConnectorClient
	policy   mcpPolicySet
}

func (t *mcpCallTool) Name() string { return "connector.mcp.call_tool" }
func (t *mcpCallTool) AuditInfo(args json.RawMessage) ToolAudit {
	connector, toolName := mcpCallTargetFromArgs(args)
	tier := TierRead
	if p, ok := t.policy.toolPolicy(connector, toolName); ok && p.TrustTier != "" {
		tier = p.TrustTier
	}
	return ToolAudit{TrustTier: tier, Connector: connector, Operation: "mcp.tool." + toolName}
}
func (t *mcpCallTool) Description() string {
	return "Call a tool exposed by one of the user's connected MCP connectors. Use connector.mcp.list_tools first when the tool name or schema is unknown."
}
func (t *mcpCallTool) JSONSchema() json.RawMessage {
	return mcpConnectorSchema(t.policy.connectorNames, map[string]any{
		"tool": map[string]any{
			"type":        "string",
			"description": "MCP tool name to call.",
		},
		"arguments": map[string]any{
			"type":        "object",
			"description": "Arguments matching the MCP tool's input schema.",
		},
	})
}
func (t *mcpCallTool) Invoke(ctx context.Context, scope ToolScope, args json.RawMessage) (json.RawMessage, error) {
	var in struct {
		Connector string          `json:"connector"`
		Tool      string          `json:"tool"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(args, &in); err != nil {
		return nil, fmt.Errorf("invalid mcp call_tool arguments: %w", err)
	}
	connector := strings.TrimSpace(in.Connector)
	toolName := strings.TrimSpace(in.Tool)
	if connector == "" || toolName == "" {
		return mcpObservation("connector and tool are required")
	}
	if !t.policy.connectorAllowed(connector) {
		return mcpObservation("connector " + connector + " is not configured")
	}
	if _, ok := t.policy.toolPolicy(connector, toolName); !ok {
		return mcpObservation("MCP tool " + connector + "/" + toolName + " is not allowlisted")
	}
	if t.resolver == nil {
		return mcpObservation("MCP tools are not configured")
	}
	mcpURL, tokenType, token, err := t.resolver.ResolveMCP(ctx, scope.UserID, connector)
	if err != nil {
		return mcpObservation(err.Error())
	}
	if t.client == nil {
		return mcpObservation("MCP tools are not configured")
	}
	result, err := t.client.CallTool(ctx, mcpURL, tokenType, token, toolName, in.Arguments)
	if err != nil {
		return mcpObservation(err.Error())
	}
	return json.Marshal(map[string]any{"connector": connector, "tool": toolName, "result": result})
}

func mcpConnectorSchema(connectorNames []string, extra map[string]any) json.RawMessage {
	connector := map[string]any{
		"type":        "string",
		"description": "Configured connector name.",
	}
	if len(connectorNames) > 0 {
		connector["enum"] = connectorNames
	}
	properties := map[string]any{"connector": connector}
	required := []string{"connector"}
	for k, v := range extra {
		properties[k] = v
		required = append(required, k)
	}
	raw, _ := json.Marshal(map[string]any{
		"type":       "object",
		"properties": properties,
		"required":   required,
	})
	return raw
}

func cleanConnectorNames(names []string) []string {
	out := make([]string, 0, len(names))
	for _, name := range names {
		name = strings.TrimSpace(name)
		if name == "" || slices.Contains(out, name) {
			continue
		}
		out = append(out, name)
	}
	slices.Sort(out)
	return out
}

func mcpObservation(message string) (json.RawMessage, error) {
	b, err := json.Marshal(map[string]string{"error": message})
	if err != nil {
		return nil, err
	}
	return b, nil
}

type mcpPolicySet struct {
	connectorNames []string
	tools          map[string]map[string]MCPToolPolicy
}

func newMCPPolicySet(connectorNames []string, policies []MCPConnectorPolicy) mcpPolicySet {
	names := cleanConnectorNames(connectorNames)
	set := mcpPolicySet{connectorNames: names, tools: map[string]map[string]MCPToolPolicy{}}
	for _, policy := range policies {
		connector := strings.TrimSpace(policy.Name)
		if connector == "" {
			continue
		}
		if !slices.Contains(set.connectorNames, connector) {
			set.connectorNames = append(set.connectorNames, connector)
			slices.Sort(set.connectorNames)
		}
		if set.tools[connector] == nil {
			set.tools[connector] = map[string]MCPToolPolicy{}
		}
		for _, tool := range policy.Tools {
			name := strings.TrimSpace(tool.Name)
			if name == "" {
				continue
			}
			tier := strings.TrimSpace(tool.TrustTier)
			if tier == "" {
				tier = TierRead
			}
			set.tools[connector][name] = MCPToolPolicy{Name: name, TrustTier: tier}
		}
	}
	return set
}

func (p mcpPolicySet) connectorAllowed(connector string) bool {
	return slices.Contains(p.connectorNames, connector)
}

func (p mcpPolicySet) toolPolicy(connector, tool string) (MCPToolPolicy, bool) {
	if connector == "" || tool == "" {
		return MCPToolPolicy{}, false
	}
	tools := p.tools[connector]
	if len(tools) == 0 {
		return MCPToolPolicy{}, false
	}
	policy, ok := tools[tool]
	return policy, ok
}

func (p mcpPolicySet) allowedTools(connector string) []MCPToolPolicy {
	tools := p.tools[connector]
	if len(tools) == 0 {
		return nil
	}
	names := make([]string, 0, len(tools))
	for name := range tools {
		names = append(names, name)
	}
	slices.Sort(names)
	out := make([]MCPToolPolicy, 0, len(names))
	for _, name := range names {
		out = append(out, tools[name])
	}
	return out
}

func mcpConnectorFromArgs(args json.RawMessage) string {
	var in struct {
		Connector string `json:"connector"`
	}
	_ = json.Unmarshal(args, &in)
	return strings.TrimSpace(in.Connector)
}

func mcpCallTargetFromArgs(args json.RawMessage) (connector, tool string) {
	var in struct {
		Connector string `json:"connector"`
		Tool      string `json:"tool"`
	}
	_ = json.Unmarshal(args, &in)
	return strings.TrimSpace(in.Connector), strings.TrimSpace(in.Tool)
}
