package googleapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

// PostJSON POSTs a JSON body with the bearer token and decodes the JSON
// response into out (out may be nil for fire-and-acknowledge calls).
func (c *Client) PostJSON(ctx context.Context, token, endpoint string, body any, out any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(raw)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	return c.doJSON(req, token, out)
}

// GetJSON GETs endpoint with the given query parameters and bearer token,
// decoding the JSON response into out.
func (c *Client) GetJSON(ctx context.Context, token, endpoint string, query url.Values, out any) error {
	target := endpoint
	if len(query) > 0 {
		target += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return err
	}
	return c.doJSON(req, token, out)
}

func (c *Client) doJSON(req *http.Request, token string, out any) error {
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	respBody, err := outbound.ReadAll(resp.Body, c.http.MaxResponseBytes())
	if err != nil {
		return err
	}
	if resp.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("google api %s returned %d", req.URL.Path, resp.StatusCode)
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(respBody, out)
}
