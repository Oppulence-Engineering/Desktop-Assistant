package cloudevents

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

func setup(t *testing.T) (*ent.Client, *ent.User) {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	u := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(auth.WithInternal(context.Background()))
	return d.Client, u
}

func testSealer(t *testing.T) *crypto.Sealer {
	t.Helper()
	s, err := crypto.NewSealer("test-encryption-key-for-cloud-events")
	if err != nil {
		t.Fatalf("sealer: %v", err)
	}
	return s
}

// fakeRouteController records StartRoute calls.
type fakeRouteController struct {
	calls []RouteInput
	err   error
}

func (f *fakeRouteController) StartRoute(_ context.Context, in RouteInput) error {
	f.calls = append(f.calls, in)
	return f.err
}

// newTestServer mounts the handler the way wire.go does, with u injected as
// the authenticated user.
func newTestServer(t *testing.T, h *Handler, u *ent.User) *httptest.Server {
	t.Helper()
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(auth.WithUser(req.Context(), u)))
		})
	})
	r.Post("/v1/events", h.Ingest)
	r.Get("/v1/events", h.List)
	r.Get("/v1/events/{eventId}", h.Get)
	r.Get("/v1/events/{eventId}/runs", h.Runs)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

func postEvent(t *testing.T, srv *httptest.Server, body string) (int, IngestResponse) {
	t.Helper()
	resp, err := http.Post(srv.URL+"/v1/events", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	var out IngestResponse
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func TestIngestValidation(t *testing.T) {
	client, u := setup(t)
	h := New(client, testSealer(t), &fakeRouteController{}, Config{MaxPayloadBytes: 1024}, zap.NewNop())
	srv := newTestServer(t, h, u)

	cases := []struct {
		name string
		body string
		want int
	}{
		{"unknown source", `{"source":"carrier_pigeon","dedupeKey":"k","text":"x"}`, http.StatusBadRequest},
		{"missing dedupeKey", `{"source":"internal","text":"x"}`, http.StatusBadRequest},
		{"empty content", `{"source":"internal","dedupeKey":"k"}`, http.StatusBadRequest},
		{"oversized payload", fmt.Sprintf(`{"source":"internal","dedupeKey":"k","payload":{"x":%q}}`, strings.Repeat("a", 2048)), http.StatusRequestEntityTooLarge},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status, _ := postEvent(t, srv, tc.body)
			if status != tc.want {
				t.Fatalf("status = %d, want %d", status, tc.want)
			}
		})
	}
}

func TestIngestDedupe(t *testing.T) {
	client, u := setup(t)
	rc := &fakeRouteController{}
	h := New(client, testSealer(t), rc, Config{MaxPayloadBytes: 1 << 20}, zap.NewNop())
	srv := newTestServer(t, h, u)

	body := `{"source":"internal","dedupeKey":"gmail:msg:1","subject":"hi","payload":{"a":1}}`
	status1, out1 := postEvent(t, srv, body)
	if status1 != http.StatusAccepted || out1.Deduped {
		t.Fatalf("first post: status=%d deduped=%v, want 202/false", status1, out1.Deduped)
	}
	status2, out2 := postEvent(t, srv, body)
	if status2 != http.StatusOK || !out2.Deduped {
		t.Fatalf("replay: status=%d deduped=%v, want 200/true", status2, out2.Deduped)
	}
	if out2.EventID != out1.EventID {
		t.Fatalf("replay returned a different event id")
	}
	// Exactly one row, exactly one route enqueue.
	n := client.CloudEvent.Query().CountX(auth.WithInternal(context.Background()))
	if n != 1 {
		t.Fatalf("event rows = %d, want 1", n)
	}
	if len(rc.calls) != 1 {
		t.Fatalf("route enqueues = %d, want 1 (replays must not re-route)", len(rc.calls))
	}
}

func TestIngestWithoutRouterStoresSkipped(t *testing.T) {
	client, u := setup(t)
	h := New(client, testSealer(t), nil, Config{MaxPayloadBytes: 1 << 20}, zap.NewNop())
	srv := newTestServer(t, h, u)

	_, out := postEvent(t, srv, `{"source":"internal","dedupeKey":"k1","text":"x"}`)
	if out.RoutingStatus != StatusSkipped {
		t.Fatalf("routingStatus = %q, want skipped when routing is disabled", out.RoutingStatus)
	}
}

func TestIngestRouteStartFailureMarksFailed(t *testing.T) {
	client, u := setup(t)
	rc := &fakeRouteController{err: fmt.Errorf("temporal down")}
	h := New(client, testSealer(t), rc, Config{MaxPayloadBytes: 1 << 20}, zap.NewNop())
	srv := newTestServer(t, h, u)

	status, out := postEvent(t, srv, `{"source":"internal","dedupeKey":"k1","text":"x"}`)
	if status != http.StatusAccepted {
		t.Fatalf("status = %d, want 202 (event is preserved)", status)
	}
	if out.RoutingStatus != StatusFailed {
		t.Fatalf("routingStatus = %q, want failed after route-start failure", out.RoutingStatus)
	}
}

func TestGetDecryptsPayload(t *testing.T) {
	client, u := setup(t)
	h := New(client, testSealer(t), &fakeRouteController{}, Config{MaxPayloadBytes: 1 << 20}, zap.NewNop())
	srv := newTestServer(t, h, u)

	_, out := postEvent(t, srv, `{"source":"internal","dedupeKey":"k1","payload":{"answer":42}}`)
	resp, err := http.Get(srv.URL + "/v1/events/" + out.EventID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	var detail struct {
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&detail); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !bytes.Contains(detail.Payload, []byte(`"answer":42`)) {
		t.Fatalf("payload = %s, want decrypted original", detail.Payload)
	}
}

func TestTenantIsolation(t *testing.T) {
	client, u := setup(t)
	other := client.User.Create().SetEmail("b@x.co").SetWorkosUserID("user_2").SaveX(auth.WithInternal(context.Background()))
	h := New(client, testSealer(t), &fakeRouteController{}, Config{MaxPayloadBytes: 1 << 20}, zap.NewNop())

	srvA := newTestServer(t, h, u)
	_, out := postEvent(t, srvA, `{"source":"internal","dedupeKey":"k1","text":"secret"}`)

	srvB := newTestServer(t, h, other)
	resp, err := http.Get(srvB.URL + "/v1/events/" + out.EventID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("cross-tenant get: status = %d, want 404", resp.StatusCode)
	}
}

func TestListPagination(t *testing.T) {
	client, u := setup(t)
	h := New(client, testSealer(t), &fakeRouteController{}, Config{MaxPayloadBytes: 1 << 20}, zap.NewNop())
	srv := newTestServer(t, h, u)

	// Distinct received_at per row: the keyset cursor orders by
	// (received_at DESC, id DESC) and SQLite compares stored text timestamps,
	// so sub-second insert bursts aren't a stable fixture.
	base := time.Date(2026, 6, 9, 12, 0, 0, 0, time.UTC)
	for i := 0; i < 5; i++ {
		client.CloudEvent.Create().
			SetUser(u).
			SetSource(SourceInternal).
			SetDedupeKey(fmt.Sprintf("k%d", i)).
			SetText("x").
			SetReceivedAt(base.Add(time.Duration(i) * time.Second)).
			SaveX(auth.WithInternal(context.Background()))
	}

	var page struct {
		Events     []json.RawMessage `json:"events"`
		NextCursor string            `json:"nextCursor"`
	}
	get := func(url string) {
		t.Helper()
		resp, err := http.Get(url)
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		defer func() { _ = resp.Body.Close() }()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		page = struct {
			Events     []json.RawMessage `json:"events"`
			NextCursor string            `json:"nextCursor"`
		}{}
		if err := json.NewDecoder(resp.Body).Decode(&page); err != nil {
			t.Fatalf("decode: %v", err)
		}
	}

	seen := 0
	get(srv.URL + "/v1/events?limit=2")
	for pages := 0; ; pages++ {
		if pages > 5 {
			t.Fatalf("cursor did not advance after %d pages", pages)
		}
		seen += len(page.Events)
		if page.NextCursor == "" {
			break
		}
		get(srv.URL + "/v1/events?limit=2&cursor=" + url.QueryEscape(page.NextCursor))
	}
	if seen != 5 {
		t.Fatalf("paged through %d events, want 5", seen)
	}
}
