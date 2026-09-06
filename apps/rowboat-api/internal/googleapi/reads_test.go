package googleapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func mockGoogleReads(t *testing.T) (*Client, *httptest.Server) {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/gmail/v1/users/me/messages", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("q") != "from:acme.com" || r.URL.Query().Get("maxResults") != "2" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"messages": []map[string]string{
				{"id": "m1", "threadId": "t1"},
				{"id": "m2", "threadId": "t2"},
			},
		})
	})
	mux.HandleFunc("/gmail/v1/users/me/messages/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("format") != "metadata" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		id := strings.TrimPrefix(r.URL.Path, "/gmail/v1/users/me/messages/")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": id, "threadId": "t-" + id, "snippet": "We dispute line 3...",
			"payload": map[string]any{"headers": []map[string]string{
				{"name": "From", "value": "ap@acme.com"},
				{"name": "Subject", "value": "Invoice #4821"},
				{"name": "Date", "value": "Fri, 06 Jun 2026 14:00:00 +0000"},
			}},
		})
	})
	mux.HandleFunc("/calendars/primary/events", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("singleEvents") != "true" || q.Get("orderBy") != "startTime" || q.Get("timeMin") == "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"items": []map[string]any{{
				"id": "evt_1", "summary": "Acme QBR",
				"start":     map[string]string{"dateTime": "2026-06-08T17:00:00Z"},
				"end":       map[string]string{"dateTime": "2026-06-08T18:00:00Z"},
				"attendees": []map[string]string{{"email": "champion@acme.com"}},
			}, {
				"id": "evt_2", "summary": "All-day",
				"start": map[string]string{"date": "2026-06-09"},
				"end":   map[string]string{"date": "2026-06-10"},
			}},
		})
	})
	mux.HandleFunc("/files", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("q") != "name contains 'invoice'" || q.Get("pageSize") != "2" || q.Get("orderBy") != "modifiedTime desc" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"files": []map[string]any{{
				"id": "file_1", "name": "Invoice 4821.pdf", "mimeType": "application/pdf",
				"modifiedTime": "2026-06-08T17:00:00Z",
				"webViewLink":  "https://drive.google.com/file/d/file_1/view",
				"owners":       []map[string]string{{"emailAddress": "owner@acme.com"}},
			}},
		})
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return New(Config{GmailBaseURL: srv.URL, CalendarBaseURL: srv.URL, DriveBaseURL: srv.URL}), srv
}

func TestListMessages(t *testing.T) {
	c, _ := mockGoogleReads(t)
	msgs, err := c.ListMessages(context.Background(), "tok", "from:acme.com", 2)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(msgs) != 2 {
		t.Fatalf("messages = %d, want 2", len(msgs))
	}
	m := msgs[0]
	if m.ID != "m1" || m.From != "ap@acme.com" || m.Subject != "Invoice #4821" || m.Snippet == "" || m.ReceivedAt == "" {
		t.Fatalf("message = %+v", m)
	}
}

func TestListMessagesClampsLimit(t *testing.T) {
	c := New(Config{GmailBaseURL: httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("maxResults") != "10" {
			t.Errorf("maxResults = %s, want clamp to 10", r.URL.Query().Get("maxResults"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"messages": []any{}})
	})).URL})
	if _, err := c.ListMessages(context.Background(), "tok", "", 500); err != nil {
		t.Fatalf("list: %v", err)
	}
}

func TestGoogleAPIErrorIncludesProviderMessage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":{"message":"Quota exceeded for quota metric."}}`))
	}))
	defer srv.Close()

	c := New(Config{GmailBaseURL: srv.URL})
	_, err := c.ListMessages(context.Background(), "tok", "", 1)
	if err == nil || !strings.Contains(err.Error(), "Quota exceeded for quota metric.") {
		t.Fatalf("error = %v, want provider detail", err)
	}
}

func TestListEvents(t *testing.T) {
	c, _ := mockGoogleReads(t)
	events, err := c.ListEvents(context.Background(), "tok", CalendarQuery{
		TimeMin: "2026-06-06T00:00:00Z",
		TimeMax: "2026-06-13T00:00:00Z",
		Text:    "Acme",
		Limit:   10,
	})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("events = %d, want 2", len(events))
	}
	if events[0].Summary != "Acme QBR" || events[0].StartsAt != "2026-06-08T17:00:00Z" || len(events[0].Attendees) != 1 {
		t.Fatalf("event = %+v", events[0])
	}
	// All-day events fall back to the date field.
	if events[1].StartsAt != "2026-06-09" {
		t.Fatalf("all-day start = %q", events[1].StartsAt)
	}
}

func TestListDriveFiles(t *testing.T) {
	c, _ := mockGoogleReads(t)
	files, err := c.ListDriveFiles(context.Background(), "tok", "name contains 'invoice'", 2)
	if err != nil {
		t.Fatalf("list drive: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("files = %d, want 1", len(files))
	}
	f := files[0]
	if f.ID != "file_1" || f.Name != "Invoice 4821.pdf" || f.MIMEType != "application/pdf" || f.WebViewLink == "" || len(f.Owners) != 1 {
		t.Fatalf("file = %+v", f)
	}
}
