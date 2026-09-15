package main

// Stripe and WorkOS mocks for account deletion.
//
// rowboat-api cancels every live Stripe subscription and deletes the WorkOS
// identity when a user deletes the account (DELETE /v1/me). Pointing
// STRIPE_API_BASE_URL and WORKOS_BASE_URL at devstack lets the local
// end-to-end suite (scripts/account-deletion-e2e.sh) run that path offline:
//
//	GET    /v1/subscriptions?customer=...&status=...[&starting_after=...]
//	GET    /v1/subscriptions/{id}
//	DELETE /v1/subscriptions/{id}
//	DELETE /user_management/users/{id}
//
// Fixture routes exist only when DEVSTACK_FIXTURE_SECRET is set, and each
// request must send that secret in the X-Devstack-Fixture-Secret header:
//
//	POST /fixture/stripe/subscriptions     {"id","customer","status"}
//	POST /fixture/stripe/cancel-failure    {"id","status"}
//	GET  /fixture/account-deletion/state
//	POST /fixture/account-deletion/reset

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"slices"
	"sort"
	"sync"
)

// stripeListPageSize is small on purpose: the API must follow has_more.
const stripeListPageSize = 2

type fixtureSubscription struct {
	Customer string `json:"customer"`
	Status   string `json:"status"`
}

type accountDeletionMocks struct {
	mu                 sync.Mutex
	subscriptions      map[string]*fixtureSubscription
	cancelFailures     map[string]int
	cancelled          []string
	deletedWorkOSUsers []string
}

func newAccountDeletionMocks() *accountDeletionMocks {
	return &accountDeletionMocks{subscriptions: map[string]*fixtureSubscription{}, cancelFailures: map[string]int{}}
}

func registerAccountDeletionMocks(mux *http.ServeMux, mocks *accountDeletionMocks, fixtureSecret string) {
	mux.HandleFunc("GET /v1/subscriptions", mocks.listSubscriptions)
	mux.HandleFunc("GET /v1/subscriptions/{id}", mocks.getSubscription)
	mux.HandleFunc("DELETE /v1/subscriptions/{id}", mocks.cancelSubscription)
	mux.HandleFunc("DELETE /user_management/users/{id}", mocks.deleteWorkOSUser)
	if fixtureSecret == "" {
		return
	}
	guard := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Devstack-Fixture-Secret")), []byte(fixtureSecret)) != 1 {
				http.Error(w, "fixture secret required", http.StatusForbidden)
				return
			}
			next(w, r)
		}
	}
	mux.HandleFunc("POST /fixture/stripe/subscriptions", guard(mocks.seedSubscription))
	mux.HandleFunc("POST /fixture/stripe/cancel-failure", guard(mocks.failCancel))
	mux.HandleFunc("GET /fixture/account-deletion/state", guard(mocks.state))
	mux.HandleFunc("POST /fixture/account-deletion/reset", guard(mocks.reset))
}

func stripeObject(id string, s *fixtureSubscription) map[string]any {
	return map[string]any{"id": id, "object": "subscription", "customer": s.Customer, "status": s.Status}
}

func stripeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{
		"type": "invalid_request_error", "code": code, "message": message,
	}})
}

func (m *accountDeletionMocks) listSubscriptions(w http.ResponseWriter, r *http.Request) {
	m.mu.Lock()
	defer m.mu.Unlock()
	q := r.URL.Query()
	status := q.Get("status")
	var ids []string
	for id, s := range m.subscriptions {
		if q.Get("customer") != "" && s.Customer != q.Get("customer") {
			continue
		}
		switch status {
		case "all":
		case "":
			// Stripe's default list hides ended subscriptions.
			if s.Status == "canceled" || s.Status == "incomplete_expired" {
				continue
			}
		default:
			if s.Status != status {
				continue
			}
		}
		ids = append(ids, id)
	}
	sort.Strings(ids)
	start := 0
	if after := q.Get("starting_after"); after != "" {
		if i := slices.Index(ids, after); i >= 0 {
			start = i + 1
		}
	}
	end := min(start+stripeListPageSize, len(ids))
	data := []any{}
	for _, id := range ids[start:end] {
		data = append(data, stripeObject(id, m.subscriptions[id]))
	}
	writeJSON(w, map[string]any{"object": "list", "url": "/v1/subscriptions", "has_more": end < len(ids), "data": data})
}

func (m *accountDeletionMocks) getSubscription(w http.ResponseWriter, r *http.Request) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id := r.PathValue("id")
	s, ok := m.subscriptions[id]
	if !ok {
		stripeError(w, http.StatusNotFound, "resource_missing", fmt.Sprintf("No such subscription: '%s'", id))
		return
	}
	writeJSON(w, stripeObject(id, s))
}

func (m *accountDeletionMocks) cancelSubscription(w http.ResponseWriter, r *http.Request) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id := r.PathValue("id")
	s, ok := m.subscriptions[id]
	if !ok {
		stripeError(w, http.StatusNotFound, "resource_missing", fmt.Sprintf("No such subscription: '%s'", id))
		return
	}
	if status := m.cancelFailures[id]; status != 0 {
		stripeError(w, status, "fixture_cancel_failure", "devstack fixture refused the cancel")
		return
	}
	if s.Status != "canceled" {
		s.Status = "canceled"
		m.cancelled = append(m.cancelled, id)
	}
	writeJSON(w, stripeObject(id, s))
}

func (m *accountDeletionMocks) deleteWorkOSUser(w http.ResponseWriter, r *http.Request) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.deletedWorkOSUsers = append(m.deletedWorkOSUsers, r.PathValue("id"))
	w.WriteHeader(http.StatusNoContent)
}

func decodeFixture(w http.ResponseWriter, r *http.Request, dst any) bool {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	if err == nil {
		err = json.Unmarshal(body, dst)
	}
	if err != nil {
		http.Error(w, "invalid fixture JSON", http.StatusBadRequest)
		return false
	}
	return true
}

func (m *accountDeletionMocks) seedSubscription(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID       string `json:"id"`
		Customer string `json:"customer"`
		Status   string `json:"status"`
	}
	if !decodeFixture(w, r, &req) {
		return
	}
	if req.ID == "" || req.Status == "" {
		http.Error(w, "id and status are required", http.StatusBadRequest)
		return
	}
	m.mu.Lock()
	m.subscriptions[req.ID] = &fixtureSubscription{Customer: req.Customer, Status: req.Status}
	m.mu.Unlock()
	writeJSON(w, map[string]bool{"ok": true})
}

func (m *accountDeletionMocks) failCancel(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID     string `json:"id"`
		Status int    `json:"status"`
	}
	if !decodeFixture(w, r, &req) {
		return
	}
	if req.ID == "" || req.Status < 400 || req.Status > 599 {
		http.Error(w, "id and a 4xx or 5xx status are required", http.StatusBadRequest)
		return
	}
	m.mu.Lock()
	m.cancelFailures[req.ID] = req.Status
	m.mu.Unlock()
	writeJSON(w, map[string]bool{"ok": true})
}

func (m *accountDeletionMocks) state(w http.ResponseWriter, _ *http.Request) {
	m.mu.Lock()
	defer m.mu.Unlock()
	writeJSON(w, map[string]any{
		"subscriptions":          m.subscriptions,
		"cancelledSubscriptions": append([]string{}, m.cancelled...),
		"deletedWorkOSUsers":     append([]string{}, m.deletedWorkOSUsers...),
	})
}

func (m *accountDeletionMocks) reset(w http.ResponseWriter, _ *http.Request) {
	m.mu.Lock()
	m.subscriptions = map[string]*fixtureSubscription{}
	m.cancelFailures = map[string]int{}
	m.cancelled = nil
	m.deletedWorkOSUsers = nil
	m.mu.Unlock()
	writeJSON(w, map[string]bool{"ok": true})
}
