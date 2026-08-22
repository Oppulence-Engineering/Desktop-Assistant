package actions

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

// HTTPActSeamConfig configures the product Act-seam client.
type HTTPActSeamConfig struct {
	// BaseURL is the product Act-seam endpoint. Empty ⇒ the caller should leave
	// the executor nil (execution disabled / fail closed).
	BaseURL string
	// ServiceToken authenticates the broker to the product (a server-to-server
	// credential, distinct from the operator approval token which the broker has
	// already verified and consumed before any executor runs).
	ServiceToken string
	Timeout      time.Duration
	// Client is optional; a default is built when nil (tests inject their own).
	Client *http.Client
}

// HTTPActSeam executes approved actions against a product's Act seam over HTTP
// (RFC 013/020). It POSTs the typed action plus the correlation id the Watch
// leg matches on, and returns the product's resulting resourceRef. The broker
// owns the token contract; this client owns only the product call.
type HTTPActSeam struct {
	client  *http.Client
	baseURL string
	token   string
}

// NewHTTPActSeam builds the Act-seam client. A blank BaseURL yields nil so the
// broker stays fail-closed rather than posting to an empty host.
func NewHTTPActSeam(cfg HTTPActSeamConfig) *HTTPActSeam {
	if strings.TrimSpace(cfg.BaseURL) == "" {
		return nil
	}
	client := cfg.Client
	if client == nil {
		timeout := cfg.Timeout
		if timeout <= 0 {
			timeout = 30 * time.Second
		}
		client = &http.Client{Timeout: timeout}
	}
	return &HTTPActSeam{
		client:  client,
		baseURL: strings.TrimRight(cfg.BaseURL, "/"),
		token:   cfg.ServiceToken,
	}
}

// actRequest is the wire request to the product Act seam.
type actRequest struct {
	Kind          string          `json:"kind"`
	Target        string          `json:"target"`
	Params        json.RawMessage `json:"params,omitempty"`
	CorrelationID string          `json:"correlationId"`
	Operator      string          `json:"operator"`
}

// actResponse is the product's reply.
type actResponse struct {
	ResultRef string `json:"resultRef"`
}

// Execute posts one approved action and returns its resulting resourceRef.
// Failures where the request may have been applied (timeout, 5xx) are wrapped
// ErrAmbiguous so the broker never auto-retries a possibly-effective action.
func (e *HTTPActSeam) Execute(ctx context.Context, req ExecRequest) (*ExecResult, error) {
	var params json.RawMessage
	if p := strings.TrimSpace(req.ParamsJSON); p != "" {
		params = json.RawMessage(p)
	}
	body, err := json.Marshal(actRequest{
		Kind:          req.Kind,
		Target:        req.Target,
		Params:        params,
		CorrelationID: req.CorrelationID,
		Operator:      operatorRef(req.UserID),
	})
	if err != nil {
		return nil, fmt.Errorf("actions: marshal act request: %w", err)
	}
	// #nosec G704 -- baseURL is operator-controlled service configuration, never request input.
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, e.baseURL+"/act", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("actions: build act request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	if e.token != "" {
		httpReq.Header.Set("Authorization", "Bearer "+e.token)
	}

	// #nosec G704 -- httpReq targets the operator-configured Act seam above.
	resp, err := e.client.Do(httpReq)
	if err != nil {
		return nil, classifyActError(err)
	}
	defer func() { _ = resp.Body.Close() }()

	payload, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode >= 500 {
		// The product received the request but its outcome is unknown.
		return nil, fmt.Errorf("%w: act seam returned %d: %s", ErrAmbiguous, resp.StatusCode, snippet(payload))
	}
	if resp.StatusCode >= 300 {
		// A definite rejection: safe to surface as a plain failure.
		return nil, fmt.Errorf("actions: act seam returned %d: %s", resp.StatusCode, snippet(payload))
	}
	var out actResponse
	if len(payload) > 0 {
		if err := json.Unmarshal(payload, &out); err != nil {
			return nil, fmt.Errorf("actions: decode act response: %w", err)
		}
	}
	return &ExecResult{ResultRef: strings.TrimSpace(out.ResultRef)}, nil
}

// operatorRef renders the operator id, tolerating the nil UUID (tests).
func operatorRef(id uuid.UUID) string {
	if id == uuid.Nil {
		return ""
	}
	return id.String()
}

// classifyActError decides whether a transport failure is ambiguous (the
// request may have been processed) or definite. Conservative by design.
func classifyActError(err error) error {
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return fmt.Errorf("%w: %w", ErrAmbiguous, err)
	}
	var nerr net.Error
	if errors.As(err, &nerr) && nerr.Timeout() {
		return fmt.Errorf("%w: %w", ErrAmbiguous, err)
	}
	return fmt.Errorf("actions: act seam call failed: %w", err)
}

// snippet bounds an error body for logs/messages.
func snippet(b []byte) string {
	const limit = 300
	s := strings.TrimSpace(string(b))
	if len(s) > limit {
		return s[:limit]
	}
	return s
}
