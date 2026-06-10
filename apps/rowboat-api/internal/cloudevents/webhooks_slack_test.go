package cloudevents

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

const slackSecret = "slack-signing-secret"

func slackSign(secret, ts string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("v0:" + ts + ":"))
	mac.Write(body)
	return "v0=" + hex.EncodeToString(mac.Sum(nil))
}

func newSlackServer(t *testing.T, h *Handler) *httptest.Server {
	t.Helper()
	r := chi.NewRouter()
	r.Post("/v1/webhooks/slack", h.SlackWebhook)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

func postSlack(t *testing.T, srv *httptest.Server, body, ts, sig string) (int, []byte) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/v1/webhooks/slack", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if ts != "" {
		req.Header.Set("X-Slack-Request-Timestamp", ts)
	}
	if sig != "" {
		req.Header.Set("X-Slack-Signature", sig)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	return resp.StatusCode, respBody
}

func connectSlack(t *testing.T, client *ent.Client, u *ent.User, teamID string) {
	t.Helper()
	client.OAuthConnection.Create().
		SetUser(u).
		SetProvider("slack").
		SetRefreshTokenEncrypted([]byte("sealed")).
		SetExternalAccountID(teamID).
		SaveX(context.Background())
}

func TestVerifySlackSignature(t *testing.T) {
	now := time.Unix(1_750_000_000, 0)
	ts := fmt.Sprintf("%d", now.Unix())
	body := []byte(`{"type":"event_callback"}`)
	valid := slackSign(slackSecret, ts, body)

	if err := verifySlackSignature(slackSecret, ts, body, valid, now); err != nil {
		t.Fatalf("valid signature rejected: %v", err)
	}
	if err := verifySlackSignature(slackSecret, ts, body, slackSign("wrong-secret", ts, body), now); err == nil {
		t.Fatal("wrong-secret signature accepted")
	}
	staleTS := fmt.Sprintf("%d", now.Add(-6*time.Minute).Unix())
	if err := verifySlackSignature(slackSecret, staleTS, body, slackSign(slackSecret, staleTS, body), now); err == nil {
		t.Fatal("stale timestamp accepted (replay window)")
	}
	if err := verifySlackSignature("", ts, body, valid, now); err == nil {
		t.Fatal("empty secret must fail closed")
	}
}

func slackEventBody(teamID, eventID, text string) string {
	raw, _ := json.Marshal(map[string]any{
		"type":       "event_callback",
		"team_id":    teamID,
		"event_id":   eventID,
		"event_time": 1750000000,
		"event":      map[string]any{"type": "message", "text": text, "channel": "C1", "user": "U1"},
	})
	return string(raw)
}

func TestSlackWebhookFlow(t *testing.T) {
	client, u := setup(t)
	connectSlack(t, client, u, "T0EXAMPLE")
	h := New(client, testSealer(t), &fakeRouteController{}, Config{MaxPayloadBytes: 1 << 20, SlackSigningSecret: slackSecret}, zap.NewNop())
	srv := newSlackServer(t, h)
	ts := fmt.Sprintf("%d", time.Now().Unix())

	// url_verification handshake echoes the challenge.
	challenge := `{"type":"url_verification","challenge":"abc123"}`
	status, respBody := postSlack(t, srv, challenge, ts, slackSign(slackSecret, ts, []byte(challenge)))
	if status != http.StatusOK {
		t.Fatalf("handshake: %d, want 200", status)
	}
	var ch struct {
		Challenge string `json:"challenge"`
	}
	_ = json.Unmarshal(respBody, &ch)
	if ch.Challenge != "abc123" {
		t.Fatalf("challenge = %q, want abc123", ch.Challenge)
	}

	// Unsigned event → 401.
	body := slackEventBody("T0EXAMPLE", "Ev001", "invoice dispute from acme")
	if status, _ := postSlack(t, srv, body, ts, ""); status != http.StatusUnauthorized {
		t.Fatalf("unsigned: %d, want 401", status)
	}

	// Signed event for a mapped workspace → 202 + stored event.
	if status, _ := postSlack(t, srv, body, ts, slackSign(slackSecret, ts, []byte(body))); status != http.StatusAccepted {
		t.Fatalf("signed event: %d, want 202", status)
	}
	ev := client.CloudEvent.Query().OnlyX(auth.WithInternal(context.Background()))
	if ev.Source != SourceSlack || ev.DedupeKey != "slack:T0EXAMPLE:Ev001" || ev.EventType != "message" {
		t.Fatalf("event = %s/%s/%s", ev.Source, ev.DedupeKey, ev.EventType)
	}
	if ev.OccurredAt == nil || ev.OccurredAt.Unix() != 1750000000 {
		t.Fatalf("occurredAt = %v, want event_time", ev.OccurredAt)
	}

	// Slack retry (same event_id) → 200 deduped, one row.
	if status, _ := postSlack(t, srv, body, ts, slackSign(slackSecret, ts, []byte(body))); status != http.StatusOK {
		t.Fatalf("retry: %d, want 200", status)
	}
	if n := client.CloudEvent.Query().CountX(auth.WithInternal(context.Background())); n != 1 {
		t.Fatalf("events = %d, want 1", n)
	}

	// Unmapped workspace → 200 ack, dropped.
	foreign := slackEventBody("T9OTHER", "Ev002", "hi")
	if status, _ := postSlack(t, srv, foreign, ts, slackSign(slackSecret, ts, []byte(foreign))); status != http.StatusOK {
		t.Fatalf("unmapped workspace: %d, want 200", status)
	}
	if n := client.CloudEvent.Query().CountX(auth.WithInternal(context.Background())); n != 1 {
		t.Fatalf("events = %d, want 1 (unmapped events never stored)", n)
	}
}
