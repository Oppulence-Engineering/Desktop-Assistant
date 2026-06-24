// Package faculties is the HTTP client for the Oppulence portfolio faculties
// (RFC 008): Conduit (the evidence plane) and Eigen (the foresight engine). The
// cloud agent reaches each faculty as a runtime tool that POSTs an operation to
// the faculty's configured endpoint, authenticated with a server-held service
// key plus the acting user's id (on-behalf-of — the RFC 018 delegation seam, a
// minimal header today; a signed A2A delegation token is the follow-up). The
// service key stays server-side and never enters model prompts or logs.
package faculties

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

// Client calls one faculty's HTTP API.
type Client struct {
	http    *outbound.Client
	baseURL string
	apiKey  string
	name    string
}

// New builds a faculty client. Returns nil when the faculty is not configured
// (no base URL or no key), so the corresponding tool reports itself unavailable
// rather than calling an unauthenticated endpoint.
func New(name, baseURL, apiKey string, policy outbound.Policy) *Client {
	if strings.TrimSpace(baseURL) == "" || strings.TrimSpace(apiKey) == "" {
		return nil
	}
	policy.Name = "faculty-" + name
	if policy.Timeout == 0 {
		policy.Timeout = 30 * time.Second
	}
	return &Client{
		http:    outbound.NewClient(policy),
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		name:    name,
	}
}

// SetBaseURL overrides the endpoint (tests point this at an httptest server).
func (c *Client) SetBaseURL(u string) {
	if u != "" {
		c.baseURL = strings.TrimRight(u, "/")
	}
}

// Call POSTs body to path on behalf of userID and returns the faculty's raw JSON
// response (passed through to the model). A non-JSON 200 body is wrapped so the
// transcript always carries valid JSON.
func (c *Client) Call(ctx context.Context, userID, path string, body any) (json.RawMessage, error) {
	if c == nil {
		return nil, fmt.Errorf("faculties: %s not configured", c.name)
	}
	reqBody, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(reqBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	if userID != "" {
		req.Header.Set("X-Rowboat-User", userID) // on-behalf-of (RFC 018 seam)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("faculties: %s request: %w", c.name, err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := outbound.ReadAll(resp.Body, c.http.MaxResponseBytes())
	if err != nil {
		return nil, fmt.Errorf("faculties: %s read response: %w", c.name, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("faculties: %s returned status %d", c.name, resp.StatusCode)
	}
	if !json.Valid(raw) {
		wrapped, _ := json.Marshal(map[string]string{"raw": string(raw)})
		return wrapped, nil
	}
	return raw, nil
}
