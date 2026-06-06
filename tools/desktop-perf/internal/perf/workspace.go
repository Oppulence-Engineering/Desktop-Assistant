package perf

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

func seedWorkspace(cfg config) (string, error) {
	if err := os.MkdirAll(filepath.Join(cfg.WorkDir, "config"), 0o755); err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Join(cfg.WorkDir, "knowledge", "PerfSeed"), 0o755); err != nil {
		return "", err
	}

	token, err := mintToken(cfg.DevstackURL)
	if err != nil {
		return "", err
	}
	expiresAt := time.Now().Add(55 * time.Minute).Unix()
	oauth := map[string]any{
		"version": 2,
		"providers": map[string]any{
			"rowboat": map[string]any{
				"mode": "rowboat",
				"tokens": map[string]any{
					"access_token":  token,
					"refresh_token": nil,
					"expires_at":    expiresAt,
					"token_type":    "Bearer",
				},
			},
		},
	}
	if err := writeJSON(filepath.Join(cfg.WorkDir, "config", "oauth.json"), oauth); err != nil {
		return "", err
	}
	noteCreation := map[string]any{
		"strictness":          "medium",
		"configured":          false,
		"onboardingComplete":  true,
		"seededByPerfHarness": true,
	}
	if err := writeJSON(filepath.Join(cfg.WorkDir, "config", "note_creation.json"), noteCreation); err != nil {
		return "", err
	}
	for i := 0; i < cfg.SeedNotes; i++ {
		name := filepath.Join(cfg.WorkDir, "knowledge", "PerfSeed", fmt.Sprintf("seed-%03d.md", i))
		body := fmt.Sprintf("# Seed Note %03d\n\nrowboatperf seed corpus note %03d.\n\n- account: Acme %03d\n- status: active\n", i, i, i%17)
		if err := os.WriteFile(name, []byte(body), 0o644); err != nil {
			return "", err
		}
	}
	return token, nil
}

func mintToken(devstackURL string) (string, error) {
	url := devstackURL + "/mint?workos_user_id=user_desktop_perf&email=desktop-perf%40solomon-ai.co"
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return "", fmt.Errorf("mint token failed: %s: %s", res.Status, string(body))
	}
	var payload struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", err
	}
	if payload.Token == "" {
		return "", errors.New("mint token response did not include token")
	}
	return payload.Token, nil
}
