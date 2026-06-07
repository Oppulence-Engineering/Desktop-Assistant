package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

// WorkOSEnricher fetches user metadata from the WorkOS User Management API.
// A minimal HTTP client is used instead of the full workos-go SDK to keep the
// dependency surface small; the single endpoint we need is stable.
type WorkOSEnricher struct {
	apiKey string
	client *outbound.Client
}

// NewWorkOSEnricher returns an Enricher backed by WorkOS, or NoopEnricher when
// no API key is configured (local dev).
func NewWorkOSEnricher(apiKey string) Enricher {
	if apiKey == "" {
		return NoopEnricher{}
	}
	return &WorkOSEnricher{
		apiKey: apiKey,
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
	url := "https://api.workos.com/user_management/users/" + workosUserID
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+e.apiKey)

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
