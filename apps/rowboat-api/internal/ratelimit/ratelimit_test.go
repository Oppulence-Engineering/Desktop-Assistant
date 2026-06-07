package ratelimit_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/ratelimit"
	"go.uber.org/zap"
)

func TestPerUserLimitsAndRetryAfter(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	m, err := ratelimit.NewManager(ctx, "", false, zap.NewNop()) // in-memory
	if err != nil {
		t.Fatalf("manager: %v", err)
	}

	calls := 0
	h := m.PerUser(ratelimit.GroupLLM, 3)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.WriteHeader(http.StatusOK)
	}))

	do := func() int {
		req := httptest.NewRequest(http.MethodPost, "/v1/llm/chat/completions", nil)
		req.RemoteAddr = "10.0.0.1:1234" // same principal each call
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}

	for i := 0; i < 3; i++ {
		if code := do(); code != http.StatusOK {
			t.Fatalf("call %d: want 200, got %d", i+1, code)
		}
	}
	// 4th within the window → 429.
	req := httptest.NewRequest(http.MethodPost, "/v1/llm/chat/completions", nil)
	req.RemoteAddr = "10.0.0.1:1234"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("4th call: want 429, got %d", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("429 should set Retry-After")
	}
	if calls != 3 {
		t.Fatalf("handler should have run 3 times, ran %d", calls)
	}
}

func TestSeparatePrincipalsHaveSeparateBuckets(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	m, err := ratelimit.NewManager(ctx, "", false, zap.NewNop())
	if err != nil {
		t.Fatalf("manager: %v", err)
	}
	h := m.PerUser(ratelimit.GroupSearch, 1)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	hit := func(addr string) int {
		req := httptest.NewRequest(http.MethodPost, "/v1/search/exa", nil)
		req.RemoteAddr = addr
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	if hit("1.1.1.1:1") != http.StatusOK {
		t.Fatal("principal A first call should pass")
	}
	if hit("2.2.2.2:1") != http.StatusOK {
		t.Fatal("principal B should have its own bucket")
	}
	if hit("1.1.1.1:1") != http.StatusTooManyRequests {
		t.Fatal("principal A second call should be limited")
	}
}
