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

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const genericWebhookSecret = "generic-webhook-secret"

func genericWebhookSign(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func newGenericWebhookServer(t *testing.T, h *Handler) *httptest.Server {
	t.Helper()
	r := chi.NewRouter()
	r.Post("/v1/webhooks/events", h.GenericWebhook)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

func postGenericWebhook(t *testing.T, srv *httptest.Server, body, sig string) (int, []byte) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/v1/webhooks/events", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if sig != "" {
		req.Header.Set("X-Webhook-Signature", sig)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("post generic webhook: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read generic webhook response: %v", err)
	}
	return resp.StatusCode, respBody
}

func genericWebhookBody(userID string) string {
	raw, _ := json.Marshal(map[string]any{
		"userId":          userID,
		"sourceEventId":   "evt-42",
		"sourceAccountId": "zapier-hook",
		"eventType":       "invoice.disputed",
		"payload": map[string]any{
			"customer": "Acme",
			"invoice":  "4821",
			"reason":   "pricing mismatch",
		},
	})
	return string(raw)
}

func TestGenericWebhookFlowRoutesToEventRun(t *testing.T) {
	client, u := setup(t)
	makeTask(t, client, u, "webhook-ar", "api", true, "webhook invoice disputes for Acme")
	rc := &fakeRouteController{}
	h := New(client, testSealer(t), rc, Config{MaxPayloadBytes: 1 << 20, WebhookSigningSecret: genericWebhookSecret}, zap.NewNop())
	srv := newGenericWebhookServer(t, h)

	body := genericWebhookBody(u.ID.String())
	sig := genericWebhookSign(genericWebhookSecret, []byte(body))
	status, respBody := postGenericWebhook(t, srv, body, sig)
	if status != http.StatusAccepted {
		t.Fatalf("signed generic webhook: %d, want 202: %s", status, respBody)
	}
	var out IngestResponse
	if err := json.Unmarshal(respBody, &out); err != nil {
		t.Fatalf("decode ingest response: %v", err)
	}
	if len(rc.calls) != 1 || rc.calls[0].EventID != out.EventID || rc.calls[0].UserID != u.ID.String() {
		t.Fatalf("route enqueues = %+v, want one enqueue for event/user", rc.calls)
	}

	ev := client.CloudEvent.Query().OnlyX(auth.WithInternal(context.Background()))
	if ev.Source != SourceWebhook || ev.DedupeKey != "webhook:zapier-hook:evt-42" || ev.EventType != "invoice.disputed" {
		t.Fatalf("event = %s/%s/%s", ev.Source, ev.DedupeKey, ev.EventType)
	}
	if !strings.Contains(ev.Text, "Acme") || !strings.Contains(ev.Text, "4821") {
		t.Fatalf("generic webhook should summarize payload into routing text, got %q", ev.Text)
	}

	status, _ = postGenericWebhook(t, srv, body, sig)
	if status != http.StatusOK {
		t.Fatalf("duplicate generic webhook: %d, want 200", status)
	}
	if len(rc.calls) != 1 {
		t.Fatalf("duplicate generic webhook must not enqueue routing again, got %+v", rc.calls)
	}

	starter := &fakeStarter{}
	router := &Router{
		Client: client,
		LLM: &fakeCompleter{
			pass1IDs: []string{"webhook-ar"},
			pass2:    map[string]string{"webhook-ar": `{"match":true,"confidence":0.91,"explanation":"invoice dispute from webhook"}`},
		},
		Starter:   starter,
		Threshold: 0.7,
		Model:     "m",
		Log:       zap.NewNop(),
	}
	if err := router.Route(context.Background(), uuid.MustParse(out.EventID)); err != nil {
		t.Fatalf("route generic webhook event: %v", err)
	}
	if len(starter.started) != 1 || starter.started[0].Task.Slug != "webhook-ar" {
		t.Fatalf("started = %+v, want webhook-ar event run", starter.started)
	}
	if got := starter.started[0]; got.Trigger != "event" || got.CloudEventID == nil || *got.CloudEventID != ev.ID {
		t.Fatalf("start params = %+v, want trigger=event linked to webhook event", got)
	}
}

func TestMCPWebhookFlowRoutesToEventRun(t *testing.T) {
	client, u := setup(t)
	makeTask(t, client, u, "mcp-canvas", "api", true, "Canvas MCP customer events for Acme")
	rc := &fakeRouteController{}
	h := New(client, testSealer(t), rc, Config{MaxPayloadBytes: 1 << 20, WebhookSigningSecret: genericWebhookSecret}, zap.NewNop())
	srv := newGenericWebhookServer(t, h)
	raw, _ := json.Marshal(map[string]any{
		"userId":          u.ID.String(),
		"source":          SourceMCP,
		"sourceEventId":   "evt-77",
		"sourceAccountId": "canvas",
		"eventType":       "customer.updated",
		"subject":         "Canvas customer updated",
		"payload": map[string]any{
			"customer": "Acme",
			"status":   "at_risk",
		},
	})
	body := string(raw)

	status, respBody := postGenericWebhook(t, srv, body, genericWebhookSign(genericWebhookSecret, []byte(body)))
	if status != http.StatusAccepted {
		t.Fatalf("signed mcp webhook: %d, want 202: %s", status, respBody)
	}
	var out IngestResponse
	if err := json.Unmarshal(respBody, &out); err != nil {
		t.Fatalf("decode ingest response: %v", err)
	}
	if len(rc.calls) != 1 || rc.calls[0].EventID != out.EventID || rc.calls[0].UserID != u.ID.String() {
		t.Fatalf("route enqueues = %+v, want one enqueue for event/user", rc.calls)
	}
	ev := client.CloudEvent.Query().OnlyX(auth.WithInternal(context.Background()))
	if ev.Source != SourceMCP || ev.DedupeKey != "mcp:canvas:evt-77" || ev.SourceAccountID != "canvas" {
		t.Fatalf("event = %s/%s/%s", ev.Source, ev.DedupeKey, ev.SourceAccountID)
	}
	assertProviderEventRoutesToRun(t, client, uuid.MustParse(out.EventID), "mcp-canvas", SourceMCP)
}

func TestProviderGenericWebhookSourcesRouteToEventRun(t *testing.T) {
	for _, tc := range []struct {
		source    string
		account   string
		eventType string
		taskSlug  string
	}{
		{source: SourceGitHub, account: "oppulence/rowboat", eventType: "issues.opened", taskSlug: "github-triage"},
		{source: SourceLinear, account: "ENG", eventType: "Issue", taskSlug: "linear-triage"},
		{source: SourceStripe, account: "acct_123", eventType: "charge.dispute.created", taskSlug: "stripe-disputes"},
	} {
		t.Run(tc.source, func(t *testing.T) {
			client, u := setup(t)
			makeTask(t, client, u, tc.taskSlug, "api", true, tc.source+" events for Acme")
			rc := &fakeRouteController{}
			h := New(client, testSealer(t), rc, Config{MaxPayloadBytes: 1 << 20, WebhookSigningSecret: genericWebhookSecret}, zap.NewNop())
			srv := newGenericWebhookServer(t, h)
			raw, _ := json.Marshal(map[string]any{
				"userId":          u.ID.String(),
				"source":          tc.source,
				"sourceEventId":   "evt-99",
				"sourceAccountId": tc.account,
				"eventType":       tc.eventType,
				"subject":         tc.eventType + " for Acme",
				"payload": map[string]any{
					"customer": "Acme",
					"provider": tc.source,
				},
			})
			body := string(raw)

			status, respBody := postGenericWebhook(t, srv, body, genericWebhookSign(genericWebhookSecret, []byte(body)))
			if status != http.StatusAccepted {
				t.Fatalf("signed provider webhook: %d, want 202: %s", status, respBody)
			}
			var out IngestResponse
			if err := json.Unmarshal(respBody, &out); err != nil {
				t.Fatalf("decode ingest response: %v", err)
			}
			if len(rc.calls) != 1 || rc.calls[0].EventID != out.EventID || rc.calls[0].UserID != u.ID.String() {
				t.Fatalf("route enqueues = %+v, want one enqueue for event/user", rc.calls)
			}
			ev := client.CloudEvent.Query().OnlyX(auth.WithInternal(context.Background()))
			wantDedupe := tc.source + ":" + tc.account + ":evt-99"
			if ev.Source != tc.source || ev.DedupeKey != wantDedupe || ev.EventType != tc.eventType {
				t.Fatalf("event = source=%s dedupe=%s type=%s, want %s/%s/%s",
					ev.Source, ev.DedupeKey, ev.EventType, tc.source, wantDedupe, tc.eventType)
			}
			assertProviderEventRoutesToRun(t, client, uuid.MustParse(out.EventID), tc.taskSlug, tc.source)
		})
	}
}

func TestGenericWebhookVerificationAndValidation(t *testing.T) {
	client, u := setup(t)
	h := New(client, testSealer(t), &fakeRouteController{}, Config{MaxPayloadBytes: 1 << 20, WebhookSigningSecret: genericWebhookSecret}, zap.NewNop())
	srv := newGenericWebhookServer(t, h)
	body := genericWebhookBody(u.ID.String())

	if status, _ := postGenericWebhook(t, srv, body, ""); status != http.StatusUnauthorized {
		t.Fatalf("missing signature: %d, want 401", status)
	}
	if status, _ := postGenericWebhook(t, srv, body, genericWebhookSign("wrong", []byte(body))); status != http.StatusUnauthorized {
		t.Fatalf("wrong signature: %d, want 401", status)
	}

	noDedupe, _ := json.Marshal(map[string]any{
		"userId":  u.ID.String(),
		"payload": map[string]any{"hello": "world"},
	})
	status, respBody := postGenericWebhook(t, srv, string(noDedupe), genericWebhookSign(genericWebhookSecret, noDedupe))
	if status != http.StatusBadRequest || !strings.Contains(string(respBody), "dedupeKey or sourceEventId is required") {
		t.Fatalf("missing dedupe/sourceEventId: %d, want 400 specific validation: %s", status, respBody)
	}

	unknownUser := fmt.Sprintf(`{"userId":%q,"sourceEventId":"evt-1","payload":{"hello":"world"}}`, uuid.NewString())
	if status, _ := postGenericWebhook(t, srv, unknownUser, genericWebhookSign(genericWebhookSecret, []byte(unknownUser))); status != http.StatusBadRequest {
		t.Fatalf("unknown user: %d, want 400", status)
	}

	unknownSource := fmt.Sprintf(`{"userId":%q,"source":"unknown","sourceEventId":"evt-1","payload":{"hello":"world"}}`, u.ID.String())
	if status, respBody := postGenericWebhook(t, srv, unknownSource, genericWebhookSign(genericWebhookSecret, []byte(unknownSource))); status != http.StatusBadRequest ||
		!strings.Contains(string(respBody), "source must be one of webhook, mcp, github, linear, stripe") {
		t.Fatalf("unknown source: %d, want 400 specific validation: %s", status, respBody)
	}
}

func TestGenericWebhookFailsClosedWithoutSecret(t *testing.T) {
	client, u := setup(t)
	h := New(client, testSealer(t), nil, Config{MaxPayloadBytes: 1 << 20}, zap.NewNop())
	srv := newGenericWebhookServer(t, h)
	body := genericWebhookBody(u.ID.String())

	if status, _ := postGenericWebhook(t, srv, body, genericWebhookSign(genericWebhookSecret, []byte(body))); status != http.StatusInternalServerError {
		t.Fatalf("unconfigured secret: %d, want 500", status)
	}
}
