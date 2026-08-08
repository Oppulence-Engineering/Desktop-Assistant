// Package pricing maps usage to credits.
//
// Credit model: 1 credit = $0.0001 (so $1 = 10,000 credits, and the 10,000-
// credit free tier ≈ $1 of usage). Per-model rates are credits per 1,000
// tokens, derived from public list prices. These are defaults and a placeholder
// for product pricing (see the plan's Open Questions §2); override at boot via
// PRICING_JSON. All charges are integer credits.
package pricing

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

// ModelRate is credits per 1,000 tokens for input and output.
type ModelRate struct {
	InputPer1K  int `json:"inputPer1k"`
	OutputPer1K int `json:"outputPer1k"`
}

// Table is the full pricing catalog.
type Table struct {
	Models       map[string]ModelRate `json:"models"`
	DefaultModel ModelRate            `json:"defaultModel"`
	VoicePerChar int                  `json:"voicePerChar"` // credits per character
	ExaPerQuery  int                  `json:"exaPerQuery"`  // flat credits per search
	// ResearchTasks is credits per Parallel Task run, keyed by processor
	// (RFC 039). Published 2026-08 list prices: lite $5/1k, base $10/1k,
	// core $25/1k — so 50, 100 and 250 credits at $0.0001 each.
	ResearchTasks map[string]int `json:"researchTasks"`
}

// DefaultTable returns the built-in catalog. Model keys match the provider/slug
// form the desktop sends (e.g. "anthropic/claude-sonnet-4-5").
func DefaultTable() *Table {
	return &Table{
		Models: map[string]ModelRate{
			"anthropic/claude-sonnet-4-5": {InputPer1K: 30, OutputPer1K: 150},
			"anthropic/claude-opus-4-1":   {InputPer1K: 150, OutputPer1K: 750},
			// List is $1/$5 per 1M = 10/50 credits per 1K. This was 8/40, i.e.
			// 80% of list: every signed-in call lost money before the upstream
			// fee, and haiku is the desktop's default for knowledge-graph work
			// (label_emails), which is the highest-volume workload we run.
			// TestNoModelPricedBelowVendorList keeps this from recurring.
			"anthropic/claude-haiku-4-5": {InputPer1K: 10, OutputPer1K: 50},
			"openai/gpt-4.1":             {InputPer1K: 20, OutputPer1K: 80},
			"openai/gpt-4.1-mini":        {InputPer1K: 4, OutputPer1K: 16},
			"openai/o4-mini":             {InputPer1K: 11, OutputPer1K: 44},
			"google/gemini-2.5-pro":      {InputPer1K: 13, OutputPer1K: 100},
			"google/gemini-2.5-flash":    {InputPer1K: 3, OutputPer1K: 25},
			// Embeddings for the desktop's semantic memory index (RFC 021).
			// Priced here because it must be: LLM_ALLOWED_MODELS and this table
			// have to agree on the same string, and rate() falls back to
			// DefaultModel — 30/150 per 1K — for anything it doesn't recognise.
			// Allowing the id without a rate would bill embeddings at the sonnet
			// rate, ~1500x their real cost.
			//
			// 1 credit/1K is the floor a whole-number rate allows. List price is
			// $0.02/1M tokens = 0.2 credits/1K, so this rounds up to a 5x margin
			// on a line item that is fractions of a cent per index pass. No
			// output rate: an embeddings response has no completion tokens.
			"openai/text-embedding-3-small": {InputPer1K: 1, OutputPer1K: 0},
		},
		DefaultModel: ModelRate{InputPer1K: 30, OutputPer1K: 150},
		VoicePerChar: 1,  // ≈ $0.0001/char
		ExaPerQuery:  50, // ≈ $0.005/search
		ResearchTasks: map[string]int{
			"lite": 50,
			"base": 100,
			"core": 250,
		},
	}
}

// maxRate bounds any operator-supplied per-unit rate. The cost math multiplies
// rates by token/char counts clamped to maxBillableTokens (1e8); maxRate keeps
// that product far inside int64, so a fat-fingered PRICING_JSON rate can never
// overflow the multiplication, wrap negative, and be clamped to a FREE call.
// 1e9 credits/1K tokens ≈ $100/token — far beyond any plausible price.
const maxRate = 1_000_000_000

// LoadJSON overlays a JSON document onto a copy of the default table. Unset
// fields keep their defaults. Rates are validated: negative or absurdly large
// values are rejected at boot rather than silently corrupting the cost math.
func LoadJSON(data []byte) (*Table, error) {
	t := DefaultTable()
	if len(data) == 0 {
		return t, nil
	}
	if err := json.Unmarshal(data, t); err != nil {
		return nil, err
	}
	if err := t.validate(); err != nil {
		return nil, err
	}
	return t, nil
}

func (t *Table) validate() error {
	checkRate := func(name string, v int) error {
		if v < 0 {
			return fmt.Errorf("pricing: %s must be >= 0 (got %d)", name, v)
		}
		if v > maxRate {
			return fmt.Errorf("pricing: %s exceeds the maximum allowed rate %d (got %d)", name, maxRate, v)
		}
		return nil
	}
	for model, r := range t.Models {
		if err := checkRate("models."+model+".inputPer1k", r.InputPer1K); err != nil {
			return err
		}
		if err := checkRate("models."+model+".outputPer1k", r.OutputPer1K); err != nil {
			return err
		}
	}
	if err := checkRate("defaultModel.inputPer1k", t.DefaultModel.InputPer1K); err != nil {
		return err
	}
	if err := checkRate("defaultModel.outputPer1k", t.DefaultModel.OutputPer1K); err != nil {
		return err
	}
	if err := checkRate("voicePerChar", t.VoicePerChar); err != nil {
		return err
	}
	for processor, credits := range t.ResearchTasks {
		if err := checkRate("researchTasks."+processor, credits); err != nil {
			return err
		}
	}
	return checkRate("exaPerQuery", t.ExaPerQuery)
}

// rate returns the rate for a model, falling back to the default. Lookup is
// exact, then case-insensitive.
func (t *Table) rate(model string) ModelRate {
	if r, ok := t.Models[model]; ok {
		return r
	}
	lower := strings.ToLower(model)
	for k, r := range t.Models {
		if strings.ToLower(k) == lower {
			return r
		}
	}
	return t.DefaultModel
}

// maxBillableTokens bounds the token counts fed into the cost math. It is far
// above any real model context window, and keeps inputTokens*rate well inside
// int64 so a hostile max_tokens (e.g. 1e17) can't overflow the multiplication
// and wrap to a tiny/negative cost — which would silently defeat the pre-call
// reservation gate. A clamped absurd request instead produces a huge cost that
// the balance check correctly rejects.
const maxBillableTokens = 100_000_000 // 100M tokens

// LLMCost is the actual cost for a completed call.
func (t *Table) LLMCost(model string, inputTokens, outputTokens int) int {
	return t.LLMCostCached(model, inputTokens, 0, outputTokens)
}

// cachedInputRateNum/Den is what a prompt-cache READ costs relative to fresh
// input. Anthropic bills cache reads at 1/10 of the base input rate, and
// OpenRouter passes that through, so a cached token must not be charged as if
// it were fresh: an agent loop that re-sends a large stable prefix every step
// is exactly the shape caching exists for, and billing it at full rate would
// make the customer's credits fall as though nothing had been cached.
//
// Cache WRITES cost more than fresh input (1.25x at Anthropic). They are not
// modelled separately: the vendor reports them inside prompt_tokens, so they
// are already billed at the full input rate here, which under-charges the
// write by 25% and over-charges nothing. Erring toward the customer on the
// smaller half of the ledger is the right direction for a rate we cannot see.
const (
	cachedInputRateNum = 1
	cachedInputRateDen = 10
)

// LLMCostCached prices a call whose prompt was partly served from the vendor's
// prompt cache. cachedTokens is the subset of inputTokens that was a cache read
// (OpenAI-compatible `usage.prompt_tokens_details.cached_tokens`); zero means
// no caching, which is the plain LLMCost case.
func (t *Table) LLMCostCached(model string, inputTokens, cachedTokens, outputTokens int) int {
	r := t.rate(model)
	inputTokens = clampTokens(inputTokens)
	outputTokens = clampTokens(outputTokens)
	cachedTokens = clampTokens(cachedTokens)
	// A vendor reporting more cached than total prompt tokens would otherwise
	// drive `fresh` negative and refund the call.
	if cachedTokens > inputTokens {
		cachedTokens = inputTokens
	}
	fresh := inputTokens - cachedTokens

	cost := ceilDiv(fresh*r.InputPer1K, 1000) +
		ceilDiv(cachedTokens*r.InputPer1K*cachedInputRateNum, 1000*cachedInputRateDen) +
		ceilDiv(outputTokens*r.OutputPer1K, 1000)
	if cost < 0 {
		return 0
	}
	return cost
}

func clampTokens(n int) int {
	if n < 0 {
		return 0
	}
	if n > maxBillableTokens {
		return maxBillableTokens
	}
	return n
}

// LLMEstimate is the pre-call reservation: input tokens plus the expected
// output (max_tokens, or a conservative default when unspecified).
func (t *Table) LLMEstimate(model string, inputTokens, maxOutputTokens int) int {
	if maxOutputTokens <= 0 {
		maxOutputTokens = 1024 // conservative default reservation
	}
	return t.LLMCost(model, inputTokens, maxOutputTokens)
}

// VoiceCost charges per character: chars * VoicePerChar. chars is clamped to
// the same ceiling as tokens so the multiplication stays inside int64 even
// against a hostile/buggy caller (the voice handler also caps bodies at 1 MiB).
func (t *Table) VoiceCost(chars int) int {
	if chars < 0 {
		return 0
	}
	if chars > maxBillableTokens {
		chars = maxBillableTokens
	}
	return chars * t.VoicePerChar
}

// ExaCost is the flat per-query charge.
func (t *Table) ExaCost() int { return t.ExaPerQuery }

// ResearchCosts returns the per-processor research charges. Callers hold the
// map, so it is copied: an operator override loaded once at boot must not be
// mutable by a consumer.
func (t *Table) ResearchCosts() map[string]int {
	out := make(map[string]int, len(t.ResearchTasks))
	for processor, credits := range t.ResearchTasks {
		out[processor] = credits
	}
	return out
}

func ceilDiv(n, d int) int {
	if d == 0 {
		return 0
	}
	return int(math.Ceil(float64(n) / float64(d)))
}
