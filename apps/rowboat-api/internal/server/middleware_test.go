package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func realIPThrough(t *testing.T, cidrs []string, remoteAddr, xff string) string {
	t.Helper()
	var got string
	h := RealIPFromTrustedProxies(cidrs)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		got = r.RemoteAddr
	}))
	r := httptest.NewRequest(http.MethodGet, "/v1/auth/workos/login-url", nil)
	r.RemoteAddr = remoteAddr
	if xff != "" {
		r.Header.Set("X-Forwarded-For", xff)
	}
	h.ServeHTTP(httptest.NewRecorder(), r)
	return got
}

func TestRealIPFromTrustedProxies(t *testing.T) {
	trusted := []string{"10.0.0.0/8", "127.0.0.0/8"}

	// Trusted peer: the rightmost untrusted XFF entry is the client; entries
	// further left are client-supplied and must be ignored.
	if got := realIPThrough(t, trusted, "10.1.2.3:5000", "6.6.6.6, 203.0.113.9"); got != "203.0.113.9:0" {
		t.Fatalf("trusted peer: RemoteAddr = %q, want 203.0.113.9:0 (rightmost untrusted)", got)
	}
	// Trusted peer with trusted intermediate hops: skip them right-to-left.
	if got := realIPThrough(t, trusted, "10.1.2.3:5000", "203.0.113.9, 10.0.0.7"); got != "203.0.113.9:0" {
		t.Fatalf("trusted hops: RemoteAddr = %q, want 203.0.113.9:0", got)
	}
	// UNTRUSTED peer: a direct client cannot spoof its identity via XFF.
	if got := realIPThrough(t, trusted, "198.51.100.4:5000", "10.0.0.1"); got != "198.51.100.4:5000" {
		t.Fatalf("untrusted peer: RemoteAddr = %q, want unchanged", got)
	}
	// Garbage XFF from a trusted peer: keep RemoteAddr rather than trusting junk.
	if got := realIPThrough(t, trusted, "10.1.2.3:5000", "not-an-ip, 203.0.113.9, junk"); got != "10.1.2.3:5000" {
		t.Fatalf("garbage XFF: RemoteAddr = %q, want unchanged", got)
	}
	// No trusted CIDRs configured: middleware is a no-op.
	if got := realIPThrough(t, nil, "10.1.2.3:5000", "203.0.113.9"); got != "10.1.2.3:5000" {
		t.Fatalf("no CIDRs: RemoteAddr = %q, want unchanged", got)
	}
}
