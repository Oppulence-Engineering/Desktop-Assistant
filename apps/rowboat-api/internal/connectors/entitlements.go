package connectors

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

const entitlementTimeout = 3 * time.Second

const entitlementMaxResponseBytes = 64 << 10

var entitlementClients sync.Map

var authoritativeDenialReasons = map[string]struct{}{
	"no_subscription": {}, "scope_not_in_plan": {}, "user_banned": {},
	"org_mismatch": {}, "connector_disabled": {},
}

type entitlementDecision struct {
	Allowed bool   `json:"allowed"`
	Reason  string `json:"reason"`
}

type entitlementRequest struct {
	Connector string   `json:"connector"`
	UserID    string   `json:"user_id"`
	OrgID     string   `json:"org_id,omitempty"`
	Scopes    []string `json:"scopes"`
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
	if len(conn.entitlementKey) < 32 {
		return false, "entitlement_unavailable"
	}
	canonicalScopes := append([]string(nil), scopes...)
	sort.Strings(canonicalScopes)
	body, err := json.Marshal(entitlementRequest{Connector: conn.Name, UserID: owner.WorkosUserID, OrgID: owner.WorkosOrgID, Scopes: canonicalScopes})
	if err != nil {
		return false, "entitlement_unavailable"
	}
	cctx, cancel := context.WithTimeout(ctx, entitlementTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodPost, conn.EntitlementURL, bytes.NewReader(body))
	if err != nil {
		return false, "entitlement_unavailable"
	}
	timestamp := time.Now().UTC().Format(time.RFC3339)
	mac := hmac.New(sha256.New, conn.entitlementKey)
	_, _ = mac.Write([]byte(timestamp))
	_, _ = mac.Write([]byte("\n"))
	_, _ = mac.Write(body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Rowboat-Connector", conn.Name)
	req.Header.Set("X-Rowboat-Timestamp", timestamp)
	req.Header.Set("X-Rowboat-Signature", fmt.Sprintf("sha256=%x", mac.Sum(nil)))
	client := productEntitlementClient(conn.allowPrivateEntitlement)
	resp, err := client.Do(req)
	if err != nil {
		return false, "entitlement_unavailable"
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return false, "entitlement_unavailable"
	}
	body, err = outbound.ReadAll(resp.Body, entitlementMaxResponseBytes)
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

func productEntitlementClient(allowPrivate bool) *http.Client {
	if cached, ok := entitlementClients.Load(allowPrivate); ok {
		return cached.(*http.Client)
	}
	dialer := &net.Dialer{Timeout: 2 * time.Second, KeepAlive: 30 * time.Second}
	base := http.DefaultTransport.(*http.Transport).Clone()
	base.Proxy = nil
	base.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil || len(ips) == 0 {
			return nil, fmt.Errorf("resolve entitlement host: %w", err)
		}
		for _, ip := range ips {
			if !allowPrivate && !publicEntitlementIP(ip) {
				continue
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		}
		return nil, fmt.Errorf("entitlement host resolved only to disallowed addresses")
	}
	client := &http.Client{
		Timeout:       entitlementTimeout,
		Transport:     outbound.NewTransport(base, outbound.Policy{Name: "connector-entitlement", Timeout: entitlementTimeout, ResponseHeaderTimeout: 2 * time.Second, MaxConcurrent: 32, MaxResponseBytes: entitlementMaxResponseBytes}),
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	}
	actual, _ := entitlementClients.LoadOrStore(allowPrivate, client)
	return actual.(*http.Client)
}

func publicEntitlementIP(ip netip.Addr) bool {
	return ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !ip.IsLinkLocalMulticast()
}
