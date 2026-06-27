package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

type fakeMCPResolver struct {
	mcpURL    string
	tokenType string
	token     string
	err       error

	userID    string
	connector string
}

func (r *fakeMCPResolver) ResolveMCP(_ context.Context, userID, connector string) (string, string, string, error) {
	r.userID = userID
	r.connector = connector
	if r.err != nil {
		return "", "", "", r.err
	}
	return r.mcpURL, r.tokenType, r.token, nil
}

type mcpServerState struct {
	authHeader string
	protocol   string

	initializedSession string
	listSession        string
	callSession        string
	callName           string
	callArgumentID     string
}

func newMCPTestServer(t *testing.T, state *mcpServerState) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ID     any             `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("decode request: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if req.Method != "notifications/initialized" {
			state.authHeader = r.Header.Get("Authorization")
			state.protocol = r.Header.Get("Mcp-Protocol-Version")
		}
		switch req.Method {
		case "initialize":
			w.Header().Set("Mcp-Session-Id", "sess-1")
			writeMCPResult(t, w, req.ID, map[string]any{
				"protocolVersion": mcpProtocolVersion,
				"capabilities":    map[string]any{},
				"serverInfo":      map[string]string{"name": "test-mcp", "version": "1"},
			})
		case "notifications/initialized":
			state.initializedSession = r.Header.Get("Mcp-Session-Id")
			w.WriteHeader(http.StatusAccepted)
		case "tools/list":
			state.listSession = r.Header.Get("Mcp-Session-Id")
			writeMCPResult(t, w, req.ID, map[string]any{
				"tools": []map[string]any{{
					"name":        "customer.lookup",
					"description": "Look up a customer",
					"inputSchema": map[string]any{"type": "object"},
				}},
			})
		case "tools/call":
			state.callSession = r.Header.Get("Mcp-Session-Id")
			var params struct {
				Name      string         `json:"name"`
				Arguments map[string]any `json:"arguments"`
			}
			if err := json.Unmarshal(req.Params, &params); err != nil {
				t.Errorf("decode call params: %v", err)
			}
			state.callName = params.Name
			if id, _ := params.Arguments["id"].(string); id != "" {
				state.callArgumentID = id
			}
			writeMCPResult(t, w, req.ID, map[string]any{
				"content": []map[string]string{{"type": "text", "text": "found " + state.callArgumentID}},
			})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

func writeMCPResult(t *testing.T, w http.ResponseWriter, id any, result any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"result":  result,
	}); err != nil {
		t.Errorf("encode response: %v", err)
	}
}

func TestMCPListToolsToolCallsServerSideCredential(t *testing.T) {
	state := &mcpServerState{}
	srv := newMCPTestServer(t, state)
	t.Cleanup(srv.Close)

	resolver := &fakeMCPResolver{mcpURL: srv.URL, tokenType: "Bearer", token: "runtime-token"}
	tool := NewMCPListToolsTool(resolver, NewMCPHTTPClient(outbound.Policy{}), []string{"canvas", "wispr"},
		MCPConnectorPolicy{Name: "canvas", Tools: []MCPToolPolicy{{Name: "customer.lookup", TrustTier: TierRead}}})
	out, err := tool.Invoke(context.Background(), ToolScope{UserID: "user-1"}, json.RawMessage(`{"connector":"canvas"}`))
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	if resolver.userID != "user-1" || resolver.connector != "canvas" {
		t.Fatalf("resolver scope = %q/%q", resolver.userID, resolver.connector)
	}
	if state.authHeader != "Bearer runtime-token" || state.protocol != mcpProtocolVersion {
		t.Fatalf("auth/protocol = %q/%q", state.authHeader, state.protocol)
	}
	if state.initializedSession != "sess-1" || state.listSession != "sess-1" {
		t.Fatalf("sessions initialized/list = %q/%q", state.initializedSession, state.listSession)
	}
	if !strings.Contains(string(out), `"customer.lookup"`) {
		t.Fatalf("out = %s", out)
	}
	if !strings.Contains(string(out), `"allowedTools"`) {
		t.Fatalf("out missing allowlist: %s", out)
	}
	if strings.Contains(string(out), "runtime-token") {
		t.Fatalf("tool output leaked access token: %s", out)
	}
}

func TestMCPCallToolCallsServerSideCredential(t *testing.T) {
	state := &mcpServerState{}
	srv := newMCPTestServer(t, state)
	t.Cleanup(srv.Close)

	resolver := &fakeMCPResolver{mcpURL: srv.URL, tokenType: "Bearer", token: "runtime-token"}
	tool := NewMCPCallTool(resolver, NewMCPHTTPClient(outbound.Policy{}), []string{"canvas"},
		MCPConnectorPolicy{Name: "canvas", Tools: []MCPToolPolicy{{Name: "customer.lookup", TrustTier: TierRead}}})
	out, err := tool.Invoke(context.Background(), ToolScope{UserID: "user-1"}, json.RawMessage(`{"connector":"canvas","tool":"customer.lookup","arguments":{"id":"cust_1"}}`))
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	if state.callSession != "sess-1" || state.callName != "customer.lookup" || state.callArgumentID != "cust_1" {
		t.Fatalf("call session/name/id = %q/%q/%q", state.callSession, state.callName, state.callArgumentID)
	}
	if !strings.Contains(string(out), `"found cust_1"`) {
		t.Fatalf("out = %s", out)
	}
}

func TestMCPCallToolRequiresAllowlist(t *testing.T) {
	resolver := &fakeMCPResolver{mcpURL: "https://mcp.test", tokenType: "Bearer", token: "runtime-token"}
	tool := NewMCPCallTool(resolver, nil, []string{"canvas"})
	out, err := tool.Invoke(context.Background(), ToolScope{UserID: "user-1"}, json.RawMessage(`{"connector":"canvas","tool":"customer.lookup","arguments":{"id":"cust_1"}}`))
	if err != nil {
		t.Fatalf("expected model-visible error, got hard error: %v", err)
	}
	if !strings.Contains(string(out), "not allowlisted") {
		t.Fatalf("out = %s", out)
	}
	if resolver.connector != "" {
		t.Fatalf("resolver should not be called for unallowlisted tool, got connector %q", resolver.connector)
	}
}

func TestMCPCallToolAuditUsesAllowlistedTrustTier(t *testing.T) {
	tool := NewMCPCallTool(nil, nil, []string{"stripe"},
		MCPConnectorPolicy{Name: "stripe", Tools: []MCPToolPolicy{
			{Name: "customer.lookup", TrustTier: TierRead},
			{Name: "invoice.finalize", TrustTier: TierAct},
			{Name: "refund.create", TrustTier: TierMoneyMoving},
		}})

	for _, tc := range []struct {
		args     string
		wantTier string
		wantOp   string
		wantConn string
	}{
		{
			args:     `{"connector":"stripe","tool":"customer.lookup","arguments":{"id":"cus_1"}}`,
			wantTier: TierRead,
			wantOp:   "mcp.tool.customer.lookup",
			wantConn: "stripe",
		},
		{
			args:     `{"connector":"stripe","tool":"invoice.finalize","arguments":{"id":"in_1"}}`,
			wantTier: TierAct,
			wantOp:   "mcp.tool.invoice.finalize",
			wantConn: "stripe",
		},
		{
			args:     `{"connector":"stripe","tool":"refund.create","arguments":{"charge":"ch_1"}}`,
			wantTier: TierMoneyMoving,
			wantOp:   "mcp.tool.refund.create",
			wantConn: "stripe",
		},
	} {
		audit := tool.(ToolAuditProvider).AuditInfo(json.RawMessage(tc.args))
		if audit.TrustTier != tc.wantTier || audit.Operation != tc.wantOp || audit.Connector != tc.wantConn {
			t.Fatalf("audit for %s = %+v, want %s/%s/%s", tc.args, audit, tc.wantTier, tc.wantConn, tc.wantOp)
		}
	}
}

func TestMCPToolsReturnModelVisibleErrors(t *testing.T) {
	tool := NewMCPListToolsTool(&fakeMCPResolver{err: fmt.Errorf("connector canvas is not connected")}, nil, []string{"canvas"})
	out, err := tool.Invoke(context.Background(), ToolScope{UserID: "user-1"}, json.RawMessage(`{"connector":"canvas"}`))
	if err != nil {
		t.Fatalf("expected model-visible error, got hard error: %v", err)
	}
	if !strings.Contains(string(out), `"error"`) || !strings.Contains(string(out), "not connected") {
		t.Fatalf("out = %s", out)
	}
}

func TestParseMCPSSE(t *testing.T) {
	raw := []byte("event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":\"tools-list\",\"result\":{\"tools\":[]}}\n\n")
	out, err := parseMCPResponse("text/event-stream", raw, "tools-list")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if string(out) != `{"tools":[]}` {
		t.Fatalf("out = %s", out)
	}
}
