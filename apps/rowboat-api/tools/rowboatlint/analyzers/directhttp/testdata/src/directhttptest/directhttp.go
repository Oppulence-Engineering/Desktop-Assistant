package directhttptest

import (
	"context"
	"net/http"
	"time"
)

func Good(ctx context.Context, client *http.Client) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://example.com", nil)
	if err != nil {
		return err
	}
	_, err = client.Do(req)
	return err
}

func Bad() {
	_, _ = http.Get("https://example.com") // want "RB004_DIRECT_HTTP"
	_ = http.DefaultClient                 // want "RB004_DIRECT_HTTP"
	_ = &http.Client{Timeout: time.Second}
}
