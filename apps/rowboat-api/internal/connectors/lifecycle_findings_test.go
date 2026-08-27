package connectors

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
)

func TestProductEntitlementStrictValidation(t *testing.T) {
	tests := []struct {
		name, body, wantReason string
		status                 int
		wantAllowed            bool
	}{
		{name: "allowed", body: `{"allowed":true,"reason":""}`, status: 200, wantAllowed: true},
		{name: "authoritative denial", body: `{"allowed":false,"reason":"user_banned"}`, status: 200, wantReason: "user_banned"},
		{name: "unknown denial", body: `{"allowed":false,"reason":"billing_weird"}`, status: 200, wantReason: "entitlement_unavailable"},
		{name: "unknown field", body: `{"allowed":true,"extra":1}`, status: 200, wantReason: "entitlement_unavailable"},
		{name: "upstream failure", body: `{}`, status: 503, wantReason: "entitlement_unavailable"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Query().Get("user_id") != "user_1" {
					t.Errorf("missing user_id")
				}
				w.WriteHeader(tt.status)
				_, _ = w.Write([]byte(tt.body))
			}))
			defer s.Close()
			h := &Handler{}
			allowed, reason := h.productEntitlement(context.Background(), &ent.User{WorkosUserID: "user_1"}, Connector{EntitlementURL: s.URL}, []string{"canvas:invoices.read"})
			if allowed != tt.wantAllowed || reason != tt.wantReason {
				t.Fatalf("got (%v,%q), want (%v,%q)", allowed, reason, tt.wantAllowed, tt.wantReason)
			}
		})
	}
}

func TestProductEntitlementTimeoutFailsClosed(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(entitlementTimeout + 100*time.Millisecond)
		_, _ = w.Write([]byte(`{"allowed":true}`))
	}))
	defer s.Close()
	h := &Handler{}
	allowed, reason := h.productEntitlement(context.Background(), &ent.User{WorkosUserID: "user_1"}, Connector{EntitlementURL: s.URL}, nil)
	if allowed || reason != "entitlement_unavailable" {
		t.Fatalf("timeout did not fail closed: %v %q", allowed, reason)
	}
}

func TestRefreshFamilyInvalidationClassification(t *testing.T) {
	if !isRefreshFamilyInvalidation(&oauthEndpointError{Code: "invalid_grant", Description: "refresh token reuse detected; token family invalidated"}) {
		t.Fatal("reuse was not classified")
	}
	if isRefreshFamilyInvalidation(&oauthEndpointError{Code: "invalid_grant", Description: "expired refresh token"}) {
		t.Fatal("ordinary expiry was classified as reuse")
	}
}
