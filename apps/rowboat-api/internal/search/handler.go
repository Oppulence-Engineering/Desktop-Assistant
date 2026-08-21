// Package search serves POST /v1/search/exa: a credit-gated pass-through proxy
// to Exa Search using the server-held x-api-key.
package search

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/pricing"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/proxyutil"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"go.uber.org/zap"
)

const maxBody = 1 << 20

// Handler serves the Exa proxy.
type Handler struct {
	prices  *pricing.Table
	gate    *quota.Gate
	secrets *secrets.Store
	http    *outbound.Client
	log     *zap.Logger
	baseURL string
	limits  quota.SpendLimits
}

// New builds the search handler.
func New(prices *pricing.Table, gate *quota.Gate, sec *secrets.Store, log *zap.Logger) *Handler {
	return &Handler{
		prices:  prices,
		gate:    gate,
		secrets: sec,
		http: outbound.NewClient(outbound.Policy{
			Name:                  "exa",
			Timeout:               30 * time.Second,
			ResponseHeaderTimeout: 15 * time.Second,
			MaxConcurrent:         64,
			MaxResponseBytes:      64 << 20,
		}),
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

// SetOutboundPolicy applies the shared outbound vendor policy.
func (h *Handler) SetOutboundPolicy(policy outbound.Policy) {
	policy.Name = "exa"
	h.http = outbound.NewClient(policy)
}

// SetSpendLimits applies per-user daily/monthly credit caps.
func (h *Handler) SetSpendLimits(limits quota.SpendLimits) {
	h.limits = limits
}

// Search handles POST /v1/search/exa.
func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	if !httpx.RequireIdempotencyKey(w, r) {
		return
	}

	raw, ok := httpx.ReadBody(w, r, maxBody)
	if !ok {
		return
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	var parsed any
	if err := dec.Decode(&parsed); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid JSON body", "bad_request")
		return
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		httpx.Error(w, http.StatusBadRequest, "request body must contain exactly one JSON document", "bad_request")
		return
	}

	cost := h.prices.ExaCost()
	requestID := httpx.IdempotencyKeyUUID(r, u.ID.String(), raw)
	charge, err := h.gate.Reserve(r.Context(), "exa_search", cost, requestID, h.limits)
	if err != nil {
		switch {
		case errors.Is(err, quota.ErrInsufficientCredits):
			httpx.Error(w, http.StatusPaymentRequired, "insufficient_credits", "insufficient_credits")
		case errors.Is(err, quota.ErrSubscriptionNotActive):
			httpx.Error(w, http.StatusPaymentRequired, "subscription not active", "subscription_not_active")
		case errors.Is(err, quota.ErrDailyLimitExceeded), errors.Is(err, quota.ErrMonthlyLimitExceeded), errors.Is(err, quota.ErrNoUser):
			writeQuotaError(w, err)
		default:
			httpx.Error(w, http.StatusInternalServerError, "could not reserve credits", "internal_error")
		}
		return
	}
	if charge.Finalized() {
		// Already settled for this Idempotency-Key: re-calling Exa would run (and
		// vendor-bill) the search again while every accounting write no-ops.
		httpx.Error(w, http.StatusConflict, "a request with this Idempotency-Key was already completed", "request_already_completed")
		return
	}
	if charge.InProgress() {
		// Concurrent duplicate (same Idempotency-Key) still in flight; don't
		// double-call Exa (it bills per search).
		httpx.Error(w, http.StatusConflict, "a request with this Idempotency-Key is already in progress", "request_in_progress")
		return
	}

	key := h.secrets.Exa()
	if key == "" {
		refund(r.Context(), charge, h.log)
		httpx.Error(w, http.StatusBadGateway, "search provider not configured", "provider_unconfigured")
		return
	}

	upReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, h.baseURL+"/search", bytes.NewReader(raw))
	if err != nil {
		refund(r.Context(), charge, h.log)
		httpx.Error(w, http.StatusInternalServerError, "could not build upstream request", "internal_error")
		return
	}
	upReq.Header.Set("x-api-key", key)
	upReq.Header.Set("Content-Type", "application/json")
	upReq.Header.Set("Idempotency-Key", r.Header.Get("Idempotency-Key"))

	resp, err := h.http.Do(upReq)
	if err != nil {
		refund(r.Context(), charge, h.log)
		h.log.Warn("exa upstream error", zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "search upstream failed", "upstream_error")
		return
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= http.StatusBadRequest {
		refund(r.Context(), charge, h.log)
		httpx.Error(w, http.StatusBadGateway, "search provider rejected the request", "upstream_error")
		return
	}

	w.Header().Set("Content-Type", proxyutil.ContentTypeOr(resp, "application/json"))
	w.WriteHeader(resp.StatusCode)
	if _, err := io.Copy(w, resp.Body); err != nil {
		// Upstream already ran and billed us; a client disconnect mid-copy must
		// still settle the charge, not refund it (refunding would hand out free,
		// vendor-billed searches to anyone who aborts the download).
		h.log.Warn("exa upstream response copy failed", zap.Error(err))
	}

	sctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 5*time.Second)
	defer cancel()
	if err := charge.Settle(sctx, cost); err != nil {
		h.log.Error("exa settle", zap.Error(err))
	}
}

func writeQuotaError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, quota.ErrSubscriptionNotActive):
		httpx.Error(w, http.StatusPaymentRequired, "subscription not active", "subscription_not_active")
	case errors.Is(err, quota.ErrDailyLimitExceeded):
		httpx.Error(w, http.StatusTooManyRequests, "daily credit limit exceeded", "daily_credit_limit_exceeded")
	case errors.Is(err, quota.ErrMonthlyLimitExceeded):
		httpx.Error(w, http.StatusTooManyRequests, "monthly credit limit exceeded", "monthly_credit_limit_exceeded")
	case errors.Is(err, quota.ErrNoUser):
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
	default:
		httpx.Error(w, http.StatusInternalServerError, "could not check credit limits", "internal_error")
	}
}

func refund(reqCtx context.Context, charge *quota.Charge, log *zap.Logger) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(reqCtx), 5*time.Second)
	defer cancel()
	if err := charge.Refund(ctx); err != nil {
		log.Error("exa refund", zap.Error(err))
	}
}
