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
