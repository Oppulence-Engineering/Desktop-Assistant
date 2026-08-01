package revenue

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipsourcestatus"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/workspacefeaturecontrol"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/revenuemetrics"
)

// ErrCapabilityDisabled is returned when a tenant entitlement or kill switch
// refuses a beta capability.
var ErrCapabilityDisabled = errors.New("revenue: workspace capability is disabled")

// Capability constants are the complete allowlist of tenant-scoped beta
// entitlements, detectors, sources, and action providers.
const (
	CapabilityBetaEntitlement  = "beta_entitlement"
	CapabilityBetaNavigation   = "beta_navigation"
	CapabilityReleaseApproval  = "release_gate_approval"
	CapabilityGoogleSource     = "source_google"
	CapabilitySlackSource      = "source_slack"
	CapabilityHubSpotSource    = "source_hubspot"
	CapabilityModelExtraction  = "model_extraction"
	CapabilityDetectorQuiet    = "detector_quiet_account"
	CapabilityDetectorOverdue  = "detector_overdue_commitment"
	CapabilityDetectorRisk     = "detector_unresolved_risk"
	CapabilityDetectorNextStep = "detector_missing_next_step"
	CapabilityDetectorSource   = "detector_source_degradation"
	CapabilityDetectorOutcome  = "detector_outcome_review"
	CapabilityActionGmail      = "action_gmail"
	CapabilityActionSlack      = "action_slack"
	CapabilityActionHubSpot    = "action_hubspot"
	CapabilityOutcomeRanking   = "outcome_ranking"
	CapabilityDesktopPublish   = "desktop_evidence_publication"
	CapabilityRealtimeUpdates  = "realtime_updates"
)

var supportedWorkspaceCapabilities = map[string]bool{
	CapabilityBetaEntitlement: true, CapabilityBetaNavigation: true, CapabilityReleaseApproval: true,
	CapabilityGoogleSource: true, CapabilitySlackSource: true, CapabilityHubSpotSource: true,
	CapabilityModelExtraction: true,
	CapabilityDetectorQuiet:   true, CapabilityDetectorOverdue: true, CapabilityDetectorRisk: true,
	CapabilityDetectorNextStep: true, CapabilityDetectorSource: true, CapabilityDetectorOutcome: true,
	CapabilityActionGmail: true, CapabilityActionSlack: true, CapabilityActionHubSpot: true,
	CapabilityOutcomeRanking: true, CapabilityDesktopPublish: true, CapabilityRealtimeUpdates: true,
}

var supportedRolloutStages = map[string]bool{
	"synthetic": true, "internal_read_only": true, "internal_governed_action": true,
	"design_partner_read_only": true, "design_partner_governed_action": true, "beta": true,
}

var featureReasonPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

// WorkspaceFeatureControls returns all explicit capability controls for the
// current tenant.
func (s *Service) WorkspaceFeatureControls(
	ctx context.Context,
	u *ent.User,
) ([]*ent.WorkspaceFeatureControl, error) {
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceView)
	if err != nil {
		return nil, err
	}
	return s.client.WorkspaceFeatureControl.Query().
		Where(workspacefeaturecontrol.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID))).
		Order(ent.Asc(workspacefeaturecontrol.FieldCapability)).All(ctx)
}

// SetWorkspaceFeatureControl applies an owner-managed entitlement or kill
// switch with a bounded rollout stage and reason.
func (s *Service) SetWorkspaceFeatureControl(
	ctx context.Context,
	u *ent.User,
	capability string,
	enabled bool,
	rolloutStage string,
	reasonCode string,
) (*ent.WorkspaceFeatureControl, error) {
	capability = strings.ToLower(strings.TrimSpace(capability))
	if !supportedWorkspaceCapabilities[capability] {
		return nil, fmt.Errorf("%w: unsupported capability", ErrInvalidInput)
	}
	reasonCode = strings.ToLower(strings.TrimSpace(reasonCode))
	if reasonCode != "" && !featureReasonPattern.MatchString(reasonCode) {
		return nil, fmt.Errorf("%w: reasonCode must be a bounded categorical slug", ErrInvalidInput)
	}
	rolloutStage = strings.ToLower(strings.TrimSpace(rolloutStage))
	if rolloutStage == "" {
		rolloutStage = "synthetic"
	}
	if !supportedRolloutStages[rolloutStage] {
		return nil, fmt.Errorf("%w: unsupported rolloutStage", ErrInvalidInput)
	}
	if capability == CapabilityReleaseApproval && enabled {
		if reasonCode != "release_owner_signoff" {
			return nil, fmt.Errorf("%w: release approval requires release_owner_signoff", ErrInvalidInput)
		}
		if rolloutStage != "design_partner_governed_action" && rolloutStage != "beta" {
			return nil, fmt.Errorf("%w: release approval is only valid for governed design-partner or beta rollout", ErrInvalidInput)
		}
	}
	ws, err := s.currentWorkspaceWithCapability(ctx, u, WorkspaceManageSources)
	if err != nil {
		return nil, err
	}
	existing, err := s.client.WorkspaceFeatureControl.Query().
		Where(
			workspacefeaturecontrol.CapabilityEQ(capability),
			workspacefeaturecontrol.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		).
		Only(ctx)
	if err == nil {
		return existing.Update().SetEnabled(enabled).SetRolloutStage(rolloutStage).
			SetReasonCode(reasonCode).Save(ctx)
	}
	if !ent.IsNotFound(err) {
		return nil, err
	}
	return s.client.WorkspaceFeatureControl.Create().
		SetWorkspace(ws).SetUser(u).SetCapability(capability).SetEnabled(enabled).
		SetRolloutStage(rolloutStage).SetReasonCode(reasonCode).Save(ctx)
}

// requireWorkspaceFeature applies explicit kill switches to every workspace.
// Workspaces opted into beta entitlement also fail closed when a capability
// has not been explicitly enabled. Legacy workspaces retain compatibility
// until enrolled.
func (s *Service) requireWorkspaceFeature(
	ctx context.Context,
	ws *ent.RevenueWorkspace,
	capability string,
) error {
	control, err := s.client.WorkspaceFeatureControl.Query().
		Where(
			workspacefeaturecontrol.CapabilityEQ(capability),
			workspacefeaturecontrol.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		).
		Only(ctx)
	if err == nil {
		if control.Enabled {
			return nil
		}
		return fmt.Errorf("%w: %s", ErrCapabilityDisabled, capability)
	}
	if !ent.IsNotFound(err) {
		return err
	}
	if capability == CapabilityBetaEntitlement {
		return fmt.Errorf("%w: %s", ErrCapabilityDisabled, capability)
	}
	beta, betaErr := s.client.WorkspaceFeatureControl.Query().
		Where(
			workspacefeaturecontrol.CapabilityEQ(CapabilityBetaEntitlement),
			workspacefeaturecontrol.EnabledEQ(true),
			workspacefeaturecontrol.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		).
		Exist(ctx)
	if betaErr != nil {
		return betaErr
	}
	if beta {
		return fmt.Errorf("%w: %s", ErrCapabilityDisabled, capability)
	}
	return nil
}

func (s *Service) betaEnrolled(ctx context.Context, ws *ent.RevenueWorkspace) (bool, error) {
	return s.client.WorkspaceFeatureControl.Query().Where(
		workspacefeaturecontrol.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		workspacefeaturecontrol.CapabilityEQ(CapabilityBetaEntitlement),
		workspacefeaturecontrol.EnabledEQ(true),
	).Exist(ctx)
}

// requireBetaActionReadiness adds the rollout and provider-write boundaries
// that only apply after a workspace opts into the beta. Legacy workflows keep
// their existing compatibility contract; pilot workspaces fail closed.
func (s *Service) requireBetaActionReadiness(
	ctx context.Context,
	ws *ent.RevenueWorkspace,
	action *ent.RevenueAction,
) error {
	enrolled, err := s.betaEnrolled(ctx, ws)
	if err != nil || !enrolled {
		return err
	}
	capability := actionCapability(action.Channel)
	if capability == "" {
		return fmt.Errorf("%w: unsupported beta action channel", ErrCapabilityDisabled)
	}
	control, err := s.client.WorkspaceFeatureControl.Query().Where(
		workspacefeaturecontrol.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		workspacefeaturecontrol.CapabilityEQ(capability),
		workspacefeaturecontrol.EnabledEQ(true),
	).Only(ctx)
	if ent.IsNotFound(err) {
		return fmt.Errorf("%w: %s", ErrCapabilityDisabled, capability)
	}
	if err != nil {
		return err
	}
	switch control.RolloutStage {
	case "internal_governed_action":
	case "design_partner_governed_action", "beta":
		if err := s.requireWorkspaceFeature(ctx, ws, CapabilityReleaseApproval); err != nil {
			return fmt.Errorf("%w: release owner signoff is required", err)
		}
	default:
		return fmt.Errorf("%w: rollout stage %s is read-only", ErrCapabilityDisabled, control.RolloutStage)
	}
	return s.requireBetaActionProviderReady(ctx, ws, action)
}

func (s *Service) requireBetaActionProviderReady(
	ctx context.Context,
	ws *ent.RevenueWorkspace,
	action *ent.RevenueAction,
) error {
	source, requiredScopes := betaActionProviderRequirements(action)
	if source == "" || len(requiredScopes) == 0 {
		return fmt.Errorf("%w: action has no supported provider write contract", ErrSourceIncomplete)
	}
	if action.AssignedUserID == nil {
		return fmt.Errorf("%w: action has no assigned provider actor", ErrSourceIncomplete)
	}
	expectedSourceAccountID := ""
	if source == "slack" {
		team, _, _, targetErr := slackTarget(action)
		if targetErr != nil {
			return fmt.Errorf("%w: %v", ErrSourceIncomplete, targetErr)
		}
		expectedSourceAccountID = strings.TrimSpace(team)
	}
	statuses, err := s.client.RelationshipSourceStatus.Query().Where(
		relationshipsourcestatus.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)),
		relationshipsourcestatus.SourceEQ(source),
	).WithUser().All(ctx)
	if err != nil {
		return err
	}
	for _, status := range statuses {
		actor, actorErr := status.Edges.UserOrErr()
		if actorErr != nil {
			continue
		}
		actorID := actor.ID
		if status.ConsentingActorID != nil {
			actorID = *status.ConsentingActorID
		}
		if actorID != *action.AssignedUserID {
			continue
		}
		if expectedSourceAccountID != "" && status.SourceAccountID != expectedSourceAccountID {
			continue
		}
		applySourceFreshness(status, s.now().UTC())
		if status.Status != "live" || status.Completeness != "complete" {
			continue
		}
		if len(differenceStrings(requiredScopes, status.GrantedScopes)) == 0 {
			return nil
		}
	}
	return fmt.Errorf("%w: %s is not live with the required write scope", ErrSourceIncomplete, source)
}

func betaActionProviderRequirements(action *ent.RevenueAction) (string, []string) {
	switch strings.ToLower(strings.TrimSpace(action.Channel)) {
	case "email", "gmail":
		if action.ExecutionMode == ExecModeDraft {
			return "google", []string{"https://www.googleapis.com/auth/gmail.compose"}
		}
		return "google", []string{"https://www.googleapis.com/auth/gmail.send"}
	case "calendar":
		return "google", []string{"https://www.googleapis.com/auth/calendar.events"}
	case "slack":
		return "slack", []string{"chat:write"}
	case "hubspot", "crm", "crm_task", "task":
		if action.Channel == "crm_task" || action.Channel == "task" || strings.Contains(strings.ToLower(action.ActionType), "task") {
			return "hubspot", []string{"crm.objects.tasks.write"}
		}
		return "hubspot", []string{"crm.objects.notes.write"}
	default:
		return "", nil
	}
}

// TrustEventInput is the bounded, content-free telemetry contract accepted by
// the activation and trust ledger.
type TrustEventInput struct {
	Name          string
	Outcome       string
	ReasonCode    string
	CorrelationID string
	Source        string
	Channel       string
	StateVersion  int
	Duration      time.Duration
	OccurredAt    time.Time
	Relationship  *ent.Relationship
	Action        *ent.RevenueAction
}

var trustEventNames = map[string]bool{
	"workspace_created": true, "source_authorization_started": true,
	"source_authorization_succeeded": true, "source_authorization_canceled": true,
	"source_authorization_failed": true, "observation_accepted": true,
	"relationship_projected": true, "mission_control_reviewed": true,
	"evidence_inspected": true, "correction_applied": true,
	"recommendation_decided": true, "action_executed": true,
	"outcome_observed": true, "source_disconnected": true,
	"identity_decided": true, "identity_candidate_viewed": true,
	"mission_control_opened":     true,
	"identity_candidate_decided": true, "projection_failed": true,
	"attention_item_decided": true,
}

var trustEventOutcomes = map[string]bool{
	"started": true, "succeeded": true, "failed": true, "deferred": true,
	"accepted": true, "corrected": true, "rejected": true, "uncertain": true,
	"manual_review": true, "disabled": true, "viewed": true,
}

func appendTrustEvent(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	in TrustEventInput,
) error {
	if !trustEventNames[in.Name] || !trustEventOutcomes[in.Outcome] {
		return fmt.Errorf("%w: unsupported trust event category", ErrInvalidInput)
	}
	if in.ReasonCode != "" && !featureReasonPattern.MatchString(in.ReasonCode) {
		return fmt.Errorf("%w: trust reason must be categorical", ErrInvalidInput)
	}
	if in.OccurredAt.IsZero() {
		in.OccurredAt = time.Now().UTC()
	}
	create := client.RevenueTrustEvent.Create().
		SetWorkspace(ws).SetUser(u).
		SetEventName(in.Name).SetOutcome(in.Outcome).
		SetOccurredAt(in.OccurredAt.UTC())
	if in.ReasonCode != "" {
		create.SetReasonCode(in.ReasonCode)
	}
	if in.CorrelationID != "" {
		create.SetCorrelationID(in.CorrelationID)
	}
	if in.Source != "" {
		create.SetSource(in.Source)
	}
	if in.Channel != "" {
		create.SetChannel(in.Channel)
	}
	if in.StateVersion > 0 {
		create.SetStateVersion(in.StateVersion)
	}
	if in.Duration > 0 {
		create.SetDurationMs(in.Duration.Milliseconds())
	}
	if in.Relationship != nil {
		create.SetRelationship(in.Relationship)
	}
	if in.Action != nil {
		create.SetAction(in.Action)
	}
	if _, err := create.Save(ctx); err != nil {
		return err
	}
	reason := in.ReasonCode
	if reason == "" {
		reason = "none"
	}
	revenuemetrics.TrustEvents.WithLabelValues(in.Name, in.Outcome, reason).Inc()
	return nil
}

func actionCapability(channel string) string {
	switch strings.ToLower(strings.TrimSpace(channel)) {
	case "email", "gmail", "calendar":
		return CapabilityActionGmail
	case "slack":
		return CapabilityActionSlack
	case "hubspot", "crm", "crm_task", "task":
		return CapabilityActionHubSpot
	default:
		return ""
	}
}

func sourceCapability(source string) string {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case "gmail", "calendar", "google":
		return CapabilityGoogleSource
	case "slack":
		return CapabilitySlackSource
	case "hubspot", "crm":
		return CapabilityHubSpotSource
	case "meeting", "voice_note", "desktop_note":
		return CapabilityDesktopPublish
	default:
		return ""
	}
}

func correlationID(prefix string, id uuid.UUID) string {
	return prefix + ":" + id.String()
}
