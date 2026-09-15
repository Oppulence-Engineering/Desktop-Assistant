package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
)

const testFixtureSecret = "fixture-secret-for-tests"

func newAccountDeletionServer(t *testing.T, secret string) (*httptest.Server, *accountDeletionMocks) {
	t.Helper()
	mux := http.NewServeMux()
	mocks := newAccountDeletionMocks()
	registerAccountDeletionMocks(mux, mocks, secret)
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server, mocks
}

// doFixture sends one request and returns the status and the full body.
func doFixture(t *testing.T, method, url, body, secret string) (int, []byte) {
	t.Helper()
	req, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if secret != "" {
		req.Header.Set("X-Devstack-Fixture-Secret", secret)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, raw
}

func seed(t *testing.T, server *httptest.Server, id, customer, status string) {
	t.Helper()
	code, raw := doFixture(t, http.MethodPost, server.URL+"/fixture/stripe/subscriptions",
		fmt.Sprintf(`{"id":%q,"customer":%q,"status":%q}`, id, customer, status), testFixtureSecret)
	if code != http.StatusOK {
		t.Fatalf("seed %s = %d: %s", id, code, raw)
	}
}

type listPage struct {
	Object  string `json:"object"`
	HasMore bool   `json:"has_more"`
	Data    []struct {
		ID       string `json:"id"`
		Customer string `json:"customer"`
		Status   string `json:"status"`
	} `json:"data"`
}

func list(t *testing.T, server *httptest.Server, query string) listPage {
	t.Helper()
	_, raw := doFixture(t, http.MethodGet, server.URL+"/v1/subscriptions?"+query, "", "")
	var page listPage
	if err := json.Unmarshal(raw, &page); err != nil {
		t.Fatalf("list %q: %v (%s)", query, err, raw)
	}
	return page
}

func TestStripeMockListPagesThroughOneCustomer(t *testing.T) {
	server, _ := newAccountDeletionServer(t, testFixtureSecret)
	for _, id := range []string{"sub_a", "sub_b", "sub_c"} {
		seed(t, server, id, "cus_1", "active")
	}
	seed(t, server, "sub_other", "cus_2", "active")

	first := list(t, server, "customer=cus_1&status=all")
	if first.Object != "list" || !first.HasMore || len(first.Data) != 2 || first.Data[0].ID != "sub_a" {
		t.Fatalf("first page = %+v", first)
	}
	second := list(t, server, "customer=cus_1&status=all&starting_after=sub_b")
	if second.HasMore || len(second.Data) != 1 || second.Data[0].ID != "sub_c" {
		t.Fatalf("second page = %+v", second)
	}
}

func TestStripeMockListFiltersByStatusLikeStripe(t *testing.T) {
	server, _ := newAccountDeletionServer(t, testFixtureSecret)
	seed(t, server, "sub_live", "cus_1", "active")
	seed(t, server, "sub_ended", "cus_1", "canceled")

	if page := list(t, server, "customer=cus_1"); len(page.Data) != 1 || page.Data[0].ID != "sub_live" {
		t.Fatalf("default list = %+v, want only the live subscription", page)
	}
	if page := list(t, server, "customer=cus_1&status=all"); len(page.Data) != 2 {
		t.Fatalf("status=all list = %+v, want both", page)
	}
	if page := list(t, server, "customer=cus_1&status=canceled"); len(page.Data) != 1 || page.Data[0].ID != "sub_ended" {
		t.Fatalf("status=canceled list = %+v", page)
	}
}

func TestStripeMockCancelRecordsOnceAndMarksCanceled(t *testing.T) {
	server, mocks := newAccountDeletionServer(t, testFixtureSecret)
	seed(t, server, "sub_1", "cus_1", "active")

	for i := 0; i < 2; i++ {
		if code, raw := doFixture(t, http.MethodDelete, server.URL+"/v1/subscriptions/sub_1", "", ""); code != http.StatusOK {
			t.Fatalf("cancel %d = %d: %s", i, code, raw)
		}
	}
	if !slices.Equal(mocks.cancelled, []string{"sub_1"}) || mocks.subscriptions["sub_1"].Status != "canceled" {
		t.Fatalf("cancelled = %v, status = %s", mocks.cancelled, mocks.subscriptions["sub_1"].Status)
	}
}

func TestStripeMockReturnsResourceMissingForUnknownSubscriptions(t *testing.T) {
	server, _ := newAccountDeletionServer(t, testFixtureSecret)
	for _, method := range []string{http.MethodGet, http.MethodDelete} {
		code, raw := doFixture(t, method, server.URL+"/v1/subscriptions/sub_nope", "", "")
		var body struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = json.Unmarshal(raw, &body)
		if code != http.StatusNotFound || body.Error.Code != "resource_missing" {
			t.Errorf("%s unknown = %d %q", method, code, body.Error.Code)
		}
	}
}

func TestStripeMockCancelFailureFixtureRefusesWithoutCancelling(t *testing.T) {
	server, mocks := newAccountDeletionServer(t, testFixtureSecret)
	seed(t, server, "sub_1", "cus_1", "active")
	if code, raw := doFixture(t, http.MethodPost, server.URL+"/fixture/stripe/cancel-failure", `{"id":"sub_1","status":402}`, testFixtureSecret); code != http.StatusOK {
		t.Fatalf("cancel-failure fixture = %d: %s", code, raw)
	}
	if code, _ := doFixture(t, http.MethodDelete, server.URL+"/v1/subscriptions/sub_1", "", ""); code != http.StatusPaymentRequired {
		t.Fatalf("cancel = %d, want 402", code)
	}
	if len(mocks.cancelled) != 0 || mocks.subscriptions["sub_1"].Status != "active" {
		t.Fatal("a refused cancel still cancelled the subscription")
	}
}

func TestWorkOSMockRecordsIdentityDeletes(t *testing.T) {
	server, mocks := newAccountDeletionServer(t, testFixtureSecret)
	code, _ := doFixture(t, http.MethodDelete, server.URL+"/user_management/users/user_42", "", "")
	if code != http.StatusNoContent || !slices.Equal(mocks.deletedWorkOSUsers, []string{"user_42"}) {
		t.Fatalf("delete = %d, recorded = %v", code, mocks.deletedWorkOSUsers)
	}
}

func TestAccountDeletionFixturesRequireTheSecret(t *testing.T) {
	server, _ := newAccountDeletionServer(t, testFixtureSecret)
	for _, secret := range []string{"", "wrong-secret"} {
		if code, _ := doFixture(t, http.MethodGet, server.URL+"/fixture/account-deletion/state", "", secret); code != http.StatusForbidden {
			t.Errorf("secret %q: state = %d, want 403", secret, code)
		}
	}
}

func TestAccountDeletionFixturesAreAbsentWithoutASecret(t *testing.T) {
	server, _ := newAccountDeletionServer(t, "")
	if code, _ := doFixture(t, http.MethodGet, server.URL+"/fixture/account-deletion/state", "", "anything"); code != http.StatusNotFound {
		t.Fatalf("state without a configured secret = %d, want 404", code)
	}
	if code, _ := doFixture(t, http.MethodDelete, server.URL+"/user_management/users/u1", "", ""); code != http.StatusNoContent {
		t.Fatalf("vendor mocks must stay available without fixtures, got %d", code)
	}
}

func TestAccountDeletionFixtureStateAndReset(t *testing.T) {
	server, _ := newAccountDeletionServer(t, testFixtureSecret)
	seed(t, server, "sub_1", "cus_1", "active")
	doFixture(t, http.MethodDelete, server.URL+"/v1/subscriptions/sub_1", "", "")
	doFixture(t, http.MethodDelete, server.URL+"/user_management/users/user_1", "", "")

	type fixtureState struct {
		Cancelled []string `json:"cancelledSubscriptions"`
		Deleted   []string `json:"deletedWorkOSUsers"`
	}
	var state fixtureState
	_, raw := doFixture(t, http.MethodGet, server.URL+"/fixture/account-deletion/state", "", testFixtureSecret)
	if err := json.Unmarshal(raw, &state); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(state.Cancelled, []string{"sub_1"}) || !slices.Equal(state.Deleted, []string{"user_1"}) {
		t.Fatalf("state = %+v", state)
	}

	doFixture(t, http.MethodPost, server.URL+"/fixture/account-deletion/reset", "", testFixtureSecret)
	var after fixtureState
	_, raw = doFixture(t, http.MethodGet, server.URL+"/fixture/account-deletion/state", "", testFixtureSecret)
	if err := json.Unmarshal(raw, &after); err != nil {
		t.Fatal(err)
	}
	if len(after.Cancelled) != 0 || len(after.Deleted) != 0 {
		t.Fatalf("state after reset = %+v", after)
	}
	if page := list(t, server, "status=all"); len(page.Data) != 0 {
		t.Fatalf("subscriptions after reset = %+v", page)
	}
}

func TestAccountDeletionFixturesRejectBadInput(t *testing.T) {
	server, _ := newAccountDeletionServer(t, testFixtureSecret)
	cases := []struct{ path, body string }{
		{"/fixture/stripe/subscriptions", `{`},
		{"/fixture/stripe/subscriptions", `{"customer":"cus_1"}`},
		{"/fixture/stripe/cancel-failure", `{"id":"sub_1","status":200}`},
		{"/fixture/stripe/cancel-failure", `{"status":500}`},
	}
	for _, c := range cases {
		if code, _ := doFixture(t, http.MethodPost, server.URL+c.path, c.body, testFixtureSecret); code != http.StatusBadRequest {
			t.Errorf("%s %s = %d, want 400", c.path, c.body, code)
		}
	}
}
