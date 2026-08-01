package revenue

import (
	"errors"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenuetrustevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
)

func TestWorkspaceFeatureControlsFailClosedForBetaAndKillSwitchLegacy(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 7, 31, 23, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }

	// An explicit kill switch applies even before beta enrollment.
	if _, err := f.svc.SetWorkspaceFeatureControl(
		f.ctx, f.user, CapabilityHubSpotSource, false, "synthetic", "fault_drill",
	); err != nil {
		t.Fatalf("disable source: %v", err)
	}
	input := RelationshipObservationInput{
		DisplayName: "Flagged Account", AccountDomain: "flagged.example",
		Source: "hubspot", ExternalID: "flagged", EventType: "company.updated",
		OccurredAt: now, ReceivedAt: now,
	}
	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{input}); !errors.Is(err, ErrCapabilityDisabled) {
		t.Fatalf("source kill switch did not fail closed: %v", err)
	}
	if count, err := f.client.RelationshipObservation.Query().Count(f.ctx); err != nil || count != 0 {
		t.Fatalf("disabled source accepted evidence: count=%d err=%v", count, err)
	}

	if _, err := f.svc.SetWorkspaceFeatureControl(
		f.ctx, f.user, CapabilityBetaEntitlement, true, "internal_read_only", "internal_canary",
	); err != nil {
		t.Fatalf("enable beta entitlement: %v", err)
	}
	if _, err := f.svc.SetWorkspaceFeatureControl(
		f.ctx, f.user, CapabilityHubSpotSource, true, "internal_read_only", "internal_canary",
	); err != nil {
		t.Fatalf("enable source: %v", err)
	}
	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{input}); err != nil {
		t.Fatalf("explicitly enabled beta source: %v", err)
	}

	action := f.action(t, ExecModeDraft)
	if _, err := f.svc.Execute(f.ctx, f.user, action.ID); !errors.Is(err, ErrCapabilityDisabled) {
		t.Fatalf("missing beta action capability must fail closed before execution: %v", err)
	}
	if _, err := f.svc.SetWorkspaceFeatureControl(
		f.ctx, f.user, CapabilityActionGmail, false, "internal_read_only", "execution_kill_switch",
	); err != nil {
		t.Fatalf("set action kill switch: %v", err)
	}
	if _, err := f.svc.Execute(f.ctx, f.user, action.ID); !errors.Is(err, ErrCapabilityDisabled) {
		t.Fatalf("explicit action kill switch did not hold: %v", err)
	}
}

func TestWorkspaceFeatureControlsRequireAdminAndTrustEventsAreCategorical(t *testing.T) {
	f := newFixture(t)
	viewer := newUser(t, f.client, "flag-viewer@x.co", "user_flag_viewer")
	if _, err := f.svc.UpsertWorkspaceMember(f.ctx, f.user, viewer.ID, "viewer"); err != nil {
		t.Fatalf("grant viewer: %v", err)
	}
	viewerCtx := auth.WithUser(f.ctx, viewer)
	if _, err := f.svc.SetWorkspaceFeatureControl(
		viewerCtx, viewer, CapabilityBetaNavigation, true, "beta", "viewer_attempt",
	); !errors.Is(err, ErrForbidden) {
		t.Fatalf("viewer changed rollout control: %v", err)
	}

	now := time.Date(2026, 7, 31, 23, 30, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	results, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		DisplayName: "Telemetry Account", AccountDomain: "telemetry.example",
		Source: "hubspot", ExternalID: "telemetry", EventType: "company.updated",
		OccurredAt: now, ReceivedAt: now,
	}})
	if err != nil {
		t.Fatalf("ingest telemetry fixture: %v", err)
	}
	events, err := f.client.RevenueTrustEvent.Query().
		Where(revenuetrustevent.HasRelationshipWith()).
		All(f.ctx)
	if err != nil {
		t.Fatalf("query trust events: %v", err)
	}
	if len(events) < 2 {
		t.Fatalf("observation and projection funnel events missing: %#v", events)
	}
	for _, event := range events {
		if !trustEventNames[event.EventName] || !trustEventOutcomes[event.Outcome] {
			t.Fatalf("unbounded trust event: %#v", event)
		}
		if event.CorrelationID == "telemetry.example" || event.ReasonCode == "Telemetry Account" {
			t.Fatalf("raw customer content entered analytics: %#v", event)
		}
	}
	if results[0].ProjectionStatus != "completed" {
		t.Fatalf("telemetry changed projection behavior: %#v", results[0])
	}
}

func TestDesignPartnerExecutionRequiresProviderWriteScopeAndReleaseOwnerSignoff(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 1, 16, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	f.link(t)
	results, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{
		goldenAccountObservation(0, now),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "google", SourceAuthorizationInput{
		SourceAccountID: "pilot-google", State: "completed", GrantedScopes: []string{
			"https://www.googleapis.com/auth/gmail.readonly",
			"https://www.googleapis.com/auth/calendar.events.readonly",
			"https://www.googleapis.com/auth/gmail.send",
		},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ReportSourceSyncProgress(f.ctx, f.user, SourceSyncProgressInput{
		Source: "google", SourceAccountID: "pilot-google", Completed: 1, Total: 1, Done: true, OccurredAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ReportSourceSyncProgress(f.ctx, f.user, SourceSyncProgressInput{
		Source: "hubspot", SourceAccountID: "pilot-portal", Completed: 1, Total: 1, Done: true, OccurredAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	for _, control := range []struct {
		capability string
		stage      string
	}{
		{CapabilityBetaEntitlement, "design_partner_read_only"},
		{CapabilityGoogleSource, "design_partner_read_only"},
		{CapabilityHubSpotSource, "design_partner_read_only"},
		{CapabilityActionGmail, "design_partner_governed_action"},
	} {
		if _, err := f.svc.SetWorkspaceFeatureControl(f.ctx, f.user, control.capability, true, control.stage, "pilot_rollout"); err != nil {
			t.Fatalf("enable %s: %v", control.capability, err)
		}
	}
	action, err := f.svc.CreateAction(f.ctx, f.user, ActionInput{
		RelationshipID: results[0].Relationship.ID, ActionType: "warm_follow_up", Channel: "email",
		Reason: "Design-partner governed action.", RecipientEmail: "buyer0@golden0.example",
		ProposedSubject: "Follow up", ProposedMessage: "Hello", ExecutionMode: ExecModeSend,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Evaluate(f.ctx, f.user, action.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Approve(f.ctx, f.user, action.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Execute(f.ctx, f.user, action.ID); !errors.Is(err, ErrCapabilityDisabled) {
		t.Fatalf("design-partner write bypassed release signoff: %v", err)
	}
	if _, err := f.svc.SetWorkspaceFeatureControl(
		f.ctx, f.user, CapabilityReleaseApproval, true, "design_partner_governed_action", "someone_clicked_enable",
	); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unattributed release approval was accepted: %v", err)
	}
	if _, err := f.svc.SetWorkspaceFeatureControl(
		f.ctx, f.user, CapabilityReleaseApproval, true, "design_partner_governed_action", "release_owner_signoff",
	); err != nil {
		t.Fatalf("record release owner signoff: %v", err)
	}
	if _, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "google", SourceAuthorizationInput{
		SourceAccountID: "pilot-google", State: "completed", GrantedScopes: []string{
			"https://www.googleapis.com/auth/gmail.readonly",
			"https://www.googleapis.com/auth/calendar.events.readonly",
		},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ReportSourceSyncProgress(f.ctx, f.user, SourceSyncProgressInput{
		Source: "google", SourceAccountID: "pilot-google", Completed: 1, Total: 1, Done: true, OccurredAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Execute(f.ctx, f.user, action.ID); !errors.Is(err, ErrSourceIncomplete) {
		t.Fatalf("missing Gmail write scope did not fail closed: %v", err)
	}
	if _, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "google", SourceAuthorizationInput{
		SourceAccountID: "pilot-google", State: "completed", GrantedScopes: []string{
			"https://www.googleapis.com/auth/gmail.readonly",
			"https://www.googleapis.com/auth/calendar.events.readonly",
			"https://www.googleapis.com/auth/gmail.send",
		},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ReportSourceSyncProgress(f.ctx, f.user, SourceSyncProgressInput{
		Source: "google", SourceAccountID: "pilot-google", Completed: 1, Total: 1, Done: true, OccurredAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	sent, err := f.svc.Execute(f.ctx, f.user, action.ID)
	if err != nil || sent.ExecutionStatus != ExecSent || f.exec.calls != 1 {
		t.Fatalf("signed, scoped governed action did not execute once: action=%+v writes=%d err=%v", sent, f.exec.calls, err)
	}
}

func TestActionReadinessRequiresAssignedActorsProviderConnection(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 8, 1, 17, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	rel := f.relationship(t)
	action, err := f.svc.CreateAction(f.ctx, f.user, ActionInput{
		RelationshipID: rel.ID, ActionType: "warm_follow_up", Channel: "email",
		Reason: "Actor-bound provider readiness.", RecipientEmail: "buyer@example.com",
		ProposedSubject: "Follow up", ProposedMessage: "Hello", ExecutionMode: ExecModeSend,
	})
	if err != nil {
		t.Fatal(err)
	}
	admin := newUser(t, f.client, "provider-admin@x.co", "user_provider_admin")
	if _, err := f.svc.UpsertWorkspaceMember(f.ctx, f.user, admin.ID, "admin"); err != nil {
		t.Fatal(err)
	}
	adminCtx := auth.WithUser(f.ctx, admin)
	scopes := []string{
		"https://www.googleapis.com/auth/gmail.readonly",
		"https://www.googleapis.com/auth/calendar.events.readonly",
		"https://www.googleapis.com/auth/gmail.send",
	}
	if _, err := f.svc.ReportSourceAuthorization(adminCtx, admin, "google", SourceAuthorizationInput{
		SourceAccountID: "admin@example.com", State: "completed", GrantedScopes: scopes,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ReportSourceSyncProgress(adminCtx, admin, SourceSyncProgressInput{
		Source: "google", SourceAccountID: "admin@example.com", Completed: 1, Total: 1, Done: true, OccurredAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.svc.requireBetaActionProviderReady(f.ctx, ws, action); !errors.Is(err, ErrSourceIncomplete) {
		t.Fatalf("another member's provider connection authorized the owner's action: %v", err)
	}
	if _, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "google", SourceAuthorizationInput{
		SourceAccountID: "owner@example.com", State: "completed", GrantedScopes: scopes,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ReportSourceSyncProgress(f.ctx, f.user, SourceSyncProgressInput{
		Source: "google", SourceAccountID: "owner@example.com", Completed: 1, Total: 1, Done: true, OccurredAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.requireBetaActionProviderReady(f.ctx, ws, action); err != nil {
		t.Fatalf("assigned actor's live scoped connection was rejected: %v", err)
	}
}
