package parallel_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/parallel"
)

func testClient(t *testing.T, h http.Handler) *parallel.Client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	c := parallel.New(parallel.Config{
		APIKey:             "test-key",
		BaseURL:            srv.URL,
		ResultPollInterval: time.Millisecond,
		ResultPollAttempts: 5,
	})
	if c == nil {
		t.Fatal("client with an API key must not be nil")
	}
	return c
}

func personTask() parallel.TaskRequest {
	return parallel.TaskRequest{
		Input:     map[string]any{"name": "Sarah Chen", "email_domain": "acme.com"},
		Processor: parallel.ProcessorBase,
		OutputSchema: map[string]any{
			"type":       "object",
			"properties": map[string]any{"title": map[string]any{"type": "string"}},
		},
	}
}

func TestNewWithoutKeyIsNil(t *testing.T) {
	if c := parallel.New(parallel.Config{APIKey: "  "}); c != nil {
		t.Fatal("a blank API key must not produce a usable client")
	}
	var c *parallel.Client
	if c.Configured() {
		t.Fatal("nil client reported itself configured")
	}
	if _, err := c.RunTask(context.Background(), personTask()); !errors.Is(err, parallel.ErrNotConfigured) {
		t.Fatalf("nil client: want ErrNotConfigured, got %v", err)
	}
}

func TestRunTaskReturnsBasisWithCitations(t *testing.T) {
	var createBody map[string]any
	var sawAPIKey string
	c := testClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawAPIKey = r.Header.Get("x-api-key")
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/tasks/runs":
			_ = json.NewDecoder(r.Body).Decode(&createBody)
			_ = json.NewEncoder(w).Encode(map[string]any{"run_id": "run_1", "status": "queued"})
		case "/v1/tasks/runs/run_1/result":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"run": map[string]any{"run_id": "run_1", "status": "completed"},
				"output": map[string]any{
					"content": map[string]any{"title": "VP Engineering"},
					"basis": []map[string]any{{
						"field":      "title",
						"confidence": "high",
						"reasoning":  "listed on the company leadership page",
						"citations": []map[string]any{{
							"title":    "Leadership — Acme",
							"url":      "https://acme.com/team",
							"excerpts": []string{"Sarah Chen, VP Engineering"},
						}},
					}},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))

	result, err := c.RunTask(context.Background(), personTask())
	if err != nil {
		t.Fatalf("RunTask: %v", err)
	}
	if sawAPIKey != "test-key" {
		t.Fatalf("API key header = %q", sawAPIKey)
	}
	if createBody["processor"] != parallel.ProcessorBase {
		t.Fatalf("processor not forwarded: %v", createBody["processor"])
	}
	if result.Content["title"] != "VP Engineering" {
		t.Fatalf("content = %v", result.Content)
	}
	basis, ok := result.BasisFor("title")
	if !ok {
		t.Fatal("no basis for title")
	}
	if len(basis.Citations) != 1 || basis.Citations[0].URL != "https://acme.com/team" {
		t.Fatalf("citations = %+v", basis.Citations)
	}
	if len(basis.Citations[0].Excerpts) != 1 {
		t.Fatalf("excerpts = %+v", basis.Citations[0].Excerpts)
	}
	if _, ok := result.BasisFor("seniority"); ok {
		t.Fatal("BasisFor invented evidence for a field the vendor did not return")
	}
}

// A run that is still executing when the result read returns is polled, not
// treated as an answer. Reading an incomplete run as complete would store an
// empty enrichment and bill for it.
func TestRunTaskPollsUntilCompleted(t *testing.T) {
	reads := 0
	c := testClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/tasks/runs" {
			_ = json.NewEncoder(w).Encode(map[string]any{"run_id": "run_2"})
			return
		}
		reads++
		status := "running"
		if reads >= 3 {
			status = "completed"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"run":    map[string]any{"run_id": "run_2", "status": status},
			"output": map[string]any{"content": map[string]any{"title": "CTO"}},
		})
	}))

	result, err := c.RunTask(context.Background(), personTask())
	if err != nil {
		t.Fatalf("RunTask: %v", err)
	}
	if reads != 3 {
		t.Fatalf("polled %d times, want 3", reads)
	}
	if result.Content["title"] != "CTO" {
		t.Fatalf("content = %v", result.Content)
	}
}

func TestRunTaskFailedRun(t *testing.T) {
	c := testClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/tasks/runs" {
			_ = json.NewEncoder(w).Encode(map[string]any{"run_id": "run_3"})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"run": map[string]any{"run_id": "run_3", "status": "failed"},
		})
	}))

	if _, err := c.RunTask(context.Background(), personTask()); !errors.Is(err, parallel.ErrRunFailed) {
		t.Fatalf("failed run: want ErrRunFailed, got %v", err)
	}
}

// The vendor's error bodies echo the input, which is a counterparty's name and
// domain. Callers log errors, so the error text must carry the status and
// nothing else.
func TestUpstreamErrorDoesNotLeakBody(t *testing.T) {
	c := testClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"bad input for Sarah Chen at acme.com"}`, http.StatusBadRequest)
	}))

	_, err := c.RunTask(context.Background(), personTask())
	if err == nil {
		t.Fatal("want an error")
	}
	if got := err.Error(); strings.Contains(got, "Sarah Chen") || strings.Contains(got, "acme.com") {
		t.Fatalf("error leaked the request subject: %q", got)
	}
}

func TestUnsupportedProcessorIsRefusedBeforeCalling(t *testing.T) {
	called := false
	c := testClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	}))
	req := personTask()
	req.Processor = "ultra"
	if _, err := c.RunTask(context.Background(), req); err == nil {
		t.Fatal("want an error for an unknown processor")
	}
	if called {
		t.Fatal("an unknown processor reached the vendor")
	}
}
