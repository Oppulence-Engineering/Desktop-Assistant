package connectors

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// oryClient is a thin OAuth 2.0 client for brokering connector tokens against
// Ory Hydra (authorization-code + PKCE, refresh, revoke).
type oryClient struct {
	publicURL    string
	clientID     string
	clientSecret string
	http         *http.Client
}

func newOryClient(publicURL, clientID, clientSecret string) *oryClient {
	return &oryClient{
		publicURL:    strings.TrimRight(publicURL, "/"),
		clientID:     clientID,
		clientSecret: clientSecret,
		http:         &http.Client{Timeout: 15 * time.Second},
	}
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
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ory token endpoint returned %d: %s", resp.StatusCode, string(body))
	}
	var tok oryToken
	if err := json.Unmarshal(body, &tok); err != nil {
		return nil, err
	}
	return &tok, nil
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
