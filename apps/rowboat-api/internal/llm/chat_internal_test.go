package llm

import (
	"encoding/json"
	"regexp"
	"strings"
	"testing"
)

// TestMarshalChatBodyEstimateIncludesTools: tool schemas are part of the
// billed prompt — the reserve estimate must grow with them (estimate.go's
// documented invariant for the proxy path, mirrored here).
func TestMarshalChatBodyEstimateIncludesTools(t *testing.T) {
	base := ChatRequest{
		Model:    "anthropic/claude-sonnet-4-5",
		Messages: []ChatMessage{{Role: "user", Content: "hi"}},
	}
	_, withoutTools, err := marshalChatBody("anthropic/claude-sonnet-4-5", base)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	huge := strings.Repeat("x", 4096)
	withTools := base
	withTools.Tools = []ToolDef{{
		Name:        "big.tool",
		Description: huge,
		Parameters:  json.RawMessage(`{"type":"object","properties":{"q":{"type":"string","description":"` + huge + `"}}}`),
	}}
	body, estimate, err := marshalChatBody("anthropic/claude-sonnet-4-5", withTools)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if estimate < withoutTools+8192 {
		t.Fatalf("estimate %d must include ~%d bytes of tool schema (messages-only was %d)", estimate, 2*len(huge), withoutTools)
	}
	// The single-encode body is still a valid request with tools present.
	var wire map[string]any
	if err := json.Unmarshal(body, &wire); err != nil {
		t.Fatalf("body: %v", err)
	}
	if _, ok := wire["tools"]; !ok || wire["tool_choice"] != "auto" {
		t.Fatal("tools/tool_choice missing from body")
	}
}

// TestMarshalChatBodySanitizesToolNames: the runtime names tools with dots
// ("artifact.write"), but providers validate tool names against
// ^[a-zA-Z0-9_-]{1,128}$ and reject the whole request with a 400 otherwise.
// Every advertised tool name and every replayed assistant tool_call must leave
// as a legal name.
func TestMarshalChatBodySanitizesToolNames(t *testing.T) {
	req := ChatRequest{
		Model: "anthropic/claude-sonnet-4-5",
		Messages: []ChatMessage{
			{Role: "user", Content: "hi"},
			{Role: "assistant", ToolCalls: []ToolCall{{
				ID:        "call_1",
				Name:      "connector.read.gmail",
				Arguments: json.RawMessage(`{}`),
			}}},
			{Role: "tool", ToolCallID: "call_1", Content: "ok"},
		},
		Tools: []ToolDef{
			{Name: "artifact.write", Parameters: json.RawMessage(`{"type":"object"}`)},
			{Name: "connector.read.gmail", Parameters: json.RawMessage(`{"type":"object"}`)},
		},
	}
	body, _, err := marshalChatBody("anthropic/claude-sonnet-4-5", req)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var wire struct {
		Messages []struct {
			ToolCalls []struct {
				Function struct {
					Name string `json:"name"`
				} `json:"function"`
			} `json:"tool_calls"`
		} `json:"messages"`
		Tools []struct {
			Function struct {
				Name string `json:"name"`
			} `json:"function"`
		} `json:"tools"`
	}
	if err := json.Unmarshal(body, &wire); err != nil {
		t.Fatalf("body: %v", err)
	}

	legal := regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)
	if len(wire.Tools) != 2 {
		t.Fatalf("want 2 tools, got %d", len(wire.Tools))
	}
	for _, tool := range wire.Tools {
		if !legal.MatchString(tool.Function.Name) {
			t.Fatalf("advertised tool name %q is rejected by providers", tool.Function.Name)
		}
	}
	var sawCall bool
	for _, m := range wire.Messages {
		for _, tc := range m.ToolCalls {
			sawCall = true
			if !legal.MatchString(tc.Function.Name) {
				t.Fatalf("replayed tool_call name %q is rejected by providers", tc.Function.Name)
			}
		}
	}
	if !sawCall {
		t.Fatal("assistant tool_call was dropped from the wire body")
	}
}

// TestToolNameMapRoundTrip: the model answers with the sanitized name, so the
// map must lead back to the runtime's real (dotted) tool name, including when
// two tools collide on the same sanitized form.
func TestToolNameMapRoundTrip(t *testing.T) {
	tools := []ToolDef{
		{Name: "artifact.write"},
		{Name: "artifact_write"},
		{Name: "connector.read.gmail"},
	}
	m := toolNameMap(tools)
	if len(m) != len(tools) {
		t.Fatalf("want %d distinct wire names, got %d: %v", len(tools), len(m), m)
	}
	seen := make(map[string]bool, len(tools))
	for wire, real := range m {
		seen[real] = true
		if wire == real && strings.ContainsRune(real, '.') {
			t.Fatalf("wire name %q was not sanitized", wire)
		}
	}
	for _, tool := range tools {
		if !seen[tool.Name] {
			t.Fatalf("tool %q is unreachable from the response mapping", tool.Name)
		}
	}
}
