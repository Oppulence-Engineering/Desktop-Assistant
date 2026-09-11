// Package composioapi provides the server-held, user-scoped Composio client.
//
// Composio brokers the governed long tail described in RFC 033: tools in
// products Oppulence deliberately does not model as relationship sensors. It is
// an action surface, never an evidence source — nothing it returns carries the
// provenance a commitment or a risk score is allowed to cite.
//
// Oppulence holds one Composio project key, supplied as COMPOSIO_API_KEY from
// Infisical. End users never hold a Composio key: they are scoped inside that
// project by user id, so a call made for one person can only reach the accounts
// that person connected. The key stays server-side and never reaches a model
// prompt, desktop storage, or an action payload.
package composioapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

// v3.1 is the version Composio recommends for new code; v3 pins toolkit
// defaults to whatever was current when a tool was first published.
const defaultBaseURL = "https://backend.composio.dev/api/v3.1"

// maxTools bounds every listing. The catalog runs to thousands of tools and a
// model does not need them; a long list is a prompt-budget leak, not breadth.
const maxTools = 25

// ErrNotConfigured reports that this deployment holds no Composio project key.
var ErrNotConfigured = errors.New("composio: no project key is configured on this server")

// ErrNoConnection reports that the user has not linked the product a tool
// belongs to. Composio answers this with a 404, not a refusal in the body.
var ErrNoConnection = errors.New("composio: that product is not connected for this user")

// ErrNotOwned reports a connection that belongs to a different user.
var ErrNotOwned = errors.New("composio: that connection belongs to another user")

// ErrUnauthorized reports a key Composio rejected.
var ErrUnauthorized = errors.New("composio: the stored API key was rejected")

// Client calls Composio with the deployment's project key.
type Client struct {
	apiKey  string
	http    *outbound.Client
	baseURL string
}

// New builds the Composio client. An empty key yields a client that reports
// itself unconfigured rather than a nil one every caller has to check.
func New(apiKey string, policy outbound.Policy) *Client {
	policy.Name = "composio"
	if policy.Timeout == 0 {
		policy.Timeout = 20 * time.Second
	}
	return &Client{
		apiKey: strings.TrimSpace(apiKey), http: outbound.NewClient(policy),
		baseURL: defaultBaseURL,
	}
}

// Configured reports whether this deployment can reach Composio at all.
func (c *Client) Configured() bool { return c != nil && c.apiKey != "" }

// SetBaseURL overrides the Composio origin for contract tests.
func (c *Client) SetBaseURL(raw string) {
	if strings.TrimSpace(raw) != "" {
		c.baseURL = strings.TrimRight(strings.TrimSpace(raw), "/")
	}
}

// ToolSummary is the bounded, model-safe shape of one catalog entry.
type ToolSummary struct {
	Slug        string `json:"slug"`
	Name        string `json:"name,omitempty"`
	Description string `json:"description,omitempty"`
	Toolkit     string `json:"toolkit,omitempty"`
}

// ToolDetail adds the input schema a caller needs before it can execute.
type ToolDetail struct {
	ToolSummary
	InputParameters json.RawMessage `json:"inputParameters,omitempty"`
}

// ExecuteResult is the outcome of one tool run.
type ExecuteResult struct {
	Successful bool            `json:"successful"`
	Data       json.RawMessage `json:"data,omitempty"`
	Error      string          `json:"error,omitempty"`
}

// SearchTools lists catalog entries, optionally narrowed by a free-text query
// and a toolkit slug such as "jira".
func (c *Client) SearchTools(
	ctx context.Context, query, toolkit string, limit int,
) ([]ToolSummary, error) {
	params := url.Values{}
	if q := strings.TrimSpace(query); q != "" {
		params.Set("search", q)
	}
	if t := strings.TrimSpace(toolkit); t != "" {
		params.Set("toolkit_slug", t)
	}
	params.Set("limit", strconv.Itoa(boundLimit(limit)))
	body, err := c.do(ctx, http.MethodGet, "/tools?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}
	items, err := decodeItems(body)
	if err != nil {
		return nil, err
	}
	out := make([]ToolSummary, 0, len(items))
	for _, item := range items {
		if summary := summarize(item); summary.Slug != "" {
			out = append(out, summary)
		}
		if len(out) >= boundLimit(limit) {
			break
		}
	}
	return out, nil
}

// DescribeTool returns one tool with the input schema needed to call it.
func (c *Client) DescribeTool(ctx context.Context, slug string) (ToolDetail, error) {
	slug = strings.TrimSpace(slug)
	if slug == "" {
		return ToolDetail{}, errors.New("composio: tool slug is required")
	}
	body, err := c.do(ctx, http.MethodGet, "/tools/"+url.PathEscape(slug), nil)
	if err != nil {
		return ToolDetail{}, err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return ToolDetail{}, fmt.Errorf("composio: decode tool: %w", err)
	}
	// A single-tool read is sometimes wrapped the same way a listing is.
	if inner, ok := raw["item"]; ok {
		var nested map[string]json.RawMessage
		if json.Unmarshal(inner, &nested) == nil {
			raw = nested
		}
	}
	detail := ToolDetail{ToolSummary: summarize(raw)}
	if schema, ok := raw["input_parameters"]; ok {
		detail.InputParameters = schema
	}
	if detail.Slug == "" {
		detail.Slug = slug
	}
	return detail, nil
}

// ExecuteTool runs one tool against the accounts this user connected inside the
// project. The user id is what keeps one person's call off another's accounts.
func (c *Client) ExecuteTool(
	ctx context.Context, userID uuid.UUID, slug string, arguments json.RawMessage,
) (ExecuteResult, error) {
	slug = strings.TrimSpace(slug)
	if slug == "" {
		return ExecuteResult{}, errors.New("composio: tool slug is required")
	}
	if len(arguments) == 0 {
		arguments = json.RawMessage(`{}`)
	}
	payload, err := json.Marshal(map[string]any{
		"user_id":   userID.String(),
		"arguments": arguments,
	})
	if err != nil {
		return ExecuteResult{}, fmt.Errorf("composio: encode arguments: %w", err)
	}
	body, err := c.do(ctx, http.MethodPost, "/tools/execute/"+url.PathEscape(slug), payload)
	if err != nil {
		return ExecuteResult{}, err
	}
	var result ExecuteResult
	if err := json.Unmarshal(body, &result); err != nil {
		return ExecuteResult{}, fmt.Errorf("composio: decode execution: %w", err)
	}
	return result, nil
}

func (c *Client) do(ctx context.Context, method, path string, payload []byte) ([]byte, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	var reader io.Reader
	if payload != nil {
		reader = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return nil, fmt.Errorf("composio: build request: %w", err)
	}
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("Accept", "application/json")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("composio: provider request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("composio: read response: %w", err)
	}
	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return body, nil
	case resp.StatusCode == http.StatusUnauthorized, resp.StatusCode == http.StatusForbidden:
		return nil, ErrUnauthorized
	}
	// Composio reports a failure as a JSON envelope, and "you never connected
	// this product" arrives as a 404 rather than a refusal in the body. Reading
	// the message is what turns an opaque status into something a user can act
	// on.
	detail := upstreamMessage(body)
	if resp.StatusCode == http.StatusNotFound &&
		strings.Contains(strings.ToLower(detail), "no connected account") {
		return nil, ErrNoConnection
	}
	if detail != "" {
		return nil, fmt.Errorf("composio: %s (status %d)", detail, resp.StatusCode)
	}
	return nil, fmt.Errorf("composio: status %d", resp.StatusCode)
}

// upstreamMessage reads Composio's {"error":{"message":…}} envelope, tolerating
// both the nested object and a plain string.
func upstreamMessage(body []byte) string {
	var envelope struct {
		Error json.RawMessage `json:"error"`
	}
	if json.Unmarshal(body, &envelope) != nil || len(envelope.Error) == 0 {
		return ""
	}
	var nested map[string]json.RawMessage
	if json.Unmarshal(envelope.Error, &nested) == nil {
		return firstString(nested, "message")
	}
	var plain string
	if json.Unmarshal(envelope.Error, &plain) == nil {
		return strings.TrimSpace(plain)
	}
	return ""
}

func boundLimit(limit int) int {
	if limit <= 0 || limit > maxTools {
		return maxTools
	}
	return limit
}

// decodeItems reads a listing. Composio's envelope is not a contract we vendor,
// so both the wrapped and the bare array form are accepted rather than letting
// a shape change read as "no tools found".
func decodeItems(body []byte) ([]map[string]json.RawMessage, error) {
	var wrapped struct {
		Items []map[string]json.RawMessage `json:"items"`
	}
	if err := json.Unmarshal(body, &wrapped); err == nil && wrapped.Items != nil {
		return wrapped.Items, nil
	}
	var bare []map[string]json.RawMessage
	if err := json.Unmarshal(body, &bare); err != nil {
		return nil, fmt.Errorf("composio: decode tools: %w", err)
	}
	return bare, nil
}

func summarize(raw map[string]json.RawMessage) ToolSummary {
	return ToolSummary{
		Slug:        firstString(raw, "slug", "name"),
		Name:        firstString(raw, "display_name", "name"),
		Description: firstString(raw, "description"),
		Toolkit:     toolkitSlug(raw),
	}
}

// toolkitSlug reads the owning toolkit, which appears either as a plain string
// or as an object carrying its own slug.
func toolkitSlug(raw map[string]json.RawMessage) string {
	value, ok := raw["toolkit"]
	if !ok {
		return firstString(raw, "toolkit_slug")
	}
	var plain string
	if json.Unmarshal(value, &plain) == nil {
		return plain
	}
	var nested map[string]json.RawMessage
	if json.Unmarshal(value, &nested) == nil {
		return firstString(nested, "slug", "name")
	}
	return ""
}

func firstString(raw map[string]json.RawMessage, keys ...string) string {
	for _, key := range keys {
		value, ok := raw[key]
		if !ok {
			continue
		}
		var out string
		if json.Unmarshal(value, &out) == nil && strings.TrimSpace(out) != "" {
			return strings.TrimSpace(out)
		}
	}
	return ""
}

// Toolkit is one connectable product in the Composio catalog.
type Toolkit struct {
	Slug        string `json:"slug"`
	Name        string `json:"name,omitempty"`
	ManagedAuth bool   `json:"managedAuth"`
}

// Connection is one product account a user linked inside the project.
type Connection struct {
	ID        string `json:"id"`
	Toolkit   string `json:"toolkit"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt,omitempty"`
}

// ConnectLink is the hosted authorization page a user must visit, plus the
// connection it will fill in.
type ConnectLink struct {
	ConnectionID string `json:"connectionId"`
	RedirectURL  string `json:"redirectUrl"`
	ExpiresAt    string `json:"expiresAt,omitempty"`
}

// ListToolkits returns connectable products, newest page only. Only toolkits
// Composio can authorize on our behalf are offered: anything else would need an
// OAuth app of our own before the connect button could work.
func (c *Client) ListToolkits(ctx context.Context, limit int) ([]Toolkit, error) {
	params := url.Values{}
	params.Set("limit", strconv.Itoa(boundLimit(limit)))
	body, err := c.do(ctx, http.MethodGet, "/toolkits?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}
	items, err := decodeItems(body)
	if err != nil {
		return nil, err
	}
	out := make([]Toolkit, 0, len(items))
	for _, item := range items {
		slug := firstString(item, "slug")
		if slug == "" {
			continue
		}
		out = append(out, Toolkit{
			Slug:        slug,
			Name:        firstString(item, "name"),
			ManagedAuth: hasManagedAuth(item),
		})
	}
	return out, nil
}

// ListConnections returns the products this user has linked.
func (c *Client) ListConnections(ctx context.Context, userID uuid.UUID) ([]Connection, error) {
	params := url.Values{}
	params.Set("user_ids", userID.String())
	params.Set("limit", strconv.Itoa(maxTools))
	body, err := c.do(ctx, http.MethodGet, "/connected_accounts?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}
	items, err := decodeItems(body)
	if err != nil {
		return nil, err
	}
	out := make([]Connection, 0, len(items))
	for _, item := range items {
		// The filter is applied by Composio; this second check means a typo in
		// the query can never surface another tenant's connection.
		if firstString(item, "user_id") != userID.String() {
			continue
		}
		out = append(out, connectionFrom(item))
	}
	return out, nil
}

// StartConnection returns the hosted page where the user authorizes one
// product. The account is not linked until they finish there.
func (c *Client) StartConnection(ctx context.Context, userID uuid.UUID, toolkit string) (ConnectLink, error) {
	toolkit = strings.ToLower(strings.TrimSpace(toolkit))
	if toolkit == "" {
		return ConnectLink{}, errors.New("composio: toolkit is required")
	}
	authConfigID, err := c.ensureAuthConfig(ctx, toolkit)
	if err != nil {
		return ConnectLink{}, err
	}
	payload, err := json.Marshal(map[string]any{
		"auth_config_id": authConfigID,
		"user_id":        userID.String(),
	})
	if err != nil {
		return ConnectLink{}, fmt.Errorf("composio: encode link request: %w", err)
	}
	body, err := c.do(ctx, http.MethodPost, "/connected_accounts/link", payload)
	if err != nil {
		return ConnectLink{}, err
	}
	var link struct {
		ConnectedAccountID string `json:"connected_account_id"`
		RedirectURL        string `json:"redirect_url"`
		ExpiresAt          string `json:"expires_at"`
	}
	if err := json.Unmarshal(body, &link); err != nil {
		return ConnectLink{}, fmt.Errorf("composio: decode link: %w", err)
	}
	if link.RedirectURL == "" {
		return ConnectLink{}, errors.New("composio: link response carried no redirect url")
	}
	return ConnectLink{
		ConnectionID: link.ConnectedAccountID,
		RedirectURL:  link.RedirectURL,
		ExpiresAt:    link.ExpiresAt,
	}, nil
}

// DeleteConnection unlinks one product account. Ownership is checked first: the
// project key can reach every connection, so the user id is the only thing
// stopping one person from deleting another's.
func (c *Client) DeleteConnection(ctx context.Context, userID uuid.UUID, connectionID string) error {
	connectionID = strings.TrimSpace(connectionID)
	if connectionID == "" {
		return errors.New("composio: connection id is required")
	}
	body, err := c.do(ctx, http.MethodGet, "/connected_accounts/"+url.PathEscape(connectionID), nil)
	if err != nil {
		return err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return fmt.Errorf("composio: decode connection: %w", err)
	}
	if firstString(raw, "user_id") != userID.String() {
		return ErrNotOwned
	}
	_, err = c.do(ctx, http.MethodDelete, "/connected_accounts/"+url.PathEscape(connectionID), nil)
	return err
}

// ensureAuthConfig reuses this project's auth config for a toolkit and creates
// a Composio-managed one only when none exists, so repeated connects do not
// pile up configs.
func (c *Client) ensureAuthConfig(ctx context.Context, toolkit string) (string, error) {
	params := url.Values{}
	params.Set("toolkit_slug", toolkit)
	params.Set("limit", strconv.Itoa(maxTools))
	body, err := c.do(ctx, http.MethodGet, "/auth_configs?"+params.Encode(), nil)
	if err != nil {
		return "", err
	}
	items, err := decodeItems(body)
	if err != nil {
		return "", err
	}
	for _, item := range items {
		if toolkitSlug(item) != toolkit {
			continue
		}
		if id := firstString(item, "id"); id != "" {
			return id, nil
		}
	}
	payload, err := json.Marshal(map[string]any{
		"toolkit":     map[string]any{"slug": toolkit},
		"auth_config": map[string]any{"type": "use_composio_managed_auth"},
	})
	if err != nil {
		return "", fmt.Errorf("composio: encode auth config: %w", err)
	}
	created, err := c.do(ctx, http.MethodPost, "/auth_configs", payload)
	if err != nil {
		return "", err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(created, &raw); err != nil {
		return "", fmt.Errorf("composio: decode auth config: %w", err)
	}
	if id := firstString(raw, "id"); id != "" {
		return id, nil
	}
	// The create response nests the record one level under some API versions.
	if inner, ok := raw["auth_config"]; ok {
		var nested map[string]json.RawMessage
		if json.Unmarshal(inner, &nested) == nil {
			if id := firstString(nested, "id"); id != "" {
				return id, nil
			}
		}
	}
	return "", errors.New("composio: auth config create returned no id")
}

func connectionFrom(raw map[string]json.RawMessage) Connection {
	return Connection{
		ID:        firstString(raw, "id"),
		Toolkit:   toolkitSlug(raw),
		Status:    firstString(raw, "status"),
		CreatedAt: firstString(raw, "created_at"),
	}
}

func hasManagedAuth(raw map[string]json.RawMessage) bool {
	value, ok := raw["composio_managed_auth_schemes"]
	if !ok {
		return false
	}
	var schemes []string
	if json.Unmarshal(value, &schemes) != nil {
		return false
	}
	return len(schemes) > 0
}
