package cloudevents

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	oauthrs "github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

type fakeGooglePushVerifier struct {
	claims *oauthrs.Claims
	err    error
}

func (v *fakeGooglePushVerifier) Verify(string) (*oauthrs.Claims, error) {
	return v.claims, v.err
}

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
		SaveX(auth.WithUser(context.Background(), u))
}

func addGoogleWatch(t *testing.T, client *ent.Client, u *ent.User, kind, email, channelID, resourceID string) *ent.GoogleWatch {
	t.Helper()
	create := client.GoogleWatch.Create().
		SetUser(u).
		SetKind(kind).
		SetAccountEmail(email).
		SetExpiresAt(time.Now().UTC().Add(time.Hour))
	if channelID != "" {
		create = create.SetChannelID(channelID)
	}
	if resourceID != "" {
		create = create.SetResourceID(resourceID)
	}
	return create.SaveX(auth.WithUser(context.Background(), u))
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

// postWebhook POSTs and returns the status, closing the body (bodyclose).
func postWebhook(t *testing.T, url, body string) int {
	t.Helper()
	resp, err := http.Post(url, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	return resp.StatusCode
}

func TestGoogleWebhookTokenVerification(t *testing.T) {
	client, u := setup(t)
	connectGoogle(t, client, u, "me@gmail.com")
	addGoogleWatch(t, client, u, "gmail", "me@gmail.com", "", "")
	h := New(client, testSealer(t), &fakeRouteController{}, Config{MaxPayloadBytes: 1 << 20, GoogleWebhookToken: "tok-1"}, zap.NewNop())
	if _, ok := h.resolveActiveGoogleWatch(httptest.NewRequest(http.MethodPost, "/v1/webhooks/google", nil), "gmail", "me@gmail.com", "", ""); !ok {
		t.Fatal("active Gmail watch did not resolve")
	}
	srv := newWebhookServer(t, h)
	body := gmailPushBody(t, "me@gmail.com", 998877)

	// Wrong token → 401.
	if status := postWebhook(t, srv.URL+"/v1/webhooks/google?token=wrong", body); status != http.StatusUnauthorized {
		t.Fatalf("wrong token: %d, want 401", status)
	}
	// Missing token → 401.
	if status := postWebhook(t, srv.URL+"/v1/webhooks/google", body); status != http.StatusUnauthorized {
		t.Fatalf("missing token: %d, want 401", status)
	}
	// Correct token → 202 with a stored event.
	if status := postWebhook(t, srv.URL+"/v1/webhooks/google?token=tok-1", body); status != http.StatusAccepted {
		t.Fatalf("valid token: %d, want 202", status)
	}

	ev := client.CloudEvent.Query().OnlyX(auth.WithInternal(context.Background()))
	if ev.Source != SourceGmail || ev.DedupeKey != "gmail:history:me@gmail.com:998877" {
		t.Fatalf("event = %s/%s, want gmail dedupe key", ev.Source, ev.DedupeKey)
	}
}

func TestGmailPushRequiresConfiguredOIDCIdentity(t *testing.T) {
	client, u := setup(t)
	connectGoogle(t, client, u, "me@gmail.com")
	addGoogleWatch(t, client, u, "gmail", "me@gmail.com", "", "")
	h := New(client, testSealer(t), &fakeRouteController{}, Config{MaxPayloadBytes: 1 << 20, GoogleWebhookToken: "legacy-token"}, zap.NewNop())
	verifier := &fakeGooglePushVerifier{claims: &oauthrs.Claims{Email: "pubsub@example.iam.gserviceaccount.com"}}
	h.SetGooglePushVerifier(verifier, "pubsub@example.iam.gserviceaccount.com")
	srv := newWebhookServer(t, h)
	body := gmailPushBody(t, "me@gmail.com", 998879)

	post := func(token string) int {
		t.Helper()
		req, _ := http.NewRequest(http.MethodPost, srv.URL+"/v1/webhooks/google", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("post: %v", err)
		}
		defer func() { _ = resp.Body.Close() }()
		return resp.StatusCode
	}
	if status := post(""); status != http.StatusUnauthorized {
		t.Fatalf("missing OIDC token = %d, want 401", status)
	}
	if status := post("signed-token"); status != http.StatusAccepted {
		t.Fatalf("valid OIDC push = %d, want 202", status)
	}
	verifier.claims.Email = "other@example.iam.gserviceaccount.com"
	if status := post("signed-token"); status != http.StatusUnauthorized {
		t.Fatalf("wrong service account = %d, want 401", status)
	}
}

func TestGoogleWebhookFailsClosedWithoutSecret(t *testing.T) {
	client, _ := setup(t)
	h := New(client, testSealer(t), nil, Config{MaxPayloadBytes: 1 << 20}, zap.NewNop())
	srv := newWebhookServer(t, h)

	if status := postWebhook(t, srv.URL+"/v1/webhooks/google?token=anything", "{}"); status != http.StatusInternalServerError {
		t.Fatalf("unconfigured secret: %d, want 500 (fail closed)", status)
	}
}

func TestGoogleWebhookUnresolvedUserDropped(t *testing.T) {
	client, _ := setup(t)
	h := New(client, testSealer(t), &fakeRouteController{}, Config{MaxPayloadBytes: 1 << 20, GoogleWebhookToken: "tok-1"}, zap.NewNop())
	srv := newWebhookServer(t, h)

	if status := postWebhook(t, srv.URL+"/v1/webhooks/google?token=tok-1", gmailPushBody(t, "stranger@gmail.com", 1)); status != http.StatusOK {
		t.Fatalf("unresolved account: %d, want 200 (ack, stop retries)", status)
	}
	if n := client.CloudEvent.Query().CountX(auth.WithInternal(context.Background())); n != 0 {
		t.Fatalf("events = %d, want 0 (unresolved events are never stored)", n)
	}
}

func TestGoogleWebhookRequiresActiveWatch(t *testing.T) {
	client, u := setup(t) // u.email = a@x.co, no connection rows
	h := New(client, testSealer(t), &fakeRouteController{}, Config{MaxPayloadBytes: 1 << 20, GoogleWebhookToken: "tok-1"}, zap.NewNop())
	srv := newWebhookServer(t, h)

	if status := postWebhook(t, srv.URL+"/v1/webhooks/google?token=tok-1", gmailPushBody(t, "a@x.co", 7)); status != http.StatusOK {
		t.Fatalf("unregistered Gmail watch: %d, want 200 drop", status)
	}
	if n := client.CloudEvent.Query().CountX(auth.WithInternal(context.Background())); n != 0 {
		t.Fatalf("events = %d, want 0 without an active watch", n)
	}
	_ = u
}

func TestCalendarNotification(t *testing.T) {
	client, u := setup(t)
	connectGoogle(t, client, u, "me@gmail.com")
	addGoogleWatch(t, client, u, "calendar", "me@gmail.com", "gcal:me@gmail.com:abc", "res-1")
	h := New(client, testSealer(t), &fakeRouteController{}, Config{MaxPayloadBytes: 1 << 20, GoogleWebhookToken: "tok-1"}, zap.NewNop())
	srv := newWebhookServer(t, h)

	send := func(state, channelID, msgNum string) int {
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
		defer func() { _ = resp.Body.Close() }()
		return resp.StatusCode
	}

	// sync handshake → plain 200, nothing stored.
	if status := send("sync", "gcal:me@gmail.com:abc", "1"); status != http.StatusOK {
		t.Fatalf("sync: %d, want 200", status)
	}
	// real update → 202 + event.
	if status := send("exists", "gcal:me@gmail.com:abc", "2"); status != http.StatusAccepted {
		t.Fatalf("exists: %d, want 202", status)
	}
	ev := client.CloudEvent.Query().OnlyX(auth.WithInternal(context.Background()))
	if ev.Source != SourceGoogleCalendar || ev.DedupeKey != "gcal:gcal:me@gmail.com:abc:2" {
		t.Fatalf("event = %s/%s", ev.Source, ev.DedupeKey)
	}
	// duplicate message number → 200 deduped, still one row.
	if status := send("exists", "gcal:me@gmail.com:abc", "2"); status != http.StatusOK {
		t.Fatalf("dup: %d, want 200", status)
	}
	if n := client.CloudEvent.Query().CountX(auth.WithInternal(context.Background())); n != 1 {
		t.Fatalf("events = %d, want 1", n)
	}
	// A valid shared token does not authorize an invented channel for the same
	// account; only the exact active GoogleWatch registration is accepted.
	if status := send("exists", "gcal:me@gmail.com:forged", "3"); status != http.StatusOK {
		t.Fatalf("forged channel: %d, want 200 drop", status)
	}
	if n := client.CloudEvent.Query().CountX(auth.WithInternal(context.Background())); n != 1 {
		t.Fatalf("forged channel stored an event; count = %d", n)
	}
}

func TestDriveNotification(t *testing.T) {
	client, u := setup(t)
	connectGoogle(t, client, u, "me@gmail.com")
	addGoogleWatch(t, client, u, "drive", "me@gmail.com", "gdrive:me@gmail.com:abc", "drive-res-1")
	h := New(client, testSealer(t), &fakeRouteController{}, Config{MaxPayloadBytes: 1 << 20, GoogleWebhookToken: "tok-1"}, zap.NewNop())
	srv := newWebhookServer(t, h)

	send := func(msgNum string) int {
		t.Helper()
		req, _ := http.NewRequest(http.MethodPost, srv.URL+"/v1/webhooks/google", nil)
		req.Header.Set("X-Goog-Channel-Token", "tok-1")
		req.Header.Set("X-Goog-Resource-State", "exists")
		req.Header.Set("X-Goog-Channel-ID", "gdrive:me@gmail.com:abc")
		req.Header.Set("X-Goog-Message-Number", msgNum)
		req.Header.Set("X-Goog-Resource-ID", "drive-res-1")
		req.Header.Set("X-Goog-Changed", "children")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("send: %v", err)
		}
		defer func() { _ = resp.Body.Close() }()
		return resp.StatusCode
	}

	if status := send("4"); status != http.StatusAccepted {
		t.Fatalf("drive notification: %d, want 202", status)
	}
	ev := client.CloudEvent.Query().OnlyX(auth.WithInternal(context.Background()))
	if ev.Source != SourceGoogleDrive || ev.DedupeKey != "gdrive:gdrive:me@gmail.com:abc:4" || ev.SourceAccountID != "me@gmail.com" {
		t.Fatalf("event = %s/%s/%s", ev.Source, ev.DedupeKey, ev.SourceAccountID)
	}
	if status := send("4"); status != http.StatusOK {
		t.Fatalf("dup: %d, want 200", status)
	}
	if n := client.CloudEvent.Query().CountX(auth.WithInternal(context.Background())); n != 1 {
		t.Fatalf("events = %d, want 1", n)
	}
}
