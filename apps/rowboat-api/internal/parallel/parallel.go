// Package parallel is a client for the Parallel Web Task API (RFC 039).
//
// The reason this vendor and not a model with a search tool: the Task API
// returns a per-field `basis` — {field, citations[{title, url, excerpts}],
// reasoning, confidence} — so an enrichment result arrives as evidence rather
// than as prose. This codebase refuses facts without evidence, and a model
// summarising search results produces something the provenance ladder has no
// honest place for.
//
// The API key is server-held. It never reaches the desktop, a model prompt, or a
// log line.
package parallel

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

// ErrNotConfigured is returned by every call when no API key is set, so the
// research surface reports itself unavailable instead of calling an
// unauthenticated endpoint.
var ErrNotConfigured = errors.New("parallel: not configured")

// ErrRunFailed is returned when the vendor finishes a run in a terminal state
// that produced no output. Failed runs are not billed by the vendor, and the
// caller refunds its credit reservation on this error.
var ErrRunFailed = errors.New("parallel: task run failed")

// Processor names a Task API tier. Cost per the published 2026-08 rates:
// lite $5/1k (~2 fields), base $10/1k (~5 fields), core $25/1k (~10 fields).
const (
	ProcessorLite = "lite"
	ProcessorBase = "base"
	ProcessorCore = "core"
)

// Processors is the allowlist. An unrecognised processor is refused before the
// call rather than passed through, because a typo'd tier is a silent price
// change.
var Processors = map[string]bool{
	ProcessorLite: true,
	ProcessorBase: true,
	ProcessorCore: true,
}

// Citation is one piece of evidence for one field.
type Citation struct {
	Title    string   `json:"title,omitempty"`
	URL      string   `json:"url"`
	Excerpts []string `json:"excerpts,omitempty"`
}

// Basis is the vendor's evidence for a single output field.
type Basis struct {
	Field      string     `json:"field"`
	Citations  []Citation `json:"citations"`
	Reasoning  string     `json:"reasoning,omitempty"`
	Confidence string     `json:"confidence,omitempty"` // "high" | "medium" | "low"
}

// TaskResult is one completed run: the structured output plus its per-field
// evidence.
type TaskResult struct {
	RunID     string
	Processor string
	Content   map[string]any
	Basis     []Basis
}

// BasisFor returns the evidence for one output field.
func (r *TaskResult) BasisFor(field string) (Basis, bool) {
	for _, b := range r.Basis {
		if b.Field == field {
			return b, true
		}
	}
	return Basis{}, false
}

// TaskRequest is one task submission.
type TaskRequest struct {
	// Input is the anchor the vendor resolves against. Callers must send the
	// narrowest anchor they have — see the entity-resolution note in RFC 039:
	// a confident answer about the wrong Sarah Chen is worse than no answer.
	Input map[string]any
	// OutputSchema is a JSON Schema object whose properties name the fields the
	// task must return. Field names become PersonAttribute dimensions, so they
	// are chosen by the caller and not by the model.
	OutputSchema map[string]any
	Processor    string
}

// Config configures the client.
type Config struct {
	APIKey  string
	BaseURL string
	Policy  outbound.Policy
	// ResultPollInterval and ResultPollAttempts bound the wait for a run that
	// is still executing when the blocking result read returns early.
	ResultPollInterval time.Duration
	ResultPollAttempts int
}

// Client calls the Parallel Task API.
type Client struct {
	http               *outbound.Client
	baseURL            string
	apiKey             string
	resultPollInterval time.Duration
	resultPollAttempts int
}

// New builds a client. Returns nil when no API key is configured; every method
// on a nil client returns ErrNotConfigured, so an unconfigured deployment fails
// closed and loudly rather than silently degrading.
func New(cfg Config) *Client {
	if strings.TrimSpace(cfg.APIKey) == "" {
		return nil
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://api.parallel.ai"
	}
	cfg.Policy.Name = "parallel"
	if cfg.Policy.Timeout == 0 {
		// Task runs are research, not lookups: a `core` run reads several pages
		// before it answers.
		cfg.Policy.Timeout = 120 * time.Second
	}
	if cfg.Policy.MaxResponseBytes == 0 {
		cfg.Policy.MaxResponseBytes = 8 << 20
	}
	if cfg.ResultPollInterval <= 0 {
		cfg.ResultPollInterval = 2 * time.Second
	}
	if cfg.ResultPollAttempts <= 0 {
		cfg.ResultPollAttempts = 30
	}
	return &Client{
		http:               outbound.NewClient(cfg.Policy),
		baseURL:            strings.TrimSuffix(cfg.BaseURL, "/"),
		apiKey:             cfg.APIKey,
		resultPollInterval: cfg.ResultPollInterval,
		resultPollAttempts: cfg.ResultPollAttempts,
	}
}

// Configured reports whether research calls can be made.
func (c *Client) Configured() bool { return c != nil }

// RunTask submits one task and returns its completed result.
func (c *Client) RunTask(ctx context.Context, req TaskRequest) (*TaskResult, error) {
	if c == nil {
		return nil, ErrNotConfigured
	}
	if !Processors[req.Processor] {
		return nil, fmt.Errorf("parallel: unsupported processor %q", req.Processor)
	}
	if len(req.Input) == 0 {
		return nil, errors.New("parallel: task input is empty")
	}
	if len(req.OutputSchema) == 0 {
		return nil, errors.New("parallel: task output schema is empty")
	}

	runID, err := c.createRun(ctx, req)
	if err != nil {
		return nil, err
	}
	result, err := c.awaitResult(ctx, runID)
	if err != nil {
		return nil, err
	}
	result.Processor = req.Processor
	return result, nil
}

type createRunResponse struct {
	RunID  string `json:"run_id"`
	Status string `json:"status"`
}

func (c *Client) createRun(ctx context.Context, req TaskRequest) (string, error) {
	body, err := json.Marshal(map[string]any{
		"input":     req.Input,
		"processor": req.Processor,
		"task_spec": map[string]any{
			"output_schema": map[string]any{
				"type":        "json",
				"json_schema": req.OutputSchema,
			},
		},
	})
	if err != nil {
		return "", err
	}
	var out createRunResponse
	if err := c.do(ctx, http.MethodPost, "/v1/tasks/runs", body, &out); err != nil {
		return "", err
	}
	if out.RunID == "" {
		return "", errors.New("parallel: task run response carried no run_id")
	}
	return out.RunID, nil
}

// resultResponse is the subset of the result payload this codebase consumes.
// Everything else the vendor returns is deliberately dropped rather than stored:
// a field nobody reads is a field nobody notices going stale.
type resultResponse struct {
	Run struct {
		RunID  string `json:"run_id"`
		Status string `json:"status"`
	} `json:"run"`
	Output struct {
		Content map[string]any `json:"content"`
		Basis   []Basis        `json:"basis"`
	} `json:"output"`
}

func (c *Client) awaitResult(ctx context.Context, runID string) (*TaskResult, error) {
	path := "/v1/tasks/runs/" + url.PathEscape(runID) + "/result"
	for attempt := 0; attempt < c.resultPollAttempts; attempt++ {
		var out resultResponse
		if err := c.do(ctx, http.MethodGet, path, nil, &out); err != nil {
			return nil, err
		}
		switch strings.ToLower(out.Run.Status) {
		case "completed":
			return &TaskResult{
				RunID:   runID,
				Content: out.Output.Content,
				Basis:   out.Output.Basis,
			}, nil
		case "failed", "cancelled", "canceled":
			return nil, fmt.Errorf("%w: run %s ended %s", ErrRunFailed, runID, out.Run.Status)
		}
		// Still queued or running. The result endpoint blocks server-side, so
		// this loop is the fallback for an early return, not the primary wait.
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(c.resultPollInterval):
		}
	}
	return nil, fmt.Errorf("%w: run %s did not complete in time", ErrRunFailed, runID)
}

func (c *Client) do(ctx context.Context, method, path string, body []byte, out any) error {
	var reader *bytes.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	} else {
		reader = bytes.NewReader(nil)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("parallel: %s %s: %w", method, path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := outbound.ReadAll(resp.Body, c.http.MaxResponseBytes())
	if err != nil {
		return fmt.Errorf("parallel: read response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// The vendor's error bodies can echo the input, which is a counterparty's
		// name and domain. Report the status, never the body: callers log errors.
		return fmt.Errorf("parallel: %s %s returned %d", method, path, resp.StatusCode)
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("parallel: decode response: %w", err)
	}
	return nil
}
