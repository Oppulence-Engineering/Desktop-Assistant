package billing_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"sort"
	"strings"
	"sync"
	"testing"

	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/billing"
)

const cancelSecretKey = "sk_test_cancel_subscriptions"

type fakeSubscription struct {
	customer string
	status   string
}

// subscriptionStripe serves the Stripe subscription endpoints that
// CancelSubscriptions calls, with knobs for pagination and failures.
type subscriptionStripe struct {
	t            *testing.T
	mu           sync.Mutex
	subs         map[string]*fakeSubscription
	pageSize     int
	listStatus   int
	cancelStatus map[string]int
	requests     []string
	cancelled    []string
}

func newSubscriptionStripe(t *testing.T) *subscriptionStripe {
	return &subscriptionStripe{t: t, subs: map[string]*fakeSubscription{}, cancelStatus: map[string]int{}}
}

func (f *subscriptionStripe) add(id, customer, status string) {
	f.subs[id] = &fakeSubscription{customer: customer, status: status}
}

func (f *subscriptionStripe) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.requests = append(f.requests, r.Method+" "+r.URL.Path+"?"+r.URL.RawQuery)
	if got := r.Header.Get("Authorization"); got != "Bearer "+cancelSecretKey {
		f.t.Errorf("Authorization header = %q, want the Stripe secret key", got)
	}
	w.Header().Set("Content-Type", "application/json")
	fail := func(status int, code string) {
		w.WriteHeader(status)
		_, _ = fmt.Fprintf(w, `{"error":{"type":"invalid_request_error","code":%q,"message":"Stripe detail about cus_private_detail"}}`, code)
	}
	encode := func(id string, s *fakeSubscription) map[string]any {
		return map[string]any{"id": id, "object": "subscription", "status": s.status, "customer": s.customer}
	}
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/v1/subscriptions":
		if f.listStatus != 0 {
			fail(f.listStatus, "list_failed")
			return
		}
		q := r.URL.Query()
		if q.Get("status") != "all" {
			f.t.Errorf("list status filter = %q, want all (a canceled filter would hide nothing, a default filter hides past_due)", q.Get("status"))
		}
		var ids []string
		for id, s := range f.subs {
			if s.customer == q.Get("customer") {
				ids = append(ids, id)
			}
		}
		sort.Strings(ids)
		start := 0
		if after := q.Get("starting_after"); after != "" {
			for i, id := range ids {
				if id == after {
					start = i + 1
				}
			}
		}
		end := len(ids)
		if f.pageSize > 0 && start+f.pageSize < end {
			end = start + f.pageSize
		}
		data := []any{}
		for _, id := range ids[start:end] {
			data = append(data, encode(id, f.subs[id]))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"object": "list", "url": "/v1/subscriptions", "has_more": end < len(ids), "data": data})
	case strings.HasPrefix(r.URL.Path, "/v1/subscriptions/"):
		id := strings.TrimPrefix(r.URL.Path, "/v1/subscriptions/")
		s, ok := f.subs[id]
		if !ok {
			fail(http.StatusNotFound, "resource_missing")
			return
		}
		if r.Method == http.MethodDelete {
			if status := f.cancelStatus[id]; status != 0 {
				fail(status, "cancel_failed")
				return
			}
			s.status = "canceled"
			f.cancelled = append(f.cancelled, id)
		}
		_ = json.NewEncoder(w).Encode(encode(id, s))
	default:
		f.t.Errorf("unexpected Stripe request %s %s", r.Method, r.URL.Path)
		w.WriteHeader(http.StatusNotFound)
	}
}

func (f *subscriptionStripe) calls(method string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, request := range f.requests {
		if strings.HasPrefix(request, method+" ") {
			n++
		}
	}
	return n
}

func (f *subscriptionStripe) cancelledIDs() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	ids := slices.Clone(f.cancelled)
	sort.Strings(ids)
	return ids
}

func newCancelHandler(t *testing.T, fake *subscriptionStripe) (*ent.Client, *billing.Handler) {
	t.Helper()
	client := testClient(t)
	server := httptest.NewServer(fake)
	t.Cleanup(server.Close)
	h := billing.New(client, 10000, 0, nil, zap.NewNop())
	h.ConfigureStripe(billing.StripeConfig{SecretKey: cancelSecretKey, APIBaseURL: server.URL})
	return client, h
}

func billedUser(t *testing.T, client *ent.Client, name, customerID, subscriptionID string) *ent.User {
	t.Helper()
	ctx := auth.WithInternal(context.Background())
	u := client.User.Create().SetEmail(name + "@example.test").SetWorkosUserID("user_" + name).SaveX(ctx)
	create := client.Subscription.Create().SetUser(u).SetSanctionedCredits(10000)
	if customerID != "" {
		create.SetStripeCustomerID(customerID)
	}
	if subscriptionID != "" {
		create.SetStripeSubscriptionID(subscriptionID)
	}
	create.SaveX(ctx)
	return u
}

func TestCancelSubscriptionsWithoutASubscriptionRowCallsNothing(t *testing.T) {
	fake := newSubscriptionStripe(t)
	client, h := newCancelHandler(t, fake)
	u := client.User.Create().SetEmail("free@example.test").SetWorkosUserID("user_free").SaveX(auth.WithInternal(context.Background()))

	n, err := h.CancelSubscriptions(context.Background(), u)
	if err != nil || n != 0 {
		t.Fatalf("CancelSubscriptions = %d, %v; want 0, nil", n, err)
	}
	if len(fake.requests) != 0 {
		t.Fatalf("Stripe requests = %v, want none", fake.requests)
	}
}

func TestCancelSubscriptionsWithoutStripeIDsCallsNothing(t *testing.T) {
	fake := newSubscriptionStripe(t)
	client, h := newCancelHandler(t, fake)
	u := billedUser(t, client, "trial", "", "")

	n, err := h.CancelSubscriptions(context.Background(), u)
	if err != nil || n != 0 {
		t.Fatalf("CancelSubscriptions = %d, %v; want 0, nil", n, err)
	}
	if len(fake.requests) != 0 {
		t.Fatalf("Stripe requests = %v, want none", fake.requests)
	}
}

func TestCancelSubscriptionsRefusesWhenABilledUserMeetsAnUnconfiguredStripe(t *testing.T) {
	client := testClient(t)
	h := billing.New(client, 10000, 0, nil, zap.NewNop()) // ConfigureStripe never called
	for _, ids := range [][2]string{{"cus_only", ""}, {"", "sub_only"}, {"cus_both", "sub_both"}} {
		u := billedUser(t, client, "unconfigured"+ids[0]+ids[1], ids[0], ids[1])
		n, err := h.CancelSubscriptions(context.Background(), u)
		if err == nil || n != 0 || !strings.Contains(err.Error(), "not configured") {
			t.Errorf("ids %v: CancelSubscriptions = %d, %v; want a not-configured error", ids, n, err)
		}
	}
}

func TestCancelSubscriptionsCancelsEveryStatusThatCanStillCharge(t *testing.T) {
	fake := newSubscriptionStripe(t)
	live := []string{"active", "trialing", "past_due", "unpaid", "incomplete", "paused"}
	for _, status := range live {
		fake.add("sub_"+status, "cus_1", status)
	}
	fake.add("sub_canceled", "cus_1", "canceled")
	fake.add("sub_expired", "cus_1", "incomplete_expired")
	client, h := newCancelHandler(t, fake)
	u := billedUser(t, client, "payer", "cus_1", "")

	n, err := h.CancelSubscriptions(context.Background(), u)
	if err != nil {
		t.Fatal(err)
	}
	if n != len(live) {
		t.Fatalf("cancelled count = %d, want %d", n, len(live))
	}
	want := []string{}
	for _, status := range live {
		want = append(want, "sub_"+status)
	}
	sort.Strings(want)
	if got := fake.cancelledIDs(); !slices.Equal(got, want) {
		t.Fatalf("cancelled = %v, want %v", got, want)
	}
}

func TestCancelSubscriptionsLeavesOtherStripeCustomersAlone(t *testing.T) {
	fake := newSubscriptionStripe(t)
	fake.add("sub_mine", "cus_mine", "active")
	fake.add("sub_theirs", "cus_theirs", "active")
	client, h := newCancelHandler(t, fake)
	u := billedUser(t, client, "mine", "cus_mine", "")

	if _, err := h.CancelSubscriptions(context.Background(), u); err != nil {
		t.Fatal(err)
	}
	if got := fake.cancelledIDs(); !slices.Equal(got, []string{"sub_mine"}) {
		t.Fatalf("cancelled = %v, want only sub_mine", got)
	}
	if fake.subs["sub_theirs"].status != "active" {
		t.Fatal("another customer's subscription was cancelled")
	}
}

func TestCancelSubscriptionsFollowsEveryListPage(t *testing.T) {
	fake := newSubscriptionStripe(t)
	fake.pageSize = 2
	for i := 1; i <= 5; i++ {
		fake.add(fmt.Sprintf("sub_%d", i), "cus_paged", "active")
	}
	client, h := newCancelHandler(t, fake)
	u := billedUser(t, client, "paged", "cus_paged", "")

	n, err := h.CancelSubscriptions(context.Background(), u)
	if err != nil || n != 5 {
		t.Fatalf("CancelSubscriptions = %d, %v; want 5, nil", n, err)
	}
	joined := strings.Join(fake.requests, "\n")
	for _, cursor := range []string{"starting_after=sub_2", "starting_after=sub_4"} {
		if !strings.Contains(joined, cursor) {
			t.Errorf("no list request with %s; requests:\n%s", cursor, joined)
		}
	}
}

func TestCancelSubscriptionsRetrievesALinkedSubscriptionMissingFromTheList(t *testing.T) {
	fake := newSubscriptionStripe(t)
	fake.add("sub_listed", "cus_1", "active")
	fake.add("sub_legacy", "cus_legacy", "active") // linked locally, billed to an older customer
	client, h := newCancelHandler(t, fake)
	u := billedUser(t, client, "legacy", "cus_1", "sub_legacy")

	n, err := h.CancelSubscriptions(context.Background(), u)
	if err != nil || n != 2 {
		t.Fatalf("CancelSubscriptions = %d, %v; want 2, nil", n, err)
	}
	if got := fake.cancelledIDs(); !slices.Equal(got, []string{"sub_legacy", "sub_listed"}) {
		t.Fatalf("cancelled = %v", got)
	}
}

func TestCancelSubscriptionsWithOnlyALinkedSubscriptionSkipsTheList(t *testing.T) {
	fake := newSubscriptionStripe(t)
	fake.add("sub_linked", "cus_unknown_locally", "active")
	client, h := newCancelHandler(t, fake)
	u := billedUser(t, client, "linked", "", "sub_linked")

	n, err := h.CancelSubscriptions(context.Background(), u)
	if err != nil || n != 1 {
		t.Fatalf("CancelSubscriptions = %d, %v; want 1, nil", n, err)
	}
	for _, request := range fake.requests {
		if strings.HasPrefix(request, "GET /v1/subscriptions?") {
			t.Fatalf("listed subscriptions without a customer id: %v", fake.requests)
		}
	}
}

func TestCancelSubscriptionsIgnoresALinkedSubscriptionThatStripeNoLongerHas(t *testing.T) {
	fake := newSubscriptionStripe(t)
	client, h := newCancelHandler(t, fake)
	u := billedUser(t, client, "gone", "", "sub_deleted_in_stripe")

	n, err := h.CancelSubscriptions(context.Background(), u)
	if err != nil || n != 0 {
		t.Fatalf("CancelSubscriptions = %d, %v; want 0, nil", n, err)
	}
	if fake.calls(http.MethodDelete) != 0 {
		t.Fatal("sent a cancel for a subscription Stripe does not have")
	}
}

func TestCancelSubscriptionsDoesNotCancelAnAlreadyCanceledLinkedSubscription(t *testing.T) {
	fake := newSubscriptionStripe(t)
	fake.add("sub_done", "cus_other", "canceled")
	client, h := newCancelHandler(t, fake)
	u := billedUser(t, client, "done", "", "sub_done")

	n, err := h.CancelSubscriptions(context.Background(), u)
	if err != nil || n != 0 {
		t.Fatalf("CancelSubscriptions = %d, %v; want 0, nil", n, err)
	}
	if fake.calls(http.MethodDelete) != 0 {
		t.Fatal("cancelled a subscription that was already canceled")
	}
}

func TestCancelSubscriptionsToleratesASubscriptionThatDisappearsMidCancel(t *testing.T) {
	fake := newSubscriptionStripe(t)
	fake.add("sub_race", "cus_1", "active")
	fake.cancelStatus["sub_race"] = http.StatusNotFound
	client, h := newCancelHandler(t, fake)
	u := billedUser(t, client, "race", "cus_1", "")

	n, err := h.CancelSubscriptions(context.Background(), u)
	if err != nil || n != 0 {
		t.Fatalf("CancelSubscriptions = %d, %v; want 0, nil", n, err)
	}
}

func TestCancelSubscriptionsFailsWhenStripeRefusesACancel(t *testing.T) {
	for _, status := range []int{http.StatusBadRequest, http.StatusPaymentRequired, http.StatusForbidden} {
		fake := newSubscriptionStripe(t)
		fake.add("sub_stuck", "cus_1", "active")
		fake.cancelStatus["sub_stuck"] = status
		client, h := newCancelHandlerNamed(t, fake, fmt.Sprintf("refuse%d", status))
		u := billedUser(t, client, fmt.Sprintf("stuck%d", status), "cus_1", "")

		n, err := h.CancelSubscriptions(context.Background(), u)
		if err == nil || n != 0 {
			t.Fatalf("status %d: CancelSubscriptions = %d, %v; want an error", status, n, err)
		}
		if !strings.Contains(err.Error(), fmt.Sprint(status)) {
			t.Errorf("status %d: error %q does not name the status", status, err)
		}
		if strings.Contains(err.Error(), "cus_private_detail") {
			t.Errorf("status %d: error leaks the Stripe message: %q", status, err)
		}
	}
}

func TestCancelSubscriptionsFailsWithoutLeakingTheStripeMessageWhenListingFails(t *testing.T) {
	fake := newSubscriptionStripe(t)
	fake.listStatus = http.StatusUnauthorized
	client, h := newCancelHandler(t, fake)
	u := billedUser(t, client, "badkey", "cus_1", "")

	n, err := h.CancelSubscriptions(context.Background(), u)
	if err == nil || n != 0 {
		t.Fatalf("CancelSubscriptions = %d, %v; want an error", n, err)
	}
	if strings.Contains(err.Error(), "cus_private_detail") || !strings.Contains(err.Error(), "401") {
		t.Fatalf("error = %q; want the status without the Stripe message", err)
	}
	if fake.calls(http.MethodDelete) != 0 {
		t.Fatal("cancelled after the list failed")
	}
}

func TestCancelSubscriptionsOnlyUsesTheGivenUsersBillingRow(t *testing.T) {
	fake := newSubscriptionStripe(t)
	fake.add("sub_a", "cus_a", "active")
	fake.add("sub_b", "cus_b", "active")
	client, h := newCancelHandler(t, fake)
	a := billedUser(t, client, "a", "cus_a", "sub_a")
	billedUser(t, client, "b", "cus_b", "sub_b")

	if _, err := h.CancelSubscriptions(context.Background(), a); err != nil {
		t.Fatal(err)
	}
	if got := fake.cancelledIDs(); !slices.Equal(got, []string{"sub_a"}) {
		t.Fatalf("cancelled = %v, want only sub_a", got)
	}
}

func TestCancelSubscriptionsIsSafeToRunTwice(t *testing.T) {
	fake := newSubscriptionStripe(t)
	fake.add("sub_once", "cus_1", "active")
	client, h := newCancelHandler(t, fake)
	u := billedUser(t, client, "twice", "cus_1", "sub_once")

	first, err := h.CancelSubscriptions(context.Background(), u)
	if err != nil || first != 1 {
		t.Fatalf("first run = %d, %v", first, err)
	}
	second, err := h.CancelSubscriptions(context.Background(), u)
	if err != nil || second != 0 {
		t.Fatalf("second run = %d, %v; want 0, nil", second, err)
	}
	if fake.calls(http.MethodDelete) != 1 {
		t.Fatalf("DELETE calls = %d, want 1", fake.calls(http.MethodDelete))
	}
}

func TestCancelSubscriptionsStopsWhenTheContextIsCancelled(t *testing.T) {
	fake := newSubscriptionStripe(t)
	fake.add("sub_ctx", "cus_1", "active")
	client, h := newCancelHandler(t, fake)
	u := billedUser(t, client, "ctx", "cus_1", "")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := h.CancelSubscriptions(ctx, u); err == nil {
		t.Fatal("CancelSubscriptions succeeded with a cancelled context")
	}
	if fake.calls(http.MethodDelete) != 0 {
		t.Fatal("cancelled a subscription with a cancelled context")
	}
}

// newCancelHandlerNamed gives each loop iteration its own in-memory database.
func newCancelHandlerNamed(t *testing.T, fake *subscriptionStripe, name string) (*ent.Client, *billing.Handler) {
	t.Helper()
	var client *ent.Client
	t.Run(name, func(sub *testing.T) { client = testClientNamed(t, sub.Name()) })
	server := httptest.NewServer(fake)
	t.Cleanup(server.Close)
	h := billing.New(client, 10000, 0, nil, zap.NewNop())
	h.ConfigureStripe(billing.StripeConfig{SecretKey: cancelSecretKey, APIBaseURL: server.URL})
	return client, h
}
