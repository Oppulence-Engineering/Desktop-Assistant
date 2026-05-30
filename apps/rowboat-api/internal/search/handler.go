// Package search serves POST /v1/search/exa: a credit-gated pass-through proxy
// to Exa Search using the server-held x-api-key.
package search

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/pricing"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/proxyutil"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const maxBody = 1 << 20

// Handler serves the Exa proxy.
type Handler struct {
	prices  *pricing.Table
	gate    *quota.Gate
	secrets *secrets.Store
	http    *http.Client
	log     *zap.Logger
	baseURL string
}

// New builds the search handler.
func New(prices *pricing.Table, gate *quota.Gate, sec *secrets.Store, log *zap.Logger) *Handler {
	return &Handler{
		prices:  prices,
		gate:    gate,
		secrets: sec,
		http:    &http.Client{Timeout: 30 * time.Second},
		log:     log,
		baseURL: "https://api.exa.ai",
	}
}

// SetUpstream overrides the Exa base URL (tests).
func (h *Handler) SetUpstream(base string) {
	if base != "" {
		h.baseURL = base
	}
}

// Search handles POST /v1/search/exa.
func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserFromCtx(r.Context()); !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}

	raw, err := io.ReadAll(io.LimitReader(r.Body, maxBody))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "could not read body", "bad_request")
		return
	}

	cost := h.prices.ExaCost()
	requestID := uuid.New()
	charge, err := h.gate.Reserve(r.Context(), "exa_search", cost, requestID)
	if err != nil {
		if err == quota.ErrInsufficientCredits {
			httpx.Error(w, http.StatusPaymentRequired, "insufficient_credits", "insufficient_credits")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "could not reserve credits", "internal_error")
		return
	}

	key := h.secrets.Exa()
	if key == "" {
		refund(charge, h.log)
		httpx.Error(w, http.StatusBadGateway, "search provider not configured", "provider_unconfigured")
		return
	}

	upReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, h.baseURL+"/search", bytes.NewReader(raw))
	if err != nil {
		refund(charge, h.log)
		httpx.Error(w, http.StatusInternalServerError, "could not build upstream request", "internal_error")
		return
	}
	upReq.Header.Set("x-api-key", key)
	upReq.Header.Set("Content-Type", "application/json")

	resp, err := h.http.Do(upReq)
	if err != nil {
		refund(charge, h.log)
		h.log.Warn("exa upstream error", zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "search upstream failed", "upstream_error")
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

	w.Header().Set("Content-Type", proxyutil.ContentTypeOr(resp, "application/json"))
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)

	sctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 5*time.Second)
	defer cancel()
	if err := charge.Settle(sctx, cost); err != nil {
		h.log.Error("exa settle", zap.Error(err))
	}
}

func refund(charge *quota.Charge, log *zap.Logger) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := charge.Refund(ctx); err != nil {
		log.Error("exa refund", zap.Error(err))
	}
}
