// Package googleapi is the shared client for server-side Google API calls
// made with a user's connected-account credentials: OAuth token exchange from
// the sealed refresh token, plus the narrow Gmail/Calendar read calls the
// cloud runtime's connector tools and the watch manager need. It is a leaf
// package (no imports from internal/google or internal/googlewatch) so both
// the OAuth handler flow and its consumers can depend on it without cycles.
package googleapi

import (
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

const (
	defaultGmailBase    = "https://gmail.googleapis.com"
	defaultCalendarBase = "https://www.googleapis.com/calendar/v3"
	defaultTokenURL     = "https://oauth2.googleapis.com/token"
)

// Config carries the endpoint overrides (dev mocks); empty values keep the
// real Google endpoints.
type Config struct {
	TokenURL        string
	GmailBaseURL    string
	CalendarBaseURL string
}

// Client issues Google API calls through the shared outbound vendor policy.
type Client struct {
	http *outbound.Client
	cfg  Config
}

// New builds a Client, applying endpoint defaults.
func New(cfg Config) *Client {
	if cfg.TokenURL == "" {
		cfg.TokenURL = defaultTokenURL
	}
	if cfg.GmailBaseURL == "" {
		cfg.GmailBaseURL = defaultGmailBase
	}
	if cfg.CalendarBaseURL == "" {
		cfg.CalendarBaseURL = defaultCalendarBase
	}
	return &Client{
		http: outbound.NewClient(outbound.Policy{
			Name:                  "google-api",
			Timeout:               20 * time.Second,
			ResponseHeaderTimeout: 10 * time.Second,
			MaxConcurrent:         16,
			MaxResponseBytes:      1 << 20,
		}),
		cfg: cfg,
	}
}

// GmailBaseURL returns the resolved Gmail API host (for callers composing
// endpoints outside this package, e.g. the watch manager).
func (c *Client) GmailBaseURL() string { return c.cfg.GmailBaseURL }

// CalendarBaseURL returns the resolved Calendar API base.
func (c *Client) CalendarBaseURL() string { return c.cfg.CalendarBaseURL }
