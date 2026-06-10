package llm

import (
	"encoding/json"
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
