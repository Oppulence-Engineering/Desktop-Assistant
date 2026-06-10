package llm_test

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/credits"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/llm"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/pricing"
	"github.com/google/uuid"
)

const toolCallBody = `{
  "choices": [{
    "finish_reason": "tool_calls",
    "message": {
      "role": "assistant",
      "content": "",
      "tool_calls": [{
        "id": "call_1",
        "type": "function",
        "function": {"name": "connector.read.gmail", "arguments": "{\"query\":\"from:acme.com\",\"limit\":5}"}
      }]
    }
  }],
  "usage": {"prompt_tokens": 200, "completion_tokens": 30, "total_tokens": 230}
}`

const finalBody = `{
  "choices": [{
    "finish_reason": "stop",
    "message": {"role": "assistant", "content": "# Report\n\nAll good."}
  }],
  "usage": {"prompt_tokens": 300, "completion_tokens": 50, "total_tokens": 350}
}`

func chatRequest(rid uuid.UUID, messages []llm.ChatMessage) llm.ChatRequest {
	return llm.ChatRequest{
		Model:     "anthropic/claude-sonnet-4-5",
		Messages:  messages,
		MaxTokens: 512,
		Tools: []llm.ToolDef{{
			Name:        "connector.read.gmail",
			Description: "Search Gmail",
			Parameters:  json.RawMessage(`{"type":"object","properties":{"query":{"type":"string"},"limit":{"type":"integer"}}}`),
		}},
		Op:         "runtime_llm",
		UseCase:    "background_task_agent",
		SubUseCase: "runtime",
		AgentName:  "daily-summary",
		RequestID:  rid,
	}
}

func TestChatCompleteToolCallRoundTrip(t *testing.T) {
	client, ctx, h := setup(t, 100000)

	var captured []byte
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured, _ = io.ReadAll(r.Body)
		calls++
		w.Header().Set("Content-Type", "application/json")
		if calls == 1 {
			_, _ = io.WriteString(w, toolCallBody)
			return
		}
		_, _ = io.WriteString(w, finalBody)
	}))
	defer upstream.Close()
	h.SetUpstreams("", upstream.URL)

	// First turn: model requests a tool call.
	res, err := h.ChatComplete(ctx, chatRequest(uuid.New(), []llm.ChatMessage{
		{Role: "system", Content: "You are a runtime."},
		{Role: "user", Content: "do the task"},
	}))
	if err != nil {
		t.Fatalf("chat 1: %v", err)
	}
	if len(res.Message.ToolCalls) != 1 || res.Message.ToolCalls[0].Name != "connector.read.gmail" {
		t.Fatalf("tool calls = %+v, want connector.read.gmail", res.Message.ToolCalls)
	}
	if string(res.Message.ToolCalls[0].Arguments) != `{"query":"from:acme.com","limit":5}` {
		t.Fatalf("arguments = %s", res.Message.ToolCalls[0].Arguments)
	}
	// The advertised tools must be on the wire in OpenAI function shape.
	var wire map[string]any
	_ = json.Unmarshal(captured, &wire)
	if _, ok := wire["tools"]; !ok || wire["tool_choice"] != "auto" {
		t.Fatalf("request missing tools/tool_choice: %s", captured)
	}

	// Second turn: append the assistant tool-call turn + the tool result and
	// get the final answer. The wire body must carry tool_calls + tool_call_id.
	transcript := []llm.ChatMessage{
		{Role: "system", Content: "You are a runtime."},
		{Role: "user", Content: "do the task"},
		res.Message,
		{Role: "tool", ToolCallID: res.Message.ToolCalls[0].ID, Content: `{"messages":[]}`},
	}
	res2, err := h.ChatComplete(ctx, chatRequest(uuid.New(), transcript))
	if err != nil {
		t.Fatalf("chat 2: %v", err)
	}
	if res2.Message.Content != "# Report\n\nAll good." || len(res2.Message.ToolCalls) != 0 {
		t.Fatalf("final = %+v", res2.Message)
	}
	if res2.InputTokens != 300 || res2.OutputTokens != 50 {
		t.Fatalf("usage = %d/%d, want 300/50", res2.InputTokens, res2.OutputTokens)
	}
	wireStr := string(captured)
	for _, needle := range []string{`"tool_calls"`, `"call_1"`, `"tool_call_id":"call_1"`, `"role":"tool"`} {
		if !strings.Contains(wireStr, needle) {
			t.Fatalf("second request missing %s: %s", needle, wireStr)
		}
	}

	// Billing: both calls settled at actual usage.
	want := pricing.DefaultTable().LLMCost("anthropic/claude-sonnet-4-5", 200, 30) +
		pricing.DefaultTable().LLMCost("anthropic/claude-sonnet-4-5", 300, 50)
	avail, _ := credits.Available(ctx, client, 100000)
	if got := 100000 - avail; got != want {
		t.Fatalf("net charge = %d, want %d", got, want)
	}

	// Telemetry: agentName recorded on usage rows.
	rows := client.LLMUsage.Query().AllX(ctx)
	if len(rows) != 2 || rows[0].AgentName != "daily-summary" || rows[0].UseCase != "background_task_agent" {
		t.Fatalf("usage rows = %+v", rows)
	}
}

func TestChatCompleteRefundsOnFailure(t *testing.T) {
	client, ctx, h := setup(t, 100000)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = io.WriteString(w, `{"error":"down"}`)
	}))
	defer upstream.Close()
	h.SetUpstreams("", upstream.URL)

	_, err := h.ChatComplete(ctx, chatRequest(uuid.New(), []llm.ChatMessage{{Role: "user", Content: "x"}}))
	if err == nil {
		t.Fatal("want error on upstream 502")
	}
	if avail, _ := credits.Available(ctx, client, 100000); avail != 100000 {
		t.Fatalf("available = %d, want full refund", avail)
	}
}

func TestChatCompleteReplayIsRejected(t *testing.T) {
	_, ctx, h := setup(t, 100000)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, finalBody)
	}))
	defer upstream.Close()
	h.SetUpstreams("", upstream.URL)

	rid := uuid.New()
	req := chatRequest(rid, []llm.ChatMessage{{Role: "user", Content: "x"}})
	if _, err := h.ChatComplete(ctx, req); err != nil {
		t.Fatalf("first call: %v", err)
	}
	_, err := h.ChatComplete(ctx, req)
	if !errors.Is(err, llm.ErrAlreadyCompleted) {
		t.Fatalf("replay err = %v, want ErrAlreadyCompleted", err)
	}
}
