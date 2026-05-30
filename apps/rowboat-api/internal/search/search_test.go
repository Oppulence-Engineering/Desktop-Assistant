package search_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/credits"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/pricing"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/search"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"go.uber.org/zap"
)

func setup(t *testing.T, sanctioned int) (*ent.Client, context.Context, *search.Handler) {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	bg := context.Background()
	u := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(bg)
	d.Client.Subscription.Create().SetUser(u).SetSanctionedCredits(sanctioned).SaveX(bg)
	sec := secrets.NewFromConfig(appconfig.Config{ExaAPIKey: "exa-key"})
	h := search.New(pricing.DefaultTable(), quota.New(d.Client, zap.NewNop()), sec, zap.NewNop())
	return d.Client, auth.WithUser(bg, u), h
}

func TestSearchProxiesAndCharges(t *testing.T) {
	client, ctx, h := setup(t, 10000)
	var gotKey string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKey = r.Header.Get("x-api-key")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"results":[{"title":"t","url":"u"}]}`))
	}))
	defer upstream.Close()
	h.SetUpstream(upstream.URL)

	body := `{"query":"golang","numResults":5,"type":"auto"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/search/exa", strings.NewReader(body)).WithContext(ctx)
	rec := httptest.NewRecorder()
	h.Search(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"results"`) {
		t.Errorf("response not relayed: %s", rec.Body.String())
	}
	if gotKey != "exa-key" {
		t.Errorf("upstream x-api-key = %q", gotKey)
	}
	// Flat 50-credit charge.
	if avail, _ := credits.Available(ctx, client, 10000); avail != 9950 {
		t.Fatalf("available = %d, want 9950", avail)
	}
}
