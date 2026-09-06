package googleapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
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

// PutJSON PUTs a JSON body with the bearer token and decodes the JSON response.
func (c *Client) PutJSON(ctx context.Context, token, endpoint string, body any, out any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, endpoint, strings.NewReader(string(raw)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	return c.doJSON(req, token, out)
}

// PatchJSON PATCHes a JSON body with the bearer token and decodes the response.
func (c *Client) PatchJSON(ctx context.Context, token, endpoint string, body any, out any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, endpoint, strings.NewReader(string(raw)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	return c.doJSON(req, token, out)
}

// PatchRaw PATCHes a raw body with the bearer token and decodes the JSON response.
func (c *Client) PatchRaw(ctx context.Context, token, endpoint, contentType string, body []byte, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
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
		var payload struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal(respBody, &payload) == nil && strings.TrimSpace(payload.Error.Message) != "" {
			return fmt.Errorf("google api %s returned %d: %s", req.URL.Path, resp.StatusCode, strings.TrimSpace(payload.Error.Message))
		}
		return fmt.Errorf("google api %s returned %d", req.URL.Path, resp.StatusCode)
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(respBody, out)
}

func queryURL(endpoint string, query url.Values) string {
	if len(query) == 0 {
		return endpoint
	}
	return endpoint + "?" + query.Encode()
}

func multipartRelated(metadata any, media []byte, mediaType string) ([]byte, string, error) {
	var b bytes.Buffer
	w := multipartWriter{boundary: "rowboat-google-boundary"}
	if err := w.writeJSONPart(&b, metadata); err != nil {
		return nil, "", err
	}
	if err := w.writeMediaPart(&b, mediaType, media); err != nil {
		return nil, "", err
	}
	w.close(&b)
	return b.Bytes(), "multipart/related; boundary=" + w.boundary, nil
}

type multipartWriter struct {
	boundary string
}

func (w multipartWriter) writeJSONPart(out io.Writer, v any) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(out, "--%s\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n%s\r\n", w.boundary, raw)
	return err
}

func (w multipartWriter) writeMediaPart(out io.Writer, contentType string, body []byte) error {
	if contentType == "" {
		contentType = "text/plain; charset=UTF-8"
	}
	_, err := fmt.Fprintf(out, "--%s\r\nContent-Type: %s\r\n\r\n%s\r\n", w.boundary, contentType, body)
	return err
}

func (w multipartWriter) close(out io.Writer) {
	_, _ = fmt.Fprintf(out, "--%s--\r\n", w.boundary)
}
