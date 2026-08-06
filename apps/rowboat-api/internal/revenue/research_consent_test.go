package revenue

import (
	"errors"
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
