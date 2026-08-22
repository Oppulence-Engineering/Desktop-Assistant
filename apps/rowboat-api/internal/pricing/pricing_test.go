package pricing_test

import (
	"os"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/pricing"
)

func TestLLMCostKnownModel(t *testing.T) {
	tbl := pricing.DefaultTable()
	// sonnet: 30/1k in, 150/1k out. 2000 in, 1000 out → 60 + 150 = 210.
	if got := tbl.LLMCost("anthropic/claude-sonnet-4-5", 2000, 1000); got != 210 {
		t.Fatalf("cost = %d, want 210", got)
	}
}

func TestLLMCostCeilsPartialThousands(t *testing.T) {
	tbl := pricing.DefaultTable()
	// 1500 in @30/1k = ceil(45000/1000)=45; 500 out @150/1k = ceil(75000/1000)=75 → 120.
	if got := tbl.LLMCost("anthropic/claude-sonnet-4-5", 1500, 500); got != 120 {
		t.Fatalf("cost = %d, want 120", got)
	}
}

func TestLLMCostUnknownModelUsesDefault(t *testing.T) {
	tbl := pricing.DefaultTable()
	if got := tbl.LLMCost("mystery/model", 1000, 1000); got != 180 { // default 30+150
		t.Fatalf("cost = %d, want 180", got)
	}
}

func TestLLMEstimateDefaultsOutput(t *testing.T) {
	tbl := pricing.DefaultTable()
	// maxOut<=0 → reserve assumes 1024 out. sonnet: 1000 in → 30; 1024 out → ceil(153600/1000)=154 → 184.
	if got := tbl.LLMEstimate("anthropic/claude-sonnet-4-5", 1000, 0); got != 184 {
		t.Fatalf("estimate = %d, want 184", got)
	}
}

func TestVoiceAndExaCost(t *testing.T) {
	tbl := pricing.DefaultTable()
	if got := tbl.VoiceCost(250); got != 250 {
		t.Fatalf("voice = %d, want 250", got)
	}
	if got := tbl.ExaCost(); got != 50 {
		t.Fatalf("exa = %d, want 50", got)
	}
}

func TestLoadJSONOverride(t *testing.T) {
	tbl, err := pricing.LoadJSON([]byte(`{"exaPerQuery":99,"models":{"x/y":{"inputPer1k":1,"outputPer1k":2}}}`))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if tbl.ExaCost() != 99 {
		t.Fatalf("exa override = %d, want 99", tbl.ExaCost())
	}
	if got := tbl.LLMCost("x/y", 1000, 1000); got != 3 {
		t.Fatalf("override model cost = %d, want 3", got)
	}
	// Default voice rate preserved.
	if tbl.VoiceCost(10) != 10 {
		t.Fatalf("voice default not preserved: %d", tbl.VoiceCost(10))
	}
}

// An unrecognised model id bills at DefaultModel, and DefaultModel is expensive.
//
// This is what makes LLM_ALLOWED_MODELS load-bearing rather than cosmetic. The
// allowlist is checked against the raw requested string before routing, and the
// pricing table is keyed on that same string. Anything that let an unpriced id
// past the allowlist — for instance "normalising" the openrouter/ prefix so
// "openrouter/openai/gpt-4.1-mini" resolves like "openai/gpt-4.1-mini" — would
// route correctly and then charge the fallback rate.
//
// The failure mode is over-billing, not free calls, which is the quieter and
// worse of the two. See the note on route() in internal/llm/router.go.
func TestUnknownModelBillsAtTheExpensiveDefault(t *testing.T) {
	table := pricing.DefaultTable()

	const inTok, outTok = 1000, 1000
	known := table.LLMCost("openai/gpt-4.1-mini", inTok, outTok)
	unknown := table.LLMCost("openrouter/openai/gpt-4.1-mini", inTok, outTok)

	if known == 0 {
		t.Fatal("expected a real rate for a priced model; fixture drifted")
	}
	if unknown == known {
		t.Fatal("prefixed id resolved to the same rate — the pricing table now " +
			"recognises it, so the allowlist note in llm/router.go needs revisiting")
	}
	if unknown < known {
		t.Errorf("unknown-model fallback (%d) is cheaper than a priced model (%d); "+
			"the allowlist is the only thing preventing under-billing", unknown, known)
	}
}

// The desktop's signed-in defaults are temporarily on anthropic/claude-haiku-4-5
// because every openai/* model routes to a leg that is returning 502. That swap
// is not free: haiku is priced above gpt-4.1-mini in this very table, and the
// comment in apps/x/packages/core/src/models/defaults.ts quotes the multiple.
//
// This exists so the quoted number cannot drift from the table. If the rates
// move, the comment is wrong and someone should notice here rather than in a
// billing report.
func TestHaikuIsPricedAboveGPT41Mini(t *testing.T) {
	table := pricing.DefaultTable()

	const inTok, outTok = 1000, 1000
	mini := table.LLMCost("openai/gpt-4.1-mini", inTok, outTok)
	haiku := table.LLMCost("anthropic/claude-haiku-4-5", inTok, outTok)
	sonnet := table.LLMCost("anthropic/claude-sonnet-4-5", inTok, outTok)

	if haiku <= mini {
		t.Errorf("haiku (%d) is no longer more expensive than gpt-4.1-mini (%d); "+
			"the cost note in defaults.ts needs updating", haiku, mini)
	}
	if haiku >= sonnet {
		t.Errorf("haiku (%d) is no longer clearly below sonnet (%d); it was chosen "+
			"as the cheapest working model", haiku, sonnet)
	}
}

// Every model the production gateway allows must be priced here.
//
// LLM_ALLOWED_MODELS and this table are two lists that have to agree on the
// same strings, kept in different files by different people. They drifted in
// both directions at once: text-embedding-3-small was priced nowhere and
// allowed nowhere, so the desktop's memory index got a 400 model_not_allowed
// on every pass — and had someone fixed only the allowlist, rate() would have
// silently billed embeddings at DefaultModel's 30/150 per 1K, roughly 1500x
// their real cost.
//
// Reads the chart rather than restating the list, because a copy would drift too.
func TestProductionAllowlistIsFullyPriced(t *testing.T) {
	const chart = "../../../../charts/rowboat-api/values-production.yaml"
	raw, err := os.ReadFile(chart)
	if err != nil {
		t.Fatalf("read %s: %v", chart, err)
	}

	var models []string
	for _, line := range strings.Split(string(raw), "\n") {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "LLM_ALLOWED_MODELS:") {
			continue
		}
		value := strings.TrimSpace(strings.TrimPrefix(trimmed, "LLM_ALLOWED_MODELS:"))
		value = strings.Trim(value, `"'`)
		for _, m := range strings.Split(value, ",") {
			if m = strings.TrimSpace(m); m != "" {
				models = append(models, m)
			}
		}
	}
	if len(models) == 0 {
		t.Fatalf("no LLM_ALLOWED_MODELS found in %s; the key moved and this test is now vacuous", chart)
	}

	table := pricing.DefaultTable()
	for _, model := range models {
		if _, ok := table.Models[model]; !ok {
			t.Errorf("%q is allowed in production but absent from the pricing table, "+
				"so it bills at the DefaultModel fallback rate", model)
		}
	}
}

// vendorListCredits is public list price expressed in this table's unit
// (credits per 1,000 tokens, 1 credit = $0.0001). A rate below its entry means
// we pay the vendor more than we charge the customer, so every call at that
// model loses money and volume makes it worse — the failure mode a usage
// report shows only after the month closes.
//
// Sourced from the providers' published per-1M prices:
//
//	sonnet-4-5   $3/$15     opus-4-1  $15/$75    haiku-4-5 $1/$5
//	gpt-4.1      $2/$8      4.1-mini  $0.40/$1.60  o4-mini $1.10/$4.40
//	gemini-2.5-pro $1.25/$10           2.5-flash $0.30/$2.50
//	gemini-3.1-flash-lite $0.25/$1.50
//
// Update alongside the table when a vendor changes list price.
var vendorListCredits = map[string]pricing.ModelRate{
	"anthropic/claude-sonnet-4-5":  {InputPer1K: 30, OutputPer1K: 150},
	"anthropic/claude-opus-4-1":    {InputPer1K: 150, OutputPer1K: 750},
	"anthropic/claude-haiku-4-5":   {InputPer1K: 10, OutputPer1K: 50},
	"google/gemini-3.1-flash-lite": {InputPer1K: 3, OutputPer1K: 15},
	"openai/gpt-4.1":               {InputPer1K: 20, OutputPer1K: 80},
	"openai/gpt-4.1-mini":          {InputPer1K: 4, OutputPer1K: 16},
	"openai/o4-mini":               {InputPer1K: 11, OutputPer1K: 44},
	"google/gemini-2.5-flash":      {InputPer1K: 3, OutputPer1K: 25},
}

// The margin policy itself is a product decision and stays where it is — this
// only asserts the floor. Selling at list is a choice; selling below it is a
// bug, and it shipped: haiku sat at 8/40 against a 10/50 list.
func TestNoModelPricedBelowVendorList(t *testing.T) {
	table := pricing.DefaultTable()

	for model, list := range vendorListCredits {
		rate, ok := table.Models[model]
		if !ok {
			// Removing a model from the catalog is fine; it just cannot be
			// silently under-priced while still routable.
			continue
		}
		if rate.InputPer1K < list.InputPer1K {
			t.Errorf("%s input %d credits/1K is below vendor list %d: every call loses money",
				model, rate.InputPer1K, list.InputPer1K)
		}
		if rate.OutputPer1K < list.OutputPer1K {
			t.Errorf("%s output %d credits/1K is below vendor list %d: every call loses money",
				model, rate.OutputPer1K, list.OutputPer1K)
		}
	}
}

// An agent loop re-sends a large stable prefix on every step. That is what
// prompt caching is for, and the gateway now reads
// usage.prompt_tokens_details.cached_tokens — so a cache read must cost a
// fraction of fresh input. Billing it at the full rate would mean enabling
// caching cut our vendor bill while the customer's credits fell exactly as
// before, which is both wrong and invisible.
func TestCachedInputIsDiscounted(t *testing.T) {
	table := pricing.DefaultTable()
	const model = "anthropic/claude-haiku-4-5" // 10 credits/1K input

	// 100k prompt tokens, no output. Fresh: 100 * 10 = 1000 credits.
	fresh := table.LLMCostCached(model, 100_000, 0, 0)
	if fresh != 1000 {
		t.Fatalf("fresh input cost = %d, want 1000", fresh)
	}

	// Same call with 90% served from cache: 10k fresh (100) + 90k cached at
	// one tenth (90) = 190.
	cached := table.LLMCostCached(model, 100_000, 90_000, 0)
	if cached != 190 {
		t.Errorf("90%% cached cost = %d, want 190", cached)
	}
	if cached >= fresh {
		t.Errorf("caching did not reduce cost: cached %d vs fresh %d", cached, fresh)
	}

	// Zero cached tokens must be identical to the uncached path, so providers
	// without prompt caching are unaffected.
	if got, want := table.LLMCostCached(model, 12_345, 0, 678), table.LLMCost(model, 12_345, 678); got != want {
		t.Errorf("zero-cached path diverged: %d vs %d", got, want)
	}
}

// A provider reporting more cached tokens than total prompt tokens must not
// drive the fresh count negative and refund the call.
func TestCachedTokensCannotExceedPrompt(t *testing.T) {
	table := pricing.DefaultTable()
	const model = "anthropic/claude-haiku-4-5"

	got := table.LLMCostCached(model, 1_000, 999_999, 0)
	want := table.LLMCostCached(model, 1_000, 1_000, 0)
	if got != want {
		t.Errorf("over-reported cache = %d, want it clamped to %d", got, want)
	}
	if got <= 0 {
		t.Errorf("cost collapsed to %d; a bogus cache count must not make calls free", got)
	}
}
