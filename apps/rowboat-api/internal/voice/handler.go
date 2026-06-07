// Package voice serves POST /v1/voice/text-to-speech/{voiceId}: a credit-gated
// proxy to ElevenLabs using the server-held xi-api-key. Audio bytes are
// streamed straight back to the desktop.
package voice

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/pricing"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/proxyutil"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

const maxBody = 1 << 20 // 1 MiB of TTS text/settings

// Handler serves the voice proxy.
type Handler struct {
	prices  *pricing.Table
	gate    *quota.Gate
	secrets *secrets.Store
	http    *outbound.Client
	log     *zap.Logger
	baseURL string
	limits  quota.SpendLimits
}

// New builds the voice handler.
func New(prices *pricing.Table, gate *quota.Gate, sec *secrets.Store, log *zap.Logger) *Handler {
	return &Handler{
		prices:  prices,
		gate:    gate,
		secrets: sec,
		http: outbound.NewClient(outbound.Policy{
			Name:                  "elevenlabs",
			Timeout:               60 * time.Second,
			ResponseHeaderTimeout: 15 * time.Second,
			MaxConcurrent:         64,
			MaxResponseBytes:      64 << 20,
		}),
		log:     log,
		baseURL: "https://api.elevenlabs.io",
	}
}

// SetUpstream overrides the ElevenLabs base URL (tests).
func (h *Handler) SetUpstream(base string) {
	if base != "" {
		h.baseURL = base
	}
}

// SetOutboundPolicy applies the shared outbound vendor policy.
func (h *Handler) SetOutboundPolicy(policy outbound.Policy) {
	policy.Name = "elevenlabs"
	h.http = outbound.NewClient(policy)
}

// SetSpendLimits applies per-user daily/monthly credit caps.
func (h *Handler) SetSpendLimits(limits quota.SpendLimits) {
	h.limits = limits
}

// TextToSpeech handles POST /v1/voice/text-to-speech/{voiceId}.
func (h *Handler) TextToSpeech(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	if !httpx.RequireIdempotencyKey(w, r) {
		return
	}
	voiceID := chi.URLParam(r, "voiceId")
	if voiceID == "" {
		httpx.Error(w, http.StatusBadRequest, "missing voiceId", "bad_request")
		return
	}

	raw, ok := httpx.ReadBody(w, r, maxBody)
	if !ok {
		return
	}
	var parsed struct {
		Text string `json:"text"`
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	if err := dec.Decode(&parsed); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid JSON body", "bad_request")
		return
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		httpx.Error(w, http.StatusBadRequest, "request body must contain exactly one JSON document", "bad_request")
		return
	}
	if parsed.Text == "" {
		httpx.Error(w, http.StatusBadRequest, "missing text", "bad_request")
		return
	}

	cost := h.prices.VoiceCost(utf8.RuneCountInString(parsed.Text))
	if err := h.gate.CheckSpendLimits(r.Context(), cost, h.limits); err != nil {
		writeQuotaError(w, err)
		return
	}
	requestID := httpx.IdempotencyKeyUUID(r, u.ID.String())
	charge, err := h.gate.Reserve(r.Context(), "voice_tts", cost, requestID)
	if err != nil {
		if err == quota.ErrInsufficientCredits {
			httpx.Error(w, http.StatusPaymentRequired, "insufficient_credits", "insufficient_credits")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "could not reserve credits", "internal_error")
		return
	}

	key := h.secrets.ElevenLabs()
	if key == "" {
		refund(charge, h.log)
		httpx.Error(w, http.StatusBadGateway, "voice provider not configured", "provider_unconfigured")
		return
	}

	upReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, h.baseURL+"/v1/text-to-speech/"+voiceID, bytes.NewReader(raw))
	if err != nil {
		refund(charge, h.log)
		httpx.Error(w, http.StatusInternalServerError, "could not build upstream request", "internal_error")
		return
	}
	upReq.Header.Set("xi-api-key", key)
	upReq.Header.Set("Content-Type", "application/json")
	upReq.Header.Set("Accept", "audio/mpeg")
	upReq.Header.Set("Idempotency-Key", r.Header.Get("Idempotency-Key"))

	resp, err := h.http.Do(upReq)
	if err != nil {
		refund(charge, h.log)
		h.log.Warn("elevenlabs upstream error", zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "voice upstream failed", "upstream_error")
		return
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= http.StatusBadRequest {
		refund(charge, h.log)
		w.Header().Set("Content-Type", proxyutil.ContentTypeOr(resp, "application/json"))
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
		return
	}

	w.Header().Set("Content-Type", proxyutil.ContentTypeOr(resp, "audio/mpeg"))
	w.WriteHeader(resp.StatusCode)
	if _, err := io.Copy(w, resp.Body); err != nil {
		refund(charge, h.log)
		h.log.Warn("voice upstream response copy failed", zap.Error(err))
		return
	}

	// Flat per-character charge: actual == reserved, so settle is a no-op, but
	// call it for symmetry. Detached so it survives a client disconnect.
	sctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 5*time.Second)
	defer cancel()
	if err := charge.Settle(sctx, cost); err != nil {
		h.log.Error("voice settle", zap.Error(err))
	}
}

func writeQuotaError(w http.ResponseWriter, err error) {
	switch err {
	case quota.ErrDailyLimitExceeded:
		httpx.Error(w, http.StatusTooManyRequests, "daily credit limit exceeded", "daily_credit_limit_exceeded")
	case quota.ErrMonthlyLimitExceeded:
		httpx.Error(w, http.StatusTooManyRequests, "monthly credit limit exceeded", "monthly_credit_limit_exceeded")
	case quota.ErrNoUser:
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
	default:
		httpx.Error(w, http.StatusInternalServerError, "could not check credit limits", "internal_error")
	}
}

func refund(charge *quota.Charge, log *zap.Logger) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := charge.Refund(ctx); err != nil {
		log.Error("voice refund", zap.Error(err))
	}
}
