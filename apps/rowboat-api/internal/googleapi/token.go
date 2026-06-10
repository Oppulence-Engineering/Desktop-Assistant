package googleapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
)

// ErrReconnectRequired marks a dead refresh token (Google invalid_grant):
// retrying cannot fix it, only a user reconnect can (which rewrites the
// connection row).
var ErrReconnectRequired = errors.New("googleapi: invalid_grant; user must reconnect Google")

// AccessTokenForConnection exchanges the connection's sealed refresh token
// for an access token using the server-held Google OAuth client. The token
// stays in Go code — callers must never pass it into model prompts or logs.
func (c *Client) AccessTokenForConnection(ctx context.Context, sealer *crypto.Sealer, sec *secrets.Store, conn *ent.OAuthConnection) (string, error) {
	clientID := sec.GoogleOAuthClientID()
	clientSecret := sec.GoogleOAuthClientSecret()
	if clientID == "" || clientSecret == "" {
		return "", errors.New("google oauth client not configured")
	}
	refresh, err := sealer.OpenString(conn.RefreshTokenEncrypted)
	if err != nil {
		return "", fmt.Errorf("unseal refresh token: %w", err)
	}

	form := url.Values{}
	form.Set("client_id", clientID)
	form.Set("client_secret", clientSecret)
	form.Set("refresh_token", refresh)
	form.Set("grant_type", "refresh_token")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("google token endpoint: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := outbound.ReadAll(resp.Body, c.http.MaxResponseBytes())
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		var gerr struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(raw, &gerr)
		if gerr.Error == "invalid_grant" {
			return "", ErrReconnectRequired
		}
		return "", fmt.Errorf("google token endpoint returned %d (%s)", resp.StatusCode, gerr.Error)
	}
	var tok struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(raw, &tok); err != nil || tok.AccessToken == "" {
		return "", errors.New("google token endpoint returned no access token")
	}
	return tok.AccessToken, nil
}
