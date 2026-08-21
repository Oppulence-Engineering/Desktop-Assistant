// Package revenue implements the Rowboat side of RFC 030 (Revenue Memory and
// Outbound Governance): the relationship/action domain, the action-queue
// lifecycle with its hard invariants, and the client for the OutboundConsole
// preflight facade.
//
// The package never composes a policy decision itself. Suppression,
// verification, ownership, and policy rules are owned by the facade; when the
// facade is unreachable or unconfigured the answer is "no decision" (fail
// closed), never a synthesized pass.
package revenue

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

// SchemaVersion is the revenue-integration contract version (RFC 030).
const SchemaVersion = "2026-07-12"

// ErrFacadeUnavailable means no policy decision could be obtained. Callers
// must leave the action `policy_status=pending` and must not approve or send.
var ErrFacadeUnavailable = errors.New("revenue: outbound facade unavailable (fail closed)")

// EvaluateRecipient is the bounded recipient block of an evaluate request.
type EvaluateRecipient struct {
	OutboundLeadID string `json:"outboundLeadId,omitempty"`
	Email          string `json:"email,omitempty"`
	AccountDomain  string `json:"accountDomain,omitempty"`
}

// RelationshipSignals carries only bounded signals across the boundary. Raw
// email bodies, transcripts, prompts, and complete artifacts are forbidden.
type RelationshipSignals struct {
	LastContactAt       *time.Time `json:"lastContactAt,omitempty"`
	RequestedFollowUpAt *time.Time `json:"requestedFollowUpAt,omitempty"`
	ReasonCode          string     `json:"reasonCode,omitempty"`
}

// EvaluateAction is the action block of an evaluate request.
type EvaluateAction struct {
	ActionID            string              `json:"actionId"`
	Revision            int                 `json:"revision"`
	RevisionHash        string              `json:"revisionHash"`
	ActionType          string              `json:"actionType"`
	Channel             string              `json:"channel"`
	Recipient           EvaluateRecipient   `json:"recipient"`
	RelationshipSignals RelationshipSignals `json:"relationshipSignals"`
}

// EvaluateRequest is the facade EvaluateRevenueAction request (RFC 030).
type EvaluateRequest struct {
	SchemaVersion          string         `json:"schemaVersion"`
	RequestID              string         `json:"requestId"`
	IdempotencyKey         string         `json:"idempotencyKey"`
	CorrelationID          string         `json:"correlationId"`
	OutboundOrganizationID string         `json:"outboundOrganizationId,omitempty"`
	OutboundWorkspaceID    string         `json:"outboundWorkspaceId,omitempty"`
	Actor                  EvaluateActor  `json:"actor"`
	Action                 EvaluateAction `json:"action"`
}

// EvaluateActor identifies the end user for facade-side audit.
type EvaluateActor struct {
	WorkOSUserID string `json:"workosUserId,omitempty"`
}

// PolicyDecision is the facade's immutable answer for one exact action
// revision. Sub-objects are kept as raw JSON: Rowboat snapshots them for
// audit but never re-derives policy from their contents.
type PolicyDecision struct {
	SchemaVersion string          `json:"schemaVersion"`
	DecisionID    string          `json:"decisionId"`
	RequestID     string          `json:"requestId"`
	ActionID      string          `json:"actionId"`
	Revision      int             `json:"revision"`
	RevisionHash  string          `json:"revisionHash"`
	Status        string          `json:"status"` // passed | review_required | blocked
	OutboundLead  string          `json:"outboundLeadId,omitempty"`
	Verification  json.RawMessage `json:"verification,omitempty"`
	Suppression   json.RawMessage `json:"suppression,omitempty"`
	Research      json.RawMessage `json:"research,omitempty"`
	CRM           json.RawMessage `json:"crm,omitempty"`
	ReasonCodes   []string        `json:"reasonCodes"`
	EvaluatedAt   time.Time       `json:"evaluatedAt"`
	ExpiresAt     time.Time       `json:"expiresAt"`

	// ResponseHash is computed by Rowboat over the raw response body so a
	// stored snapshot can be proven against what the facade returned.
	ResponseHash string `json:"-"`
}

// OutcomeReport mirrors ReportRevenueActionOutcome (RFC 030).
type OutcomeReport struct {
	SchemaVersion       string    `json:"schemaVersion"`
	IdempotencyKey      string    `json:"idempotencyKey"`
	OutboundWorkspaceID string    `json:"outboundWorkspaceId,omitempty"`
	ActionID            string    `json:"actionId"`
	OutboundLeadID      string    `json:"outboundLeadId,omitempty"`
	Kind                string    `json:"kind"`
	Source              string    `json:"source"`
	SourceEventID       string    `json:"sourceEventId"`
	OccurredAt          time.Time `json:"occurredAt"`
}

// FacadeClient is the OutboundConsole revenue facade (RFC 030 WP1). Rowboat
// calls it for preflight and outcome reporting; it never calls the
// verification backend (Reacher) directly.
type FacadeClient interface {
	EvaluateRevenueAction(ctx context.Context, req EvaluateRequest) (*PolicyDecision, error)
	ReportRevenueActionOutcome(ctx context.Context, report OutcomeReport) error
}

// disabledFacade is the fail-closed default when no facade is configured.
// Every call answers ErrFacadeUnavailable; nothing can pass preflight.
type disabledFacade struct{}

func (disabledFacade) EvaluateRevenueAction(context.Context, EvaluateRequest) (*PolicyDecision, error) {
	return nil, ErrFacadeUnavailable
}

func (disabledFacade) ReportRevenueActionOutcome(context.Context, OutcomeReport) error {
	return ErrFacadeUnavailable
}

// NewDisabledFacade returns the fail-closed facade used when
// REVENUE_FACADE_BASE_URL is unset (local mode).
func NewDisabledFacade() FacadeClient { return disabledFacade{} }

// HTTPFacadeConfig configures the HTTP facade client.
type HTTPFacadeConfig struct {
	BaseURL string
	// ServiceToken is the short-lived service credential (RFC 030 service
	// auth). During initial deployment this is the bootstrap environment
	// credential; user bearer tokens are never forwarded.
	ServiceToken string
	Timeout      time.Duration
}

// httpFacade calls the OutboundConsole facade over HTTP with the vendor-call
// policy (timeouts, response caps, circuit breaker) applied.
type httpFacade struct {
	cfg    HTTPFacadeConfig
	client *outbound.Client
}

// NewHTTPFacade builds the production facade client.
func NewHTTPFacade(cfg HTTPFacadeConfig) FacadeClient {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	return &httpFacade{
		cfg: cfg,
		client: outbound.NewClient(outbound.Policy{
			Name:                  "outbound-facade",
			Timeout:               timeout,
			ResponseHeaderTimeout: timeout,
			MaxConcurrent:         16,
			MaxResponseBytes:      1 << 20, // decisions are bounded envelopes, never provider dumps
			FailureThreshold:      5,
			Cooldown:              30 * time.Second,
			// Evaluate/outcome calls carry idempotency keys the facade must
			// honor (RFC 030 WP1 gate: duplicate requests are free).
			RetryNonIdempotent: true,
		}),
	}
}

func (f *httpFacade) EvaluateRevenueAction(ctx context.Context, req EvaluateRequest) (*PolicyDecision, error) {
	req.SchemaVersion = SchemaVersion
	body, status, err := f.post(ctx, "/v1/revenue/evaluate", req.IdempotencyKey, req)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrFacadeUnavailable, err)
	}
	if status != http.StatusOK {
		// A non-200 is "no decision", not a decision. Never map an error
		// body to blocked/passed.
		return nil, fmt.Errorf("%w: facade status %d", ErrFacadeUnavailable, status)
	}
	var decision PolicyDecision
	if err := json.Unmarshal(body, &decision); err != nil {
		return nil, fmt.Errorf("%w: undecodable decision: %w", ErrFacadeUnavailable, err)
	}
	if decision.DecisionID == "" || decision.Status == "" {
		return nil, fmt.Errorf("%w: decision missing id or status", ErrFacadeUnavailable)
	}
	sum := sha256.Sum256(body)
	decision.ResponseHash = "sha256:" + hex.EncodeToString(sum[:])
	return &decision, nil
}

func (f *httpFacade) ReportRevenueActionOutcome(ctx context.Context, report OutcomeReport) error {
	report.SchemaVersion = SchemaVersion
	_, status, err := f.post(ctx, "/v1/revenue/outcomes", report.IdempotencyKey, report)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrFacadeUnavailable, err)
	}
	if status != http.StatusOK && status != http.StatusAccepted && status != http.StatusConflict {
		// 409 is an idempotent replay: the outcome is already recorded.
		return fmt.Errorf("%w: facade status %d", ErrFacadeUnavailable, status)
	}
	return nil
}

func (f *httpFacade) post(ctx context.Context, path, idempotencyKey string, payload any) ([]byte, int, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, 0, err
	}
	// #nosec G704 -- BaseURL is operator-controlled service configuration; path is a fixed call-site constant.
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, f.cfg.BaseURL+path, bytes.NewReader(raw))
	if err != nil {
		return nil, 0, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if idempotencyKey != "" {
		httpReq.Header.Set("Idempotency-Key", idempotencyKey)
	}
	if f.cfg.ServiceToken != "" {
		httpReq.Header.Set("Authorization", "Bearer "+f.cfg.ServiceToken)
	}
	// #nosec G704 -- httpReq targets the operator-configured facade above.
	resp, err := f.client.Do(httpReq)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return body, resp.StatusCode, nil
}
