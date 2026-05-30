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
}

// DefaultTable returns the built-in catalog. Model keys match the provider/slug
// form the desktop sends (e.g. "anthropic/claude-sonnet-4-5").
func DefaultTable() *Table {
	return &Table{
		Models: map[string]ModelRate{
			"anthropic/claude-sonnet-4-5": {InputPer1K: 30, OutputPer1K: 150},
			"anthropic/claude-opus-4-1":   {InputPer1K: 150, OutputPer1K: 750},
			"anthropic/claude-haiku-4-5":  {InputPer1K: 8, OutputPer1K: 40},
			"openai/gpt-4.1":              {InputPer1K: 20, OutputPer1K: 80},
			"openai/gpt-4.1-mini":         {InputPer1K: 4, OutputPer1K: 16},
			"openai/o4-mini":              {InputPer1K: 11, OutputPer1K: 44},
			"google/gemini-2.5-pro":       {InputPer1K: 13, OutputPer1K: 100},
			"google/gemini-2.5-flash":     {InputPer1K: 3, OutputPer1K: 25},
		},
		DefaultModel: ModelRate{InputPer1K: 30, OutputPer1K: 150},
		VoicePerChar: 1,  // ≈ $0.0001/char
		ExaPerQuery:  50, // ≈ $0.005/search
	}
}

// LoadJSON overlays a JSON document onto a copy of the default table. Unset
// fields keep their defaults.
func LoadJSON(data []byte) (*Table, error) {
	t := DefaultTable()
	if len(data) == 0 {
		return t, nil
	}
	if err := json.Unmarshal(data, t); err != nil {
		return nil, err
	}
	return t, nil
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

// LLMCost is the actual cost for a completed call.
func (t *Table) LLMCost(model string, inputTokens, outputTokens int) int {
	r := t.rate(model)
	cost := ceilDiv(inputTokens*r.InputPer1K, 1000) + ceilDiv(outputTokens*r.OutputPer1K, 1000)
	if cost < 0 {
		return 0
	}
	return cost
}

// LLMEstimate is the pre-call reservation: input tokens plus the expected
// output (max_tokens, or a conservative default when unspecified).
func (t *Table) LLMEstimate(model string, inputTokens, maxOutputTokens int) int {
	if maxOutputTokens <= 0 {
		maxOutputTokens = 1024 // conservative default reservation
	}
	return t.LLMCost(model, inputTokens, maxOutputTokens)
}

// VoiceCost charges per character: ceil(chars * VoicePerChar).
func (t *Table) VoiceCost(chars int) int {
	if chars < 0 {
		return 0
	}
	return chars * t.VoicePerChar
}

// ExaCost is the flat per-query charge.
func (t *Table) ExaCost() int { return t.ExaPerQuery }

func ceilDiv(n, d int) int {
	if d == 0 {
		return 0
	}
	return int(math.Ceil(float64(n) / float64(d)))
}
