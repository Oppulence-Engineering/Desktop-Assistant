// Package llm is the OpenRouter/OpenAI-compatible LLM gateway: it gates on
// credits, forwards to an OpenAI-compatible upstream (OpenAI direct or
// OpenRouter), streams responses back, settles the credit reservation against
// actual token usage, and records an LLMUsage row per call.
package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/pricing"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/quota"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/secrets"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const maxRequestBody = 24 << 20 // 24 MiB (large contexts + tool defs)

// Handler serves the /v1/llm/* gateway.
type Handler struct {
	prices  *pricing.Table
	gate    *quota.Gate
	secrets *secrets.Store
	client  *ent.Client
	http    *http.Client
	log     *zap.Logger

	openAIBaseURL     string
	openRouterBaseURL string
}

// New builds the LLM gateway handler.
func New(prices *pricing.Table, gate *quota.Gate, sec *secrets.Store, client *ent.Client, log *zap.Logger) *Handler {
	return &Handler{
		prices:            prices,
		gate:              gate,
		secrets:           sec,
		client:            client,
		http:              &http.Client{Timeout: 0}, // no overall timeout: streams; cancelled via request context
		log:               log,
		openAIBaseURL:     openAIBase,
		openRouterBaseURL: openRouterBase,
	}
}

// SetUpstreams overrides the upstream base URLs (used in tests and for
// self-hosted gateway deployments).
func (h *Handler) SetUpstreams(openAI, openRouter string) {
	if openAI != "" {
		h.openAIBaseURL = openAI
	}
	if openRouter != "" {
		h.openRouterBaseURL = openRouter
	}
}

type usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

type telemetry struct {
	useCase    string
	subUseCase string
	agentName  string
}

func telemetryFrom(r *http.Request) telemetry {
	return telemetry{
		useCase:    r.Header.Get("x-rowboat-use-case"),
		subUseCase: r.Header.Get("x-rowboat-sub-use-case"),
		agentName:  r.Header.Get("x-rowboat-agent-name"),
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

	raw, err := io.ReadAll(io.LimitReader(r.Body, maxRequestBody))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "could not read request body", "bad_request")
		return
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid JSON body", "bad_request")
		return
	}
	model, _ := body["model"].(string)
	if model == "" {
		httpx.Error(w, http.StatusBadRequest, "missing model", "bad_request")
		return
	}

	up, err := h.route(model)
	if err != nil {
		h.log.Error("llm route", zap.String("model", model), zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "model provider not configured", "provider_unconfigured")
		return
	}

	// Reserve credits before contacting the upstream.
	inputEst := estimateInputTokens(body)
	estimate := h.prices.LLMEstimate(model, inputEst, requestedMaxOutput(body))
	requestID := uuid.New()
	charge, err := h.gate.Reserve(r.Context(), "llm_call", estimate, requestID)
	if err != nil {
		if errors.Is(err, quota.ErrInsufficientCredits) {
			httpx.Error(w, http.StatusPaymentRequired, "insufficient_credits", "insufficient_credits")
			return
		}
		h.log.Error("quota reserve", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not reserve credits", "internal_error")
		return
	}

	// Rewrite the outbound body: upstream model id + ask for streamed usage.
	streaming := isStream(body)
	body["model"] = up.model
	if streaming {
		body["stream_options"] = map[string]any{"include_usage": true}
	}
	outBody, _ := json.Marshal(body)

	upReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, up.baseURL+path, bytes.NewReader(outBody))
	if err != nil {
		h.refund(charge)
		httpx.Error(w, http.StatusInternalServerError, "could not build upstream request", "internal_error")
		return
	}
	upReq.Header.Set("Content-Type", "application/json")
	upReq.Header.Set("Authorization", "Bearer "+up.apiKey)
	if up.provider == "openrouter" {
		upReq.Header.Set("HTTP-Referer", "https://app.solomon-ai.co")
		upReq.Header.Set("X-Title", "Rowboat")
	}

	resp, err := h.http.Do(upReq)
	if err != nil {
		h.refund(charge)
		h.log.Warn("llm upstream error", zap.String("provider", up.provider), zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "upstream request failed", "upstream_error")
		return
	}
	defer func() { _ = resp.Body.Close() }()

	// Upstream error: refund and forward the upstream status + body verbatim.
	if resp.StatusCode >= http.StatusBadRequest {
		h.refund(charge)
		w.Header().Set("Content-Type", contentTypeOr(resp, "application/json"))
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
		return
	}

	var inTok, outTok int
	if streaming && isEventStream(resp) {
		inTok, outTok = h.streamThrough(w, resp)
	} else {
		inTok, outTok = h.bufferThrough(w, resp)
	}
	if inTok == 0 {
		inTok = inputEst
	}

	// Settle + record on a detached context so accounting completes even if the
	// client disconnected mid-stream.
	h.finalize(r.Context(), charge, u, requestID, model, inTok, outTok, telemetryFrom(r))
}

// finalize settles the reservation against the actual cost and records usage.
func (h *Handler) finalize(reqCtx context.Context, charge *quota.Charge, u *ent.User, requestID uuid.UUID, model string, inTok, outTok int, tel telemetry) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(reqCtx), 10*time.Second)
	defer cancel()

	cost := h.prices.LLMCost(model, inTok, outTok)
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
		h.log.Error("record llm usage", zap.Error(err), zap.String("request_id", requestID.String()))
	}
}

func (h *Handler) refund(charge *quota.Charge) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := charge.Refund(ctx); err != nil {
		h.log.Error("quota refund", zap.Error(err))
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
