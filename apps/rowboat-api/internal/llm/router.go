package llm

import (
	"fmt"
	"strings"
)

const (
	openAIBase     = "https://api.openai.com/v1"
	openRouterBase = "https://openrouter.ai/api/v1"
)

// upstream describes where a request is forwarded and how it is authenticated.
type upstream struct {
	baseURL  string
	apiKey   string
	model    string // model id sent upstream (may differ from the requested id)
	provider string // for logging/metrics
}

// route maps a requested model id to an upstream.
//
// Design: the desktop speaks the OpenAI/OpenRouter wire format, so we proxy to
// OpenAI-compatible upstreams without translating message formats —
//   - openai/*      → OpenAI directly (prefix stripped)
//   - openrouter/*  → OpenRouter (prefix stripped)
//   - anthropic/* google/* and anything else → OpenRouter (full slug kept;
//     OpenRouter understands "anthropic/…" and "google/…").
//
// This deviates from the plan's "anthropic/* → Anthropic API" to avoid a large
// OpenAI↔Anthropic-Messages / Gemini translation layer. Direct-provider
// adapters can be added here later without changing call sites.
func (h *Handler) route(model string) (upstream, error) {
	switch {
	case strings.HasPrefix(model, "openai/"):
		key := h.secrets.OpenAI()
		if key == "" {
			return upstream{}, fmt.Errorf("openai api key not configured")
		}
		return upstream{baseURL: h.openAIBaseURL, apiKey: key, model: strings.TrimPrefix(model, "openai/"), provider: "openai"}, nil

	case strings.HasPrefix(model, "openrouter/"):
		return h.openRouter(strings.TrimPrefix(model, "openrouter/"))

	default:
		// anthropic/*, google/*, bare ids → OpenRouter passthrough.
		return h.openRouter(model)
	}
}

func (h *Handler) openRouter(model string) (upstream, error) {
	key := h.secrets.OpenRouter()
	if key == "" {
		return upstream{}, fmt.Errorf("openrouter api key not configured")
	}
	return upstream{baseURL: h.openRouterBaseURL, apiKey: key, model: model, provider: "openrouter"}, nil
}
