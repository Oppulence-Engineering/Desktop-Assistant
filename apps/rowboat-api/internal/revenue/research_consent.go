package revenue

import (
	"context"
	"errors"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
)

// Cloud research (RFC 039) is refused by three independent gates. They are
// separate errors because they have separate remedies: an operator re-enables a
// capability, a user upgrades a plan, and only the user can give consent.
var (
	// ErrResearchPlanRequired means the caller's plan does not include cloud
	// research. Handlers map it to 402.
	ErrResearchPlanRequired = errors.New("revenue: cloud research requires the intelligence plan")
	// ErrResearchConsentRequired means nobody has agreed to send counterparty
	// details to the vendor. Handlers map it to 409, not 402: this is not a
	// paywall, and offering to sell a way past it would be the wrong answer.
	ErrResearchConsentRequired = errors.New("revenue: cloud research consent has not been granted for this workspace")
)

// ResearchPlan is the subscription plan that includes cloud research.
//
// Not `pro`. Research is gated behind a consent flag that is off by default and
// independent of the plan, so a meaningful fraction of paying users will never
// enable it; folding its cost into an existing plan would charge them for a
// capability they declined on privacy grounds.
const ResearchPlan = "intelligence"

// CloudResearchConsentState is the workspace's answer to "may we send a
// counterparty's name and domain to the research vendor?".
type CloudResearchConsentState struct {
	Consented   bool       `json:"consented"`
	ConsentedAt *time.Time `json:"consentedAt,omitempty"`
}

// CloudResearchConsent reports the workspace-level consent state. Readable by
// any member: "what leaves this workspace" is not privileged information.
func (s *Service) CloudResearchConsent(ctx context.Context, u *ent.User) (CloudResearchConsentState, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceView)
	if err != nil {
		return CloudResearchConsentState{}, err
	}
	return consentState(ws), nil
}

// SetCloudResearchConsent grants or revokes consent for every counterparty in
// the workspace at once.
//
// Workspace-scoped rather than per-person on purpose: a per-person prompt would
// be answered "yes" reflexively at the moment the user wants an answer, which is
// consent theatre. One decision, made deliberately, revocable in one place.
//
// Requires manage_sources — the same permission as connecting a data source,
// because this is the same kind of decision: what this workspace discloses, and
// to whom.
func (s *Service) SetCloudResearchConsent(
	ctx context.Context,
	u *ent.User,
	consented bool,
) (CloudResearchConsentState, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceManageSources)
	if err != nil {
		return CloudResearchConsentState{}, err
	}
	update := ws.Update().SetCloudResearchConsent(consented)
	if consented {
		update.SetCloudResearchConsentAt(s.now())
	} else {
		// Clear the timestamp on revocation so the column can never display a
		// consent date for a consent that is not in force.
		update.ClearCloudResearchConsentAt()
	}
	saved, err := update.Save(ctx)
	if err != nil {
		return CloudResearchConsentState{}, err
	}
	return consentState(saved), nil
}

func consentState(ws *ent.RevenueWorkspace) CloudResearchConsentState {
	return CloudResearchConsentState{
		Consented:   ws.CloudResearchConsent,
		ConsentedAt: ws.CloudResearchConsentAt,
	}
}

// requireCloudResearch is the single admission gate for every outbound research
// call. Nothing may reach the vendor without passing all three checks, and the
// order is deliberate: the fleet-wide kill switch first (so an outage or a price
// change stops traffic regardless of what anyone has bought or agreed to), then
// the plan, then consent.
//
// Consent is checked last but is not the weakest: it is the only gate that
// cannot be granted on the caller's behalf by an operator or a payment.
func (s *Service) requireCloudResearch(
	ctx context.Context,
	ws *ent.RevenueWorkspace,
) error {
	if err := s.requireWorkspaceFeature(ctx, ws, CapabilityCloudResearch); err != nil {
		return err
	}
	if err := s.requireResearchPlan(ctx); err != nil {
		return err
	}
	if !ws.CloudResearchConsent {
		return ErrResearchConsentRequired
	}
	return nil
}

// CloudResearchAdmission runs the three gates for the caller's own workspace
// and returns the first refusal. It exists so the desktop can render an honest
// mode control — "Cloud research needs the Intelligence plan" rather than a
// toggle that fails when used — without duplicating the gate logic client-side.
func (s *Service) CloudResearchAdmission(ctx context.Context, u *ent.User) error {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceView)
	if err != nil {
		return err
	}
	return s.requireCloudResearch(ctx, ws)
}

// ResearchRefusalCode turns a gate error into the stable slug a client renders
// copy from. Unknown errors report as an internal problem rather than as a
// reason the user could act on, because telling someone to upgrade when the
// database is down wastes their money and their time.
func ResearchRefusalCode(err error) string {
	switch {
	case err == nil:
		return ""
	case errors.Is(err, ErrResearchConsentRequired):
		return "consent_required"
	case errors.Is(err, ErrResearchPlanRequired):
		return "plan_required"
	case errors.Is(err, ErrCapabilityDisabled):
		return "capability_disabled"
	case errors.Is(err, ErrResearchUnavailable):
		return "provider_unconfigured"
	default:
		return "unavailable"
	}
}

// requireResearchPlan checks the subscription plan. The query is tenant-scoped
// by the ent interceptor, so it reads the caller's own subscription and cannot
// be pointed at another user's by a request parameter.
func (s *Service) requireResearchPlan(ctx context.Context) error {
	sub, err := s.client.Subscription.Query().Only(ctx)
	if ent.IsNotFound(err) {
		return ErrResearchPlanRequired
	}
	if err != nil {
		return err
	}
	if sub.Plan != ResearchPlan {
		return ErrResearchPlanRequired
	}
	// A lapsed card is not a licence to keep spending at a vendor on the
	// workspace's behalf.
	if sub.Status != "active" && sub.Status != "trialing" {
		return ErrResearchPlanRequired
	}
	return nil
}
