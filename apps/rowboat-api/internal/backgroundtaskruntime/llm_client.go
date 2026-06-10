package backgroundtaskruntime

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskmetrics"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/llm"
	"github.com/google/uuid"
)

// llmMaxTokens bounds each loop completion.
const llmMaxTokens = 4096

// GatewayLLM adapts the in-process llm gateway to the runtime's LLMClient,
// binding the billing identity (the task owner) and the run's deterministic
// idempotency anchor.
type GatewayLLM struct {
	handler *llm.Handler
	user    *ent.User
	model   string
	slug    string
	runID   string
	attempt int
}

// NewGatewayLLM builds the per-run gateway adapter. model is the resolved
// model id (task override or runtime default); attempt is the Temporal
// activity attempt (1-based) seeding the idempotency anchor — each retry
// reserves fresh because an LLM transcript cannot resume across attempts
// (re-billing the retried attempt's calls is the accepted cost of keeping
// the activity retry budget usable).
func NewGatewayLLM(handler *llm.Handler, user *ent.User, model, slug, runID string, attempt int) *GatewayLLM {
	if attempt < 1 {
		attempt = 1
	}
	return &GatewayLLM{handler: handler, user: user, model: model, slug: slug, runID: runID, attempt: attempt}
}

// Complete advances the conversation one turn. The deterministic
// per-(attempt, call) request id makes a duplicate submission WITHIN one
// attempt replay the original reservation instead of double-billing; a
// replay surfacing here is terminal (the transcript is gone), but with
// attempt-seeded ids that never happens on a normal Temporal retry.
func (g *GatewayLLM) Complete(ctx context.Context, callIndex int, messages []Message, tools []ToolDef) (Turn, error) {
	ctx = auth.WithUser(ctx, g.user)

	chatMessages := make([]llm.ChatMessage, 0, len(messages))
	for _, m := range messages {
		cm := llm.ChatMessage{Role: m.Role, Content: m.Content, ToolCallID: m.ToolCallID}
		for _, tc := range m.ToolCalls {
			cm.ToolCalls = append(cm.ToolCalls, llm.ToolCall{ID: tc.ID, Name: tc.Name, Arguments: tc.Arguments})
		}
		chatMessages = append(chatMessages, cm)
	}
	chatTools := make([]llm.ToolDef, 0, len(tools))
	for _, t := range tools {
		chatTools = append(chatTools, llm.ToolDef{Name: t.Name, Description: t.Description, Parameters: t.Parameters})
	}

	start := time.Now()
	res, err := g.handler.ChatComplete(ctx, llm.ChatRequest{
		Model:      g.model,
		Messages:   chatMessages,
		Tools:      chatTools,
		MaxTokens:  llmMaxTokens,
		Op:         "runtime_llm",
		UseCase:    "background_task_agent",
		SubUseCase: "runtime",
		AgentName:  g.slug,
		RequestID:  runtimeRequestID(g.runID, g.attempt, callIndex),
	})
	latency := time.Since(start)
	if err != nil {
		if errors.Is(err, llm.ErrAlreadyCompleted) || errors.Is(err, llm.ErrInProgress) {
			return Turn{}, &RuntimeError{
				Code:    CodeLLMCallFailed,
				Message: "deterministic llm request-id replayed within the same attempt; the transcript cannot be resumed",
				Cause:   err,
			}
		}
		return Turn{}, &RuntimeError{Code: CodeLLMCallFailed, Message: "llm gateway call failed", Cause: err}
	}
	backgroundtaskmetrics.RuntimeLLMCalls.WithLabelValues(res.Provider).Inc()
	backgroundtaskmetrics.RuntimeLLMLatency.WithLabelValues(res.Provider).Observe(latency.Seconds())

	turn := Turn{
		Provider:     res.Provider,
		Model:        g.model,
		InputTokens:  res.InputTokens,
		OutputTokens: res.OutputTokens,
		LatencyMs:    latency.Milliseconds(),
	}
	turn.Message = Message{Role: "assistant", Content: res.Message.Content}
	for _, tc := range res.Message.ToolCalls {
		turn.Message.ToolCalls = append(turn.Message.ToolCalls, ToolCallRequest{ID: tc.ID, Name: tc.Name, Arguments: tc.Arguments})
	}
	return turn, nil
}

// runtimeRequestID derives the deterministic per-(run, attempt, call)
// idempotency anchor — the event router's routeRequestID pattern, plus the
// activity attempt so Temporal retries reserve fresh instead of dying on
// replay of a prior attempt's settled charge.
func runtimeRequestID(runID string, attempt, callIndex int) uuid.UUID {
	return uuid.NewSHA1(uuid.NameSpaceOID,
		[]byte("cloud-runtime/"+runID+"/attempt/"+strconv.Itoa(attempt)+"/llm/"+strconv.Itoa(callIndex)))
}
