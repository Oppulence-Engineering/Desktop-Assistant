package secrets

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"go.uber.org/zap"
)

// infisicalClient is built once and reused across refresh ticks: a new client
// per tick would discard the connection pool, semaphore, and circuit-breaker
// state every interval. The policy is static (independent of cfg).
var infisicalClient = sync.OnceValue(func() *outbound.Client {
	return outbound.NewClient(outbound.Policy{
		Name:                  "infisical",
		Timeout:               10 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
		MaxConcurrent:         8,
		MaxResponseBytes:      2 << 20,
	})
})

// LoadInfisical fetches secrets from the configured Infisical project and
// overlays them onto the env-seeded values. It is a no-op when Infisical is
// disabled. A fetch failure is returned (callers log and continue on the env
// values).
func (s *Store) LoadInfisical(ctx context.Context, cfg appconfig.Config) error {
	if !cfg.InfisicalEnabled {
		return nil
	}
	if cfg.InfisicalToken == "" || cfg.InfisicalProjectID == "" {
		return fmt.Errorf("secrets: Infisical enabled but token or project id missing")
	}
	vals, err := fetchInfisical(ctx, cfg)
	if err != nil {
		return err
	}
	for k, v := range vals {
		s.set(k, v)
	}
	return nil
}

// StartRefresh periodically re-loads secrets from Infisical until ctx is done.
// Errors are logged, not fatal — stale-but-present keys beat an empty store.
func (s *Store) StartRefresh(ctx context.Context, cfg appconfig.Config, interval time.Duration, log *zap.Logger) {
	if !cfg.InfisicalEnabled || interval <= 0 {
		return
	}
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if err := s.LoadInfisical(ctx, cfg); err != nil {
					log.Warn("infisical refresh failed", zap.Error(err))
				} else {
					log.Debug("infisical secrets refreshed")
				}
			}
		}
	}()
}

func fetchInfisical(ctx context.Context, cfg appconfig.Config) (map[string]string, error) {
	q := url.Values{}
	q.Set("environment", cfg.InfisicalEnvironment)
	q.Set("workspaceId", cfg.InfisicalProjectID)
	q.Set("secretPath", "/")
	endpoint := cfg.InfisicalSiteURL + "/api/v3/secrets/raw?" + q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.InfisicalToken)

	resp, err := infisicalClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("secrets: infisical request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("secrets: infisical returned %d", resp.StatusCode)
	}

	var body struct {
		Secrets []struct {
			SecretKey   string `json:"secretKey"`
			SecretValue string `json:"secretValue"`
		} `json:"secrets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	out := make(map[string]string, len(body.Secrets))
	for _, sec := range body.Secrets {
		out[sec.SecretKey] = sec.SecretValue
	}
	return out, nil
}
