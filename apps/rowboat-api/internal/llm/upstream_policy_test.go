package llm_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/credits"
)

const okCompletion = `{
  "choices": [{"finish_reason":"stop","message":{"role":"assistant","content":"ok"}}],
  "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
}`

// captureUpstream stands in for the vendor and records the body it was sent.
func captureUpstream(t *testing.T, status int, respBody string) (*httptest.Server, *[]byte) {
	t.Helper()
	var captured []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, respBody)
	}))
	t.Cleanup(srv.Close)
	return srv, &captured
}

func upstreamField(t *testing.T, raw []byte, key string) (any, bool) {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("upstream body was not JSON: %v (%s)", err, raw)
	}
	v, ok := body[key]
	return v, ok
}

// A completion with no max_tokens must not reach the vendor uncapped.
//
// OpenRouter sizes its credit check on the requested max_tokens, not on what
// the model emits, so an uncapped request is priced against the model's whole
// output window — 64,000 tokens on claude-haiku-4-5. On 2026-08-07 that turned
// a funded-but-modest balance into a 402 on every single desktop background
// run, surfaced as "Bad Gateway" after three SDK retries. The desktop's
// streamText calls set no maxOutputTokens and there is no reason to expect
// every future client to remember, so the gateway supplies the bound.
func TestCompletionWithoutMaxTokensIsCappedUpstream(t *testing.T) {
	_, ctx, h := setup(t, 100000)
	upstream, captured := captureUpstream(t, http.StatusOK, okCompletion)
	h.SetUpstream(upstream.URL)

	req := httptest.NewRequest(http.MethodPost, "/v1/llm/chat/completions",
		strings.NewReader(`{"model":"anthropic/claude-sonnet-4-5","messages":[{"role":"user","content":"hi"}]}`)).WithContext(ctx)
	req.Header.Set("Idempotency-Key", "llm-default-max-tokens")
	rec := httptest.NewRecorder()
	h.ChatCompletions(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	v, ok := upstreamField(t, *captured, "max_tokens")
	if !ok {
		t.Fatal("upstream request carried no max_tokens; the vendor will price it against the full output window")
	}
	n, isNum := v.(float64)
	if !isNum || n <= 0 {
		t.Fatalf("max_tokens = %v, want a positive number", v)
	}
}

// A caller that sets its own cap keeps it. The default is a floor under absent
// configuration, not an override of an explicit one.
func TestCallerMaxTokensIsPreserved(t *testing.T) {
	_, ctx, h := setup(t, 100000)
	upstream, captured := captureUpstream(t, http.StatusOK, okCompletion)
	h.SetUpstream(upstream.URL)

	req := httptest.NewRequest(http.MethodPost, "/v1/llm/chat/completions",
		strings.NewReader(`{"model":"anthropic/claude-sonnet-4-5","max_tokens":64,"messages":[{"role":"user","content":"hi"}]}`)).WithContext(ctx)
	req.Header.Set("Idempotency-Key", "llm-explicit-max-tokens")
	rec := httptest.NewRecorder()
	h.ChatCompletions(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	v, _ := upstreamField(t, *captured, "max_tokens")
	if n, _ := v.(float64); n != 64 {
		t.Fatalf("max_tokens = %v, want the caller's 64", v)
	}
}

// /embeddings shares the same proxy, and an embeddings request has no
// completion to bound — max_tokens is not part of that schema and the vendor
// would reject it.
func TestEmbeddingsAreNotGivenMaxTokens(t *testing.T) {
	_, ctx, h := setup(t, 100000)
	upstream, captured := captureUpstream(t, http.StatusOK,
		`{"data":[{"embedding":[0.1,0.2]}],"usage":{"prompt_tokens":4,"total_tokens":4}}`)
	h.SetUpstream(upstream.URL)

	req := httptest.NewRequest(http.MethodPost, "/v1/llm/embeddings",
		strings.NewReader(`{"model":"openai/text-embedding-3-small","input":["invoice"]}`)).WithContext(ctx)
	req.Header.Set("Idempotency-Key", "llm-embeddings-no-max-tokens")
	rec := httptest.NewRecorder()
	h.Embeddings(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	if _, ok := upstreamField(t, *captured, "max_tokens"); ok {
		t.Fatal("embeddings request was given max_tokens; that field is not in the embeddings schema")
	}
}

// The hold has to cover the ceiling the vendor may bill, not just the prompt.
//
// requestedMaxOutput is 0 for every caller that omits max_tokens, so the
// reservation used to price zero output while the request was free to emit the
// full cap. Settle then debits the real cost and performs no balance check --
// correctly, because the work is already done and must be paid for -- so the
// difference came straight out of a balance nobody had checked. Dogfooding on
// 2026-08-07 finished the day at -948 credits against a 10,000 grant.
//
// Here the completion is billed at 16K x 150/1K = 2,400 credits against a 500
// credit account. Before this, the call was admitted on a ~2 credit hold and
// settled the balance to -1,900.
func TestUncappedCompletionReservesForItsOutputCeiling(t *testing.T) {
	client, ctx, h := setup(t, 500)
	upstream, _ := captureUpstream(t, http.StatusOK, `{
	  "choices": [{"finish_reason":"length","message":{"role":"assistant","content":"..."}}],
	  "usage": {"prompt_tokens": 10, "completion_tokens": 16000, "total_tokens": 16010}
	}`)
	h.SetUpstream(upstream.URL)

	req := httptest.NewRequest(http.MethodPost, "/v1/llm/chat/completions",
		strings.NewReader(`{"model":"anthropic/claude-sonnet-4-5","messages":[{"role":"user","content":"hi"}]}`)).WithContext(ctx)
	req.Header.Set("Idempotency-Key", "llm-uncapped-reservation")
	rec := httptest.NewRecorder()
	h.ChatCompletions(rec, req)

	if rec.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d, want 402 before the vendor is called: %s", rec.Code, rec.Body.String())
	}
	available, err := credits.Available(ctx, client, 500)
	if err != nil {
		t.Fatalf("available: %v", err)
	}
	if available < 0 {
		t.Fatalf("balance went negative (%d): a reservation that under-quotes the request is spent through by Settle", available)
	}
}

// The strict hold applies only where the ceiling is unknown. A caller that
// states its own budget is quoted on that budget, so this does not turn every
// small request into a large reservation -- and gives clients a way to keep
// working on a nearly-empty balance.
func TestCallerSuppliedCapKeepsTheHoldSmall(t *testing.T) {
	_, ctx, h := setup(t, 500)
	upstream, _ := captureUpstream(t, http.StatusOK, okCompletion)
	h.SetUpstream(upstream.URL)

	req := httptest.NewRequest(http.MethodPost, "/v1/llm/chat/completions",
		strings.NewReader(`{"model":"anthropic/claude-sonnet-4-5","max_tokens":64,"messages":[{"role":"user","content":"hi"}]}`)).WithContext(ctx)
	req.Header.Set("Idempotency-Key", "llm-small-cap-small-hold")
	rec := httptest.NewRecorder()
	h.ChatCompletions(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — a 64-token completion is affordable here: %s", rec.Code, rec.Body.String())
	}
}

// Embeddings have no completion to bound, so they must not be quoted for one.
// Reserving 16K of output against an embeddings call would price a ~1 credit
// request in the thousands and lock the memory index out of a healthy account.
func TestEmbeddingsAreNotQuotedForACompletion(t *testing.T) {
	_, ctx, h := setup(t, 500)
	upstream, _ := captureUpstream(t, http.StatusOK,
		`{"data":[{"embedding":[0.1,0.2]}],"usage":{"prompt_tokens":4,"total_tokens":4}}`)
	h.SetUpstream(upstream.URL)

	req := httptest.NewRequest(http.MethodPost, "/v1/llm/embeddings",
		strings.NewReader(`{"model":"openai/text-embedding-3-small","input":["invoice"]}`)).WithContext(ctx)
	req.Header.Set("Idempotency-Key", "llm-embeddings-hold")
	rec := httptest.NewRecorder()
	h.Embeddings(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
}

// A 402 from the vendor means our provider account is out of credits. It used
// to fold into the generic upstream_error, which made an unfunded balance
// indistinguishable from a provider outage: clients saw "Bad Gateway", retried
// three times each, and nothing in the response or the logs named the cause.
// Diagnosing it took a direct probe against the vendor's own credits endpoint.
func TestUpstreamOutOfCreditsIsItsOwnError(t *testing.T) {
	_, ctx, h := setup(t, 100000)
	upstream, _ := captureUpstream(t, http.StatusPaymentRequired,
		`{"error":{"message":"This request requires more credits","code":402}}`)
	h.SetUpstream(upstream.URL)

	req := httptest.NewRequest(http.MethodPost, "/v1/llm/chat/completions",
		strings.NewReader(`{"model":"anthropic/claude-sonnet-4-5","messages":[{"role":"user","content":"hi"}]}`)).WithContext(ctx)
	req.Header.Set("Idempotency-Key", "llm-upstream-402")
	rec := httptest.NewRecorder()
	h.ChatCompletions(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, "upstream_credits_exhausted") {
		t.Errorf("missing the distinct code: %s", body)
	}
	if strings.Contains(body, "upstream_error") {
		t.Errorf("still reported as a generic upstream failure: %s", body)
	}
	// The caller's own balance is fine; nothing here should read as their fault.
	if strings.Contains(body, "insufficient_credits") {
		t.Errorf("an operator funding problem is being blamed on the customer: %s", body)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Error("no Retry-After; clients will hammer a condition only an operator can clear")
	}
}
