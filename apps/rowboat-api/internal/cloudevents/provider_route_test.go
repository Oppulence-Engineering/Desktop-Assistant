package cloudevents

import (
	"context"
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
	"github.com/google/uuid"
	"go.uber.org/zap"
)

func assertProviderEventRoutesToRun(t *testing.T, client *ent.Client, eventID uuid.UUID, slug, source string) {
	t.Helper()
	starter := &fakeStarter{}
	router := &Router{
		Client: client,
		LLM: &fakeCompleter{
			pass1IDs: []string{slug},
			pass2: map[string]string{
				slug: `{"match":true,"confidence":0.93,"explanation":"provider event matches smoke task"}`,
			},
		},
		Starter:   starter,
		Threshold: 0.7,
		Model:     "m",
		Log:       zap.NewNop(),
	}
	if err := router.Route(context.Background(), eventID); err != nil {
		t.Fatalf("route provider event: %v", err)
	}
	if len(starter.started) != 1 || starter.started[0].Task.Slug != slug {
		t.Fatalf("started = %+v, want one %s event run", starter.started, slug)
	}
	got := starter.started[0]
	if got.Trigger != "event" || got.CloudEventID == nil || *got.CloudEventID != eventID {
		t.Fatalf("start params = %+v, want trigger=event linked to source event", got)
	}
	ev := client.CloudEvent.GetX(auth.WithInternal(context.Background()), eventID)
	if ev.Source != source || ev.RoutingStatus != StatusRouted || ev.MatchedTaskCount != 1 {
		t.Fatalf("event = source=%s status=%s matches=%d, want %s/routed/1",
			ev.Source, ev.RoutingStatus, ev.MatchedTaskCount, source)
	}
}

func TestSlackWebhookRoutesToEventRun(t *testing.T) {
	client, u := setup(t)
	makeTask(t, client, u, "slack-ar", "api", true, "Slack invoice disputes for Acme")
	connectSlack(t, client, u, "T0EXAMPLE")
	rc := &fakeRouteController{}
	h := New(client, testSealer(t), rc, Config{MaxPayloadBytes: 1 << 20, SlackSigningSecret: slackSecret}, zap.NewNop())
	srv := newSlackServer(t, h)
	ts := time.Now().Unix()
	body := slackEventBody("T0EXAMPLE", "EvRoute001", "Acme invoice 4821 is disputed")

	status, respBody := postSlack(t, srv, body, fmt.Sprintf("%d", ts), slackSign(slackSecret, fmt.Sprintf("%d", ts), []byte(body)))
	if status != http.StatusAccepted {
		t.Fatalf("slack route event: %d, want 202: %s", status, respBody)
	}
	if len(rc.calls) != 1 {
		t.Fatalf("route enqueues = %d, want 1", len(rc.calls))
	}
	assertProviderEventRoutesToRun(t, client, uuid.MustParse(rc.calls[0].EventID), "slack-ar", SourceSlack)
}

func TestGoogleGmailWebhookRoutesToEventRun(t *testing.T) {
	client, u := setup(t)
	makeTask(t, client, u, "gmail-ar", "api", true, "Gmail invoice disputes for Acme")
	connectGoogle(t, client, u, "me@gmail.com")
	addGoogleWatch(t, client, u, "gmail", "me@gmail.com", "", "")
	rc := &fakeRouteController{}
	h := New(client, testSealer(t), rc, Config{MaxPayloadBytes: 1 << 20, GoogleWebhookToken: "tok-1"}, zap.NewNop())
	srv := newWebhookServer(t, h)
	body := gmailPushBody(t, "me@gmail.com", 998878)

	if status := postWebhook(t, srv.URL+"/v1/webhooks/google?token=tok-1", body); status != http.StatusAccepted {
		t.Fatalf("gmail route event: %d, want 202", status)
	}
	if len(rc.calls) != 1 {
		t.Fatalf("route enqueues = %d, want 1", len(rc.calls))
	}
	assertProviderEventRoutesToRun(t, client, uuid.MustParse(rc.calls[0].EventID), "gmail-ar", SourceGmail)
}

func TestGoogleCalendarWebhookRoutesToEventRun(t *testing.T) {
	client, u := setup(t)
	makeTask(t, client, u, "calendar-qbr", "api", true, "Google Calendar QBR moves for Acme")
	connectGoogle(t, client, u, "me@gmail.com")
	addGoogleWatch(t, client, u, "calendar", "me@gmail.com", "gcal:me@gmail.com:route", "res-route-1")
	rc := &fakeRouteController{}
	h := New(client, testSealer(t), rc, Config{MaxPayloadBytes: 1 << 20, GoogleWebhookToken: "tok-1"}, zap.NewNop())
	srv := newWebhookServer(t, h)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/v1/webhooks/google", nil)
	req.Header.Set("X-Goog-Channel-Token", "tok-1")
	req.Header.Set("X-Goog-Resource-State", "exists")
	req.Header.Set("X-Goog-Channel-ID", "gcal:me@gmail.com:route")
	req.Header.Set("X-Goog-Message-Number", "3")
	req.Header.Set("X-Goog-Resource-ID", "res-route-1")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("calendar route event post: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("calendar route event: %d, want 202: %s", resp.StatusCode, respBody)
	}
	if len(rc.calls) != 1 {
		t.Fatalf("route enqueues = %d, want 1", len(rc.calls))
	}
	assertProviderEventRoutesToRun(t, client, uuid.MustParse(rc.calls[0].EventID), "calendar-qbr", SourceGoogleCalendar)
}

func TestGoogleDriveWebhookRoutesToEventRun(t *testing.T) {
	client, u := setup(t)
	makeTask(t, client, u, "drive-alerts", "api", true, "Google Drive file changes for Acme")
	connectGoogle(t, client, u, "me@gmail.com")
	addGoogleWatch(t, client, u, "drive", "me@gmail.com", "gdrive:me@gmail.com:route", "drive-res-route-1")
	rc := &fakeRouteController{}
	h := New(client, testSealer(t), rc, Config{MaxPayloadBytes: 1 << 20, GoogleWebhookToken: "tok-1"}, zap.NewNop())
	srv := newWebhookServer(t, h)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/v1/webhooks/google", nil)
	req.Header.Set("X-Goog-Channel-Token", "tok-1")
	req.Header.Set("X-Goog-Resource-State", "exists")
	req.Header.Set("X-Goog-Channel-ID", "gdrive:me@gmail.com:route")
	req.Header.Set("X-Goog-Message-Number", "5")
	req.Header.Set("X-Goog-Resource-ID", "drive-res-route-1")
	req.Header.Set("X-Goog-Changed", "children")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("drive route event post: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("drive route event: %d, want 202: %s", resp.StatusCode, respBody)
	}
	if len(rc.calls) != 1 {
		t.Fatalf("route enqueues = %d, want 1", len(rc.calls))
	}
	assertProviderEventRoutesToRun(t, client, uuid.MustParse(rc.calls[0].EventID), "drive-alerts", SourceGoogleDrive)
}

func TestInternalIngestRoutesToEventRun(t *testing.T) {
	client, u := setup(t)
	makeTask(t, client, u, "internal-alert", "api", true, "internal billing alerts for Acme")
	rc := &fakeRouteController{}
	h := New(client, testSealer(t), rc, Config{MaxPayloadBytes: 1 << 20}, zap.NewNop())
	srv := newInternalEventServer(t, h)
	body, _ := json.Marshal(map[string]any{
		"userId":    u.ID.String(),
		"source":    SourceInternal,
		"dedupeKey": "internal:route:1",
		"eventType": "billing.alert",
		"subject":   "Acme billing alert",
		"text":      "Acme billing threshold crossed.",
	})

	status, out, respBody := postInternalEvent(t, srv, string(body))
	if status != http.StatusAccepted {
		t.Fatalf("internal route event: %d, want 202: %s", status, respBody)
	}
	if len(rc.calls) != 1 || rc.calls[0].EventID != out.EventID || rc.calls[0].UserID != u.ID.String() {
		t.Fatalf("route enqueues = %+v, want one enqueue for event/user", rc.calls)
	}
	assertProviderEventRoutesToRun(t, client, uuid.MustParse(out.EventID), "internal-alert", SourceInternal)
}

func newInternalEventServer(t *testing.T, h *Handler) *httptest.Server {
	t.Helper()
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(auth.WithInternal(req.Context())))
		})
	})
	r.Post("/v1/internal/events", h.IngestInternal)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

func postInternalEvent(t *testing.T, srv *httptest.Server, body string) (int, IngestResponse, []byte) {
	t.Helper()
	resp, err := http.Post(srv.URL+"/v1/internal/events", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("post internal event: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read internal event response: %v", err)
	}
	var out IngestResponse
	_ = json.Unmarshal(respBody, &out)
	return resp.StatusCode, out, respBody
}
