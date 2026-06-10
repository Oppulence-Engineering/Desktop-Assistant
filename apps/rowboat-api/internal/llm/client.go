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

// In-process gateway entry point (RFC 003 §8). Server-side features (the cloud
// event router) make bounded LLM calls through the same reserve → upstream →
// settle → record-usage pipeline as the HTTP proxy, instead of an HTTP hop to
// our own handler. The caller's ctx must carry the user to bill
// (auth.WithUser).

// ErrAlreadyCompleted is returned when req.RequestID was already settled or
// refunded: the accounting for this call is terminal, so re-calling the vendor
// would produce unbilled work. Callers replaying deterministic request ids
// (e.g. a Temporal activity retry) should treat it as "result lost; skip".
var ErrAlreadyCompleted = errors.New("llm: request already completed")

// ErrInProgress is returned when a concurrent call with the same RequestID is
// still in flight. Retryable.
var ErrInProgress = errors.New("llm: request already in progress")

// CompleteRequest is one non-streaming, in-process gateway call.
type CompleteRequest struct {
	Model      string
	System     string // optional system prompt
	Prompt     string // user message
	MaxTokens  int    // 0 → provider default (reservation assumes 1024)
	JSONObject bool   // ask for response_format {"type":"json_object"}

	Op         string    // quota op label, e.g. "event_route"
	UseCase    string    // llm_usage use_case, e.g. "cloud_event_router"
	SubUseCase string    // e.g. "pass1" | "pass2"
	RequestID  uuid.UUID // quota/llm_usage idempotency anchor
}

// CompleteResult is the assistant message plus the usage that was billed.
type CompleteResult struct {
	Content      string
	InputTokens  int
	OutputTokens int
}

// Complete runs route → Reserve → upstream chat completion → Settle → record
// LLMUsage, billing the user carried by ctx. Quota errors
// (quota.ErrInsufficientCredits, quota.ErrDailyLimitExceeded,
// quota.ErrMonthlyLimitExceeded) are returned unwrapped so callers can
// classify terminal-vs-retryable.
func (h *Handler) Complete(ctx context.Context, req CompleteRequest) (CompleteResult, error) {
	u, ok := auth.UserFromCtx(ctx)
	if !ok {
		return CompleteResult{}, quota.ErrNoUser
	}
	if req.Op == "" || req.RequestID == uuid.Nil {
		return CompleteResult{}, fmt.Errorf("llm: Complete requires Op and RequestID")
	}

	up, err := h.route(req.Model)
	if err != nil {
		return CompleteResult{}, fmt.Errorf("llm route: %w", err)
	}

	messages := make([]map[string]any, 0, 2)
	if req.System != "" {
		messages = append(messages, map[string]any{"role": "system", "content": req.System})
	}
	messages = append(messages, map[string]any{"role": "user", "content": req.Prompt})
	body := map[string]any{
		"model":    up.model,
		"messages": messages,
	}
	if req.MaxTokens > 0 {
		body["max_tokens"] = req.MaxTokens
	}
	if req.JSONObject {
		body["response_format"] = map[string]any{"type": "json_object"}
	}
	outBody, err := json.Marshal(body)
	if err != nil {
		return CompleteResult{}, err
	}

	inputEst := (len(req.System) + len(req.Prompt)) / 4
	maxOut := req.MaxTokens
	estimate := h.prices.LLMEstimate(req.Model, inputEst, maxOut)
	charge, err := h.gate.Reserve(ctx, req.Op, estimate, req.RequestID, h.spendLimits)
	if err != nil {
		return CompleteResult{}, err
	}
	if charge.Finalized() {
		return CompleteResult{}, ErrAlreadyCompleted
	}
	if charge.InProgress() {
		return CompleteResult{}, ErrInProgress
	}

	upReq, err := http.NewRequestWithContext(ctx, http.MethodPost, up.baseURL+"/chat/completions", bytes.NewReader(outBody))
	if err != nil {
		h.refund(charge)
		return CompleteResult{}, err
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
		h.refund(charge)
		return CompleteResult{}, fmt.Errorf("llm upstream: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		h.refund(charge)
		return CompleteResult{}, fmt.Errorf("llm upstream read: %w", err)
	}
	if resp.StatusCode >= http.StatusBadRequest {
		h.refund(charge)
		return CompleteResult{}, fmt.Errorf("llm upstream status %d: %s", resp.StatusCode, truncateErrBody(raw))
	}

	var parsed struct {
		Usage   *usage `json:"usage"`
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		h.refund(charge)
		return CompleteResult{}, fmt.Errorf("llm upstream response: %w", err)
	}
	if len(parsed.Choices) == 0 {
		h.refund(charge)
		return CompleteResult{}, errors.New("llm upstream returned no choices")
	}
	content := parsed.Choices[0].Message.Content

	inTok, outTok := inputEst, len(content)/4
	if parsed.Usage != nil {
		inTok, outTok = parsed.Usage.PromptTokens, parsed.Usage.CompletionTokens
	}
	h.finalize(ctx, charge, u, req.RequestID, req.Model, inTok, outTok, telemetry{
		useCase:    req.UseCase,
		subUseCase: req.SubUseCase,
	})

	return CompleteResult{Content: content, InputTokens: inTok, OutputTokens: outTok}, nil
}

// CompleteJSON is Complete with the assistant content unmarshaled into out.
// Markdown code fences (which some models emit even in JSON mode) are
// stripped first.
func (h *Handler) CompleteJSON(ctx context.Context, req CompleteRequest, out any) error {
	res, err := h.Complete(ctx, req)
	if err != nil {
		return err
	}
	content := stripCodeFences(res.Content)
	if err := json.Unmarshal([]byte(content), out); err != nil {
		return fmt.Errorf("llm: response is not the expected JSON: %w", err)
	}
	return nil
}

// stripCodeFences removes a wrapping ```json ... ``` (or plain ```) fence.
func stripCodeFences(s string) string {
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, "```") {
		return s
	}
	s = strings.TrimPrefix(s, "```")
	if nl := strings.IndexByte(s, '\n'); nl >= 0 {
		// Drop the language tag line (e.g. "json").
		if lang := strings.TrimSpace(s[:nl]); lang == "" || len(lang) <= 10 {
			s = s[nl+1:]
		}
	}
	s = strings.TrimSuffix(strings.TrimSpace(s), "```")
	return strings.TrimSpace(s)
}

// truncateErrBody bounds an upstream error body folded into an error message.
func truncateErrBody(b []byte) string {
	const maxLen = 512
	if len(b) > maxLen {
		b = b[:maxLen]
	}
	return string(b)
}
