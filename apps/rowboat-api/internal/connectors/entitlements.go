package connectors

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

const entitlementTimeout = 3 * time.Second

var authoritativeDenialReasons = map[string]struct{}{
	"no_subscription": {}, "scope_not_in_plan": {}, "user_banned": {},
	"org_mismatch": {}, "connector_disabled": {},
}

type entitlementDecision struct {
	Allowed bool   `json:"allowed"`
	Reason  string `json:"reason"`
}

// productEntitlement calls the product-owned source of truth. A configured
// endpoint is always authoritative and fails closed on timeout, malformed JSON,
// an unknown reason, or a response larger than 64 KiB.
func (h *Handler) productEntitlement(ctx context.Context, owner *ent.User, conn Connector, scopes []string) (bool, string) {
	if conn.EntitlementURL == "" {
		return h.localEntitlement(ctx, owner, conn, scopes)
	}
	if owner == nil {
		return false, "no_subscription"
	}
	u, err := url.Parse(conn.EntitlementURL)
	if err != nil {
		return false, "entitlement_unavailable"
	}
	q := u.Query()
	q.Set("user_id", owner.WorkosUserID)
	if owner.WorkosOrgID != "" {
		q.Set("org_id", owner.WorkosOrgID)
	}
	for _, scope := range scopes {
		q.Add("scope", scope)
	}
	u.RawQuery = q.Encode()
	cctx, cancel := context.WithTimeout(ctx, entitlementTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return false, "entitlement_unavailable"
	}
	client := outbound.NewClient(outbound.Policy{Name: "connector-entitlement", Timeout: entitlementTimeout, ResponseHeaderTimeout: 2 * time.Second, MaxConcurrent: 32, MaxResponseBytes: 64 << 10})
	resp, err := client.Do(req)
	if err != nil {
		return false, "entitlement_unavailable"
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return false, "entitlement_unavailable"
	}
	body, err := outbound.ReadAll(resp.Body, client.MaxResponseBytes())
	if err != nil {
		return false, "entitlement_unavailable"
	}
	var decision entitlementDecision
	dec := json.NewDecoder(strings.NewReader(string(body)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&decision); err != nil {
		return false, "entitlement_unavailable"
	}
	if decision.Allowed {
		if decision.Reason != "" {
			return false, "entitlement_unavailable"
		}
		return true, ""
	}
	if _, ok := authoritativeDenialReasons[decision.Reason]; !ok {
		return false, "entitlement_unavailable"
	}
	return false, decision.Reason
}

func validateEntitlementReason(reason string) error {
	if reason == "entitlement_unavailable" {
		return nil
	}
	if _, ok := authoritativeDenialReasons[reason]; !ok {
		return fmt.Errorf("unknown entitlement denial reason %q", reason)
	}
	return nil
}
