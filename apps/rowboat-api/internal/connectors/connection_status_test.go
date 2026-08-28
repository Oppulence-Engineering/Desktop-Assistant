package connectors_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/connectors"
	"github.com/golang-jwt/jwt/v5"
)

const connectionStatusRegistry = `[{
  "name":"canvas",
  "displayName":"Canvas",
  "description":"Canvas",
  "mcpUrl":"https://canvas.example/mcp",
  "authType":"api_key",
  "audience":"canvas-api",
  "authoritativeEntitlementRequired":true,
  "environments":["development"],
  "scopes":[{"name":"canvas:invoices.read","displayName":"Read invoices","description":"Read invoices","grantTier":"required","risk":"low"}],
  "mcpTools":[{"name":"invoice.lookup","trustTier":"read"}]
}]`

type statusEntitlementRequest struct {
	Connector string   `json:"connector"`
	UserID    string   `json:"user_id"`
	OrgID     string   `json:"org_id"`
	Scopes    []string `json:"scopes"`
}

func TestConnectionStatusBindsEntitlementToTokenAndConnectionOrganization(t *testing.T) {
	for _, mode := range []string{"user", "organization"} {
		t.Run(mode+"-level entitlement", func(t *testing.T) {
			var mu sync.Mutex
			var requests []statusEntitlementRequest
			entitlement := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var req statusEntitlementRequest
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					http.Error(w, err.Error(), http.StatusBadRequest)
					return
				}
				mu.Lock()
				requests = append(requests, req)
				mu.Unlock()

				allowed := req.UserID == "user_1"
				if mode == "organization" {
					// Both organizations remain entitled. Re-deriving org-B from the
					// mutable user mirror would therefore incorrectly keep the org-A
					// token active after the membership switch.
					allowed = req.OrgID == "org-A" || req.OrgID == "org-B"
				}
				w.Header().Set("Content-Type", "application/json")
				if allowed {
					_, _ = w.Write([]byte(`{"allowed":true}`))
					return
				}
				_, _ = w.Write([]byte(`{"allowed":false,"reason":"no_subscription"}`))
			}))
			t.Cleanup(entitlement.Close)

			registry, err := connectors.LoadRegistry([]byte(connectionStatusRegistry))
			if err != nil {
				t.Fatal(err)
			}
			if err := registry.ConfigureProductEntitlements(
				map[string]string{"canvas": entitlement.URL},
				map[string]string{"canvas": "01234567890123456789012345678901"},
			); err != nil {
				t.Fatal(err)
			}
			client, owner, h := setup(t, registry)
			owner = client.User.UpdateOneID(owner.ID).SetWorkosOrgID("org-A").SaveX(auth.WithInternal(context.Background()))
			userCtx := auth.WithUser(context.Background(), owner)

			connected := httptest.NewRecorder()
			h.SetAPIKey(connected, httptest.NewRequest(http.MethodPost, "/v1/connections/canvas/api-key", strings.NewReader(`{"apiKey":"canvas-secret"}`)).
				WithContext(withParam(userCtx, "name", "canvas")))
			if connected.Code != http.StatusOK {
				t.Fatalf("connect org-A credential: status=%d body=%s", connected.Code, connected.Body.String())
			}

			minted := httptest.NewRecorder()
			h.MCPToken(minted, httptest.NewRequest(http.MethodPost, "/v1/connections/canvas/mcp-token", nil).
				WithContext(withParam(userCtx, "name", "canvas")))
			if minted.Code != http.StatusOK {
				t.Fatalf("mint org-A token: status=%d body=%s", minted.Code, minted.Body.String())
			}
			var tokenResponse struct {
				AccessToken string `json:"access_token"`
			}
			if err := json.Unmarshal(minted.Body.Bytes(), &tokenResponse); err != nil || tokenResponse.AccessToken == "" {
				t.Fatalf("decode resource token: err=%v body=%s", err, minted.Body.String())
			}
			binding := resourceTokenStatusBinding(t, tokenResponse.AccessToken)
			if binding["organization_id"] != "org-A" {
				t.Fatalf("issued token organization = %v, want org-A", binding["organization_id"])
			}

			status := func() (bool, int) {
				t.Helper()
				body, err := json.Marshal(binding)
				if err != nil {
					t.Fatal(err)
				}
				rec := httptest.NewRecorder()
				h.ConnectionStatus(rec, httptest.NewRequest(http.MethodPost, "/v1/internal/connections/status", strings.NewReader(string(body))).
					WithContext(invalidationContext("canvas-api", []string{"canvas"}, nil)))
				var response struct {
					Active bool `json:"active"`
				}
				if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
					t.Fatalf("decode status response: status=%d err=%v body=%s", rec.Code, err, rec.Body.String())
				}
				return response.Active, rec.Code
			}

			active, code := status()
			if code != http.StatusOK || !active {
				t.Fatalf("same-org token status: code=%d active=%v", code, active)
			}
			mu.Lock()
			callsBeforeSwitch := len(requests)
			for i, req := range requests {
				if req.OrgID != "org-A" {
					mu.Unlock()
					t.Fatalf("entitlement request %d organization = %q, want immutable org-A", i, req.OrgID)
				}
			}
			mu.Unlock()

			client.User.UpdateOneID(owner.ID).SetWorkosOrgID("org-B").ExecX(auth.WithInternal(context.Background()))
			active, code = status()
			if code != http.StatusOK || active {
				t.Fatalf("org-A token after owner switched to entitled org-B: code=%d active=%v", code, active)
			}
			mu.Lock()
			callsAfterSwitch := len(requests)
			mu.Unlock()
			if callsAfterSwitch != callsBeforeSwitch {
				t.Fatalf("organization mismatch reached product entitlement: calls before=%d after=%d", callsBeforeSwitch, callsAfterSwitch)
			}
		})
	}
}

func resourceTokenStatusBinding(t *testing.T, raw string) map[string]any {
	t.Helper()
	claims := jwt.MapClaims{}
	if _, _, err := new(jwt.Parser).ParseUnverified(raw, claims); err != nil {
		t.Fatalf("parse resource token: %v", err)
	}
	ext, ok := claims["ext"].(map[string]any)
	if !ok {
		t.Fatalf("resource token ext claims = %#v", claims["ext"])
	}
	audiences, err := claims.GetAudience()
	if err != nil || len(audiences) != 1 {
		t.Fatalf("resource token audience = %v, err=%v", audiences, err)
	}
	generation, ok := ext["credential_generation"].(float64)
	if !ok {
		t.Fatalf("resource token generation = %#v", ext["credential_generation"])
	}
	return map[string]any{
		"jti":                   claims["jti"],
		"connection_id":         ext["connection_id"],
		"workos_user_id":        ext["workos_user_id"],
		"organization_id":       ext["organization_id"],
		"connector":             ext["connector_id"],
		"credential_generation": int64(generation),
		"audience":              audiences[0],
	}
}
