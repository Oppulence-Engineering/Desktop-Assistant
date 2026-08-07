package revenue

import (
	"errors"
	"fmt"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/google/uuid"
)

// reloadWorkspace re-reads the workspace row. requireCloudResearch reads consent
// off the struct it is handed, so a test that flips consent and then reuses a
// stale struct would be testing its own local variable.
func reloadWorkspace(t *testing.T, f *fixture, id uuid.UUID) *ent.RevenueWorkspace {
	t.Helper()
	ws, err := f.client.RevenueWorkspace.Get(f.ctx, id)
	if err != nil {
		t.Fatalf("reload workspace: %v", err)
	}
	return ws
}

// enableCloudResearch flips the operator capability on for the fixture
// workspace. It deliberately does NOT touch consent: every test that needs
// consent has to ask for it, which is the property under test.
func enableCloudResearch(t *testing.T, f *fixture) {
	t.Helper()
	if _, err := f.svc.SetWorkspaceFeatureControl(
		f.ctx, f.user, CapabilityCloudResearch, true, "beta", "rfc_039",
	); err != nil {
		t.Fatalf("enable cloud research capability: %v", err)
	}
}

func TestCloudResearchConsentDefaultsOff(t *testing.T) {
	f := newFixture(t)

	state, err := f.svc.CloudResearchConsent(f.ctx, f.user)
	if err != nil {
		t.Fatalf("read consent: %v", err)
	}
	if state.Consented {
		t.Fatal("a fresh workspace must not consent to sending counterparty details to a vendor")
	}
	if state.ConsentedAt != nil {
		t.Fatalf("unconsented workspace reported a consent timestamp: %v", state.ConsentedAt)
	}
}

func TestCloudResearchConsentGrantAndRevoke(t *testing.T) {
	f := newFixture(t)

	granted, err := f.svc.SetCloudResearchConsent(f.ctx, f.user, true)
	if err != nil {
		t.Fatalf("grant consent: %v", err)
	}
	if !granted.Consented || granted.ConsentedAt == nil {
		t.Fatalf("grant did not record consent + timestamp: %+v", granted)
	}

	revoked, err := f.svc.SetCloudResearchConsent(f.ctx, f.user, false)
	if err != nil {
		t.Fatalf("revoke consent: %v", err)
	}
	if revoked.Consented {
		t.Fatal("revoke left consent on")
	}
	// A stale timestamp next to a revoked flag would let a UI claim the user
	// agreed to something they have withdrawn.
	if revoked.ConsentedAt != nil {
		t.Fatalf("revoke left a consent timestamp: %v", revoked.ConsentedAt)
	}

	reread, err := f.svc.CloudResearchConsent(f.ctx, f.user)
	if err != nil {
		t.Fatalf("re-read consent: %v", err)
	}
	if reread.Consented {
		t.Fatal("revocation did not persist")
	}
}

// The capability is an operator kill switch, not consent. Enabling it must not
// grant consent, and consent must not satisfy the capability.
func TestCloudResearchCapabilityAndConsentAreIndependent(t *testing.T) {
	f := newFixture(t)
	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatalf("workspace: %v", err)
	}
	grantSub(t, f, ResearchPlan, "active")

	// Capability on, consent untouched → still refused, and refused for consent.
	enableCloudResearch(t, f)
	state, err := f.svc.CloudResearchConsent(f.ctx, f.user)
	if err != nil {
		t.Fatalf("read consent: %v", err)
	}
	if state.Consented {
		t.Fatal("enabling the capability granted consent as a side effect")
	}
	ws = reloadWorkspace(t, f, ws.ID)
	if err := f.svc.requireCloudResearch(f.ctx, ws); !errors.Is(err, ErrResearchConsentRequired) {
		t.Fatalf("capability without consent: want ErrResearchConsentRequired, got %v", err)
	}

	// Consent on, capability killed → refused for the capability.
	if _, err := f.svc.SetCloudResearchConsent(f.ctx, f.user, true); err != nil {
		t.Fatalf("grant consent: %v", err)
	}
	if _, err := f.svc.SetWorkspaceFeatureControl(
		f.ctx, f.user, CapabilityCloudResearch, false, "beta", "vendor_incident",
	); err != nil {
		t.Fatalf("kill switch: %v", err)
	}
	ws = reloadWorkspace(t, f, ws.ID)
	if err := f.svc.requireCloudResearch(f.ctx, ws); !errors.Is(err, ErrCapabilityDisabled) {
		t.Fatalf("kill switch with consent: want ErrCapabilityDisabled, got %v", err)
	}
}

func TestCloudResearchRequiresIntelligencePlan(t *testing.T) {
	f := newFixture(t)
	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatalf("workspace: %v", err)
	}
	enableCloudResearch(t, f)
	if _, err := f.svc.SetCloudResearchConsent(f.ctx, f.user, true); err != nil {
		t.Fatalf("grant consent: %v", err)
	}
	ws = reloadWorkspace(t, f, ws.ID)

	// No subscription at all.
	if err := f.svc.requireCloudResearch(f.ctx, ws); !errors.Is(err, ErrResearchPlanRequired) {
		t.Fatalf("no subscription: want ErrResearchPlanRequired, got %v", err)
	}

	// The paid plans that exist today do not include research: Chase is a
	// better follow-up reminder, not an intelligence system.
	for _, plan := range []string{"free", "starter", "pro"} {
		f.client.Subscription.Delete().ExecX(f.ctx)
		grantSub(t, f, plan, "active")
		if err := f.svc.requireCloudResearch(f.ctx, ws); !errors.Is(err, ErrResearchPlanRequired) {
			t.Fatalf("plan %q: want ErrResearchPlanRequired, got %v", plan, err)
		}
	}

	// The right plan, but the card has lapsed.
	f.client.Subscription.Delete().ExecX(f.ctx)
	grantSub(t, f, ResearchPlan, "past_due")
	if err := f.svc.requireCloudResearch(f.ctx, ws); !errors.Is(err, ErrResearchPlanRequired) {
		t.Fatalf("past_due intelligence plan: want ErrResearchPlanRequired, got %v", err)
	}

	// All three gates satisfied.
	f.client.Subscription.Delete().ExecX(f.ctx)
	grantSub(t, f, ResearchPlan, "active")
	if err := f.svc.requireCloudResearch(f.ctx, ws); err != nil {
		t.Fatalf("capability + plan + consent should admit: %v", err)
	}
}

// Admission is four independent switches — vendor configured, capability, plan,
// consent — across every research entry point. Previous rounds tested a handful
// of cells by hand. This exhausts the table, and pins WHICH refusal wins when
// several are shut, because the order is a product decision: the fleet-wide kill
// switch must beat a billing problem, and neither may be reported as a consent
// problem the user is then asked to solve.
func TestResearchAdmissionTruthTable(t *testing.T) {
	type gates struct{ configured, capability, plan, consent bool }

	// want is the sentinel for each of the 16 states.
	want := func(g gates) error {
		switch {
		case !g.capability:
			return ErrCapabilityDisabled
		case !g.plan:
			return ErrResearchPlanRequired
		case !g.consent:
			return ErrResearchConsentRequired
		case !g.configured:
			return ErrResearchUnavailable
		default:
			return nil
		}
	}

	for i := 0; i < 16; i++ {
		g := gates{
			configured: i&1 != 0,
			capability: i&2 != 0,
			plan:       i&4 != 0,
			consent:    i&8 != 0,
		}
		name := fmt.Sprintf("cfg=%v/cap=%v/plan=%v/consent=%v",
			g.configured, g.capability, g.plan, g.consent)

		t.Run(name, func(t *testing.T) {
			vendor := &vendorStub{
				content: map[string]any{researchMatchField: "high", "title": "VP Engineering"},
				basis:   []map[string]any{citedBasis("title", "high")},
			}
			rf := newResearchFixture(t, vendor)

			if !g.capability {
				if _, err := rf.svc.SetWorkspaceFeatureControl(
					rf.ctx, rf.user, CapabilityCloudResearch, false, "beta", "vendor_incident",
				); err != nil {
					t.Fatalf("kill switch: %v", err)
				}
			}
			if !g.plan {
				rf.client.Subscription.Delete().ExecX(rf.ctx)
				grantSub(t, rf.fixture, "pro", "active")
			}
			if !g.consent {
				if _, err := rf.svc.SetCloudResearchConsent(rf.ctx, rf.user, false); err != nil {
					t.Fatalf("revoke consent: %v", err)
				}
			}
			if !g.configured {
				cfg := rf.svc.research
				cfg.Client = nil
				rf.svc.SetResearch(cfg)
			}

			expected := want(g)

			// Every entry point must agree. A gate enforced on one and not
			// another is how a background job reaches a vendor a foreground call
			// would have been refused for.
			_, enrichErr := rf.svc.EnrichPerson(rf.ctx, rf.user, rf.person.ID)
			assertAdmission(t, "EnrichPerson", expected, enrichErr)

			_, batchErr := rf.svc.EnrichPersons(rf.ctx, rf.user, []uuid.UUID{rf.person.ID})
			assertAdmission(t, "EnrichPersons", expected, batchErr)

			_, triggerErr := rf.svc.ResearchAccountTrigger(rf.ctx, rf.user, rf.account(t).ID)
			assertAdmission(t, "ResearchAccountTrigger", expected, triggerErr)

			_, sweepErr := rf.svc.SweepAccountTriggers(rf.ctx, rf.user, 5)
			assertAdmission(t, "SweepAccountTriggers", expected, sweepErr)

			// The estimate reads no vendor, so it is admitted whenever the three
			// gates that are about permission are open.
			_, estimateErr := rf.svc.EstimatePersonEnrichment(rf.ctx, rf.user)
			estimateWant := expected
			if errors.Is(estimateWant, ErrResearchUnavailable) {
				estimateWant = nil
			}
			assertAdmission(t, "EstimatePersonEnrichment", estimateWant, estimateErr)

			// Nothing may reach the vendor unless every gate is open.
			if expected != nil && vendor.runs != 0 {
				t.Fatalf("vendor was called %d times while refused with %v", vendor.runs, expected)
			}
		})
	}
}

func assertAdmission(t *testing.T, entry string, want, got error) {
	t.Helper()
	if want == nil {
		if got != nil {
			t.Fatalf("%s: want admission, got %v", entry, got)
		}
		return
	}
	if !errors.Is(got, want) {
		t.Fatalf("%s: want %v, got %v", entry, want, got)
	}
}
