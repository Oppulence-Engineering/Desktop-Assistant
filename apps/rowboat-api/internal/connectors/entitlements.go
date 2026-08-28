package connectors

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/connectormetrics"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	oauthrs "github.com/Oppulence-Engineering/rowboat/packages/oauth-resource-server-go"
)

const entitlementTimeout = 3 * time.Second

const entitlementMaxResponseBytes = 64 << 10

var entitlementClients sync.Map

type entitlementClientKey struct {
	allowPrivate bool
	caFile       string
}

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
func (h *Handler) productEntitlement(ctx context.Context, owner *ent.User, organizationID string, conn Connector, scopes []string) (bool, string) {
	if owner == nil || organizationID == "" || connectorOrganizationID(owner) != organizationID {
		return false, "org_mismatch"
	}
	if conn.EntitlementURL == "" {
		return h.localEntitlement(ctx, owner, conn, scopes)
	}
	return authoritativeProductEntitlement(ctx, owner, organizationID, conn, scopes)
}

// authoritativeProductEntitlement is the single signed transport used by both
// the HTTP broker and worker-side token minting. Keeping signing, SSRF policy,
// response bounds, and denial normalization here prevents worker execution from
// drifting into a weaker entitlement protocol.
func authoritativeProductEntitlement(ctx context.Context, owner *ent.User, organizationID string, conn Connector, scopes []string) (bool, string) {
	if owner == nil || organizationID == "" || connectorOrganizationID(owner) != organizationID {
		return false, "org_mismatch"
	}
	if len(conn.entitlementKey) < 32 {
		return entitlementUnavailable(conn.Name, "signing_key")
	}
	canonicalScopes := append([]string(nil), scopes...)
	sort.Strings(canonicalScopes)
	body, err := json.Marshal(entitlementRequest{Connector: conn.Name, UserID: owner.WorkosUserID, OrgID: organizationID, Scopes: canonicalScopes})
	if err != nil {
		return entitlementUnavailable(conn.Name, "request_encode")
	}
	cctx, cancel := context.WithTimeout(ctx, entitlementTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodPost, conn.EntitlementURL, bytes.NewReader(body))
	if err != nil {
		return entitlementUnavailable(conn.Name, "request_build")
	}
	timestamp := time.Now().UTC().Format(time.RFC3339)
	requestID, err := oauthrs.NewEntitlementRequestID()
	if err != nil {
		return entitlementUnavailable(conn.Name, "request_id")
	}
	signature, err := oauthrs.SignEntitlementRequest(conn.entitlementKey, timestamp, requestID, body)
	if err != nil {
		return entitlementUnavailable(conn.Name, "request_sign")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(oauthrs.EntitlementConnectorHeader, conn.Name)
	req.Header.Set(oauthrs.EntitlementTimestampHeader, timestamp)
	req.Header.Set(oauthrs.EntitlementRequestIDHeader, requestID)
	req.Header.Set(oauthrs.EntitlementSignatureHeader, signature)
	client := productEntitlementClient(conn.allowPrivateEntitlement)
	resp, err := client.Do(req)
	if err != nil {
		return entitlementUnavailable(conn.Name, "transport")
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return entitlementUnavailable(conn.Name, "upstream_status")
	}
	body, err = outbound.ReadAll(resp.Body, entitlementMaxResponseBytes)
	if err != nil {
		return entitlementUnavailable(conn.Name, "response_read")
	}
	var decision entitlementDecision
	dec := json.NewDecoder(strings.NewReader(string(body)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&decision); err != nil {
		return entitlementUnavailable(conn.Name, "response_decode")
	}
	if decision.Allowed {
		if decision.Reason != "" {
			return entitlementUnavailable(conn.Name, "inconsistent_allow")
		}
		return true, ""
	}
	if _, ok := authoritativeDenialReasons[decision.Reason]; !ok {
		return entitlementUnavailable(conn.Name, "unknown_denial")
	}
	return false, decision.Reason
}

func entitlementUnavailable(connector, cause string) (bool, string) {
	connectormetrics.EntitlementUnavailable.WithLabelValues(connector, cause).Inc()
	return false, "entitlement_unavailable"
}

func productEntitlementClient(allowPrivate bool) *http.Client {
	key := entitlementClientKey{allowPrivate: allowPrivate, caFile: strings.TrimSpace(os.Getenv("SSL_CERT_FILE"))}
	if cached, ok := entitlementClients.Load(key); ok {
		return cached.(*http.Client)
	}
	client := newProductEntitlementClient(entitlementTransportOptions{allowPrivate: allowPrivate, caFile: key.caFile})
	actual, _ := entitlementClients.LoadOrStore(key, client)
	return actual.(*http.Client)
}

type entitlementResolver interface {
	LookupNetIP(context.Context, string, string) ([]netip.Addr, error)
}

type entitlementTransportOptions struct {
	allowPrivate bool
	resolver     entitlementResolver
	dialContext  func(context.Context, string, string) (net.Conn, error)
	tlsConfig    *tls.Config
	caFile       string
	timeout      time.Duration
}

func newProductEntitlementClient(options entitlementTransportOptions) *http.Client {
	timeout := options.timeout
	if timeout <= 0 {
		timeout = entitlementTimeout
	}
	resolver := options.resolver
	if resolver == nil {
		resolver = net.DefaultResolver
	}
	dialContext := options.dialContext
	if dialContext == nil {
		dialer := &net.Dialer{Timeout: 2 * time.Second, KeepAlive: 30 * time.Second}
		dialContext = dialer.DialContext
	}
	base := http.DefaultTransport.(*http.Transport).Clone()
	base.Proxy = nil
	if options.tlsConfig != nil {
		base.TLSClientConfig = options.tlsConfig.Clone()
	} else {
		roots, err := x509.SystemCertPool()
		if err != nil || roots == nil {
			roots = x509.NewCertPool()
		}
		if options.caFile != "" {
			if pemBytes, readErr := os.ReadFile(options.caFile); readErr == nil {
				roots.AppendCertsFromPEM(pemBytes)
			}
		}
		base.TLSClientConfig = &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}
	}
	base.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := resolver.LookupNetIP(ctx, "ip", host)
		if err != nil {
			return nil, fmt.Errorf("resolve entitlement host: %w", err)
		}
		if len(ips) == 0 {
			return nil, fmt.Errorf("resolve entitlement host: no addresses")
		}
		for _, ip := range ips {
			if !options.allowPrivate && !publicEntitlementIP(ip) {
				return nil, fmt.Errorf("entitlement host resolved to a disallowed address")
			}
		}
		return dialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
	}
	return &http.Client{
		Timeout:       timeout,
		Transport:     outbound.NewTransport(base, outbound.Policy{Name: "connector-entitlement", Timeout: timeout, ResponseHeaderTimeout: min(timeout, 2*time.Second), MaxConcurrent: 32, MaxResponseBytes: entitlementMaxResponseBytes}),
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	}
}

func publicEntitlementIP(ip netip.Addr) bool {
	return ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !ip.IsLinkLocalMulticast()
}
