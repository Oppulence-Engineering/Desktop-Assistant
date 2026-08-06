package llm

import (
	"fmt"
	"strings"
)

const openRouterBase = "https://openrouter.ai/api/v1"

// upstream describes where a request is forwarded and how it is authenticated.
type upstream struct {
	baseURL  string
	apiKey   string
	model    string // model id sent upstream (may differ from the requested id)
	provider string // for logging/metrics
}

// route maps a requested model id to an upstream.
//
// Everything goes through OpenRouter. The desktop speaks the OpenAI wire
// format and OpenRouter is OpenAI-compatible, so this is a passthrough with no
// message translation:
//   - openrouter/*  → OpenRouter (prefix stripped; explicit routing)
//   - everything else → OpenRouter with the slug intact, which is already its
//     native id format ("openai/…", "anthropic/…", "google/…").
//
// openai/* used to bypass OpenRouter and call OpenAI directly with a separate
// key. That second credential is a second thing to fund, rotate and monitor,
// and it failed on its own: every openai/* request returned 502 while
// anthropic/* served fine through OpenRouter, which silently broke email
// labeling. One upstream means one billing relationship, one key, and one
// failure mode — and OpenRouter serves the same OpenAI models under the same
// slugs, so no call site changes.
//
// The OpenAI key is still used elsewhere for embeddings (semantic memory);
// this only removes it from chat routing.
func (h *Handler) route(model string) (upstream, error) {
	if strings.HasPrefix(model, "openrouter/") {
		return h.openRouter(strings.TrimPrefix(model, "openrouter/"))
	}
	return h.openRouter(model)
}

func (h *Handler) openRouter(model string) (upstream, error) {
	key := h.secrets.OpenRouter()
	if key == "" {
		return upstream{}, fmt.Errorf("openrouter api key not configured")
	}
	return upstream{baseURL: h.openRouterBaseURL, apiKey: key, model: model, provider: "openrouter"}, nil
}
