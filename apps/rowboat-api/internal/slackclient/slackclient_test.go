package slackclient

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

func TestPostMessageSuccess(t *testing.T) {
	var gotPath, gotAuth, gotBody, gotContentType string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		gotContentType = r.Header.Get("Content-Type")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	c := New(outbound.Policy{})
	c.SetBaseURL(srv.URL)

	if err := c.PostMessage(context.Background(), "xoxb-123", "C1", "1700000000.000100", "hello world"); err != nil {
		t.Fatalf("PostMessage: %v", err)
	}
	if gotPath != "/chat.postMessage" {
		t.Fatalf("path = %q", gotPath)
	}
	if gotAuth != "Bearer xoxb-123" {
		t.Fatalf("Authorization = %q", gotAuth)
	}
	if !strings.HasPrefix(gotContentType, "application/json") {
		t.Fatalf("Content-Type = %q", gotContentType)
	}
	for _, want := range []string{`"channel":"C1"`, `"text":"hello world"`, `"thread_ts":"1700000000.000100"`} {
		if !strings.Contains(gotBody, want) {
			t.Fatalf("body %q missing %q", gotBody, want)
		}
	}
}

func TestPostMessageOmitsThreadWhenEmpty(t *testing.T) {
	var gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	c := New(outbound.Policy{})
	c.SetBaseURL(srv.URL)
	if err := c.PostMessage(context.Background(), "xoxb-1", "C1", "", "hi"); err != nil {
		t.Fatalf("PostMessage: %v", err)
	}
	if strings.Contains(gotBody, "thread_ts") {
		t.Fatalf("body %q should not carry thread_ts", gotBody)
	}
}

func TestPostMessageSlackLogicalError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		// Slack signals logical failures with HTTP 200 + ok:false.
		_, _ = w.Write([]byte(`{"ok":false,"error":"missing_scope"}`))
	}))
	defer srv.Close()

	c := New(outbound.Policy{})
	c.SetBaseURL(srv.URL)
	err := c.PostMessage(context.Background(), "xoxb-1", "C1", "", "hi")
	if err == nil || !strings.Contains(err.Error(), "missing_scope") {
		t.Fatalf("expected missing_scope error, got %v", err)
	}
}

func TestPostMessageValidation(t *testing.T) {
	c := New(outbound.Policy{})
	if err := c.PostMessage(context.Background(), "", "C1", "", "hi"); err == nil {
		t.Fatal("expected error for missing bot token")
	}
	if err := c.PostMessage(context.Background(), "tok", "", "", "hi"); err == nil {
		t.Fatal("expected error for missing channel")
	}
}

func TestReadThread(t *testing.T) {
	var gotPath, gotQuery, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		gotAuth = r.Header.Get("Authorization")
		_, _ = w.Write([]byte(`{"ok":true,"messages":[{"user":"U1","text":"first","ts":"1.1"},{"user":"U2","text":"second","ts":"1.2"}]}`))
	}))
	defer srv.Close()

	c := New(outbound.Policy{})
	c.SetBaseURL(srv.URL)
	msgs, err := c.ReadThread(context.Background(), "xoxb-1", "C1", "1700000000.000100", 0)
	if err != nil {
		t.Fatalf("ReadThread: %v", err)
	}
	if gotPath != "/conversations.replies" {
		t.Fatalf("path = %q", gotPath)
	}
	if gotAuth != "Bearer xoxb-1" {
		t.Fatalf("auth = %q", gotAuth)
	}
	for _, want := range []string{"channel=C1", "ts=1700000000.000100", "limit=50"} {
		if !strings.Contains(gotQuery, want) {
			t.Fatalf("query %q missing %q", gotQuery, want)
		}
	}
	if len(msgs) != 2 || msgs[0].Text != "first" || msgs[1].User != "U2" {
		t.Fatalf("messages = %+v", msgs)
	}
}

func TestReadThreadError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"ok":false,"error":"channel_not_found"}`))
	}))
	defer srv.Close()
	c := New(outbound.Policy{})
	c.SetBaseURL(srv.URL)
	if _, err := c.ReadThread(context.Background(), "xoxb-1", "C1", "1.1", 0); err == nil || !strings.Contains(err.Error(), "channel_not_found") {
		t.Fatalf("expected channel_not_found error, got %v", err)
	}
}

func TestPostApprovalRequest(t *testing.T) {
	var gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat.postMessage" {
			http.NotFound(w, r)
			return
		}
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	c := New(outbound.Policy{})
	c.SetBaseURL(srv.URL)
	if err := c.PostApprovalRequest(context.Background(), "xoxb-1", "C1", "1.1", "Approval needed", "appr-1", "sess-1", "user-1", "U7REQ"); err != nil {
		t.Fatalf("PostApprovalRequest: %v", err)
	}
	// The button value is an escaped JSON string inside the payload; assert on
	// fragments that survive escaping.
	for _, want := range []string{ActionApprove, ActionDeny, "appr-1", "sess-1", "user-1", "granted", "denied", "U7REQ", `"thread_ts":"1.1"`} {
		if !strings.Contains(gotBody, want) {
			t.Fatalf("approval body missing %q\nbody: %s", want, gotBody)
		}
	}
}

func TestRespondURL(t *testing.T) {
	var gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		_, _ = w.Write([]byte("ok"))
	}))
	defer srv.Close()
	c := New(outbound.Policy{})
	if err := c.RespondURL(context.Background(), srv.URL, map[string]any{"replace_original": true, "text": "done"}); err != nil {
		t.Fatalf("RespondURL: %v", err)
	}
	if !strings.Contains(gotBody, `"replace_original":true`) || !strings.Contains(gotBody, `"text":"done"`) {
		t.Fatalf("response_url body = %s", gotBody)
	}
}

func TestParseChannelKey(t *testing.T) {
	cases := []struct {
		in                    string
		team, channel, thread string
		ok                    bool
	}{
		{"slack:T123:C456:1700000000.000100", "T123", "C456", "1700000000.000100", true},
		{"slack:T1:C1:", "", "", "", false},
		{"slack:T1:C1", "", "", "", false},
		{"http:T1:C1:ts", "", "", "", false},
		{"", "", "", "", false},
	}
	for _, c := range cases {
		team, channel, thread, ok := ParseChannelKey(c.in)
		if ok != c.ok || team != c.team || channel != c.channel || thread != c.thread {
			t.Fatalf("ParseChannelKey(%q) = (%q,%q,%q,%v), want (%q,%q,%q,%v)",
				c.in, team, channel, thread, ok, c.team, c.channel, c.thread, c.ok)
		}
	}
}
