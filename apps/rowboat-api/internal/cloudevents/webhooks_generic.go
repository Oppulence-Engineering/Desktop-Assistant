package cloudevents

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
)

// GenericWebhook handles POST /v1/webhooks/events. It is the public signed
// receiver for user-owned webhook events from workflow tools such as Zapier,
// Make, bespoke backends, or connector gateways that cannot hold a user JWT.
func (h *Handler) GenericWebhook(w http.ResponseWriter, r *http.Request) {
	body, ok := httpx.ReadBody(w, r, h.maxIngestBody())
	if !ok {
		return
	}
	if err := verifyGenericWebhookSignature(
		h.cfg.WebhookSigningSecret,
		body,
		r.Header.Get("X-Webhook-Signature"),
	); err != nil {
		if errors.Is(err, errGenericWebhookUnconfigured) {
			h.log.Error("generic webhook rejected: WEBHOOK_SIGNING_SECRET is not configured")
			httpx.Error(w, http.StatusInternalServerError, "webhook verification unavailable", "webhook_unconfigured")
			return
		}
		httpx.Error(w, http.StatusUnauthorized, "invalid webhook signature", "unauthorized")
		return
	}

	var req genericWebhookRequest
	if !decodeSingleJSON(w, body, &req) {
		return
	}
	owner, err := h.resolveInternalUser(auth.WithInternal(r.Context()), strings.TrimSpace(req.UserID))
	if err != nil {
		writeIngestError(w, err, h.log)
		return
	}
	ingestReq, err := req.ingestRequest()
	if err != nil {
		writeIngestError(w, err, h.log)
		return
	}
	ev, deduped, err := h.ingest(r.Context(), owner, ingestReq)
	if err != nil {
		writeIngestError(w, err, h.log)
		return
	}
	resp := IngestResponse{
		EventID:          ev.ID.String(),
		RoutingStatus:    ev.RoutingStatus,
		Deduped:          deduped,
		MatchedTaskCount: ev.MatchedTaskCount,
	}
	status := http.StatusAccepted
	if deduped {
		status = http.StatusOK
	}
	httpx.WriteJSON(w, status, resp)
}

type genericWebhookRequest struct {
	UserID          string          `json:"userId"`
	Source          string          `json:"source,omitempty"`
	SourceEventID   string          `json:"sourceEventId,omitempty"`
	SourceAccountID string          `json:"sourceAccountId,omitempty"`
	EventType       string          `json:"eventType,omitempty"`
	Subject         string          `json:"subject,omitempty"`
	Text            string          `json:"text,omitempty"`
	Payload         json.RawMessage `json:"payload,omitempty"`
	DedupeKey       string          `json:"dedupeKey,omitempty"`
	OccurredAt      *time.Time      `json:"occurredAt,omitempty"`
}

func (req genericWebhookRequest) ingestRequest() (IngestRequest, error) {
	source := strings.TrimSpace(req.Source)
	if source == "" {
		source = SourceWebhook
	}
	if !genericWebhookSourceAllowed(source) {
		return IngestRequest{}, &validationError{msg: "source must be one of webhook, mcp, github, linear, stripe"}
	}
	sourceEventID := strings.TrimSpace(req.SourceEventID)
	sourceAccountID := strings.TrimSpace(req.SourceAccountID)
	dedupeKey := strings.TrimSpace(req.DedupeKey)
	if dedupeKey == "" && sourceEventID != "" {
		if sourceAccountID != "" {
			dedupeKey = fmt.Sprintf("%s:%s:%s", source, sourceAccountID, sourceEventID)
		} else {
			dedupeKey = source + ":" + sourceEventID
		}
	}
	if dedupeKey == "" {
		return IngestRequest{}, &validationError{msg: "dedupeKey or sourceEventId is required"}
	}

	subject := strings.TrimSpace(req.Subject)
	if subject == "" && strings.TrimSpace(req.EventType) != "" {
		subject = strings.TrimSpace(req.EventType)
	}
	text := strings.TrimSpace(req.Text)
	if text == "" && len(req.Payload) > 0 {
		text = summarizeWebhookPayload(req.Payload)
	}

	return IngestRequest{
		Source:          source,
		SourceEventID:   sourceEventID,
		SourceAccountID: sourceAccountID,
		EventType:       strings.TrimSpace(req.EventType),
		Subject:         subject,
		Text:            text,
		Payload:         req.Payload,
		DedupeKey:       dedupeKey,
		OccurredAt:      req.OccurredAt,
	}, nil
}

func genericWebhookSourceAllowed(source string) bool {
	switch source {
	case SourceWebhook, SourceMCP, SourceGitHub, SourceLinear, SourceStripe:
		return true
	default:
		return false
	}
}

var errGenericWebhookUnconfigured = errors.New("cloudevents: generic webhook signing secret not configured")

func verifyGenericWebhookSignature(secret string, body []byte, got string) error {
	if secret == "" {
		return errGenericWebhookUnconfigured
	}
	got = strings.TrimSpace(strings.TrimPrefix(got, "sha256="))
	if got == "" {
		return errors.New("missing webhook signature")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	want := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(want), []byte(got)) {
		return errors.New("signature mismatch")
	}
	return nil
}

func decodeSingleJSON(w http.ResponseWriter, body []byte, dst any) bool {
	dec := json.NewDecoder(bytes.NewReader(body))
	if err := dec.Decode(dst); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid JSON body", "bad_request")
		return false
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		httpx.Error(w, http.StatusBadRequest, "request body must contain exactly one JSON document", "bad_request")
		return false
	}
	return true
}

func summarizeWebhookPayload(raw json.RawMessage) string {
	var compact bytes.Buffer
	if err := json.Compact(&compact, raw); err != nil {
		return truncate("Webhook payload: "+string(raw), maxTextLen)
	}
	return truncate("Webhook payload: "+compact.String(), maxTextLen)
}
