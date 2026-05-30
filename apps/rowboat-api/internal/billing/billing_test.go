package billing_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/billing"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/credits"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/google/uuid"
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

func TestMeReturnsBillingShape(t *testing.T) {
	client := testClient(t)
	ctx := context.Background()

	u := client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(ctx)
	client.Subscription.Create().SetUser(u).SetSanctionedCredits(10000).SaveX(ctx)
	// Spend 1579 credits across two calls.
	client.CreditLedger.Create().SetUser(u).SetDelta(-1000).SetReason("llm_call").SetRequestID(uuid.New()).SaveX(ctx)
	client.CreditLedger.Create().SetUser(u).SetDelta(-579).SetReason("llm_call").SetRequestID(uuid.New()).SaveX(ctx)

	h := billing.New(client, 10000, nil, zap.NewNop())

	req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	req = req.WithContext(auth.WithUser(ctx, u)) // simulate RequireJWT
	rec := httptest.NewRecorder()
	h.Me(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var body struct {
		User struct {
			ID    string `json:"id"`
			Email string `json:"email"`
		} `json:"user"`
		Billing struct {
			Plan   string `json:"plan"`
			Status string `json:"status"`
			Usage  struct {
				SanctionedCredits int `json:"sanctionedCredits"`
				AvailableCredits  int `json:"availableCredits"`
			} `json:"usage"`
		} `json:"billing"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if body.User.Email != "a@x.co" {
		t.Errorf("email = %q", body.User.Email)
	}
	if body.Billing.Plan != "free" || body.Billing.Status != "active" {
		t.Errorf("plan/status = %q/%q", body.Billing.Plan, body.Billing.Status)
	}
	if body.Billing.Usage.SanctionedCredits != 10000 {
		t.Errorf("sanctioned = %d", body.Billing.Usage.SanctionedCredits)
	}
	if body.Billing.Usage.AvailableCredits != 8421 { // 10000 - 1579
		t.Errorf("available = %d, want 8421", body.Billing.Usage.AvailableCredits)
	}
}

func TestMeRejectsUnauthenticated(t *testing.T) {
	client := testClient(t)
	h := billing.New(client, 10000, nil, zap.NewNop())
	req := httptest.NewRequest(http.MethodGet, "/v1/me", nil) // no user in ctx
	rec := httptest.NewRecorder()
	h.Me(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
}

func TestAvailableCreditsClampsAtZero(t *testing.T) {
	client := testClient(t)
	ctx := context.Background()
	u := client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(ctx)
	client.CreditLedger.Create().SetUser(u).SetDelta(-50).SetReason("llm_call").SetRequestID(uuid.New()).SaveX(ctx)

	got, err := credits.Available(auth.WithUser(ctx, u), client, 10)
	if err != nil {
		t.Fatalf("avail: %v", err)
	}
	if got != 0 {
		t.Fatalf("want clamp to 0, got %d", got)
	}
}
