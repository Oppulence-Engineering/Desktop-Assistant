package perf

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os/exec"
	"time"
)

func preflight(cfg config) error {
	for _, name := range []string{"npm", "pnpm", "agent-browser"} {
		if _, err := exec.LookPath(name); err != nil {
			return fmt.Errorf("missing required command %q: %w", name, err)
		}
	}
	if cfg.Mode == "dev" {
		if err := ensurePortFree(cfg.VitePort, "Vite"); err != nil {
			return err
		}
	}
	if err := ensurePortFree(cfg.CDPPort, "Electron CDP"); err != nil {
		return err
	}
	if err := waitForHTTP(cfg.APIURL+"/healthz", "rowboat API health", 2*time.Minute, 2); err != nil {
		return fmt.Errorf("%w; run make api-up first", err)
	}
	if err := waitForHTTP(cfg.DevstackURL+"/.well-known/jwks.json", "rowboat devstack", 2*time.Minute, 2); err != nil {
		return fmt.Errorf("%w; run make api-up first", err)
	}
	return nil
}

func waitForDesktopAPIs(cfg config, token string) error {
	if err := waitForHTTP(cfg.APIURL+"/healthz", "rowboat API health", 2*time.Minute, 2); err != nil {
		return err
	}
	if err := waitForHTTP(cfg.APIURL+"/v1/config", "rowboat API config", 2*time.Minute, 2); err != nil {
		return err
	}
	if token != "" {
		if err := waitForAuthenticatedHTTP(cfg.APIURL+"/v1/llm/models", token, "rowboat API models", 2*time.Minute, 2); err != nil {
			return err
		}
	}
	if cfg.IncludeCloud {
		if err := waitForHTTP(cfg.APIURL+"/readyz", "rowboat API readyz", 5*time.Minute, 2); err != nil {
			return err
		}
	}
	return nil
}

func waitForCDP(port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/json/version", port), nil)
		res, err := http.DefaultClient.Do(req)
		cancel()
		if err == nil {
			_ = res.Body.Close()
			if res.StatusCode >= 200 && res.StatusCode <= 299 {
				return nil
			}
		}
		time.Sleep(time.Second)
	}
	return fmt.Errorf("timed out waiting for Electron CDP on localhost:%d", port)
}

func ensurePortFree(port int, name string) error {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return fmt.Errorf("localhost:%d is already in use for %s; stop the process or override the port", port, name)
	}
	return ln.Close()
}

func waitForPortFree(port int, name string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var last error
	for time.Now().Before(deadline) {
		if err := ensurePortFree(port, name); err == nil {
			return nil
		} else {
			last = err
		}
		time.Sleep(500 * time.Millisecond)
	}
	if last != nil {
		return last
	}
	return fmt.Errorf("localhost:%d did not become free for %s", port, name)
}

func waitForHTTP(url, label string, timeout time.Duration, consecutiveSuccesses int) error {
	return waitForHTTPWithHeaders(url, nil, label, timeout, consecutiveSuccesses)
}

func waitForAuthenticatedHTTP(url, token, label string, timeout time.Duration, consecutiveSuccesses int) error {
	return waitForHTTPWithHeaders(url, map[string]string{"Authorization": "Bearer " + token}, label, timeout, consecutiveSuccesses)
}

func waitForHTTPWithHeaders(url string, headers map[string]string, label string, timeout time.Duration, consecutiveSuccesses int) error {
	if consecutiveSuccesses < 1 {
		consecutiveSuccesses = 1
	}
	deadline := time.Now().Add(timeout)
	successes := 0
	var lastErr error
	for time.Now().Before(deadline) {
		if err := checkHTTPWithHeaders(url, headers); err != nil {
			lastErr = err
			successes = 0
		} else {
			successes++
			if successes >= consecutiveSuccesses {
				return nil
			}
		}
		time.Sleep(2 * time.Second)
	}
	if lastErr == nil {
		lastErr = errors.New("timed out")
	}
	return fmt.Errorf("%s is not reachable at %s after %s: %w", label, url, timeout, lastErr)
}

func checkHTTP(url string) error {
	return checkHTTPWithHeaders(url, nil)
}

func checkHTTPWithHeaders(url string, headers map[string]string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return fmt.Errorf("unexpected status %s", res.Status)
	}
	return nil
}
