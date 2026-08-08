// Package llm is the OpenAI-compatible LLM gateway: it gates on credits,
// forwards to OpenRouter, streams responses back, settles the credit
// reservation against actual token usage, and records an LLMUsage row per call.
package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/pricing"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const maxRequestBody = 24 << 20 // 24 MiB (large contexts + tool defs)

// defaultMaxOutputTokens caps a completion request that arrives without one.
//
// OpenRouter sizes its credit check on the *requested* max_tokens, not on what
// the model ends up emitting. A request with no cap is therefore priced against
// the model's entire output window — 64,000 tokens on claude-haiku-4-5 — and is
// refused with 402 unless the account balance covers all of it. The desktop's
// streamText calls set no maxOutputTokens, so on 2026-08-07 a modest balance
// failed every single background run ("you requested up to 64000 tokens, but
// can only afford 6063") while the same request with a cap succeeded.
//
// 16k is far above anything the desktop's agents produce — labeling, graph
// sync and note tagging emit hundreds of tokens, and no chat answer runs to
// 12,000 words — so this bounds the reservation without truncating real work.
// Operators can raise it with LLM_DEFAULT_MAX_OUTPUT_TOKENS.
const defaultMaxOutputTokens = 16384

// Handler serves the /v1/llm/* gateway.
type Handler struct {
	prices  *pricing.Table
	gate    *quota.Gate
	secrets *secrets.Store
	client  *ent.Client
	http    *outbound.Client
	log     *zap.Logger

	openRouterBaseURL string
	allowedModels     map[string]struct{}
	maxPromptBytes    int
	maxToolBytes      int
	maxMessages       int
	defaultMaxOutput  int
	spendLimits       quota.SpendLimits
}

// Policy configures expensive-flow protections for LLM requests.
type Policy struct {
	AllowedModels          []string
	MaxPromptBytes         int
	MaxToolPayloadBytes    int
	MaxMessages            int
	DefaultMaxOutputTokens int
	SpendLimits            quota.SpendLimits
}

// New builds the LLM gateway handler.
func New(prices *pricing.Table, gate *quota.Gate, sec *secrets.Store, client *ent.Client, log *zap.Logger) *Handler {
	return &Handler{
		prices:  prices,
		gate:    gate,
		secrets: sec,
		client:  client,
		http: outbound.NewClient(outbound.Policy{
			Name:                  "llm",
			Timeout:               0, // streams are cancelled by request context
			ResponseHeaderTimeout: 15 * time.Second,
			MaxConcurrent:         32,
			MaxResponseBytes:      64 << 20,
		}),
		log:               log,
		openRouterBaseURL: openRouterBase,
		maxPromptBytes:    2 << 20,
		maxToolBytes:      1 << 20,
		maxMessages:       128,
		defaultMaxOutput:  defaultMaxOutputTokens,
	}
}

// SetUpstream overrides the OpenRouter base URL (used in tests and for
// self-hosted gateway deployments).
//
// Was SetUpstreams(openAI, openRouter). The OpenAI parameter is gone rather
// than ignored: a setter that silently discards an argument is a trap for
// whoever configures OPENAI_BASE_URL next and wonders why it has no effect.
// All chat traffic goes through OpenRouter; the OpenAI key and base URL are
// still used for embeddings, wired separately.
func (h *Handler) SetUpstream(openRouter string) {
	if openRouter != "" {
		h.openRouterBaseURL = openRouter
	}
}

// SetOutboundPolicy applies the shared outbound vendor policy.
func (h *Handler) SetOutboundPolicy(policy outbound.Policy) {
	policy.Name = "llm"
	policy.Timeout = 0
	h.http = outbound.NewClient(policy)
}

// SetPolicy applies business-flow protections.
func (h *Handler) SetPolicy(policy Policy) {
	h.allowedModels = make(map[string]struct{}, len(policy.AllowedModels))
	for _, model := range policy.AllowedModels {
		model = strings.TrimSpace(model)
		if model != "" {
			h.allowedModels[model] = struct{}{}
		}
	}
	if len(h.allowedModels) == 0 {
		h.allowedModels = nil
	}
	if policy.MaxPromptBytes > 0 {
		h.maxPromptBytes = policy.MaxPromptBytes
	}
	if policy.MaxToolPayloadBytes > 0 {
		h.maxToolBytes = policy.MaxToolPayloadBytes
	}
	if policy.MaxMessages > 0 {
		h.maxMessages = policy.MaxMessages
	}
	if policy.DefaultMaxOutputTokens > 0 {
		h.defaultMaxOutput = policy.DefaultMaxOutputTokens
	}
	h.spendLimits = policy.SpendLimits
}

type usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
	// PromptTokensDetails carries the cache-read subset of PromptTokens. Absent
	// from providers that do not support prompt caching, in which case
	// CachedTokens stays zero and pricing is unchanged.
	PromptTokensDetails struct {
		CachedTokens int `json:"cached_tokens"`
	} `json:"prompt_tokens_details"`
}

// cachedFrom reads the cache-read token count from a usage payload, tolerating
// providers that omit the details object entirely.
func cachedFrom(u *usage) int {
	if u == nil {
		return 0
	}
	return u.PromptTokensDetails.CachedTokens
}

type telemetry struct {
	useCase    string
	subUseCase string
	agentName  string
}

func headerOrLegacy(r *http.Request, primary, legacy string) string {
	if v := r.Header.Get(primary); v != "" {
		return v
	}
	return r.Header.Get(legacy)
}

func telemetryFrom(r *http.Request) telemetry {
	return telemetry{
		useCase:    headerOrLegacy(r, "x-solomon-use-case", "x-rowboat-use-case"),
		subUseCase: headerOrLegacy(r, "x-solomon-sub-use-case", "x-rowboat-sub-use-case"),
		agentName:  headerOrLegacy(r, "x-solomon-agent-name", "x-rowboat-agent-name"),
	}
}

// ChatCompletions handles POST /v1/llm/chat/completions.
func (h *Handler) ChatCompletions(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "/chat/completions")
}

// Completions handles POST /v1/llm/completions.
func (h *Handler) Completions(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "/completions")
}

// Embeddings handles POST /v1/llm/embeddings.
func (h *Handler) Embeddings(w http.ResponseWriter, r *http.Request) {
	h.proxy(w, r, "/embeddings")
}

// proxy implements the full gateway flow for an OpenAI-compatible endpoint.
func (h *Handler) proxy(w http.ResponseWriter, r *http.Request, path string) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	if !httpx.RequireIdempotencyKey(w, r) {
		return
	}

	raw, ok := httpx.ReadBody(w, r, maxRequestBody)
	if !ok {
		return
	}
	var body map[string]any
	dec := json.NewDecoder(bytes.NewReader(raw))
	// UseNumber keeps numeric fields byte-faithful through the decode→re-marshal
	// round trip: plain float64 decoding silently corrupts integers above 2^53
	// (e.g. a 64-bit seed) on the way to the upstream.
	dec.UseNumber()
	if err := dec.Decode(&body); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid JSON body", "bad_request")
		return
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		httpx.Error(w, http.StatusBadRequest, "request body must contain exactly one JSON document", "bad_request")
		return
	}
	model, _ := body["model"].(string)
	if model == "" {
		httpx.Error(w, http.StatusBadRequest, "missing model", "bad_request")
		return
	}
	if err := h.validatePolicy(model, body); err != nil {
		writePolicyError(w, err)
		return
	}

	up, err := h.route(model)
	if err != nil {
		h.log.Error("llm route", zap.String("model", model), zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "model provider not configured", "provider_unconfigured")
		return
	}

	// Reserve credits before contacting the upstream. Spend caps are enforced
	// inside the reservation transaction.
	inputEst := estimateInputTokens(body)
	estimate := h.prices.LLMEstimate(model, inputEst, effectiveMaxOutput(body, path, h.defaultMaxOutput))
	requestID := httpx.IdempotencyKeyUUID(r, u.ID.String(), raw)
	charge, err := h.gate.Reserve(r.Context(), "llm_call", estimate, requestID, h.spendLimits)
	if err != nil {
		switch {
		case errors.Is(err, quota.ErrInsufficientCredits):
			httpx.Error(w, http.StatusPaymentRequired, "insufficient_credits", "insufficient_credits")
		case errors.Is(err, quota.ErrSubscriptionNotActive):
			httpx.Error(w, http.StatusPaymentRequired, "subscription not active", "subscription_not_active")
		case errors.Is(err, quota.ErrDailyLimitExceeded), errors.Is(err, quota.ErrMonthlyLimitExceeded), errors.Is(err, quota.ErrNoUser):
			writeQuotaError(w, err)
		default:
			h.log.Error("quota reserve", zap.Error(err))
			httpx.Error(w, http.StatusInternalServerError, "could not reserve credits", "internal_error")
		}
		return
	}
	if charge.Finalized() {
		// This Idempotency-Key (+ body) already completed and settled. Re-calling
		// the vendor would serve a fresh, vendor-billed completion whose accounting
		// writes all no-op against the existing terminal ledger rows — i.e. free
		// inference on replay.
		httpx.Error(w, http.StatusConflict, "a request with this Idempotency-Key was already completed", "request_already_completed")
		return
	}
	if charge.InProgress() {
		// A concurrent request with the same Idempotency-Key is already calling the
		// upstream; don't double-call the vendor (it bills per call). The client
		// may retry once the in-flight request finishes.
		httpx.Error(w, http.StatusConflict, "a request with this Idempotency-Key is already in progress", "request_in_progress")
		return
	}

	// Rewrite the outbound body: upstream model id + ask for streamed usage.
	streaming := isStream(body)
	body["model"] = up.model
	if streaming {
		body["stream_options"] = map[string]any{"include_usage": true}
	}
	// Bound the completion the vendor has to price. See defaultMaxOutputTokens:
	// an uncapped request is charged against the model's whole output window at
	// reservation time, which turns a healthy balance into a 402 on every call.
	//
	// This is the same ceiling effectiveMaxOutput reserved against above, and the
	// two must stay in step: a hold smaller than what the vendor may bill is the
	// gap Settle silently spends through.
	if isCompletionPath(path) && requestedMaxOutput(body) == 0 {
		body["max_tokens"] = h.defaultMaxOutput
	}
	outBody, _ := json.Marshal(body)

	upReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, up.baseURL+path, bytes.NewReader(outBody))
	if err != nil {
		h.refund(r.Context(), charge)
		httpx.Error(w, http.StatusInternalServerError, "could not build upstream request", "internal_error")
		return
	}
	upReq.Header.Set("Content-Type", "application/json")
	upReq.Header.Set("Authorization", "Bearer "+up.apiKey)
	upReq.Header.Set("Idempotency-Key", r.Header.Get("Idempotency-Key"))
	if up.provider == "openrouter" {
		upReq.Header.Set("HTTP-Referer", "https://app.solomon-ai.co")
		upReq.Header.Set("X-Title", "Solomon AI")
	}

	resp, err := h.http.Do(upReq)
	if err != nil {
		h.refund(r.Context(), charge)
		h.log.Warn("llm upstream error", zap.String("provider", up.provider), zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "upstream request failed", "upstream_error")
		return
	}
	defer func() { _ = resp.Body.Close() }()

	// Upstream error: refund, but never expose a provider response body. Vendor
	// errors can contain account, project, request, or policy details that do not
	// belong in our public API contract.
	if resp.StatusCode >= http.StatusBadRequest {
		h.refund(r.Context(), charge)
		// Log the status, provider and model — never the body. Without this the
		// server recorded nothing about why an upstream rejected a request, so a
		// dead key, a missing model and an unfunded account were indistinguishable
		// from the outside: all three surfaced as a bare "upstream_error". Status
		// alone is enough to tell them apart and carries none of the account or
		// policy detail the body would.
		h.log.Warn("llm upstream rejected",
			zap.String("provider", up.provider),
			zap.String("model", up.model),
			zap.Int("upstream_status", resp.StatusCode))
		if resp.StatusCode == http.StatusTooManyRequests {
			if retryAfter := resp.Header.Get("Retry-After"); retryAfter != "" {
				w.Header().Set("Retry-After", retryAfter)
			}
			httpx.Error(w, http.StatusTooManyRequests, "upstream provider rate limited the request", "upstream_rate_limited")
			return
		}
		// 402 from the vendor means *our* provider account is out of credits —
		// an operator problem, not a customer one, and not something the caller
		// can fix or usefully retry within a request. Folding it into the generic
		// upstream_error made an unfunded OpenRouter balance indistinguishable
		// from a provider outage: clients saw "Bad Gateway", retried three times
		// each, and nothing named the cause. Give it a code that can be alerted
		// on, and log at error level because someone has to go top it up.
		if resp.StatusCode == http.StatusPaymentRequired {
			h.log.Error("llm upstream out of credits",
				zap.String("provider", up.provider),
				zap.String("model", up.model))
			w.Header().Set("Retry-After", "60")
			httpx.Error(w, http.StatusServiceUnavailable, "upstream provider account is out of credits", "upstream_credits_exhausted")
			return
		}
		httpx.Error(w, http.StatusBadGateway, "upstream provider rejected the request", "upstream_error")
		return
	}

	var inTok, cachedTok, outTok int
	var relayErr error
	streamed := streaming && isEventStream(resp)
	if streamed {
		inTok, cachedTok, outTok, relayErr = h.streamThrough(w, resp)
	} else {
		inTok, cachedTok, outTok, relayErr = h.bufferThrough(w, resp)
	}
	if inTok == 0 {
		inTok = inputEst
	}
	if relayErr != nil {
		if streamed {
			// The upstream died mid-stream, but a 200 plus real, vendor-billed
			// content already went out to the client. Settle for what was relayed
			// instead of refunding: a full refund here would let anyone who can
			// induce a mid-stream failure (e.g. by requesting a completion large
			// enough to trip the response cap) collect free inference.
			h.finalize(r.Context(), charge, u, requestID, model, inTok, cachedTok, outTok, telemetryFrom(r))
		} else {
			// Buffered path: nothing but an error envelope was written; refund.
			h.refund(r.Context(), charge)
		}
		return
	}

	// Settle + record on a detached context so accounting completes even if the
	// client disconnected mid-stream.
	h.finalize(r.Context(), charge, u, requestID, model, inTok, cachedTok, outTok, telemetryFrom(r))
}

// finalize settles the reservation against the actual cost and records usage.
func (h *Handler) finalize(reqCtx context.Context, charge *quota.Charge, u *ent.User, requestID uuid.UUID, model string, inTok, cachedTok, outTok int, tel telemetry) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(reqCtx), 10*time.Second)
	defer cancel()

	cost := h.prices.LLMCostCached(model, inTok, cachedTok, outTok)
	if err := charge.Settle(ctx, cost); err != nil {
		h.log.Error("quota settle", zap.Error(err), zap.String("request_id", requestID.String()))
	}

	create := h.client.LLMUsage.Create().
		SetUser(u).
		SetModel(model).
		SetInputTokens(inTok).
		SetOutputTokens(outTok).
		SetCostUnits(cost).
		SetRequestID(requestID)
	if tel.useCase != "" {
		create = create.SetUseCase(tel.useCase)
	}
	if tel.subUseCase != "" {
		create = create.SetSubUseCase(tel.subUseCase)
	}
	if tel.agentName != "" {
		create = create.SetAgentName(tel.agentName)
	}
	if err := create.Exec(ctx); err != nil {
		// request_id is unique on llm_usage: an idempotent retry collides here,
		// which means the call was already recorded — not an error.
		if !ent.IsConstraintError(err) {
			h.log.Error("record llm usage", zap.Error(err), zap.String("request_id", requestID.String()))
		}
	}
}

func (h *Handler) refund(reqCtx context.Context, charge *quota.Charge) {
	// Preserve the authenticated tenant identity for write-side Ent hooks while
	// detaching cancellation so accounting still completes after disconnects.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(reqCtx), 5*time.Second)
	defer cancel()
	if err := charge.Refund(ctx); err != nil {
		h.log.Error("quota refund", zap.Error(err))
	}
}

func (h *Handler) validatePolicy(model string, body map[string]any) error {
	if len(h.allowedModels) > 0 {
		if _, ok := h.allowedModels[model]; !ok {
			return errModelNotAllowed
		}
	}
	if h.maxMessages > 0 {
		if messages, ok := body["messages"].([]any); ok && len(messages) > h.maxMessages {
			return errTooManyMessages
		}
	}
	if h.maxPromptBytes > 0 && payloadBytes(body, "messages", "prompt", "input") > h.maxPromptBytes {
		return errPromptTooLarge
	}
	if h.maxToolBytes > 0 && payloadBytes(body, "tools", "functions") > h.maxToolBytes {
		return errToolsTooLarge
	}
	return nil
}

var (
	errModelNotAllowed = errors.New("model_not_allowed")
	errTooManyMessages = errors.New("too_many_messages")
	errPromptTooLarge  = errors.New("prompt_too_large")
	errToolsTooLarge   = errors.New("tools_payload_too_large")
)

func payloadBytes(body map[string]any, keys ...string) int {
	total := 0
	for _, key := range keys {
		if v, ok := body[key]; ok {
			b, err := json.Marshal(v)
			if err == nil {
				total += len(b)
			}
		}
	}
	return total
}

func writePolicyError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errModelNotAllowed):
		httpx.Error(w, http.StatusBadRequest, "model is not allowed", "model_not_allowed")
	case errors.Is(err, errTooManyMessages):
		httpx.Error(w, http.StatusBadRequest, "too many messages", "too_many_messages")
	case errors.Is(err, errPromptTooLarge):
		httpx.Error(w, http.StatusRequestEntityTooLarge, "prompt payload is too large", "prompt_too_large")
	case errors.Is(err, errToolsTooLarge):
		httpx.Error(w, http.StatusRequestEntityTooLarge, "tool payload is too large", "tools_payload_too_large")
	default:
		httpx.Error(w, http.StatusBadRequest, "request violates LLM policy", "bad_request")
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

func contentTypeOr(resp *http.Response, def string) string {
	if ct := resp.Header.Get("Content-Type"); ct != "" {
		return ct
	}
	return def
}

func isEventStream(resp *http.Response) bool {
	return bytes.Contains([]byte(resp.Header.Get("Content-Type")), []byte("event-stream"))
}
