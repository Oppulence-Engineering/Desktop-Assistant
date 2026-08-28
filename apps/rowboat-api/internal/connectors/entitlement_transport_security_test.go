package connectors

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

type sequenceResolver struct {
	mu      sync.Mutex
	answers [][]netip.Addr
	calls   int
}

func (r *sequenceResolver) LookupNetIP(_ context.Context, _, _ string) ([]netip.Addr, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.answers) == 0 {
		return nil, fmt.Errorf("no answer")
	}
	index := r.calls
	if index >= len(r.answers) {
		index = len(r.answers) - 1
	}
	r.calls++
	return append([]netip.Addr(nil), r.answers[index]...), nil
}

func tlsFixtureClient(t *testing.T, handler http.Handler, resolver entitlementResolver, timeout time.Duration) (*http.Client, string) {
	t.Helper()
	server := httptest.NewTLSServer(handler)
	t.Cleanup(server.Close)
	pool := x509.NewCertPool()
	pool.AddCert(server.Certificate())
	target := server.Listener.Addr().String()
	client := newProductEntitlementClient(entitlementTransportOptions{
		resolver:  resolver,
		timeout:   timeout,
		tlsConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12},
		dialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, target)
		},
	})
	parsed, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	return client, "https://example.com:" + parsed.Port()
}

func TestProductionEntitlementTransportBlocksPrivateLinkLocalIPv6AndMixedDNS(t *testing.T) {
	blocked := [][]netip.Addr{
		{netip.MustParseAddr("127.0.0.1")},
		{netip.MustParseAddr("10.0.0.1")},
		{netip.MustParseAddr("169.254.169.254")},
		{netip.MustParseAddr("::1")},
		{netip.MustParseAddr("fc00::1")},
		{netip.MustParseAddr("8.8.8.8"), netip.MustParseAddr("127.0.0.1")},
	}
	for _, answer := range blocked {
		t.Run(answer[0].String(), func(t *testing.T) {
			var dials atomic.Int64
			client := newProductEntitlementClient(entitlementTransportOptions{
				resolver: &sequenceResolver{answers: [][]netip.Addr{answer}}, timeout: 100 * time.Millisecond,
				dialContext: func(context.Context, string, string) (net.Conn, error) {
					dials.Add(1)
					return nil, fmt.Errorf("must not dial")
				},
			})
			resp, err := client.Get("https://entitlement.example/v1/entitlements")
			if err == nil {
				_ = resp.Body.Close()
				t.Fatal("blocked DNS answer was accepted")
			}
			if dials.Load() != 0 {
				t.Fatal("transport dialed before rejecting the complete DNS answer set")
			}
		})
	}
}

func TestProductionEntitlementTransportRejectsDNSAnswerChangeToPrivate(t *testing.T) {
	var requests atomic.Int64
	resolver := &sequenceResolver{answers: [][]netip.Addr{{netip.MustParseAddr("8.8.8.8")}, {netip.MustParseAddr("127.0.0.1")}}}
	client, endpoint := tlsFixtureClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		_, _ = w.Write([]byte(`{"allowed":true}`))
	}), resolver, time.Second)
	resp, err := client.Get(endpoint)
	if err != nil {
		t.Fatalf("public DNS request failed: %v", err)
	}
	_ = resp.Body.Close()
	client.CloseIdleConnections()
	resp, err = client.Get(endpoint)
	if err == nil {
		_ = resp.Body.Close()
		t.Fatal("private DNS rebound answer was accepted")
	}
	if requests.Load() != 1 {
		t.Fatalf("server requests = %d, want only the pre-rebind request", requests.Load())
	}
}

func TestProductionEntitlementTransportBlocksRedirectsAndProxy(t *testing.T) {
	var redirectedHits atomic.Int64
	redirectTarget := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { redirectedHits.Add(1) }))
	defer redirectTarget.Close()
	resolver := &sequenceResolver{answers: [][]netip.Addr{{netip.MustParseAddr("8.8.8.8")}}}
	client, endpoint := tlsFixtureClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Location", redirectTarget.URL)
		w.WriteHeader(http.StatusFound)
	}), resolver, time.Second)
	resp, err := client.Get(endpoint)
	if err != nil {
		t.Fatalf("redirect response failed before policy evaluation: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusFound || redirectedHits.Load() != 0 {
		t.Fatalf("redirect followed: status=%d target_hits=%d", resp.StatusCode, redirectedHits.Load())
	}

	var proxyHits atomic.Int64
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		proxyHits.Add(1)
		http.Error(w, "proxy used", http.StatusBadGateway)
	}))
	defer proxy.Close()
	t.Setenv("HTTPS_PROXY", proxy.URL)
	t.Setenv("https_proxy", proxy.URL)
	resolver = &sequenceResolver{answers: [][]netip.Addr{{netip.MustParseAddr("8.8.8.8")}}}
	client, endpoint = tlsFixtureClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"allowed":true}`))
	}), resolver, time.Second)
	resp, err = client.Get(endpoint)
	if err != nil {
		t.Fatalf("direct request with hostile proxy environment failed: %v", err)
	}
	_ = resp.Body.Close()
	if proxyHits.Load() != 0 {
		t.Fatal("entitlement transport honored proxy environment")
	}
}

func TestProductionEntitlementTransportEnforcesTLSCertificateAndSNI(t *testing.T) {
	resolver := &sequenceResolver{answers: [][]netip.Addr{{netip.MustParseAddr("8.8.8.8")}}}
	client, endpoint := tlsFixtureClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"allowed":true}`))
	}), resolver, time.Second)
	resp, err := client.Get(endpoint)
	if err != nil {
		t.Fatalf("certificate for example.com was not accepted with pinned public dial: %v", err)
	}
	_ = resp.Body.Close()
	wrongEndpoint := strings.Replace(endpoint, "example.com", "wrong.example", 1)
	client.CloseIdleConnections()
	resp, err = client.Get(wrongEndpoint)
	if err == nil {
		_ = resp.Body.Close()
		t.Fatal("TLS certificate/SNI hostname mismatch was accepted")
	}
}

func TestEntitlementTransportHonorsExplicitCertificateFile(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"allowed":true}`))
	}))
	t.Cleanup(server.Close)
	certificateFile := t.TempDir() + "/entitlement-ca.pem"
	certificatePEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw})
	if err := os.WriteFile(certificateFile, certificatePEM, 0o600); err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	client := newProductEntitlementClient(entitlementTransportOptions{
		allowPrivate: true,
		caFile:       certificateFile,
		timeout:      time.Second,
	})
	resp, err := client.Get("https://127.0.0.1:" + parsed.Port())
	if err != nil {
		t.Fatalf("explicit entitlement CA was not trusted: %v", err)
	}
	if closeErr := resp.Body.Close(); closeErr != nil {
		t.Fatal(closeErr)
	}
}

func TestProductionEntitlementTransportBoundsSlowAndOversizedBodies(t *testing.T) {
	t.Run("slow", func(t *testing.T) {
		resolver := &sequenceResolver{answers: [][]netip.Addr{{netip.MustParseAddr("8.8.8.8")}}}
		client, endpoint := tlsFixtureClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
			time.Sleep(250 * time.Millisecond)
			_, _ = w.Write([]byte(`{"allowed":true}`))
		}), resolver, 75*time.Millisecond)
		resp, err := client.Get(endpoint)
		if err == nil {
			_, err = io.ReadAll(resp.Body)
			_ = resp.Body.Close()
		}
		if err == nil {
			t.Fatal("slow entitlement body exceeded timeout without failure")
		}
	})

	t.Run("oversized", func(t *testing.T) {
		resolver := &sequenceResolver{answers: [][]netip.Addr{{netip.MustParseAddr("8.8.8.8")}}}
		client, endpoint := tlsFixtureClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(strings.Repeat("x", entitlementMaxResponseBytes+1)))
		}), resolver, time.Second)
		resp, err := client.Get(endpoint)
		if err != nil {
			return // The transport may reject a declared oversized body before exposing it.
		}
		_, readErr := outbound.ReadAll(resp.Body, entitlementMaxResponseBytes)
		if closeErr := resp.Body.Close(); closeErr != nil {
			t.Fatalf("close oversized response: %v", closeErr)
		}
		if readErr == nil {
			t.Fatal("oversized entitlement response was accepted")
		}
	})
}
