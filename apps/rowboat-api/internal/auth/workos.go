package auth

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

// WorkOSEnricher fetches user metadata from the WorkOS User Management API.
// A minimal HTTP client is used instead of the full workos-go SDK to keep the
// dependency surface small; the single endpoint we need is stable.
type WorkOSEnricher struct {
	apiKey  string
	baseURL string
	client  *outbound.Client
}

// NewWorkOSEnricher returns an Enricher backed by WorkOS, or NoopEnricher when
// no API key is configured (local dev). baseURL (WORKOS_BASE_URL) overrides
// https://api.workos.com; local end-to-end runs point it at devstack.
func NewWorkOSEnricher(apiKey, baseURL string) Enricher {
	if apiKey == "" {
		return NoopEnricher{}
	}
	if baseURL == "" {
		baseURL = "https://api.workos.com"
	}
	return &WorkOSEnricher{
		apiKey:  apiKey,
		baseURL: strings.TrimRight(baseURL, "/"),
		client: outbound.NewClient(outbound.Policy{
			Name:                  "workos-enricher",
			Timeout:               5 * time.Second,
			ResponseHeaderTimeout: 5 * time.Second,
			MaxConcurrent:         64,
			MaxResponseBytes:      1 << 20,
		}),
	}
}

// Email looks up the user's primary email via GET /user_management/users/{id}.
func (e *WorkOSEnricher) Email(ctx context.Context, workosUserID string) (string, error) {
	endpoint := e.baseURL + "/user_management/users/" + url.PathEscape(workosUserID)
	// #nosec G704 -- baseURL is operator-controlled configuration (WORKOS_BASE_URL); the id is path-escaped.
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+e.apiKey)

	// #nosec G704 -- req targets the operator-configured WorkOS base URL above.
	resp, err := e.client.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("workos: users lookup returned %d", resp.StatusCode)
	}
	var body struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", err
	}
	return body.Email, nil
}

// DeleteUser removes the WorkOS identity via DELETE /user_management/users/{id}.
// Account deletion needs this: ResolveUser recreates the local user mirror for
// any valid token, so an identity left in WorkOS can sign in again. A 404 means
// the identity is already gone.
func (e *WorkOSEnricher) DeleteUser(ctx context.Context, workosUserID string) error {
	endpoint := e.baseURL + "/user_management/users/" + url.PathEscape(workosUserID)
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+e.apiKey)

	resp, err := e.client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusNotFound || (resp.StatusCode >= 200 && resp.StatusCode < 300) {
		return nil
	}
	return fmt.Errorf("workos: user delete returned %d", resp.StatusCode)
}
