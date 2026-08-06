package llm

import (
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
)

// Every chat model must route through OpenRouter.
//
// openai/* used to bypass it and call OpenAI directly on a second key. That key
// failed on its own — every openai/* request returned 502 while anthropic/*
// served fine through OpenRouter — and silently broke email labeling. One
// upstream means one credential to fund and one failure mode.
func routerFixture(t *testing.T, openAIKey, openRouterKey string) *Handler {
	t.Helper()
	sec := secrets.NewFromConfig(appconfig.Config{
		OpenAIAPIKey:     openAIKey,
		OpenRouterAPIKey: openRouterKey,
	})
	return &Handler{secrets: sec, openRouterBaseURL: openRouterBase}
}

func TestRouteSendsEveryModelToOpenRouter(t *testing.T) {
	h := routerFixture(t, "sk-openai-should-be-unused", "sk-or-test")
	for _, model := range []string{
		"openai/gpt-4.1-mini",
		"openai/gpt-4.1",
		"anthropic/claude-haiku-4-5",
		"google/gemini-2.5-flash",
		"some-bare-id",
	} {
		up, err := h.route(model)
		if err != nil {
			t.Fatalf("route(%q) errored: %v", model, err)
		}
		if up.provider != "openrouter" {
			t.Errorf("route(%q).provider = %q, want openrouter", model, up.provider)
		}
		if !strings.Contains(up.baseURL, "openrouter.ai") {
			t.Errorf("route(%q).baseURL = %q, want an openrouter host", model, up.baseURL)
		}
		// The slug is OpenRouter's native id format, so it passes through intact.
		if up.model != model {
			t.Errorf("route(%q).model = %q, want the slug unchanged", model, up.model)
		}
	}
}

func TestRouteStripsTheExplicitOpenRouterPrefix(t *testing.T) {
	h := routerFixture(t, "", "sk-or-test")
	up, err := h.route("openrouter/openai/gpt-4.1")
	if err != nil {
		t.Fatalf("route errored: %v", err)
	}
	if up.model != "openai/gpt-4.1" {
		t.Errorf("model = %q, want the openrouter/ prefix stripped", up.model)
	}
}

func TestRouteNeedsNoOpenAIKey(t *testing.T) {
	// The OpenAI key is still used for embeddings, but chat routing must not
	// depend on it — otherwise an unfunded or rotated OpenAI account takes the
	// whole gateway down, which is exactly what happened.
	h := routerFixture(t, "", "sk-or-test")
	if _, err := h.route("openai/gpt-4.1-mini"); err != nil {
		t.Errorf("route should not require an OpenAI key, got: %v", err)
	}
}

func TestRouteFailsClearlyWithoutAnOpenRouterKey(t *testing.T) {
	h := routerFixture(t, "sk-openai", "")
	if _, err := h.route("anthropic/claude-haiku-4-5"); err == nil {
		t.Error("route should error when the OpenRouter key is unset")
	}
}
