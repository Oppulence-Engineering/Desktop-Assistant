package revenue

import (
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipattentionitem"
)

func triggerVendor(event string, cited bool) *vendorStub {
	basis := map[string]any{"field": triggerEventField, "confidence": "high", "reasoning": "press release"}
	if cited {
		basis["citations"] = []map[string]any{{
			"title": "Acme raises Series B",
			"url":   "https://techpress.example/acme-series-b",
		}}
	}
	return &vendorStub{
		content: map[string]any{triggerEventField: event, triggerDateField: "2026-08-04"},
		basis:   []map[string]any{basis},
	}
}

// account returns the relationship the seeded person actually participates in.
// A bare CreateRelationship has no participants, and a trigger on an account
// where the user knows nobody is not the case worth testing.
func (rf *researchFixture) account(t *testing.T) *ent.Relationship {
	t.Helper()
	participants, err := rf.person.QueryParticipants().WithRelationship().All(rf.ctx)
	if err != nil {
		t.Fatalf("query participants: %v", err)
	}
	if len(participants) != 1 || participants[0].Edges.Relationship == nil {
		t.Fatalf("expected the seeded person to be on exactly one account, got %d", len(participants))
	}
	return participants[0].Edges.Relationship
}

func attentionItems(t *testing.T, f *fixture, reason string) []*ent.RelationshipAttentionItem {
	t.Helper()
	rows, err := f.client.RelationshipAttentionItem.Query().
		Where(relationshipattentionitem.ReasonCodeEQ(reason)).
		All(f.ctx)
	if err != nil {
		t.Fatalf("query attention items: %v", err)
	}
	return rows
}

func TestAccountTriggerWritesCitedMilestoneAndRaisesAttention(t *testing.T) {
	vendor := triggerVendor("Acme announced a Series B.", true)
	rf := newResearchFixture(t, vendor)
	rel := rf.account(t)

	outcome, err := rf.svc.ResearchAccountTrigger(rf.ctx, rf.user, rel.ID)
	if err != nil {
		t.Fatalf("ResearchAccountTrigger: %v", err)
	}
	if !outcome.Found || outcome.Event != "Acme announced a Series B." {
		t.Fatalf("outcome = %+v", outcome)
	}

	if err := rf.svc.RefreshRelationshipAttention(rf.ctx, rf.user); err != nil {
		t.Fatalf("refresh attention: %v", err)
	}
	items := attentionItems(t, rf.fixture, "external_trigger")
	if len(items) != 1 {
		t.Fatalf("expected 1 external_trigger item, got %d", len(items))
	}
	item := items[0]
	if item.RankScore != triggerRankScore {
		t.Fatalf("rank score = %d", item.RankScore)
	}
	// The queue item must point at the cited assertion, or "why now?" has no
	// answer the user can check.
	if len(item.EvidenceRefs) != 1 {
		t.Fatalf("evidence refs = %v", item.EvidenceRefs)
	}
	if item.ExpiresAt == nil {
		t.Fatal("a trigger with no expiry would stay a reason to write forever")
	}
	// Names the contact, so the item is a next step and not a news alert.
	if !strings.Contains(item.Explanation, "Sarah Chen") {
		t.Fatalf("explanation did not name the contact: %q", item.Explanation)
	}
	// Carries the source, so "why now?" is checkable. An evidence ref alone is
	// not enough: nothing resolves assertion refs to a URL.
	if !strings.Contains(item.Explanation, "https://techpress.example/acme-series-b") {
		t.Fatalf("explanation carried no clickable source: %q", item.Explanation)
	}
}

// An uncited event is a rumour. It must not become a milestone and must not
// reach the queue.
func TestUncitedTriggerIsDiscarded(t *testing.T) {
	vendor := triggerVendor("Acme is rumoured to be raising.", false)
	rf := newResearchFixture(t, vendor)
	rel := rf.account(t)

	outcome, err := rf.svc.ResearchAccountTrigger(rf.ctx, rf.user, rel.ID)
	if err != nil {
		t.Fatalf("ResearchAccountTrigger: %v", err)
	}
	if outcome.Found {
		t.Fatal("an uncited event was stored")
	}
	if outcome.Rejected == "" {
		t.Fatal("an uncited event was discarded without saying why")
	}
	if err := rf.svc.RefreshRelationshipAttention(rf.ctx, rf.user); err != nil {
		t.Fatalf("refresh attention: %v", err)
	}
	if items := attentionItems(t, rf.fixture, "external_trigger"); len(items) != 0 {
		t.Fatalf("an uncited event reached the queue: %+v", items)
	}
}

func TestNoEventMeansNoTrigger(t *testing.T) {
	rf := newResearchFixture(t, triggerVendor("none", true))
	rel := rf.account(t)

	outcome, err := rf.svc.ResearchAccountTrigger(rf.ctx, rf.user, rel.ID)
	if err != nil {
		t.Fatalf("ResearchAccountTrigger: %v", err)
	}
	if outcome.Found {
		t.Fatal(`"none" was stored as a milestone`)
	}
	// The vendor still ran, so the run is still paid for — at the lite rate.
	// Guarded because the tier is the difference between ~$37 and ~$187 a month
	// at the advertised 250-account limit, on a $249 plan.
	if spent := creditsSpent(t, rf.fixture); spent != 50 {
		t.Fatalf("a trigger run spent %d credits, want 50 (lite)", spent)
	}
}

// An expired trigger stops being a reason to write.
func TestExpiredTriggerLeavesTheQueue(t *testing.T) {
	rf := newResearchFixture(t, triggerVendor("Acme announced a Series B.", true))
	rel := rf.account(t)

	if _, err := rf.svc.ResearchAccountTrigger(rf.ctx, rf.user, rel.ID); err != nil {
		t.Fatalf("ResearchAccountTrigger: %v", err)
	}
	ws, err := rf.svc.CurrentWorkspace(rf.ctx, rf.user)
	if err != nil {
		t.Fatalf("workspace: %v", err)
	}
	future := time.Now().UTC().Add(triggerValidity + 24*time.Hour)
	triggers, err := rf.svc.activeAccountTriggers(rf.ctx, ws, future)
	if err != nil {
		t.Fatalf("active triggers: %v", err)
	}
	if len(triggers) != 0 {
		t.Fatalf("an expired trigger is still active: %+v", triggers)
	}
}

func TestTriggerRefusesAccountWithoutADomain(t *testing.T) {
	vendor := triggerVendor("Acme announced a Series B.", true)
	rf := newResearchFixture(t, vendor)
	rel := rf.account(t)
	rf.client.Relationship.UpdateOne(rel).SetAccountDomain("gmail.com").ExecX(rf.ctx)

	if _, err := rf.svc.ResearchAccountTrigger(rf.ctx, rf.user, rel.ID); err == nil {
		t.Fatal("a public mailbox domain is not a company to monitor")
	}
	if vendor.runs != 0 {
		t.Fatal("an unanchored account reached the vendor")
	}
}

func TestTriggerExplanation(t *testing.T) {
	got := triggerExplanation(
		"Acme announced a Series B", "Sarah Chen (VP Engineering)", "https://press.example/acme",
	)
	want := "Acme announced a Series B. Your last contact there was Sarah Chen (VP Engineering). " +
		"Source: https://press.example/acme"
	if got != want {
		t.Fatalf("explanation = %q, want %q", got, want)
	}
	if got := triggerExplanation("Acme launched v2.", "", ""); got != "Acme launched v2." {
		t.Fatalf("explanation without a contact or source = %q", got)
	}
}

func TestFirstCitationURL(t *testing.T) {
	if got := firstCitationURL(`[{"url":"https://a.example"},{"url":"https://b.example"}]`); got != "https://a.example" {
		t.Fatalf("firstCitationURL = %q", got)
	}
	// A malformed or empty column must not break the queue item.
	for _, encoded := range []string{"", "not json", "[]", `[{"url":"  "}]`} {
		if got := firstCitationURL(encoded); got != "" {
			t.Fatalf("firstCitationURL(%q) = %q, want empty", encoded, got)
		}
	}
}
