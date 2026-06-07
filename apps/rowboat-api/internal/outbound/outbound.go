// Package outbound centralizes policy for calls to external vendors.
package outbound

import (
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

var (
	// ErrCircuitOpen is returned when a provider is in brownout.
	ErrCircuitOpen = errors.New("outbound circuit open")
	// ErrResponseTooLarge is returned when an upstream body exceeds policy.
	ErrResponseTooLarge = errors.New("upstream response too large")
)

// Policy configures an outbound vendor client or reverse-proxy transport.
type Policy struct {
	Name                  string
	Timeout               time.Duration
	ResponseHeaderTimeout time.Duration
	MaxConcurrent         int
	MaxResponseBytes      int64
	FailureThreshold      int
	Cooldown              time.Duration
}

// Client is an http.Client with rowboat's vendor-call policy applied.
type Client struct {
	*http.Client
	policy Policy
}

// NewClient builds a policy-backed client. A Timeout of 0 is allowed for
// streaming clients; request contexts still cancel the call.
func NewClient(policy Policy) *Client {
	rt := NewTransport(http.DefaultTransport, policy)
	return &Client{
		Client: &http.Client{
			Timeout:   policy.Timeout,
			Transport: rt,
		},
		policy: policy,
	}
}

// MaxResponseBytes reports the configured response cap.
func (c *Client) MaxResponseBytes() int64 {
	return c.policy.MaxResponseBytes
}

// NewTransport wraps base with concurrency, retry, circuit-breaker, and body
// limit behavior. It is safe for http.Client and httputil.ReverseProxy.
func NewTransport(base http.RoundTripper, policy Policy) http.RoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	policy = normalize(policy)
	return &transport{
		base:    cloneTransport(base, policy),
		policy:  policy,
		sem:     make(chan struct{}, policy.MaxConcurrent),
		breaker: newBreaker(policy.FailureThreshold, policy.Cooldown),
	}
}

func normalize(policy Policy) Policy {
	if policy.Name == "" {
		policy.Name = "vendor"
	}
	if policy.ResponseHeaderTimeout <= 0 {
		policy.ResponseHeaderTimeout = 15 * time.Second
	}
	if policy.MaxConcurrent <= 0 {
		policy.MaxConcurrent = 32
	}
	if policy.MaxResponseBytes <= 0 {
		policy.MaxResponseBytes = 32 << 20
	}
	if policy.FailureThreshold <= 0 {
		policy.FailureThreshold = 5
	}
	if policy.Cooldown <= 0 {
		policy.Cooldown = 30 * time.Second
	}
	return policy
}

func cloneTransport(base http.RoundTripper, policy Policy) http.RoundTripper {
	t, ok := base.(*http.Transport)
	if !ok {
		return base
	}
	cp := t.Clone()
	cp.ResponseHeaderTimeout = policy.ResponseHeaderTimeout
	cp.TLSHandshakeTimeout = 10 * time.Second
	cp.ExpectContinueTimeout = time.Second
	cp.MaxIdleConns = max(cp.MaxIdleConns, 128)
	cp.MaxIdleConnsPerHost = max(cp.MaxIdleConnsPerHost, policy.MaxConcurrent)
	cp.MaxConnsPerHost = max(cp.MaxConnsPerHost, policy.MaxConcurrent)
	if cp.DialContext == nil {
		dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
		cp.DialContext = dialer.DialContext
	}
	return cp
}

type transport struct {
	base    http.RoundTripper
	policy  Policy
	sem     chan struct{}
	breaker *breaker
}

func (t *transport) RoundTrip(req *http.Request) (*http.Response, error) {
	if !t.breaker.allow() {
		return nil, fmt.Errorf("%s: %w", t.policy.Name, ErrCircuitOpen)
	}
	select {
	case t.sem <- struct{}{}:
	case <-req.Context().Done():
		return nil, req.Context().Err()
	}

	resp, err := t.roundTripWithRetry(req)
	if err != nil {
		<-t.sem
		t.breaker.failure()
		return nil, err
	}
	if resp.StatusCode >= http.StatusInternalServerError {
		t.breaker.failure()
	} else {
		t.breaker.success()
	}
	resp.Body = &leaseBody{
		ReadCloser: NewMaxBytesReadCloser(resp.Body, t.policy.MaxResponseBytes),
		release: func() {
			<-t.sem
		},
	}
	return resp, nil
}

func (t *transport) roundTripWithRetry(req *http.Request) (*http.Response, error) {
	resp, err := t.base.RoundTrip(req)
	if !shouldRetry(req, resp, err) {
		return resp, err
	}
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	if req.Body != nil && req.GetBody == nil {
		return resp, err
	}
	if req.Body != nil {
		body, bodyErr := req.GetBody()
		if bodyErr != nil {
			return resp, err
		}
		req.Body = body
	}
	timer := time.NewTimer(150 * time.Millisecond)
	defer timer.Stop()
	select {
	case <-timer.C:
	case <-req.Context().Done():
		return nil, req.Context().Err()
	}
	return t.base.RoundTrip(req)
}

func shouldRetry(req *http.Request, resp *http.Response, err error) bool {
	if !idempotent(req) {
		return false
	}
	if err != nil {
		return true
	}
	return resp != nil && (resp.StatusCode == http.StatusBadGateway ||
		resp.StatusCode == http.StatusServiceUnavailable ||
		resp.StatusCode == http.StatusGatewayTimeout)
}

func idempotent(req *http.Request) bool {
	switch req.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	case http.MethodPut, http.MethodDelete:
		return true
	case http.MethodPost, http.MethodPatch:
		return strings.TrimSpace(req.Header.Get("Idempotency-Key")) != ""
	default:
		return false
	}
}

type leaseBody struct {
	io.ReadCloser
	once    sync.Once
	release func()
}

func (b *leaseBody) Close() error {
	err := b.ReadCloser.Close()
	b.once.Do(b.release)
	return err
}

// NewMaxBytesReadCloser returns a reader that permits exactly max bytes and
// returns ErrResponseTooLarge before exposing byte max+1.
func NewMaxBytesReadCloser(rc io.ReadCloser, maxBytes int64) io.ReadCloser {
	if maxBytes <= 0 {
		return rc
	}
	return &maxBytesReadCloser{rc: rc, remaining: maxBytes}
}

type maxBytesReadCloser struct {
	rc        io.ReadCloser
	remaining int64
	exceeded  bool
}

func (r *maxBytesReadCloser) Read(p []byte) (int, error) {
	if r.exceeded {
		return 0, ErrResponseTooLarge
	}
	if r.remaining == 0 {
		var one [1]byte
		n, err := r.rc.Read(one[:])
		if n > 0 {
			r.exceeded = true
			return 0, ErrResponseTooLarge
		}
		return 0, err
	}
	if int64(len(p)) > r.remaining {
		p = p[:r.remaining]
	}
	n, err := r.rc.Read(p)
	r.remaining -= int64(n)
	return n, err
}

func (r *maxBytesReadCloser) Close() error {
	return r.rc.Close()
}

// ReadAll reads and closes an upstream body through a response-size cap.
func ReadAll(rc io.ReadCloser, maxBytes int64) ([]byte, error) {
	defer func() { _ = rc.Close() }()
	return io.ReadAll(NewMaxBytesReadCloser(rc, maxBytes))
}

type breaker struct {
	mu        sync.Mutex
	failures  int
	threshold int
	openUntil time.Time
	cooldown  time.Duration
}

func newBreaker(threshold int, cooldown time.Duration) *breaker {
	return &breaker{threshold: threshold, cooldown: cooldown}
}

func (b *breaker) allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.openUntil.IsZero() || time.Now().After(b.openUntil)
}

func (b *breaker) success() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.failures = 0
	b.openUntil = time.Time{}
}

func (b *breaker) failure() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.failures++
	if b.failures >= b.threshold {
		b.openUntil = time.Now().Add(b.cooldown)
	}
}
