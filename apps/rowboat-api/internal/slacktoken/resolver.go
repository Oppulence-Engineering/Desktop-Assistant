// Package slacktoken resolves sealed Slack bot credentials for runtime use.
//
// Slack apps without token rotation store the bot access token directly. Slack
// apps with token rotation store a sealed JSON bundle containing the current
// access token, one-use refresh token, and expiry; the resolver refreshes and
// rewrites that bundle before handing the bot token to Slack API callers.
package slacktoken

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/oauthconnection"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/google/uuid"
)

const (
	providerSlack           = "slack"
	defaultSlackTokenURL    = "https://slack.com/api/oauth.v2.access"
	refreshBeforeSlackToken = 5 * time.Minute
)

var ErrNotConnected = errors.New("slacktoken: slack connection not found")

// Credential is the plaintext Slack credential shape sealed into
// OAuthConnection.refresh_token_encrypted when Slack token rotation is enabled.
type Credential struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token,omitempty"`
	ExpiresAt    time.Time `json:"expires_at,omitempty"`
}

// MarshalCredential serializes a Slack credential bundle for sealing.
func MarshalCredential(cred Credential) (string, error) {
	if strings.TrimSpace(cred.AccessToken) == "" {
		return "", errors.New("slacktoken: access token is required")
	}
	raw, err := json.Marshal(cred)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

// DecodeCredential parses a serialized credential bundle. For legacy rows that
// contain a sealed bare xoxb token, it returns ok=false and carries that token in
// AccessToken so callers can preserve backwards compatibility.
func DecodeCredential(raw string) (Credential, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return Credential{}, false
	}
	var cred Credential
	if !strings.HasPrefix(raw, "{") {
		return Credential{AccessToken: raw}, false
	}
	if err := json.Unmarshal([]byte(raw), &cred); err != nil || strings.TrimSpace(cred.AccessToken) == "" {
		return Credential{}, false
	}
	return cred, true
}

// Resolver resolves and refreshes Slack bot access tokens.
type Resolver struct {
	client   *ent.Client
	sealer   *crypto.Sealer
	secrets  *secrets.Store
	http     *outbound.Client
	tokenURL string
	now      func() time.Time
}

// New builds a resolver. tokenURL may point at a Slack API mock in tests; empty
// uses Slack's oauth.v2.access endpoint.
func New(client *ent.Client, sealer *crypto.Sealer, sec *secrets.Store, tokenURL string, policy outbound.Policy) *Resolver {
	if tokenURL == "" {
		tokenURL = defaultSlackTokenURL
	}
	policy.Name = "slack-token"
	if policy.Timeout == 0 {
		policy.Timeout = 15 * time.Second
	}
	return &Resolver{
		client:   client,
		sealer:   sealer,
		secrets:  sec,
		http:     outbound.NewClient(policy),
		tokenURL: tokenURL,
		now:      time.Now,
	}
}

// SetNow overrides the clock for tests.
func (r *Resolver) SetNow(now func() time.Time) {
	if now != nil {
		r.now = now
	}
}

// Resolve implements agentregistry.CredResolver for Slack. Other providers are
// rejected so this resolver cannot accidentally be used for non-Slack secrets.
func (r *Resolver) Resolve(ctx context.Context, userID, provider string) (string, error) {
	if provider != providerSlack {
		return "", fmt.Errorf("slacktoken: unsupported provider %q", provider)
	}
	conn, err := r.lookup(ctx, userID, "")
	if err != nil {
		return "", err
	}
	return r.TokenForConnection(ctx, conn)
}

// ResolveTeam returns the Slack bot token for one user/workspace pair.
func (r *Resolver) ResolveTeam(ctx context.Context, userID, teamID string) (string, error) {
	conn, err := r.lookup(ctx, userID, strings.TrimSpace(teamID))
	if err != nil {
		return "", err
	}
	return r.TokenForConnection(ctx, conn)
}

// TokenForConnection opens a Slack OAuthConnection and refreshes it when the
// stored credential bundle is near expiry.
func (r *Resolver) TokenForConnection(ctx context.Context, conn *ent.OAuthConnection) (string, error) {
	if r == nil || r.client == nil || r.sealer == nil {
		return "", errors.New("slacktoken: resolver not configured")
	}
	if conn == nil {
		return "", ErrNotConnected
	}
	plain, err := r.sealer.OpenString(conn.RefreshTokenEncrypted)
	if err != nil {
		return "", fmt.Errorf("slacktoken: open credential: %w", err)
	}
	cred, bundle := DecodeCredential(plain)
	if !bundle {
		if strings.TrimSpace(cred.AccessToken) == "" {
			return "", errors.New("slacktoken: empty credential")
		}
		return cred.AccessToken, nil
	}
	if !r.shouldRefresh(cred) {
		return cred.AccessToken, nil
	}
	if strings.TrimSpace(cred.RefreshToken) == "" {
		return cred.AccessToken, nil
	}
	return r.refresh(ctx, conn, cred.RefreshToken)
}

func (r *Resolver) lookup(ctx context.Context, userID, teamID string) (*ent.OAuthConnection, error) {
	if r == nil || r.client == nil {
		return nil, errors.New("slacktoken: resolver not configured")
	}
	uid, err := uuid.Parse(userID)
	if err != nil {
		return nil, fmt.Errorf("slacktoken: invalid user id: %w", err)
	}
	query := r.client.OAuthConnection.Query().
		Where(
			oauthconnection.ProviderEQ(providerSlack),
			oauthconnection.HasUserWith(user.IDEQ(uid)),
		)
	if teamID != "" {
		query = query.Where(oauthconnection.ExternalAccountIDEQ(teamID))
	}
	conn, err := query.Only(auth.WithInternal(ctx))
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, ErrNotConnected
		}
		return nil, fmt.Errorf("slacktoken: load connection: %w", err)
	}
	return conn, nil
}

func (r *Resolver) shouldRefresh(cred Credential) bool {
	if strings.TrimSpace(cred.RefreshToken) == "" || cred.ExpiresAt.IsZero() {
		return false
	}
	return !r.now().Before(cred.ExpiresAt.Add(-refreshBeforeSlackToken))
}

func (r *Resolver) refresh(ctx context.Context, conn *ent.OAuthConnection, refreshToken string) (string, error) {
	if r.secrets == nil || r.secrets.SlackClientID() == "" || r.secrets.SlackClientSecret() == "" {
		return "", errors.New("slacktoken: slack oauth client not configured")
	}
	form := url.Values{}
	form.Set("client_id", r.secrets.SlackClientID())
	form.Set("client_secret", r.secrets.SlackClientSecret())
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", refreshToken)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := r.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("slacktoken: refresh request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := outbound.ReadAll(resp.Body, r.http.MaxResponseBytes())
	if err != nil {
		return "", err
	}
	var out struct {
		OK           bool   `json:"ok"`
		Error        string `json:"error"`
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
		Scope        string `json:"scope"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("slacktoken: parse refresh response: %w", err)
	}
	if resp.StatusCode != http.StatusOK || !out.OK || strings.TrimSpace(out.AccessToken) == "" {
		if out.Error == "" {
			out.Error = fmt.Sprintf("http_%d", resp.StatusCode)
		}
		return "", fmt.Errorf("slacktoken: refresh rejected: %s", out.Error)
	}
	if out.RefreshToken == "" {
		out.RefreshToken = refreshToken
	}
	expiresAt := time.Time{}
	if out.ExpiresIn > 0 {
		expiresAt = r.now().Add(time.Duration(out.ExpiresIn) * time.Second)
	}
	encoded, err := MarshalCredential(Credential{
		AccessToken:  out.AccessToken,
		RefreshToken: out.RefreshToken,
		ExpiresAt:    expiresAt,
	})
	if err != nil {
		return "", err
	}
	sealed, err := r.sealer.SealString(encoded)
	if err != nil {
		return "", err
	}
	update := conn.Update().SetRefreshTokenEncrypted(sealed)
	if scopes := splitScopes(out.Scope); len(scopes) > 0 {
		update = update.SetScopes(scopes)
	}
	if err := update.Exec(auth.WithInternal(ctx)); err != nil {
		return "", fmt.Errorf("slacktoken: persist refreshed credential: %w", err)
	}
	return out.AccessToken, nil
}

func splitScopes(scope string) []string {
	if strings.TrimSpace(scope) == "" {
		return nil
	}
	parts := strings.Split(scope, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}
