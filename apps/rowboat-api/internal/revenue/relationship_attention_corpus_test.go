package revenue

import (
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipattentionitem"
)

// TestRelationshipAttentionLabeledCorpus is the executable precision and
// false-positive report for RFC 038 TFA-4. Every launch detector has at least
// one positive and one hard-negative example. A failure prints the exact
// false positives and false negatives instead of hiding quality behind an
// aggregate score.
func TestRelationshipAttentionLabeledCorpus(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 1, 14, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{"google", "hubspot"} {
		if _, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, source, SourceAuthorizationInput{
			SourceAccountID: "corpus", State: "completed", GrantedScopes: sourceDescriptor(source).ReadScopes,
		}); err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.ReportSourceSyncProgress(f.ctx, f.user, SourceSyncProgressInput{
			Source: source, SourceAccountID: "corpus", Completed: 1, Total: 1, Done: true, OccurredAt: now,
		}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.svc.MarkSourceDisconnected(f.ctx, f.user, "slack", "corpus"); err != nil {
		t.Fatal(err)
	}

	type corpusCase struct {
		name     string
		expected []string
		setup    func(*ent.Relationship)
	}
	cases := []corpusCase{
		{name: "quiet-positive", expected: []string{"quiet_account"}, setup: func(rel *ent.Relationship) {
			rel.Update().SetLifecycle("evaluation").SetNextAction("Review plan").SetLastTouchAt(now.Add(-15 * 24 * time.Hour)).SetResourceRefs([]string{"google:thread:quiet-positive"}).SaveX(f.ctx)
		}},
		{name: "quiet-negative-before-cooldown", setup: func(rel *ent.Relationship) {
			rel.Update().SetLifecycle("evaluation").SetNextAction("Review plan").SetLastTouchAt(now.Add(-13 * 24 * time.Hour)).SetResourceRefs([]string{"google:thread:quiet-negative"}).SaveX(f.ctx)
		}},
		{name: "quiet-suppressed-by-stale-evidence", expected: []string{"source_degradation"}, setup: func(rel *ent.Relationship) {
			rel.Update().SetLifecycle("evaluation").SetNextAction("Review plan").SetLastTouchAt(now.Add(-30 * 24 * time.Hour)).SetResourceRefs([]string{"slack:channel:quiet-stale"}).SaveX(f.ctx)
		}},
		{name: "overdue-positive", expected: []string{"overdue_commitment"}, setup: func(rel *ent.Relationship) {
			f.client.Commitment.Create().SetWorkspace(ws).SetRelationship(rel).SetUser(f.user).
				SetDirection("promised_by_me").SetText("Send plan").SetStatus("open").SetDueAt(now.Add(-24 * time.Hour)).
				SetConfidence(1).SetUserConfirmed(true).SaveX(f.ctx)
		}},
		{name: "overdue-negative-future", setup: func(rel *ent.Relationship) {
			f.client.Commitment.Create().SetWorkspace(ws).SetRelationship(rel).SetUser(f.user).
				SetDirection("promised_by_me").SetText("Send plan later").SetStatus("open").SetDueAt(now.Add(24 * time.Hour)).
				SetConfidence(1).SetUserConfirmed(true).SaveX(f.ctx)
		}},
		{name: "risk-positive", expected: []string{"unresolved_risk"}, setup: func(rel *ent.Relationship) {
			rel.Update().SetHealth("needs_attention").SetRisks([]string{"Security review blocked"}).SaveX(f.ctx)
		}},
		{name: "risk-negative-healthy", setup: func(rel *ent.Relationship) {
			rel.Update().SetHealth("healthy").SetRisks([]string{"Monitored dependency"}).SaveX(f.ctx)
		}},
		{name: "next-step-positive", expected: []string{"missing_next_step"}, setup: func(rel *ent.Relationship) {
			rel.Update().SetLifecycle("evaluation").SetNextAction("").SetResourceRefs([]string{"google:thread:next-positive"}).SaveX(f.ctx)
		}},
		{name: "next-step-negative-present", setup: func(rel *ent.Relationship) {
			rel.Update().SetLifecycle("evaluation").SetNextAction("Schedule review").SetResourceRefs([]string{"google:thread:next-negative"}).SaveX(f.ctx)
		}},
		{name: "source-positive", expected: []string{"source_degradation"}, setup: func(rel *ent.Relationship) {
			rel.Update().SetResourceRefs([]string{"slack:channel:source-positive"}).SaveX(f.ctx)
		}},
		{name: "source-negative-live", setup: func(rel *ent.Relationship) {
			rel.Update().SetResourceRefs([]string{"hubspot:company:source-negative"}).SaveX(f.ctx)
		}},
		{name: "outcome-positive", expected: []string{"action_outcome_review"}, setup: func(rel *ent.Relationship) {
			action, err := f.svc.CreateAction(f.ctx, f.user, ActionInput{
				RelationshipID: rel.ID, ActionType: "warm_follow_up", Channel: "email",
				DedupeKey: "corpus-outcome-positive", Reason: "Corpus uncertain provider result.",
				RecipientEmail: "positive@corpus.example", ProposedSubject: "Review", ProposedMessage: "Review",
			})
			if err != nil {
				t.Fatal(err)
			}
			action.Update().SetExecutionStatus(ExecFailed).SaveX(f.ctx)
		}},
		{name: "outcome-negative-success", setup: func(rel *ent.Relationship) {
			action, err := f.svc.CreateAction(f.ctx, f.user, ActionInput{
				RelationshipID: rel.ID, ActionType: "warm_follow_up", Channel: "email",
				DedupeKey: "corpus-outcome-negative", Reason: "Corpus successful provider result.",
				RecipientEmail: "negative@corpus.example", ProposedSubject: "Done", ProposedMessage: "Done",
			})
			if err != nil {
				t.Fatal(err)
			}
			action.Update().SetExecutionStatus(ExecSent).SetQueueStatus(QueueHandled).SaveX(f.ctx)
		}},
	}

	expectedByRelationship := make(map[string]map[string]bool, len(cases))
	nameByRelationship := make(map[string]string, len(cases))
	for index, item := range cases {
		rel, err := f.svc.CreateRelationship(f.ctx, f.user, RelationshipInput{
			Kind: "company", DisplayName: fmt.Sprintf("Corpus %02d %s", index, item.name),
		})
		if err != nil {
			t.Fatal(err)
		}
		item.setup(rel)
		expectedByRelationship[rel.ID.String()] = stringSet(item.expected)
		nameByRelationship[rel.ID.String()] = item.name
	}
	if err := f.svc.RefreshRelationshipAttention(f.ctx, f.user); err != nil {
		t.Fatal(err)
	}
	items, err := f.client.RelationshipAttentionItem.Query().
		Where(relationshipattentionitem.StatusEQ("open")).WithRelationship().All(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	actualByRelationship := make(map[string]map[string]bool, len(cases))
	for _, item := range items {
		if item.ReasonCode == "recommendation" {
			continue
		}
		rel, edgeErr := item.Edges.RelationshipOrErr()
		if edgeErr != nil {
			t.Fatal(edgeErr)
		}
		if actualByRelationship[rel.ID.String()] == nil {
			actualByRelationship[rel.ID.String()] = map[string]bool{}
		}
		actualByRelationship[rel.ID.String()][item.ReasonCode] = true
	}

	detectors := []string{
		"quiet_account", "overdue_commitment", "unresolved_risk",
		"missing_next_step", "source_degradation", "action_outcome_review",
	}
	for _, detector := range detectors {
		tp, fp, fn := 0, []string{}, []string{}
		for relationshipID, expected := range expectedByRelationship {
			actual := actualByRelationship[relationshipID]
			switch {
			case expected[detector] && actual[detector]:
				tp++
			case !expected[detector] && actual[detector]:
				fp = append(fp, nameByRelationship[relationshipID])
			case expected[detector] && !actual[detector]:
				fn = append(fn, nameByRelationship[relationshipID])
			}
		}
		sort.Strings(fp)
		sort.Strings(fn)
		precision := 1.0
		if tp+len(fp) > 0 {
			precision = float64(tp) / float64(tp+len(fp))
		}
		if tp == 0 || precision < 0.95 || len(fn) > 0 {
			t.Errorf("detector=%s precision=%.3f true_positives=%d false_positives=[%s] false_negatives=[%s]", detector, precision, tp, strings.Join(fp, ", "), strings.Join(fn, ", "))
		}
	}
}

func stringSet(values []string) map[string]bool {
	out := make(map[string]bool, len(values))
	for _, value := range values {
		out[value] = true
	}
	return out
}
