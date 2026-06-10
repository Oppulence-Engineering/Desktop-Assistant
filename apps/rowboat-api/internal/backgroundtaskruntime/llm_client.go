package backgroundtaskruntime

import (
	"context"
	"errors"
	"strconv"
	"strings"
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
}

// NewGatewayLLM builds the per-run gateway adapter. model is the resolved
// model id (task override or runtime default).
func NewGatewayLLM(handler *llm.Handler, user *ent.User, model, slug, runID string) *GatewayLLM {
	return &GatewayLLM{handler: handler, user: user, model: model, slug: slug, runID: runID}
}

// Complete advances the conversation one turn. The deterministic per-call
// request id makes a Temporal activity retry replay the original quota
// reservation instead of double-billing; the replay itself is terminal (the
// prior attempt's transcript is gone), surfaced as llm_call_failed.
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
		RequestID:  runtimeRequestID(g.runID, callIndex),
	})
	latency := time.Since(start)
	provider := providerOf(g.model)
	if err != nil {
		if errors.Is(err, llm.ErrAlreadyCompleted) || errors.Is(err, llm.ErrInProgress) {
			return Turn{}, &RuntimeError{
				Code:    CodeLLMCallFailed,
				Message: "deterministic llm request-id replayed after an activity retry; the prior attempt's transcript is lost and the loop cannot resume",
				Cause:   err,
			}
		}
		return Turn{}, &RuntimeError{Code: CodeLLMCallFailed, Message: "llm gateway call failed", Cause: err}
	}
	backgroundtaskmetrics.RuntimeLLMCalls.WithLabelValues(provider).Inc()
	backgroundtaskmetrics.RuntimeLLMLatency.WithLabelValues(provider).Observe(latency.Seconds())

	turn := Turn{
		Provider:     provider,
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

// runtimeRequestID derives the deterministic per-(run, call) idempotency
// anchor — the same pattern as the event router's routeRequestID.
func runtimeRequestID(runID string, callIndex int) uuid.UUID {
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("cloud-runtime/"+runID+"/llm/"+strconv.Itoa(callIndex)))
}

// providerOf mirrors the gateway's routing split for the metrics label.
func providerOf(model string) string {
	if strings.HasPrefix(model, "openai/") {
		return "openai"
	}
	return "openrouter"
}
