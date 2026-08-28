package connectors

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/netip"
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
				if r.Method != http.MethodPost || r.Header.Get("X-Rowboat-Signature") == "" {
					t.Errorf("request was not a signed POST")
				}
				w.WriteHeader(tt.status)
				_, _ = w.Write([]byte(tt.body))
			}))
			defer s.Close()
			h := &Handler{}
			allowed, reason := h.productEntitlement(context.Background(), &ent.User{WorkosUserID: "user_1", WorkosOrgID: "org_1"}, "org_1", Connector{Name: "canvas", EntitlementURL: s.URL, entitlementKey: []byte("test-product-key-at-least-32-bytes"), allowPrivateEntitlement: true}, []string{"canvas:invoices.read"})
			if allowed != tt.wantAllowed || reason != tt.wantReason {
				t.Fatalf("got (%v,%q), want (%v,%q)", allowed, reason, tt.wantAllowed, tt.wantReason)
			}
		})
	}
}

func TestProductEntitlementConfigurationIsProductScoped(t *testing.T) {
	reg, err := LoadRegistryForEnvironment(nil, "production", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := reg.ConfigureProductEntitlementsJSON(`{"canvas":"https://product.example/v1/internal/entitlements"}`, `{}`); err == nil {
		t.Fatal("URL without a product-scoped signing key was accepted")
	}
	if err := reg.ConfigureProductEntitlementsJSON(`{"missing":"https://product.example/v1/internal/entitlements"}`, `{"missing":"01234567890123456789012345678901"}`); err == nil {
		t.Fatal("unknown connector entitlement configuration was accepted")
	}
	urls := make(map[string]string)
	keys := make(map[string]string)
	for _, connector := range reg.ordered {
		if connector.AuthoritativeEntitlementRequired && connector.Status == "enabled" {
			urls[connector.Name] = "https://product.example/v1/internal/entitlements/" + connector.Name
			keys[connector.Name] = "01234567890123456789012345678901"
		}
	}
	urls["canvas"] = "https://127.0.0.1/v1/internal/entitlements"
	if err := reg.ConfigureProductEntitlements(urls, keys); err != nil {
		t.Fatalf("static URL configuration should defer resolved-address enforcement to dial time: %v", err)
	}
	canvas, ok := reg.Get("canvas")
	if !ok || len(canvas.entitlementKey) != 32 || canvas.allowPrivateEntitlement {
		t.Fatal("production entitlement configuration was not applied securely")
	}
}

func TestPublicEntitlementIPRejectsPrivateAndSpecialAddresses(t *testing.T) {
	for _, raw := range []string{"127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fc00::1"} {
		if publicEntitlementIP(netip.MustParseAddr(raw)) {
			t.Fatalf("special/private address %s was allowed", raw)
		}
	}
	if !publicEntitlementIP(netip.MustParseAddr("8.8.8.8")) {
		t.Fatal("public address was rejected")
	}
}

func TestProductEntitlementTimeoutFailsClosed(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(entitlementTimeout + 100*time.Millisecond)
		_, _ = w.Write([]byte(`{"allowed":true}`))
	}))
	defer s.Close()
	h := &Handler{}
	allowed, reason := h.productEntitlement(context.Background(), &ent.User{WorkosUserID: "user_1", WorkosOrgID: "org_1"}, "org_1", Connector{Name: "canvas", EntitlementURL: s.URL, entitlementKey: []byte("test-product-key-at-least-32-bytes"), allowPrivateEntitlement: true}, nil)
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
