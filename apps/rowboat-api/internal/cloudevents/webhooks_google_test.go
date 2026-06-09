package cloudevents

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

func newWebhookServer(t *testing.T, h *Handler) *httptest.Server {
	t.Helper()
	r := chi.NewRouter()
	r.Post("/v1/webhooks/google", h.GoogleWebhook)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

func connectGoogle(t *testing.T, client *ent.Client, u *ent.User, email string) {
	t.Helper()
	client.OAuthConnection.Create().
		SetUser(u).
		SetProvider("google").
		SetRefreshTokenEncrypted([]byte("sealed")).
		SetExternalAccountID(email).
		SaveX(context.Background())
}

func gmailPushBody(t *testing.T, email string, historyID uint64) string {
	t.Helper()
	note, _ := json.Marshal(map[string]any{"emailAddress": email, "historyId": historyID})
	env, _ := json.Marshal(map[string]any{
		"message":      map[string]any{"data": base64.StdEncoding.EncodeToString(note), "messageId": "m1"},
		"subscription": "projects/x/subscriptions/y",
	})
	return string(env)
}

func TestGoogleWebhookTokenVerification(t *testing.T) {
	client, u := setup(t)
	connectGoogle(t, client, u, "me@gmail.com")
	h := New(client, testSealer(t), &fakeRouteController{}, Config{MaxPayloadBytes: 1 << 20, GoogleWebhookToken: "tok-1"}, zap.NewNop())
	srv := newWebhookServer(t, h)
	body := gmailPushBody(t, "me@gmail.com", 998877)

	// Wrong token → 401.
	resp, _ := http.Post(srv.URL+"/v1/webhooks/google?token=wrong", "application/json", strings.NewReader(body))
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong token: %d, want 401", resp.StatusCode)
	}
	// Missing token → 401.
	resp, _ = http.Post(srv.URL+"/v1/webhooks/google", "application/json", strings.NewReader(body))
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("missing token: %d, want 401", resp.StatusCode)
	}
	// Correct token → 202 with a stored event.
	resp, _ = http.Post(srv.URL+"/v1/webhooks/google?token=tok-1", "application/json", strings.NewReader(body))
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("valid token: %d, want 202", resp.StatusCode)
	}

	ev := client.CloudEvent.Query().OnlyX(auth.WithInternal(context.Background()))
	if ev.Source != SourceGmail || ev.DedupeKey != "gmail:history:me@gmail.com:998877" {
		t.Fatalf("event = %s/%s, want gmail dedupe key", ev.Source, ev.DedupeKey)
	}
}

func TestGoogleWebhookFailsClosedWithoutSecret(t *testing.T) {
	client, _ := setup(t)
	h := New(client, testSealer(t), nil, Config{MaxPayloadBytes: 1 << 20}, zap.NewNop())
	srv := newWebhookServer(t, h)

	resp, _ := http.Post(srv.URL+"/v1/webhooks/google?token=anything", "application/json", strings.NewReader("{}"))
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("unconfigured secret: %d, want 500 (fail closed)", resp.StatusCode)
	}
}

func TestGoogleWebhookUnresolvedUserDropped(t *testing.T) {
	client, _ := setup(t)
	h := New(client, testSealer(t), &fakeRouteController{}, Config{MaxPayloadBytes: 1 << 20, GoogleWebhookToken: "tok-1"}, zap.NewNop())
	srv := newWebhookServer(t, h)

	resp, _ := http.Post(srv.URL+"/v1/webhooks/google?token=tok-1", "application/json",
		strings.NewReader(gmailPushBody(t, "stranger@gmail.com", 1)))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("unresolved account: %d, want 200 (ack, stop retries)", resp.StatusCode)
	}
	if n := client.CloudEvent.Query().CountX(auth.WithInternal(context.Background())); n != 0 {
		t.Fatalf("events = %d, want 0 (unresolved events are never stored)", n)
	}
}

func TestGoogleWebhookEmailFallbackResolution(t *testing.T) {
	client, u := setup(t) // u.email = a@x.co, no connection rows
	h := New(client, testSealer(t), &fakeRouteController{}, Config{MaxPayloadBytes: 1 << 20, GoogleWebhookToken: "tok-1"}, zap.NewNop())
	srv := newWebhookServer(t, h)

	resp, _ := http.Post(srv.URL+"/v1/webhooks/google?token=tok-1", "application/json",
		strings.NewReader(gmailPushBody(t, "a@x.co", 7)))
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("email-fallback resolution: %d, want 202", resp.StatusCode)
	}
	ev := client.CloudEvent.Query().OnlyX(auth.WithInternal(context.Background()))
	owner := ev.QueryUser().OnlyX(auth.WithInternal(context.Background()))
	if owner.ID != u.ID {
		t.Fatal("event owner must resolve via the WorkOS email fallback")
	}
}

func TestCalendarNotification(t *testing.T) {
	client, u := setup(t)
	connectGoogle(t, client, u, "me@gmail.com")
	h := New(client, testSealer(t), &fakeRouteController{}, Config{MaxPayloadBytes: 1 << 20, GoogleWebhookToken: "tok-1"}, zap.NewNop())
	srv := newWebhookServer(t, h)

	send := func(state, channelID, msgNum string) *http.Response {
		t.Helper()
		req, _ := http.NewRequest(http.MethodPost, srv.URL+"/v1/webhooks/google", nil)
		req.Header.Set("X-Goog-Channel-Token", "tok-1")
		req.Header.Set("X-Goog-Resource-State", state)
		req.Header.Set("X-Goog-Channel-ID", channelID)
		req.Header.Set("X-Goog-Message-Number", msgNum)
		req.Header.Set("X-Goog-Resource-ID", "res-1")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("send: %v", err)
		}
		return resp
	}

	// sync handshake → plain 200, nothing stored.
	if resp := send("sync", "gcal:me@gmail.com:abc", "1"); resp.StatusCode != http.StatusOK {
		t.Fatalf("sync: %d, want 200", resp.StatusCode)
	}
	// real update → 202 + event.
	if resp := send("exists", "gcal:me@gmail.com:abc", "2"); resp.StatusCode != http.StatusAccepted {
		t.Fatalf("exists: %d, want 202", resp.StatusCode)
	}
	ev := client.CloudEvent.Query().OnlyX(auth.WithInternal(context.Background()))
	if ev.Source != SourceGoogleCalendar || ev.DedupeKey != "gcal:gcal:me@gmail.com:abc:2" {
		t.Fatalf("event = %s/%s", ev.Source, ev.DedupeKey)
	}
	// duplicate message number → 200 deduped, still one row.
	if resp := send("exists", "gcal:me@gmail.com:abc", "2"); resp.StatusCode != http.StatusOK {
		t.Fatalf("dup: %d, want 200", resp.StatusCode)
	}
	if n := client.CloudEvent.Query().CountX(auth.WithInternal(context.Background())); n != 1 {
		t.Fatalf("events = %d, want 1", n)
	}
}
