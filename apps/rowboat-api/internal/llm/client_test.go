package llm_test

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/credits"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/llm"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/pricing"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
	"github.com/google/uuid"
)

func jsonUpstream(t *testing.T, body string, status int) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv
}

const completionBody = `{"choices":[{"message":{"content":"{\"ids\":[\"task-a\"]}"}}],"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120}}`

func TestCompleteSettlesAndRecordsUsage(t *testing.T) {
	client, ctx, h := setup(t, 100000)
	upstream := jsonUpstream(t, completionBody, http.StatusOK)
	h.SetUpstreams("", upstream.URL)

	res, err := h.Complete(ctx, llm.CompleteRequest{
		Model:      "anthropic/claude-haiku-4-5",
		System:     "You are a router.",
		Prompt:     "route this",
		MaxTokens:  256,
		JSONObject: true,
		Op:         "event_route",
		UseCase:    "cloud_event_router",
		SubUseCase: "pass1",
		RequestID:  uuid.New(),
	})
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if res.InputTokens != 100 || res.OutputTokens != 20 {
		t.Fatalf("usage = %d/%d, want 100/20", res.InputTokens, res.OutputTokens)
	}

	// The net ledger delta must equal the actual cost for the reported usage.
	wantCost := pricing.DefaultTable().LLMCost("anthropic/claude-haiku-4-5", 100, 20)
	avail, err := credits.Available(ctx, client, 100000)
	if err != nil {
		t.Fatalf("available: %v", err)
	}
	if got := 100000 - avail; got != wantCost {
		t.Fatalf("net charge = %d, want %d", got, wantCost)
	}

	// Usage row recorded with the routing use case.
	rows := client.LLMUsage.Query().AllX(ctx)
	if len(rows) != 1 || rows[0].UseCase != "cloud_event_router" || rows[0].SubUseCase != "pass1" {
		t.Fatalf("llm usage rows = %+v, want one cloud_event_router/pass1 row", rows)
	}
}

func TestCompleteRefundsOnUpstreamError(t *testing.T) {
	client, ctx, h := setup(t, 100000)
	upstream := jsonUpstream(t, `{"error":"boom"}`, http.StatusInternalServerError)
	h.SetUpstreams("", upstream.URL)

	_, err := h.Complete(ctx, llm.CompleteRequest{
		Model: "anthropic/claude-haiku-4-5", Prompt: "x",
		Op: "event_route", RequestID: uuid.New(),
	})
	if err == nil {
		t.Fatal("want error on upstream 500")
	}
	if strings.Contains(err.Error(), "boom") {
		t.Fatalf("upstream response body leaked into error: %v", err)
	}
	avail, _ := credits.Available(ctx, client, 100000)
	if avail != 100000 {
		t.Fatalf("available = %d, want full refund to 100000", avail)
	}
}

func TestCompleteInsufficientCredits(t *testing.T) {
	_, ctx, h := setup(t, 0)
	upstream := jsonUpstream(t, completionBody, http.StatusOK)
	h.SetUpstreams("", upstream.URL)

	_, err := h.Complete(ctx, llm.CompleteRequest{
		Model: "anthropic/claude-haiku-4-5", Prompt: "x",
		Op: "event_route", RequestID: uuid.New(),
	})
	if !errors.Is(err, quota.ErrInsufficientCredits) {
		t.Fatalf("err = %v, want ErrInsufficientCredits", err)
	}
}

func TestCompleteReplayIsRejected(t *testing.T) {
	_, ctx, h := setup(t, 100000)
	upstream := jsonUpstream(t, completionBody, http.StatusOK)
	h.SetUpstreams("", upstream.URL)

	rid := uuid.New()
	req := llm.CompleteRequest{
		Model: "anthropic/claude-haiku-4-5", Prompt: "x",
		Op: "event_route", RequestID: rid,
	}
	if _, err := h.Complete(ctx, req); err != nil {
		t.Fatalf("first call: %v", err)
	}
	_, err := h.Complete(ctx, req)
	if !errors.Is(err, llm.ErrAlreadyCompleted) {
		t.Fatalf("replay err = %v, want ErrAlreadyCompleted (no double vendor call)", err)
	}
}

func TestCompleteJSONStripsFences(t *testing.T) {
	_, ctx, h := setup(t, 100000)
	fenced := `{"choices":[{"message":{"content":"` + "```json\\n{\\\"match\\\":true,\\\"confidence\\\":0.9}\\n```" + `"}}],"usage":{"prompt_tokens":10,"completion_tokens":5}}`
	upstream := jsonUpstream(t, fenced, http.StatusOK)
	h.SetUpstreams("", upstream.URL)

	var out struct {
		Match      bool    `json:"match"`
		Confidence float64 `json:"confidence"`
	}
	if err := h.CompleteJSON(ctx, llm.CompleteRequest{
		Model: "anthropic/claude-haiku-4-5", Prompt: "x",
		Op: "event_route", RequestID: uuid.New(),
	}, &out); err != nil {
		t.Fatalf("complete json: %v", err)
	}
	if !out.Match || out.Confidence != 0.9 {
		t.Fatalf("out = %+v, want match=true confidence=0.9", out)
	}
}
