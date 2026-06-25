package websearch

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

func TestNewNilWithoutKey(t *testing.T) {
	if New("https://x", "", outbound.Policy{}) != nil {
		t.Fatal("New must return nil when no API key is configured")
	}
}

func TestSearch(t *testing.T) {
	var gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		_, _ = w.Write([]byte(`{"results":[{"title":"A","url":"https://a","content":"alpha"},{"title":"B","url":"https://b","content":"beta"}]}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "key-1", outbound.Policy{})
	if c == nil {
		t.Fatal("New returned nil with a key")
	}
	res, err := c.Search(context.Background(), "rowboat cloudtag", 2)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(res) != 2 || res[0].Title != "A" || res[1].URL != "https://b" {
		t.Fatalf("results = %+v", res)
	}
	for _, want := range []string{`"query":"rowboat cloudtag"`, `"max_results":2`, `"api_key":"key-1"`} {
		if !strings.Contains(gotBody, want) {
			t.Fatalf("request body %q missing %q", gotBody, want)
		}
	}
}

func TestSearchClampsMaxResults(t *testing.T) {
	var gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		_, _ = w.Write([]byte(`{"results":[]}`))
	}))
	defer srv.Close()
	c := New(srv.URL, "k", outbound.Policy{})
	if _, err := c.Search(context.Background(), "q", 999); err != nil {
		t.Fatalf("Search: %v", err)
	}
	if !strings.Contains(gotBody, `"max_results":5`) {
		t.Fatalf("expected clamp to default 5, body: %s", gotBody)
	}
}

func TestSearchProviderError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()
	c := New(srv.URL, "k", outbound.Policy{})
	if _, err := c.Search(context.Background(), "q", 3); err == nil {
		t.Fatal("expected error on non-200 provider response")
	}
}
