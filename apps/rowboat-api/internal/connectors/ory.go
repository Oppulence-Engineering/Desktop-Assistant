package connectors

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

// oryClient is a thin OAuth 2.0 client for brokering connector tokens against
// Ory Hydra (authorization-code + PKCE, refresh, revoke).
type oryClient struct {
	publicURL    string
	clientID     string
	clientSecret string
	http         *outbound.Client
}

func newOryClient(publicURL, clientID, clientSecret string) *oryClient {
	return &oryClient{
		publicURL:    strings.TrimRight(publicURL, "/"),
		clientID:     clientID,
		clientSecret: clientSecret,
		http: outbound.NewClient(outbound.Policy{
			Name:                  "ory",
			Timeout:               15 * time.Second,
			ResponseHeaderTimeout: 10 * time.Second,
			MaxConcurrent:         64,
			MaxResponseBytes:      1 << 20,
		}),
	}
}

func (c *oryClient) setOutboundPolicy(policy outbound.Policy) {
	policy.Name = "ory"
	c.http = outbound.NewClient(policy)
}

type oryToken struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	TokenType    string `json:"token_type"`
	Scope        string `json:"scope"`
}

// authorizeURL builds the /oauth2/auth URL for the PKCE flow.
func (c *oryClient) authorizeURL(redirectURI, scope, state, challenge, audience string) string {
	q := url.Values{}
	q.Set("response_type", "code")
	q.Set("client_id", c.clientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("scope", scope)
	q.Set("state", state)
	q.Set("code_challenge", challenge)
	q.Set("code_challenge_method", "S256")
	if audience != "" {
		q.Set("audience", audience)
	}
	return c.publicURL + "/oauth2/auth?" + q.Encode()
}

func (c *oryClient) exchange(ctx context.Context, code, redirectURI, verifier string) (*oryToken, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", redirectURI)
	form.Set("code_verifier", verifier)
	return c.tokenRequest(ctx, form)
}

func (c *oryClient) refresh(ctx context.Context, refreshToken string) (*oryToken, error) {
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", refreshToken)
	return c.tokenRequest(ctx, form)
}

func (c *oryClient) tokenRequest(ctx context.Context, form url.Values) (*oryToken, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.publicURL+"/oauth2/token", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetBasicAuth(c.clientID, c.clientSecret)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := outbound.ReadAll(resp.Body, c.http.MaxResponseBytes())
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		// Extract only the structured OAuth error fields rather than folding the
		// raw upstream body into an error that callers log: a credential-exchange
		// endpoint's response must not be echoed verbatim into logs.
		var oerr struct {
			Error       string `json:"error"`
			Description string `json:"error_description"`
		}
		_ = json.Unmarshal(body, &oerr)
		if oerr.Error != "" {
			return nil, fmt.Errorf("ory token endpoint returned %d: %s (%s)", resp.StatusCode, oerr.Error, truncateForLog(oerr.Description, 200))
		}
		return nil, fmt.Errorf("ory token endpoint returned %d", resp.StatusCode)
	}
	var tok oryToken
	if err := json.Unmarshal(body, &tok); err != nil {
		return nil, err
	}
	return &tok, nil
}

func truncateForLog(s string, max int) string {
	if len(s) > max {
		return s[:max] + "…"
	}
	return s
}

func (c *oryClient) revoke(ctx context.Context, token string) error {
	form := url.Values{}
	form.Set("token", token)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.publicURL+"/oauth2/revoke", strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetBasicAuth(c.clientID, c.clientSecret)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("ory revoke returned %d", resp.StatusCode)
	}
	return nil
}
