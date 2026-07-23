// Package email is the transactional email boundary. The only backend today is
// Resend (a single API key + a verified sending domain, plain HTTPS). When no
// API key is configured the sender is a fail-closed no-op so callers can wire
// it unconditionally and ship dark.
package email

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

// ErrDisabled means no email backend is configured; nothing was sent.
var ErrDisabled = errors.New("email: no provider configured")

// Message is one transactional email. HTML is required; Text is an optional
// plain-text alternative.
type Message struct {
	To      string
	Subject string
	HTML    string
	Text    string
}

// Sender delivers transactional email.
type Sender interface {
	Send(ctx context.Context, msg Message) error
	// Enabled reports whether a real backend is configured.
	Enabled() bool
}

type disabledSender struct{}

func (disabledSender) Send(context.Context, Message) error { return ErrDisabled }
func (disabledSender) Enabled() bool                       { return false }

// NewDisabled returns the fail-closed no-op sender.
func NewDisabled() Sender { return disabledSender{} }

// ResendConfig configures the Resend backend.
type ResendConfig struct {
	APIKey string
	From   string // e.g. "Oppulence <digest@oppulence.io>"
	// BaseURL overrides the Resend host (tests point it at a mock).
	BaseURL string
}

type resendSender struct {
	cfg    ResendConfig
	client *outbound.Client
}

// NewResend builds the Resend sender, or the disabled sender when the API key
// or From address is missing.
func NewResend(cfg ResendConfig) Sender {
	if cfg.APIKey == "" || cfg.From == "" {
		return disabledSender{}
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://api.resend.com"
	}
	return &resendSender{
		cfg: cfg,
		client: outbound.NewClient(outbound.Policy{
			Name:                  "resend",
			Timeout:               15 * time.Second,
			ResponseHeaderTimeout: 15 * time.Second,
			MaxConcurrent:         8,
			MaxResponseBytes:      64 << 10,
			FailureThreshold:      5,
			Cooldown:              30 * time.Second,
		}),
	}
}

func (s *resendSender) Enabled() bool { return true }

func (s *resendSender) Send(ctx context.Context, msg Message) error {
	if msg.To == "" || msg.Subject == "" || msg.HTML == "" {
		return fmt.Errorf("email: to, subject, and html are required")
	}
	body, err := json.Marshal(map[string]any{
		"from":    s.cfg.From,
		"to":      []string{msg.To},
		"subject": msg.Subject,
		"html":    msg.HTML,
		"text":    msg.Text,
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.BaseURL+"/emails", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.APIKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("email: send: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= http.StatusBadRequest {
		// Never log the body — it can echo the recipient/content.
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
		return fmt.Errorf("email: provider returned %d", resp.StatusCode)
	}
	return nil
}
