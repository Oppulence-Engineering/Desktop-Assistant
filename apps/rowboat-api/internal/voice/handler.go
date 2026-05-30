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
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/pricing"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/proxyutil"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const maxBody = 1 << 20 // 1 MiB of TTS text/settings

// Handler serves the voice proxy.
type Handler struct {
	prices  *pricing.Table
	gate    *quota.Gate
	secrets *secrets.Store
	http    *http.Client
	log     *zap.Logger
	baseURL string
}

// New builds the voice handler.
func New(prices *pricing.Table, gate *quota.Gate, sec *secrets.Store, log *zap.Logger) *Handler {
	return &Handler{
		prices:  prices,
		gate:    gate,
		secrets: sec,
		http:    &http.Client{Timeout: 60 * time.Second},
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

// TextToSpeech handles POST /v1/voice/text-to-speech/{voiceId}.
func (h *Handler) TextToSpeech(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserFromCtx(r.Context()); !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	voiceID := chi.URLParam(r, "voiceId")
	if voiceID == "" {
		httpx.Error(w, http.StatusBadRequest, "missing voiceId", "bad_request")
		return
	}

	raw, err := io.ReadAll(io.LimitReader(r.Body, maxBody))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "could not read body", "bad_request")
		return
	}
	var parsed struct {
		Text string `json:"text"`
	}
	_ = json.Unmarshal(raw, &parsed)

	cost := h.prices.VoiceCost(utf8.RuneCountInString(parsed.Text))
	requestID := uuid.New()
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
	_, _ = io.Copy(w, resp.Body)

	// Flat per-character charge: actual == reserved, so settle is a no-op, but
	// call it for symmetry. Detached so it survives a client disconnect.
	sctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 5*time.Second)
	defer cancel()
	if err := charge.Settle(sctx, cost); err != nil {
		h.log.Error("voice settle", zap.Error(err))
	}
}

func refund(charge *quota.Charge, log *zap.Logger) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := charge.Refund(ctx); err != nil {
		log.Error("voice refund", zap.Error(err))
	}
}
