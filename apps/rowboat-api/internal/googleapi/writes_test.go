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

func TestSendMessage(t *testing.T) {
	var gotMethod, gotPath, gotAuth string
	var rawMessage string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		var req struct {
			Raw string `json:"raw"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("decode request: %v", err)
		}
		mimeBytes, err := base64.URLEncoding.DecodeString(req.Raw)
		if err != nil {
			t.Errorf("decode raw: %v", err)
		}
		rawMessage = string(mimeBytes)
		_, _ = w.Write([]byte(`{"id":"msg-1","threadId":"thr-1"}`))
	}))
	defer srv.Close()

	c := New(Config{GmailBaseURL: srv.URL})
	id, err := c.SendMessage(context.Background(), "tok", "x@y.co", "Hi", "body text")
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}
	if id != "msg-1" {
		t.Fatalf("message id = %q", id)
	}
	if gotMethod != http.MethodPost || gotPath != "/gmail/v1/users/me/messages/send" {
		t.Fatalf("method/path = %s %s", gotMethod, gotPath)
	}
	if gotAuth != "Bearer tok" {
		t.Fatalf("auth = %q", gotAuth)
	}
	for _, want := range []string{"To: x@y.co", "Subject: Hi", "body text"} {
		if !strings.Contains(rawMessage, want) {
			t.Fatalf("raw MIME missing %q:\n%s", want, rawMessage)
		}
	}
}

func TestCreateAndUpdateEvent(t *testing.T) {
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		got = append(got, r.Method+" "+r.URL.Path+" "+string(body))
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/calendars/primary/events":
			_, _ = w.Write([]byte(`{"id":"evt_1","summary":"Kickoff","htmlLink":"https://calendar/evt_1","start":{"dateTime":"2026-06-27T15:00:00Z"},"end":{"dateTime":"2026-06-27T15:30:00Z"},"attendees":[{"email":"a@example.com"}]}`))
		case r.Method == http.MethodPut && r.URL.Path == "/calendars/primary/events/evt_1":
			_, _ = w.Write([]byte(`{"id":"evt_1","summary":"Updated","start":{"dateTime":"2026-06-27T16:00:00Z"},"end":{"dateTime":"2026-06-27T16:30:00Z"}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	c := New(Config{CalendarBaseURL: srv.URL})
	created, err := c.CreateEvent(context.Background(), "tok", CalendarEventMutation{
		Summary:   "Kickoff",
		Start:     "2026-06-27T15:00:00Z",
		End:       "2026-06-27T15:30:00Z",
		TimeZone:  "America/New_York",
		Attendees: []string{"a@example.com"},
	})
	if err != nil {
		t.Fatalf("CreateEvent: %v", err)
	}
	if created.ID != "evt_1" || created.HTMLLink == "" || len(created.Attendees) != 1 {
		t.Fatalf("created = %+v", created)
	}
	updated, err := c.UpdateEvent(context.Background(), "tok", "evt_1", CalendarEventMutation{
		Summary: "Updated",
		Start:   "2026-06-27T16:00:00Z",
		End:     "2026-06-27T16:30:00Z",
	})
	if err != nil {
		t.Fatalf("UpdateEvent: %v", err)
	}
	if updated.Summary != "Updated" || updated.StartsAt != "2026-06-27T16:00:00Z" {
		t.Fatalf("updated = %+v", updated)
	}
	if len(got) != 2 || !strings.Contains(got[0], `"timeZone":"America/New_York"`) || !strings.Contains(got[1], `"summary":"Updated"`) {
		t.Fatalf("requests = %#v", got)
	}
}

func TestUpdateDriveFileMetadata(t *testing.T) {
	var gotMethod, gotPath, gotBody, gotFields string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotFields = r.URL.Query().Get("fields")
		body, _ := io.ReadAll(r.Body)
		gotBody = string(body)
		_, _ = w.Write([]byte(`{"id":"file_1","name":"Plan","mimeType":"text/plain","webViewLink":"https://drive/file_1"}`))
	}))
	defer srv.Close()

	c := New(Config{DriveBaseURL: srv.URL})
	file, err := c.UpdateDriveFileMetadata(context.Background(), "tok", "file_1", DriveFileMutation{
		Name:        "Plan",
		Description: "Updated plan",
	})
	if err != nil {
		t.Fatalf("UpdateDriveFileMetadata: %v", err)
	}
	if file.ID != "file_1" || file.Name != "Plan" {
		t.Fatalf("file = %+v", file)
	}
	if gotMethod != http.MethodPatch || gotPath != "/files/file_1" {
		t.Fatalf("method/path = %s %s", gotMethod, gotPath)
	}
	if gotFields == "" || !strings.Contains(gotBody, `"description":"Updated plan"`) {
		t.Fatalf("fields/body = %q %s", gotFields, gotBody)
	}
}

func TestReplaceDriveFileTextContent(t *testing.T) {
	var gotMethod, gotPath, gotUploadType, gotContentType, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotUploadType = r.URL.Query().Get("uploadType")
		gotContentType = r.Header.Get("Content-Type")
		body, _ := io.ReadAll(r.Body)
		gotBody = string(body)
		_, _ = w.Write([]byte(`{"id":"file_1","name":"Plan.txt","mimeType":"text/plain"}`))
	}))
	defer srv.Close()

	c := New(Config{DriveBaseURL: srv.URL})
	file, err := c.ReplaceDriveFileTextContent(context.Background(), "tok", "file_1", DriveFileMutation{
		Name:     "Plan.txt",
		MIMEType: "text/plain",
		Content:  "replacement content",
	})
	if err != nil {
		t.Fatalf("ReplaceDriveFileTextContent: %v", err)
	}
	if file.ID != "file_1" || file.Name != "Plan.txt" {
		t.Fatalf("file = %+v", file)
	}
	if gotMethod != http.MethodPatch || gotPath != "/upload/files/file_1" || gotUploadType != "multipart" {
		t.Fatalf("method/path/uploadType = %s %s %s", gotMethod, gotPath, gotUploadType)
	}
	if !strings.Contains(gotContentType, "multipart/related") ||
		!strings.Contains(gotBody, `"name":"Plan.txt"`) ||
		!strings.Contains(gotBody, "replacement content") {
		t.Fatalf("content type/body = %q\n%s", gotContentType, gotBody)
	}
}
