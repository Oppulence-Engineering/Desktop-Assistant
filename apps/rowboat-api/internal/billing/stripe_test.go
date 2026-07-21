package billing_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/cloudevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/billing"
	"go.uber.org/zap"
)

func stripeHandler(t *testing.T, calls *map[string]int) http.Handler {
	t.Helper()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Method + " " + r.URL.Path
		(*calls)[key]++
		if username, _, ok := r.BasicAuth(); !ok || username != "sk_test_rowboat" {
			t.Errorf("missing Stripe basic auth on %s", key)
		}
		switch key {
		case "POST /v1/customers":
			if err := r.ParseForm(); err != nil {
				t.Errorf("parse customer form: %v", err)
			}
			if r.Form.Get("metadata[user_id]") == "" {
				t.Errorf("customer metadata user_id is empty")
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"id":"cus_test_123"}`))
		case "POST /v1/checkout/sessions":
			if err := r.ParseForm(); err != nil {
				t.Errorf("parse checkout form: %v", err)
			}
			if got := r.Form.Get("line_items[0][price]"); got != "price_starter" {
				t.Errorf("checkout price = %q", got)
			}
			if got := r.Form.Get("customer"); got != "cus_test_123" {
				t.Errorf("checkout customer = %q", got)
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"id":"cs_test_123","url":"https://checkout.stripe.test/session"}`))
		case "POST /v1/billing_portal/sessions":
			if err := r.ParseForm(); err != nil {
				t.Errorf("parse portal form: %v", err)
			}
			if got := r.Form.Get("customer"); got != "cus_test_123" {
				t.Errorf("portal customer = %q", got)
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"url":"https://billing.stripe.test/session"}`))
		case "GET /v1/subscriptions/sub_test_123":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{
				"id":"sub_test_123",
				"customer":"cus_test_123",
				"status":"active",
				"trial_end":0,
				"metadata":{"plan":"starter"},
				"items":{"data":[{"price":{"id":"price_starter"}}]}
			}`))
		default:
			t.Errorf("unexpected Stripe request %s", key)
			http.NotFound(w, r)
		}
	})
}

func newStripeBillingHandler(client *ent.Client, stripeURL string) *billing.Handler {
	h := billing.New(client, 10000, 0, nil, zap.NewNop())
	h.ConfigureStripe(billing.StripeConfig{
		SecretKey:      "sk_test_rowboat",
		WebhookSecret:  "whsec_rowboat",
		StarterPriceID: "price_starter",
		ProPriceID:     "price_pro",
		SuccessURL:     "https://app.test/success",
		CancelURL:      "https://app.test/cancel",
		APIBaseURL:     stripeURL,
		StarterCredits: 123000,
		ProCredits:     456000,
	})
	return h
}

func TestCheckoutSessionCreatesCustomerAndSession(t *testing.T) {
	client := testClient(t)
	ctx := auth.WithInternal(context.Background())
	u := client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(ctx)
	client.Subscription.Create().SetUser(u).SetSanctionedCredits(10000).SaveX(ctx)

	calls := map[string]int{}
	stripe := httptest.NewServer(stripeHandler(t, &calls))
	t.Cleanup(stripe.Close)
	h := newStripeBillingHandler(client, stripe.URL)

	req := httptest.NewRequest(http.MethodPost, "/v1/billing/checkout-session", strings.NewReader(`{"plan":"starter"}`))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(auth.WithUser(ctx, u))
	rec := httptest.NewRecorder()
	h.CheckoutSession(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.URL != "https://checkout.stripe.test/session" {
		t.Fatalf("url = %q", body.URL)
	}
	if calls["POST /v1/customers"] != 1 || calls["POST /v1/checkout/sessions"] != 1 {
		t.Fatalf("stripe calls = %+v", calls)
	}
	sub := client.Subscription.Query().OnlyX(auth.WithUser(ctx, u))
	if sub.StripeCustomerID != "cus_test_123" {
		t.Fatalf("stripe customer = %q", sub.StripeCustomerID)
	}
}

func TestPortalSessionRequiresLinkedCustomer(t *testing.T) {
	client := testClient(t)
	ctx := auth.WithInternal(context.Background())
	u := client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(ctx)
	client.Subscription.Create().SetUser(u).SetSanctionedCredits(10000).SaveX(ctx)
	h := newStripeBillingHandler(client, "https://stripe.invalid")

	req := httptest.NewRequest(http.MethodPost, "/v1/billing/portal-session", nil)
	req = req.WithContext(auth.WithUser(ctx, u))
	rec := httptest.NewRecorder()
	h.PortalSession(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestStripeWebhookCheckoutCompletedUpdatesSubscription(t *testing.T) {
	client := testClient(t)
	ctx := auth.WithInternal(context.Background())
	u := client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(ctx)
	client.Subscription.Create().SetUser(u).SetSanctionedCredits(10000).SaveX(ctx)

	calls := map[string]int{}
	stripe := httptest.NewServer(stripeHandler(t, &calls))
	t.Cleanup(stripe.Close)
	h := newStripeBillingHandler(client, stripe.URL)

	payload := stripeEventPayload(t, "evt_checkout", "checkout.session.completed", map[string]any{
		"id":                  "cs_test_123",
		"customer":            "cus_test_123",
		"subscription":        "sub_test_123",
		"client_reference_id": u.ID.String(),
		"metadata": map[string]string{
			"user_id": u.ID.String(),
			"plan":    "starter",
		},
	})
	rec := postStripeWebhook(h, payload)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	sub := client.Subscription.Query().OnlyX(auth.WithUser(ctx, u))
	if sub.Plan != "starter" || sub.Status != "active" || sub.SanctionedCredits != 123000 {
		t.Fatalf("subscription = plan %q status %q credits %d", sub.Plan, sub.Status, sub.SanctionedCredits)
	}
	if sub.StripeCustomerID != "cus_test_123" || sub.StripeSubscriptionID != "sub_test_123" {
		t.Fatalf("stripe ids = customer %q subscription %q", sub.StripeCustomerID, sub.StripeSubscriptionID)
	}
	if got := client.CloudEvent.Query().Where(cloudevent.DedupeKeyEQ("evt_checkout")).CountX(auth.WithUser(ctx, u)); got != 1 {
		t.Fatalf("stripe event count = %d, want 1", got)
	}
}

func TestStripeWebhookDuplicateEventDoesNotReapply(t *testing.T) {
	client := testClient(t)
	ctx := auth.WithInternal(context.Background())
	u := client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(ctx)
	client.Subscription.Create().SetUser(u).SetSanctionedCredits(10000).SaveX(ctx)

	calls := map[string]int{}
	stripe := httptest.NewServer(stripeHandler(t, &calls))
	t.Cleanup(stripe.Close)
	h := newStripeBillingHandler(client, stripe.URL)

	payload := stripeEventPayload(t, "evt_duplicate", "checkout.session.completed", map[string]any{
		"id":                  "cs_test_123",
		"customer":            "cus_test_123",
		"subscription":        "sub_test_123",
		"client_reference_id": u.ID.String(),
		"metadata": map[string]string{
			"user_id": u.ID.String(),
			"plan":    "starter",
		},
	})
	for i := 0; i < 2; i++ {
		rec := postStripeWebhook(h, payload)
		if rec.Code != http.StatusOK {
			t.Fatalf("post %d: got %d: %s", i+1, rec.Code, rec.Body.String())
		}
	}
	if calls["GET /v1/subscriptions/sub_test_123"] != 1 {
		t.Fatalf("subscription retrieve calls = %d, want 1", calls["GET /v1/subscriptions/sub_test_123"])
	}
	if got := client.CloudEvent.Query().Where(cloudevent.DedupeKeyEQ("evt_duplicate")).CountX(auth.WithUser(ctx, u)); got != 1 {
		t.Fatalf("stripe event count = %d, want 1", got)
	}
}

func TestStripeWebhookInvalidSignature(t *testing.T) {
	client := testClient(t)
	h := newStripeBillingHandler(client, "https://stripe.invalid")
	payload := stripeEventPayload(t, "evt_bad_sig", "customer.subscription.updated", map[string]any{"id": "sub_test_123"})
	req := httptest.NewRequest(http.MethodPost, "/v1/billing/stripe/webhook", strings.NewReader(string(payload)))
	req.Header.Set("Stripe-Signature", "t=1,v1=bad")
	rec := httptest.NewRecorder()
	h.StripeWebhook(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestStripeWebhookExpiredSignature(t *testing.T) {
	client := testClient(t)
	h := newStripeBillingHandler(client, "https://stripe.invalid")
	payload := stripeEventPayload(t, "evt_old_sig", "customer.subscription.updated", map[string]any{"id": "sub_test_123"})
	req := httptest.NewRequest(http.MethodPost, "/v1/billing/stripe/webhook", strings.NewReader(string(payload)))
	req.Header.Set("Stripe-Signature", stripeSignature(payload, "whsec_rowboat", time.Now().Add(-10*time.Minute)))
	rec := httptest.NewRecorder()
	h.StripeWebhook(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestStripeSubscriptionUpdatedNormalizesBlockedStatus(t *testing.T) {
	client := testClient(t)
	ctx := auth.WithInternal(context.Background())
	u := client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(ctx)
	client.Subscription.Create().
		SetUser(u).
		SetPlan("pro").
		SetStatus("active").
		SetSanctionedCredits(456000).
		SetStripeCustomerID("cus_test_123").
		SetStripeSubscriptionID("sub_test_123").
		SaveX(ctx)
	h := newStripeBillingHandler(client, "https://stripe.invalid")

	payload := stripeEventPayload(t, "evt_unpaid", "customer.subscription.updated", map[string]any{
		"id":       "sub_test_123",
		"customer": "cus_test_123",
		"status":   "unpaid",
		"metadata": map[string]string{"plan": "pro"},
		"items": map[string]any{
			"data": []map[string]any{{"price": map[string]string{"id": "price_pro"}}},
		},
	})
	rec := postStripeWebhook(h, payload)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	sub := client.Subscription.Query().OnlyX(auth.WithUser(ctx, u))
	if sub.Plan != "pro" || sub.Status != "past_due" || sub.SanctionedCredits != 456000 {
		t.Fatalf("subscription = plan %q status %q credits %d", sub.Plan, sub.Status, sub.SanctionedCredits)
	}
}

func TestStripeInvoicePaymentFailedWithoutSubscriptionMarksPastDue(t *testing.T) {
	client := testClient(t)
	ctx := auth.WithInternal(context.Background())
	u := client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(ctx)
	client.Subscription.Create().
		SetUser(u).
		SetPlan("pro").
		SetStatus("active").
		SetSanctionedCredits(456000).
		SetStripeCustomerID("cus_test_123").
		SaveX(ctx)
	h := newStripeBillingHandler(client, "https://stripe.invalid")

	payload := stripeEventPayload(t, "evt_invoice_failed_customer", "invoice.payment_failed", map[string]any{
		"id":       "in_test_123",
		"customer": "cus_test_123",
	})
	rec := postStripeWebhook(h, payload)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	sub := client.Subscription.Query().OnlyX(auth.WithUser(ctx, u))
	if sub.Plan != "pro" || sub.Status != "past_due" || sub.SanctionedCredits != 456000 {
		t.Fatalf("subscription = plan %q status %q credits %d", sub.Plan, sub.Status, sub.SanctionedCredits)
	}
}

func TestStripeInvoicePaymentSucceededRetrievesSubscription(t *testing.T) {
	client := testClient(t)
	ctx := auth.WithInternal(context.Background())
	u := client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(ctx)
	client.Subscription.Create().
		SetUser(u).
		SetPlan("pro").
		SetStatus("past_due").
		SetSanctionedCredits(456000).
		SetStripeCustomerID("cus_test_123").
		SetStripeSubscriptionID("sub_test_123").
		SaveX(ctx)
	calls := map[string]int{}
	stripe := httptest.NewServer(stripeHandler(t, &calls))
	t.Cleanup(stripe.Close)
	h := newStripeBillingHandler(client, stripe.URL)

	payload := stripeEventPayload(t, "evt_invoice_succeeded", "invoice.payment_succeeded", map[string]any{
		"id":           "in_test_123",
		"customer":     "cus_test_123",
		"subscription": "sub_test_123",
	})
	rec := postStripeWebhook(h, payload)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if calls["GET /v1/subscriptions/sub_test_123"] != 1 {
		t.Fatalf("subscription retrieve calls = %d, want 1", calls["GET /v1/subscriptions/sub_test_123"])
	}
	sub := client.Subscription.Query().OnlyX(auth.WithUser(ctx, u))
	if sub.Plan != "starter" || sub.Status != "active" || sub.SanctionedCredits != 123000 {
		t.Fatalf("subscription = plan %q status %q credits %d", sub.Plan, sub.Status, sub.SanctionedCredits)
	}
}

func TestStripeSubscriptionPriceOverridesMetadataPlan(t *testing.T) {
	client := testClient(t)
	ctx := auth.WithInternal(context.Background())
	u := client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(ctx)
	client.Subscription.Create().
		SetUser(u).
		SetPlan("free").
		SetStatus("active").
		SetSanctionedCredits(10000).
		SetStripeCustomerID("cus_test_123").
		SetStripeSubscriptionID("sub_test_123").
		SaveX(ctx)
	h := newStripeBillingHandler(client, "https://stripe.invalid")

	payload := stripeEventPayload(t, "evt_price_wins", "customer.subscription.updated", map[string]any{
		"id":       "sub_test_123",
		"customer": "cus_test_123",
		"status":   "active",
		"metadata": map[string]string{"plan": "starter"},
		"items": map[string]any{
			"data": []map[string]any{{"price": map[string]string{"id": "price_pro"}}},
		},
	})
	rec := postStripeWebhook(h, payload)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	sub := client.Subscription.Query().OnlyX(auth.WithUser(ctx, u))
	if sub.Plan != "pro" || sub.Status != "active" || sub.SanctionedCredits != 456000 {
		t.Fatalf("subscription = plan %q status %q credits %d", sub.Plan, sub.Status, sub.SanctionedCredits)
	}
}

func TestStripeOutOfOrderWebhookFuzzDoesNotApplyStaleState(t *testing.T) {
	client := testClient(t)
	ctx := auth.WithInternal(context.Background())
	u := client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(ctx)
	client.Subscription.Create().
		SetUser(u).
		SetPlan("pro").
		SetStatus("active").
		SetSanctionedCredits(456000).
		SetStripeCustomerID("cus_test_123").
		SetStripeSubscriptionID("sub_test_123").
		SaveX(ctx)
	h := newStripeBillingHandler(client, "https://stripe.invalid")

	post := func(id, typ string, created int64, object any) map[string]any {
		t.Helper()
		rec := postStripeWebhook(h, stripeEventPayloadAt(t, id, typ, created, object))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: want 200, got %d: %s", id, rec.Code, rec.Body.String())
		}
		var body map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("%s: decode response: %v", id, err)
		}
		return body
	}
	subscriptionObject := func(status, price string) map[string]any {
		return map[string]any{
			"id":       "sub_test_123",
			"customer": "cus_test_123",
			"status":   status,
			"metadata": map[string]string{"plan": "pro"},
			"items": map[string]any{
				"data": []map[string]any{{"price": map[string]string{"id": price}}},
			},
		}
	}
	assertSub := func(plan, status string, credits int) {
		t.Helper()
		sub := client.Subscription.Query().OnlyX(auth.WithUser(ctx, u))
		if sub.Plan != plan || sub.Status != status || sub.SanctionedCredits != credits {
			t.Fatalf("subscription = plan %q status %q credits %d, want %s/%s/%d", sub.Plan, sub.Status, sub.SanctionedCredits, plan, status, credits)
		}
	}

	post("evt_fuzz_cancel_first", "customer.subscription.deleted", 100, subscriptionObject("active", "price_pro"))
	assertSub("pro", "canceled", 456000)
	post("evt_fuzz_active_newer", "customer.subscription.updated", 200, subscriptionObject("active", "price_pro"))
	assertSub("pro", "active", 456000)
	dup := post("evt_fuzz_cancel_first", "customer.subscription.deleted", 100, subscriptionObject("active", "price_pro"))
	if dup["duplicate"] != true {
		t.Fatalf("duplicate old cancel response = %+v, want duplicate=true", dup)
	}
	assertSub("pro", "active", 456000)
	staleCancel := post("evt_fuzz_cancel_stale_new_id", "customer.subscription.deleted", 150, subscriptionObject("active", "price_pro"))
	if staleCancel["stale"] != true {
		t.Fatalf("stale cancel response = %+v, want stale=true", staleCancel)
	}
	assertSub("pro", "active", 456000)
	post("evt_fuzz_invoice_failed_newer", "invoice.payment_failed", 300, map[string]any{
		"id":       "in_test_failed",
		"customer": "cus_test_123",
	})
	assertSub("pro", "past_due", 456000)
	staleSucceeded := post("evt_fuzz_invoice_succeeded_stale", "invoice.payment_succeeded", 250, map[string]any{
		"id":       "in_test_succeeded_stale",
		"customer": "cus_test_123",
	})
	if staleSucceeded["stale"] != true {
		t.Fatalf("stale payment success response = %+v, want stale=true", staleSucceeded)
	}
	assertSub("pro", "past_due", 456000)
	post("evt_fuzz_payment_recovered_newer", "customer.subscription.updated", 400, subscriptionObject("active", "price_pro"))
	assertSub("pro", "active", 456000)
}

func stripeEventPayload(t *testing.T, id, typ string, object any) []byte {
	t.Helper()
	return stripeEventPayloadAt(t, id, typ, 0, object)
}

func stripeEventPayloadAt(t *testing.T, id, typ string, created int64, object any) []byte {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"id":      id,
		"type":    typ,
		"created": created,
		"data":    map[string]any{"object": object},
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return payload
}

func postStripeWebhook(h *billing.Handler, payload []byte) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/v1/billing/stripe/webhook", strings.NewReader(string(payload)))
	req.Header.Set("Stripe-Signature", stripeSignature(payload, "whsec_rowboat", time.Now()))
	rec := httptest.NewRecorder()
	h.StripeWebhook(rec, req)
	return rec
}

func stripeSignature(payload []byte, secret string, ts time.Time) string {
	timestamp := ts.Unix()
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(strconv.FormatInt(timestamp, 10)))
	_, _ = mac.Write([]byte("."))
	_, _ = mac.Write(payload)
	return "t=" + strconv.FormatInt(timestamp, 10) + ",v1=" + hex.EncodeToString(mac.Sum(nil))
}
