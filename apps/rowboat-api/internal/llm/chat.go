package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
	"github.com/google/uuid"
)

// ChatComplete is the in-process gateway's multi-turn, tool-calling entry
// point (RFC 004). The cloud agent runtime drives its bounded loop through it;
// the single-shot Complete stays untouched for the event router. Both run the
// same reserve → upstream → settle → record pipeline, billing the user carried
// by ctx.

// ChatMessage is one OpenAI-compatible conversation turn.
type ChatMessage struct {
	Role       string     `json:"role"` // system | user | assistant | tool
	Content    string     `json:"content"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`   // assistant turns
	ToolCallID string     `json:"tool_call_id,omitempty"` // tool-result turns
}

// ToolCall is one function invocation requested by the model.
type ToolCall struct {
	ID        string
	Name      string
	Arguments json.RawMessage
}

// ToolDef advertises one callable function to the model.
type ToolDef struct {
	Name        string
	Description string
	Parameters  json.RawMessage // JSON Schema for the arguments
}

// ChatRequest is one tool-calling completion call.
type ChatRequest struct {
	Model     string
	Messages  []ChatMessage
	Tools     []ToolDef
	MaxTokens int

	Op         string    // quota op label, e.g. "runtime_llm"
	UseCase    string    // llm_usage use_case, e.g. "background_task_agent"
	SubUseCase string    // e.g. "runtime"
	AgentName  string    // e.g. the task slug
	RequestID  uuid.UUID // quota/llm_usage idempotency anchor
}

// ChatResult is the assistant turn plus billed usage. ToolCalls presence on
// Message — not FinishReason — is the authoritative "wants tools" signal
// (OpenRouter-fronted models vary in finish_reason fidelity).
type ChatResult struct {
	Message      ChatMessage
	FinishReason string
	Provider     string // the routed upstream ("openai"/"openrouter"), for metrics labels
	InputTokens  int
	OutputTokens int
}

// wire shapes for the OpenAI chat completions request.
type wireToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type wireMessage struct {
	Role       string         `json:"role"`
	Content    string         `json:"content"`
	ToolCalls  []wireToolCall `json:"tool_calls,omitempty"`
	ToolCallID string         `json:"tool_call_id,omitempty"`
}

// ChatComplete runs route → Reserve → upstream chat completion → Settle →
// record LLMUsage. Quota errors and the replay states (ErrAlreadyCompleted /
// ErrInProgress) are returned unwrapped so callers can classify them.
func (h *Handler) ChatComplete(ctx context.Context, req ChatRequest) (ChatResult, error) {
	u, ok := auth.UserFromCtx(ctx)
	if !ok {
		return ChatResult{}, quota.ErrNoUser
	}
	if req.Op == "" || req.RequestID == uuid.Nil {
		return ChatResult{}, fmt.Errorf("llm: ChatComplete requires Op and RequestID")
	}
	if len(req.Messages) == 0 {
		return ChatResult{}, fmt.Errorf("llm: ChatComplete requires at least one message")
	}

	up, err := h.route(req.Model)
	if err != nil {
		return ChatResult{}, fmt.Errorf("llm route: %w", err)
	}

	outBody, inputBytes, err := marshalChatBody(up.model, req)
	if err != nil {
		return ChatResult{}, err
	}
	// Wire names are sanitized (see sanitizeToolName); translate the model's
	// choice back to the runtime's real tool name before returning, or the
	// dispatcher would look up a tool that does not exist.
	wireToReal := toolNameMap(req.Tools)

	estimate := h.prices.LLMEstimate(req.Model, inputBytes/4, req.MaxTokens)
	charge, err := h.gate.Reserve(ctx, req.Op, estimate, req.RequestID, h.spendLimits)
	if err != nil {
		return ChatResult{}, err
	}
	if charge.Finalized() {
		return ChatResult{}, ErrAlreadyCompleted
	}
	if charge.InProgress() {
		return ChatResult{}, ErrInProgress
	}

	upReq, err := http.NewRequestWithContext(ctx, http.MethodPost, up.baseURL+"/chat/completions", bytes.NewReader(outBody))
	if err != nil {
		h.refund(ctx, charge)
		return ChatResult{}, err
	}
	upReq.Header.Set("Content-Type", "application/json")
	upReq.Header.Set("Authorization", "Bearer "+up.apiKey)
	upReq.Header.Set("Idempotency-Key", req.RequestID.String())
	if up.provider == "openrouter" {
		upReq.Header.Set("HTTP-Referer", "https://app.solomon-ai.co")
		upReq.Header.Set("X-Title", "Solomon AI")
	}

	resp, err := h.http.Do(upReq)
	if err != nil {
		h.refund(ctx, charge)
		return ChatResult{}, fmt.Errorf("llm upstream: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		h.refund(ctx, charge)
		return ChatResult{}, fmt.Errorf("llm upstream read: %w", err)
	}
	if resp.StatusCode >= http.StatusBadRequest {
		h.refund(ctx, charge)
		// The body carries the only actionable detail (which field the provider
		// rejected). Dropping it turned a one-line schema bug into a blind hunt,
		// so include a bounded prefix; it is provider error text, not user data.
		return ChatResult{}, fmt.Errorf("llm upstream returned status %d: %s", resp.StatusCode, truncateForError(raw))
	}

	var parsed struct {
		Usage   *usage `json:"usage"`
		Choices []struct {
			FinishReason string      `json:"finish_reason"`
			Message      wireMessage `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		h.refund(ctx, charge)
		return ChatResult{}, fmt.Errorf("llm upstream response: %w", err)
	}
	if len(parsed.Choices) == 0 {
		h.refund(ctx, charge)
		return ChatResult{}, errors.New("llm upstream returned no choices")
	}
	choice := parsed.Choices[0]

	msg := ChatMessage{Role: "assistant", Content: choice.Message.Content}
	for _, tc := range choice.Message.ToolCalls {
		name := tc.Function.Name
		if canonical, ok := wireToReal[name]; ok {
			name = canonical
		}
		msg.ToolCalls = append(msg.ToolCalls, ToolCall{
			ID:        tc.ID,
			Name:      name,
			Arguments: json.RawMessage(tc.Function.Arguments),
		})
	}

	inTok, outTok := inputBytes/4, estimateOutputTokens(choice.Message)
	cachedTok := 0
	if parsed.Usage != nil {
		inTok, outTok = parsed.Usage.PromptTokens, parsed.Usage.CompletionTokens
		cachedTok = cachedFrom(parsed.Usage)
	}
	h.finalize(ctx, charge, u, req.RequestID, req.Model, inTok, cachedTok, outTok, telemetry{
		useCase:    req.UseCase,
		subUseCase: req.SubUseCase,
		agentName:  req.AgentName,
	})

	return ChatResult{
		Message:      msg,
		FinishReason: choice.FinishReason,
		Provider:     up.provider,
		InputTokens:  inTok,
		OutputTokens: outTok,
	}, nil
}

// marshalChatBody builds the OpenAI-compatible request body and reports the
// reservation's input-estimate bytes. Messages and tools are each encoded
// exactly once (embedded as RawMessage) and BOTH count toward the estimate:
// tool schemas are part of the billed prompt — skipping them would let a
// tiny-messages + huge-tools request reserve almost nothing and have Settle
// (which performs no balance check) drive the ledger negative (see
// estimateInputTokens in estimate.go, the proxy-path twin of this rule).
func marshalChatBody(upstreamModel string, req ChatRequest) (body []byte, inputBytes int, err error) {
	realToWire := make(map[string]string, len(req.Tools))
	for wire, real := range toolNameMap(req.Tools) {
		realToWire[real] = wire
	}
	messages := make([]wireMessage, 0, len(req.Messages))
	for _, m := range req.Messages {
		wm := wireMessage{Role: m.Role, Content: m.Content, ToolCallID: m.ToolCallID}
		for _, tc := range m.ToolCalls {
			var wtc wireToolCall
			wtc.ID = tc.ID
			wtc.Type = "function"
			wtc.Function.Name = tc.Name
			if wire, ok := realToWire[tc.Name]; ok {
				// Assistant turns replayed from history must name tools the
				// same way the advertised schemas do, or Anthropic rejects the
				// whole conversation.
				wtc.Function.Name = wire
			}
			wtc.Function.Arguments = string(tc.Arguments)
			wm.ToolCalls = append(wm.ToolCalls, wtc)
		}
		messages = append(messages, wm)
	}
	rawMessages, err := json.Marshal(messages)
	if err != nil {
		return nil, 0, err
	}
	inputBytes = len(rawMessages)

	payload := map[string]any{
		"model":    upstreamModel,
		"messages": json.RawMessage(rawMessages),
	}
	if req.MaxTokens > 0 {
		payload["max_tokens"] = req.MaxTokens
	}
	if len(req.Tools) > 0 {
		tools := make([]map[string]any, 0, len(req.Tools))
		for _, t := range req.Tools {
			params := t.Parameters
			if len(params) == 0 {
				params = json.RawMessage(`{"type":"object","properties":{}}`)
			}
			name := t.Name
			if wire, ok := realToWire[t.Name]; ok {
				name = wire
			}
			tools = append(tools, map[string]any{
				"type": "function",
				"function": map[string]any{
					"name":        name,
					"description": t.Description,
					"parameters":  params,
				},
			})
		}
		rawTools, terr := json.Marshal(tools)
		if terr != nil {
			return nil, 0, terr
		}
		payload["tools"] = json.RawMessage(rawTools)
		payload["tool_choice"] = "auto"
		inputBytes += len(rawTools)
	}
	body, err = json.Marshal(payload)
	if err != nil {
		return nil, 0, err
	}
	return body, inputBytes, nil
}

// Tool names travel to the model inside a provider-validated schema. Anthropic
// (and OpenAI) require `^[a-zA-Z0-9_-]{1,128}$`, but this codebase names tools
// with dots — "artifact.write", "connector.read.gmail" — because dots are the
// runtime's own namespace separator. Sending them raw made every tool-carrying
// agent call fail upstream with a 400 that named no tool, so the dotted names
// are rewritten here at the wire boundary and mapped back on the way out. The
// runtime keeps its dotted names; only the provider sees the flattened ones.

// sanitizeToolName maps a tool name onto the provider-legal character set.

// truncateForError bounds an upstream error body so it can be logged and
// surfaced on a run record without pasting an unbounded provider response.
func truncateForError(raw []byte) string {
	const maxLen = 512
	s := strings.TrimSpace(string(raw))
	if len(s) > maxLen {
		return s[:maxLen] + "…"
	}
	return s
}

func sanitizeToolName(name string) string {
	var b strings.Builder
	b.Grow(len(name))
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	out := b.String()
	if len(out) > 128 {
		out = out[:128]
	}
	return out
}

// toolNameMap returns wire name -> real name for the advertised tools. Two
// distinct tools can sanitize to the same string ("a.b" and "a_b"); a numeric
// suffix keeps them distinguishable so the response can always be mapped back
// to exactly one real tool.
func toolNameMap(tools []ToolDef) map[string]string {
	if len(tools) == 0 {
		return nil
	}
	out := make(map[string]string, len(tools))
	for _, t := range tools {
		wire := sanitizeToolName(t.Name)
		if wire == "" {
			wire = "tool"
		}
		if existing, taken := out[wire]; taken && existing != t.Name {
			for i := 2; ; i++ {
				candidate := fmt.Sprintf("%s_%d", wire, i)
				if _, dup := out[candidate]; !dup {
					wire = candidate
					break
				}
			}
		}
		out[wire] = t.Name
	}
	return out
}
