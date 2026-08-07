package connectors

import "testing"

// planRank denies by default: a plan missing from the map resolves to 0, the
// same rank as free. That is the right failure direction for an unknown string
// and the wrong one for a plan we sell — `intelligence` was absent, so its
// subscribers were told to upgrade to a cheaper tier.
func TestPlanRankCoversEverySellablePlan(t *testing.T) {
	// Mirrors the Subscription schema's plan validator.
	for _, plan := range []string{"free", "starter", "pro", "intelligence"} {
		if _, ok := planRank[plan]; !ok {
			t.Fatalf("plan %q is sellable but missing from planRank; it would rank as free", plan)
		}
	}
	if planRank["intelligence"] <= planRank["pro"] {
		t.Fatalf("intelligence (%d) must outrank pro (%d): it is a superset",
			planRank["intelligence"], planRank["pro"])
	}
	if planRank["pro"] <= planRank["starter"] || planRank["starter"] <= planRank["free"] {
		t.Fatal("plan ranks must increase with price")
	}
}
