package feedback_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/feedback"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"go.uber.org/zap"
)

func testClient(t *testing.T) *ent.Client {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d.Client
}

// plainRequest is one captured GraphQL call to the fake Plain server.
type plainRequest struct {
	auth      string
	operation string // "upsertCustomer" or "createThread"
	variables map[string]any
}

// fakePlain stands in for Plain's GraphQL endpoint, answering both mutations.
func fakePlain(t *testing.T, calls *[]plainRequest) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode plain request: %v", err)
		}
		op := "createThread"
		if strings.Contains(body.Query, "upsertCustomer") {
			op = "upsertCustomer"
		}
		*calls = append(*calls, plainRequest{
			auth:      r.Header.Get("Authorization"),
			operation: op,
			variables: body.Variables,
		})
		switch op {
		case "upsertCustomer":
			_, _ = w.Write([]byte(`{"data":{"upsertCustomer":{"result":"CREATED","customer":{"id":"c_123"},"error":null}}}`))
		default:
			_, _ = w.Write([]byte(`{"data":{"createThread":{"thread":{"id":"th_456"},"error":null}}}`))
		}
	}))
}

func newHandler(t *testing.T, baseURL, apiKey string, labels map[string]string) (*feedback.Handler, *ent.User, context.Context) {
	t.Helper()
	client := testClient(t)
	ctx := context.Background()
	u := client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(ctx)
	ctx = auth.WithUser(ctx, u)
	client.Subscription.Create().SetUser(u).SetSanctionedCredits(10000).SaveX(ctx)
	sec := secrets.NewFromConfig(appconfig.Config{PlainAPIKey: apiKey})
	h := feedback.New(sec, client, feedback.Config{
		BaseURL:      baseURL,
		LabelTypeIDs: labels,
	}, zap.NewNop())
	return h, u, ctx
}

func submit(ctx context.Context, t *testing.T, h *feedback.Handler, u *ent.User, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/feedback", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(auth.WithUser(ctx, u)) // simulate RequireJWT
	rec := httptest.NewRecorder()
	h.Submit(rec, req)
	return rec
}

func TestSubmitRelaysToPlain(t *testing.T) {
	var calls []plainRequest
	srv := fakePlain(t, &calls)
	defer srv.Close()

	h, u, ctx := newHandler(t, srv.URL, "plain-key", map[string]string{"bug": "lt_bug"})
	rec := submit(ctx, t, h, u, `{"category":"bug","message":"it broke","appVersion":"0.1.10","platform":"darwin/arm64"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		OK       bool   `json:"ok"`
		ThreadID string `json:"threadId"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !resp.OK || resp.ThreadID != "th_456" {
		t.Errorf("resp = %+v", resp)
	}

	if len(calls) != 2 {
		t.Fatalf("want 2 plain calls, got %d", len(calls))
	}
	if calls[0].operation != "upsertCustomer" || calls[1].operation != "createThread" {
		t.Errorf("operations = %s, %s", calls[0].operation, calls[1].operation)
	}
	for _, c := range calls {
		if c.auth != "Bearer plain-key" {
			t.Errorf("auth header = %q", c.auth)
		}
	}

	upsert := calls[0].variables["input"].(map[string]any)
	if email := upsert["identifier"].(map[string]any)["emailAddress"]; email != "a@x.co" {
		t.Errorf("customer email = %v", email)
	}

	thread := calls[1].variables["input"].(map[string]any)
	if cid := thread["customerIdentifier"].(map[string]any)["customerId"]; cid != "c_123" {
		t.Errorf("customerId = %v", cid)
	}
	if title := thread["title"].(string); title != "Bug report from a@x.co" {
		t.Errorf("title = %q", title)
	}
	labels, _ := thread["labelTypeIds"].([]any)
	if len(labels) != 1 || labels[0] != "lt_bug" {
		t.Errorf("labelTypeIds = %v", thread["labelTypeIds"])
	}
	components := thread["components"].([]any)
	if text := components[0].(map[string]any)["componentText"].(map[string]any)["text"]; text != "it broke" {
		t.Errorf("message component = %v", text)
	}
	meta := components[2].(map[string]any)["componentText"].(map[string]any)["text"].(string)
	for _, want := range []string{"0.1.10", "darwin/arm64", "plan: free", u.ID.String()} {
		if !strings.Contains(meta, want) {
			t.Errorf("metadata %q missing %q", meta, want)
		}
	}
}

func TestSubmitOmitsLabelWhenUnmapped(t *testing.T) {
	var calls []plainRequest
	srv := fakePlain(t, &calls)
	defer srv.Close()

	h, u, ctx := newHandler(t, srv.URL, "plain-key", nil)
	rec := submit(ctx, t, h, u, `{"category":"feature","message":"please add x"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	thread := calls[1].variables["input"].(map[string]any)
	if _, present := thread["labelTypeIds"]; present {
		t.Errorf("labelTypeIds should be omitted, got %v", thread["labelTypeIds"])
	}
}

func TestSubmitRejectsBadInput(t *testing.T) {
	var calls []plainRequest
	srv := fakePlain(t, &calls)
	defer srv.Close()
	h, u, ctx := newHandler(t, srv.URL, "plain-key", nil)

	for name, body := range map[string]string{
		"bad category":      `{"category":"rant","message":"hi"}`,
		"empty message":     `{"category":"bug","message":"   "}`,
		"oversized message": `{"category":"bug","message":"` + strings.Repeat("a", 5001) + `"}`,
	} {
		rec := submit(ctx, t, h, u, body)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: want 400, got %d: %s", name, rec.Code, rec.Body.String())
		}
	}
	if len(calls) != 0 {
		t.Errorf("plain should not be called on invalid input, got %d calls", len(calls))
	}
}

func TestSubmitWithoutKeyIsUnconfigured(t *testing.T) {
	h, u, ctx := newHandler(t, "http://plain.invalid", "", nil)
	rec := submit(ctx, t, h, u, `{"category":"bug","message":"hi"}`)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("want 502, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "provider_unconfigured") {
		t.Errorf("body = %s", rec.Body.String())
	}
}

func TestSubmitPlainServerErrorIs502(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	h, u, ctx := newHandler(t, srv.URL, "plain-key", nil)
	rec := submit(ctx, t, h, u, `{"category":"bug","message":"hi"}`)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("want 502, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "upstream_error") {
		t.Errorf("body = %s", rec.Body.String())
	}
}

func TestSubmitPlainMutationErrorIs502(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":{"upsertCustomer":{"result":null,"customer":null,"error":{"message":"forbidden","code":"forbidden"}}}}`))
	}))
	defer srv.Close()

	h, u, ctx := newHandler(t, srv.URL, "plain-key", nil)
	rec := submit(ctx, t, h, u, `{"category":"bug","message":"hi"}`)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("want 502, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestParseLabelMap(t *testing.T) {
	m, err := feedback.ParseLabelMap(`{"bug":"lt_1","feature":"lt_2"}`)
	if err != nil || m["bug"] != "lt_1" || m["feature"] != "lt_2" {
		t.Errorf("m=%v err=%v", m, err)
	}
	if m, err = feedback.ParseLabelMap("  "); err != nil || len(m) != 0 {
		t.Errorf("empty: m=%v err=%v", m, err)
	}
	if _, err = feedback.ParseLabelMap(`{bad`); err == nil {
		t.Error("want error on malformed JSON")
	}
}
