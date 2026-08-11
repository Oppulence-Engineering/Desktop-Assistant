package main

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func gmailServer(t *testing.T) *httptest.Server {
	t.Helper()
	// Reset the package-level store so mutations from one test cannot decide
	// the outcome of another.
	gmail = newGmailStore()
	mux := http.NewServeMux()
	registerGmailMock(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func getJSON(t *testing.T, srv *httptest.Server, path string) map[string]any {
	t.Helper()
	res, err := srv.Client().Get(srv.URL + path)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("GET %s: status %d", path, res.StatusCode)
	}
	var out map[string]any
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatalf("GET %s: decode: %v", path, err)
	}
	return out
}

func threadIDs(t *testing.T, body map[string]any) []string {
	t.Helper()
	raw, _ := body["threads"].([]any)
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		m, ok := item.(map[string]any)
		if !ok {
			t.Fatalf("thread entry is not an object: %T", item)
		}
		out = append(out, m["id"].(string))
	}
	return out
}

// ensureGmailAccount bails when the profile has no email, which is what made
// every mailbox feature report "No connected mailbox account" locally.
func TestProfileReturnsAnEmailAddress(t *testing.T) {
	srv := gmailServer(t)
	body := getJSON(t, srv, "/gmail/v1/users/me/profile")
	if body["emailAddress"] != gmailMockUser {
		t.Fatalf("emailAddress = %v, want %q", body["emailAddress"], gmailMockUser)
	}
	if body["historyId"] == nil {
		t.Fatal("profile must carry a historyId; sync stores it as the sync cursor")
	}
}

func TestThreadsListFiltersSpamAndTrash(t *testing.T) {
	srv := gmailServer(t)
	ids := threadIDs(t, getJSON(t, srv,
		"/gmail/v1/users/me/threads?q="+
			"after%3A2000%2F01%2F01+-in%3Aspam+-in%3Atrash"))
	for _, id := range ids {
		if id == "t_spam" {
			t.Fatal("a -in:spam query returned the SPAM thread")
		}
	}
	if len(ids) == 0 {
		t.Fatal("no threads matched a wide-open after: window")
	}
}

func TestThreadsListHonoursInboxLabel(t *testing.T) {
	srv := gmailServer(t)
	ids := threadIDs(t, getJSON(t, srv, "/gmail/v1/users/me/threads?labelIds=INBOX"))
	for _, id := range ids {
		if id == "t_archived" {
			t.Fatal("labelIds=INBOX returned a thread with no INBOX label")
		}
	}
	if len(ids) == 0 {
		t.Fatal("labelIds=INBOX matched nothing")
	}
}

// An unimplemented operator must fail loudly. Silently ignoring it would return
// a superset and let a broken filter pass as working.
func TestUnsupportedQueryTermIsRejected(t *testing.T) {
	srv := gmailServer(t)
	res, err := srv.Client().Get(srv.URL + "/gmail/v1/users/me/threads?q=from%3Aboss%40example.com")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	_ = res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for an unimplemented query term", res.StatusCode)
	}
}

func TestThreadGetReturnsDecodableBodyAndHeaders(t *testing.T) {
	srv := gmailServer(t)
	body := getJSON(t, srv, "/gmail/v1/users/me/threads/t_renewal")

	msgs, _ := body["messages"].([]any)
	if len(msgs) != 2 {
		t.Fatalf("message count = %d, want 2", len(msgs))
	}
	first := msgs[0].(map[string]any)
	payload := first["payload"].(map[string]any)

	headers := map[string]string{}
	for _, h := range payload["headers"].([]any) {
		hm := h.(map[string]any)
		headers[hm["name"].(string)] = hm["value"].(string)
	}
	for _, want := range []string{"From", "To", "Subject", "Date"} {
		if headers[want] == "" {
			t.Fatalf("missing %s header; the thread reader reads all four", want)
		}
	}

	data := payload["body"].(map[string]any)["data"].(string)
	decoded, err := base64.URLEncoding.WithPadding(base64.NoPadding).DecodeString(data)
	if err != nil {
		t.Fatalf("body data is not base64url: %v", err)
	}
	if !strings.Contains(string(decoded), "40-seat tier") {
		t.Fatalf("decoded body did not round-trip: %q", decoded)
	}
}

// Archiving must actually change what the next listing returns. A mock that
// returns 200 and mutates nothing would let a broken archive ship.
func TestModifyRemovingInboxArchivesTheThread(t *testing.T) {
	srv := gmailServer(t)

	before := threadIDs(t, getJSON(t, srv, "/gmail/v1/users/me/threads?labelIds=INBOX"))
	if !contains(before, "t_soc2") {
		t.Fatal("fixture thread is not in the inbox to begin with")
	}

	res, err := srv.Client().Post(
		srv.URL+"/gmail/v1/users/me/threads/t_soc2/modify",
		"application/json",
		strings.NewReader(`{"removeLabelIds":["INBOX"]}`),
	)
	if err != nil {
		t.Fatalf("modify: %v", err)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("modify status = %d", res.StatusCode)
	}

	after := threadIDs(t, getJSON(t, srv, "/gmail/v1/users/me/threads?labelIds=INBOX"))
	if contains(after, "t_soc2") {
		t.Fatal("thread still listed under INBOX after the label was removed")
	}
}

func TestModifyUnknownThreadIs404(t *testing.T) {
	srv := gmailServer(t)
	res, err := srv.Client().Post(
		srv.URL+"/gmail/v1/users/me/threads/does_not_exist/modify",
		"application/json",
		strings.NewReader(`{"removeLabelIds":["INBOX"]}`),
	)
	if err != nil {
		t.Fatalf("modify: %v", err)
	}
	_ = res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", res.StatusCode)
	}
}

func TestSendRejectsMalformedRawAndAcceptsValid(t *testing.T) {
	srv := gmailServer(t)

	bad, err := srv.Client().Post(srv.URL+"/gmail/v1/users/me/messages/send",
		"application/json", strings.NewReader(`{"raw":"not-base64!!"}`))
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	_ = bad.Body.Close()
	if bad.StatusCode != http.StatusBadRequest {
		t.Fatalf("malformed raw: status = %d, want 400", bad.StatusCode)
	}

	raw := base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString(
		[]byte("To: dana@northwind.example\r\nSubject: Re: renewal\r\n\r\nSending today."))
	payload, _ := json.Marshal(map[string]string{"raw": raw, "threadId": "t_renewal"})
	good, err := srv.Client().Post(srv.URL+"/gmail/v1/users/me/messages/send",
		"application/json", strings.NewReader(string(payload)))
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	defer func() { _ = good.Body.Close() }()
	if good.StatusCode != http.StatusOK {
		t.Fatalf("valid send: status = %d", good.StatusCode)
	}
	var out map[string]any
	_ = json.NewDecoder(good.Body).Decode(&out)
	if out["threadId"] != "t_renewal" {
		t.Fatalf("threadId not echoed: %v", out["threadId"])
	}
}

func contains(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}
