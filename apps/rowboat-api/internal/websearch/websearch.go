// Package websearch is a minimal web-search client for the durable-agent
// web.search tool. It targets a Tavily-shaped JSON API (POST {api_key, query,
// max_results} → {results:[{title,url,content}]}), which the operator points at
// a provider via WEB_SEARCH_API_URL / WEB_SEARCH_API_KEY. The API key stays
// server-held; it never enters model prompts or logs.
package websearch

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

// defaultMaxResults / maxResultsCap bound the result fan-out per call.
const (
	defaultMaxResults = 5
	maxResultsCap     = 10
)

// Result is one search hit returned to the model.
type Result struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Content string `json:"content"`
}

// Client calls the configured web-search API.
type Client struct {
	http   *outbound.Client
	apiURL string
	apiKey string
}

// New builds a web-search client. Returns nil when no API key is configured, so
// the web.search tool reports itself unavailable rather than calling an
// unauthenticated endpoint.
func New(apiURL, apiKey string, policy outbound.Policy) *Client {
	if apiKey == "" {
		return nil
	}
	if apiURL == "" {
		apiURL = "https://api.tavily.com/search"
	}
	policy.Name = "web-search"
	if policy.Timeout == 0 {
		policy.Timeout = 20 * time.Second
	}
	return &Client{http: outbound.NewClient(policy), apiURL: apiURL, apiKey: apiKey}
}

// SetAPIURL overrides the endpoint (tests point this at an httptest server).
func (c *Client) SetAPIURL(u string) {
	if u != "" {
		c.apiURL = u
	}
}

// Search runs one query and returns up to maxResults hits (clamped).
func (c *Client) Search(ctx context.Context, query string, maxResults int) ([]Result, error) {
	if c == nil {
		return nil, fmt.Errorf("websearch: not configured")
	}
	if maxResults <= 0 || maxResults > maxResultsCap {
		maxResults = defaultMaxResults
	}
	reqBody, err := json.Marshal(map[string]any{
		"api_key":      c.apiKey,
		"query":        query,
		"max_results":  maxResults,
		"search_depth": "basic",
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.apiURL, bytes.NewReader(reqBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("websearch: request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := outbound.ReadAll(resp.Body, c.http.MaxResponseBytes())
	if err != nil {
		return nil, fmt.Errorf("websearch: read response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("websearch: provider returned status %d", resp.StatusCode)
	}
	var out struct {
		Results []Result `json:"results"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("websearch: decode response: %w", err)
	}
	return out.Results, nil
}
