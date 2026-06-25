package faculties

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

func TestNewNilWhenUnconfigured(t *testing.T) {
	if New("conduit", "", "k", outbound.Policy{}) != nil {
		t.Fatal("New must be nil without a base URL")
	}
	if New("conduit", "https://x", "", outbound.Policy{}) != nil {
		t.Fatal("New must be nil without an API key")
	}
}

func TestCall(t *testing.T) {
	var gotPath, gotAuth, gotUser, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		gotUser = r.Header.Get("X-Rowboat-User")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		_, _ = w.Write([]byte(`{"threads":[{"id":"t1"}]}`))
	}))
	defer srv.Close()

	c := New("conduit", srv.URL, "svc-key", outbound.Policy{})
	out, err := c.Call(context.Background(), "user-9", "/v1/query", map[string]any{"operation": "disputes_open"})
	if err != nil {
		t.Fatalf("Call: %v", err)
	}
	if gotPath != "/v1/query" {
		t.Fatalf("path = %q", gotPath)
	}
	if gotAuth != "Bearer svc-key" {
		t.Fatalf("auth = %q", gotAuth)
	}
	if gotUser != "user-9" {
		t.Fatalf("on-behalf-of header = %q", gotUser)
	}
	if !strings.Contains(gotBody, `"operation":"disputes_open"`) {
		t.Fatalf("body = %s", gotBody)
	}
	if !strings.Contains(string(out), `"threads"`) {
		t.Fatalf("response passthrough = %s", out)
	}
}

func TestCallNonJSONWrapped(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`plain text body`))
	}))
	defer srv.Close()
	c := New("eigen", srv.URL, "k", outbound.Policy{})
	out, err := c.Call(context.Background(), "u", "/v1/simulate", map[string]any{"scenario": "runway"})
	if err != nil {
		t.Fatalf("Call: %v", err)
	}
	if !strings.Contains(string(out), `"raw":"plain text body"`) {
		t.Fatalf("non-JSON body should be wrapped, got %s", out)
	}
}

func TestCallErrorStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()
	c := New("conduit", srv.URL, "k", outbound.Policy{})
	if _, err := c.Call(context.Background(), "u", "/v1/query", nil); err == nil {
		t.Fatal("expected error on non-2xx status")
	}
}
