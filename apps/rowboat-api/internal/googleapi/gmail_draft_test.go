package googleapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCreateDraft(t *testing.T) {
	var gotPath, gotAuth, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		_, _ = w.Write([]byte(`{"id":"draft-1","message":{"id":"m-1"}}`))
	}))
	defer srv.Close()

	c := New(Config{GmailBaseURL: srv.URL})
	id, err := c.CreateDraft(context.Background(), "tok", "x@y.co", "Hi there", "the body text")
	if err != nil {
		t.Fatalf("CreateDraft: %v", err)
	}
	if id != "draft-1" {
		t.Fatalf("draft id = %q", id)
	}
	if gotPath != "/gmail/v1/users/me/drafts" {
		t.Fatalf("path = %q", gotPath)
	}
	if gotAuth != "Bearer tok" {
		t.Fatalf("auth = %q", gotAuth)
	}
	// The body carries {message:{raw: base64url(MIME)}}; decode and check headers.
	var req struct {
		Message struct {
			Raw string `json:"raw"`
		} `json:"message"`
	}
	if err := json.Unmarshal([]byte(gotBody), &req); err != nil {
		t.Fatalf("decode request: %v (%s)", err, gotBody)
	}
	mime, err := base64.URLEncoding.DecodeString(req.Message.Raw)
	if err != nil {
		t.Fatalf("decode raw: %v", err)
	}
	for _, want := range []string{"To: x@y.co", "Subject: Hi there", "the body text"} {
		if !strings.Contains(string(mime), want) {
			t.Fatalf("MIME missing %q:\n%s", want, mime)
		}
	}
}

func TestCreateDraftSanitizesHeaders(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Message struct {
				Raw string `json:"raw"`
			} `json:"message"`
		}
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &req)
		mime, _ := base64.URLEncoding.DecodeString(req.Message.Raw)
		// An injected header must not appear as its own line.
		if strings.Contains(string(mime), "Bcc: attacker@evil.co") && strings.Count(string(mime), "\r\n") > 5 {
			t.Errorf("header injection not sanitized:\n%s", mime)
		}
		_, _ = w.Write([]byte(`{"id":"d"}`))
	}))
	defer srv.Close()
	c := New(Config{GmailBaseURL: srv.URL})
	if _, err := c.CreateDraft(context.Background(), "tok", "x@y.co\r\nBcc: attacker@evil.co", "s", "b"); err != nil {
		t.Fatalf("CreateDraft: %v", err)
	}
}

func TestCreateDraftRequiresRecipient(t *testing.T) {
	c := New(Config{})
	if _, err := c.CreateDraft(context.Background(), "tok", "  ", "s", "b"); err == nil {
		t.Fatal("expected error for empty recipient")
	}
}

func TestCreateDraftEncodesNonASCIIHeaders(t *testing.T) {
	var raw string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Message struct {
				Raw string `json:"raw"`
			} `json:"message"`
		}
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &req)
		mimeBytes, _ := base64.URLEncoding.DecodeString(req.Message.Raw)
		raw = string(mimeBytes)
		_, _ = w.Write([]byte(`{"id":"d"}`))
	}))
	defer srv.Close()
	c := New(Config{GmailBaseURL: srv.URL})
	if _, err := c.CreateDraft(context.Background(), "tok", "Renée <r@x.co>", "Café meeting ☕", "body"); err != nil {
		t.Fatalf("CreateDraft: %v", err)
	}
	// Subject must be an RFC 2047 encoded-word, not raw UTF-8.
	if !strings.Contains(raw, "Subject: =?utf-8?") {
		t.Fatalf("subject not encoded:\n%s", raw)
	}
	if strings.Contains(raw, "Café meeting") {
		t.Fatalf("raw non-ASCII subject leaked into headers:\n%s", raw)
	}
	// The address itself stays intact; the display name is encoded.
	if !strings.Contains(raw, "<r@x.co>") {
		t.Fatalf("address not preserved:\n%s", raw)
	}
}
