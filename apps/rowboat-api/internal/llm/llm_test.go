package llm_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/credits"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/llm"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/pricing"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"go.uber.org/zap"
)

func setup(t *testing.T, sanctioned int) (*ent.Client, context.Context, *llm.Handler) {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })

	bg := context.Background()
	u := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(bg)
	userCtx := auth.WithUser(bg, u)
	d.Client.Subscription.Create().SetUser(u).SetSanctionedCredits(sanctioned).SaveX(userCtx)

	sec := secrets.NewFromConfig(appconfig.Config{OpenRouterAPIKey: "or-key"})
	h := llm.New(pricing.DefaultTable(), quota.New(d.Client, zap.NewNop()), sec, d.Client, zap.NewNop())
	return d.Client, userCtx, h
}

func TestChatCompletionsDoesNotExposeUpstreamErrorBody(t *testing.T) {
	_, ctx, h := setup(t, 100000)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"error":{"message":"secret provider account project_123"}}`)
	}))
	defer upstream.Close()
	h.SetUpstream(upstream.URL)

	req := httptest.NewRequest(http.MethodPost, "/v1/llm/chat/completions", strings.NewReader(`{"model":"anthropic/claude-sonnet-4-5","messages":[{"role":"user","content":"hi"}]}`)).WithContext(ctx)
	req.Header.Set("Idempotency-Key", "llm-upstream-error-redaction")
	rec := httptest.NewRecorder()
	h.ChatCompletions(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "project_123") || !strings.Contains(rec.Body.String(), "upstream_error") {
		t.Fatalf("provider error leaked or safe code missing: %s", rec.Body.String())
	}
}

func TestStreamingToolCallsWithoutUsageAreBilled(t *testing.T) {
	client, ctx, h := setup(t, 100000)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"id\":\"call_1\",\"function\":{\"name\":\"connector.read.gmail\",\"arguments\":\"{\\\"query\\\":\\\"from:acme.com\\\"}\"}}]}}]}\n\n")
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer upstream.Close()
	h.SetUpstream(upstream.URL)

	req := httptest.NewRequest(http.MethodPost, "/v1/llm/chat/completions", strings.NewReader(`{"model":"anthropic/claude-sonnet-4-5","stream":true,"messages":[{"role":"user","content":"search"}]}`)).WithContext(ctx)
	req.Header.Set("Idempotency-Key", "llm-tool-fallback-usage")
	rec := httptest.NewRecorder()
	h.ChatCompletions(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	usage := client.LLMUsage.Query().OnlyX(ctx)
	if usage.OutputTokens <= 0 {
		t.Fatalf("tool-only streamed completion was billed at %d output tokens", usage.OutputTokens)
	}
}

func TestChatCompletionsStreamingSettlesCredits(t *testing.T) {
	client, ctx, h := setup(t, 100000)

	var gotAuth, gotModel string
	var gotStreamOptions bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		body, _ := io.ReadAll(r.Body)
		var parsed map[string]any
		_ = json.Unmarshal(body, &parsed)
		gotModel, _ = parsed["model"].(string)
		_, gotStreamOptions = parsed["stream_options"]

		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\n")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{}}],\"usage\":{\"prompt_tokens\":1200,\"completion_tokens\":8,\"total_tokens\":1208}}\n\n")
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer upstream.Close()
	h.SetUpstream(upstream.URL)

	reqBody := `{"model":"anthropic/claude-sonnet-4-5","stream":true,"messages":[{"role":"user","content":"hi"}]}`
	req := httptest.NewRequest(http.MethodPost, "/v1/llm/chat/completions", strings.NewReader(reqBody)).WithContext(ctx)
	req.Header.Set("Idempotency-Key", "llm-stream-1")
	rec := httptest.NewRecorder()
	h.ChatCompletions(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "event-stream") {
		t.Fatalf("want event-stream, got %q", ct)
	}
	if !strings.Contains(rec.Body.String(), "Hello") || !strings.Contains(rec.Body.String(), "[DONE]") {
		t.Fatalf("stream not relayed verbatim: %s", rec.Body.String())
	}
	// Upstream auth swapped to the vendor key; model kept full slug; usage asked.
	if gotAuth != "Bearer or-key" {
		t.Errorf("upstream auth = %q", gotAuth)
	}
	if gotModel != "anthropic/claude-sonnet-4-5" {
		t.Errorf("upstream model = %q", gotModel)
	}
	if !gotStreamOptions {
		t.Error("gateway should inject stream_options.include_usage")
	}

	// Cost: ceil(1200*30/1000)=36 + ceil(8*150/1000)=2 → 38 → available 99962.
	avail, _ := credits.Available(ctx, client, 100000)
	if avail != 99962 {
		t.Fatalf("available after settle = %d, want 99962", avail)
	}
	// One usage row recorded.
	if n := client.LLMUsage.Query().CountX(ctx); n != 1 {
		t.Fatalf("llm usage rows = %d, want 1", n)
	}
}

func TestChatCompletionsInsufficientCredits(t *testing.T) {
	_, ctx, h := setup(t, 5) // tiny balance

	hit := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hit = true
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()
	h.SetUpstream(upstream.URL)

	reqBody := `{"model":"anthropic/claude-sonnet-4-5","stream":true,"messages":[{"role":"user","content":"hi"}]}`
	req := httptest.NewRequest(http.MethodPost, "/v1/llm/chat/completions", strings.NewReader(reqBody)).WithContext(ctx)
	req.Header.Set("Idempotency-Key", "llm-insufficient-1")
	rec := httptest.NewRecorder()
	h.ChatCompletions(rec, req)

	if rec.Code != http.StatusPaymentRequired {
		t.Fatalf("want 402, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "insufficient_credits") {
		t.Errorf("body = %s", rec.Body.String())
	}
	if hit {
		t.Error("upstream must not be called when credits are insufficient")
	}
}

func TestModelsCatalog(t *testing.T) {
	_, _, h := setup(t, 100)
	req := httptest.NewRequest(http.MethodGet, "/v1/llm/models", nil)
	rec := httptest.NewRecorder()
	h.Models(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	var body struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	found := false
	for _, m := range body.Data {
		if m.ID == "anthropic/claude-sonnet-4-5" {
			found = true
		}
	}
	if !found {
		t.Fatalf("catalog missing expected model: %+v", body.Data)
	}
}
