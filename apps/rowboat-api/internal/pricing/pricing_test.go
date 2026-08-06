package pricing_test

import (
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
