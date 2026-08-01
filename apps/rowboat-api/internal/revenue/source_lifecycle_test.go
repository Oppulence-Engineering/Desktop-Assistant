package revenue

import (
	"errors"
	"slices"
	"testing"
	"time"
)

func TestSourceAuthorizationRecordsConsentWithoutRequiringFutureWriteScopes(t *testing.T) {
	f := newFixture(t)
	base := time.Date(2026, 8, 1, 9, 30, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return base }

	started, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "gmail", SourceAuthorizationInput{
		SourceAccountID: "owner@example.com", State: "started",
	})
	if err != nil {
		t.Fatalf("start authorization: %v", err)
	}
	if started.Source != "google" || started.Status != "authorizing" || started.AuthorizationStartedAt == nil || started.ConsentingActorID == nil || *started.ConsentingActorID != f.user.ID {
		t.Fatalf("authorization start is not attributable: %#v", started)
	}
	if slices.Contains(started.RequiredScopes, "https://www.googleapis.com/auth/gmail.send") {
		t.Fatalf("progressive write scope was made a connection requirement: %#v", started.RequiredScopes)
	}

	f.svc.now = func() time.Time { return base.Add(time.Minute) }
	completed, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "google", SourceAuthorizationInput{
		SourceAccountID: "owner@example.com", State: "completed",
		GrantedScopes: []string{
			"https://www.googleapis.com/auth/calendar.events.readonly",
			"https://www.googleapis.com/auth/gmail.readonly",
			"https://www.googleapis.com/auth/gmail.readonly",
		},
	})
	if err != nil {
		t.Fatalf("complete authorization: %v", err)
	}
	if completed.Status != "connected" || completed.AuthorizedAt == nil || len(completed.MissingScopes) != 0 {
		t.Fatalf("completed authorization is not truthful: %#v", completed)
	}
	if completed.Completeness != "partial" {
		t.Fatalf("authorization must remain partial until backfill: %#v", completed)
	}
}

func TestSourceAuthorizationCancellationAndFailureAreExplicit(t *testing.T) {
	f := newFixture(t)
	canceled, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "slack", SourceAuthorizationInput{State: "canceled"})
	if err != nil || canceled.Status != "not_connected" || canceled.ErrorCode != "authorization_canceled" {
		t.Fatalf("canceled authorization: %#v err=%v", canceled, err)
	}
	failed, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "slack", SourceAuthorizationInput{State: "failed", ErrorCode: "invalid_grant"})
	if err != nil || failed.Status != "reconnect_required" || failed.ErrorCode != "invalid_grant" || failed.LastFailedSyncAt == nil {
		t.Fatalf("failed authorization: %#v err=%v", failed, err)
	}
}

func TestSourceAuthorizationPromotesPendingDefaultToExactProviderAccount(t *testing.T) {
	f := newFixture(t)
	if _, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "slack", SourceAuthorizationInput{State: "started"}); err != nil {
		t.Fatal(err)
	}
	completed, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "slack", SourceAuthorizationInput{
		State: "completed", SourceAccountID: "T-PILOT",
		GrantedScopes: []string{"channels:history", "channels:read", "users:read"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if completed.SourceAccountID != "T-PILOT" {
		t.Fatalf("pending consent was not promoted to exact provider account: %#v", completed)
	}
	statuses, err := f.svc.RelationshipSourceStatuses(f.ctx, f.user)
	if err != nil || len(statuses) != 1 {
		t.Fatalf("consent promotion created duplicate lifecycle cards: %#v err=%v", statuses, err)
	}
}

func TestSourceLifecycleProgressFreshnessRepairAndDisconnect(t *testing.T) {
	f := newFixture(t)
	base := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return base }
	if _, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "hubspot", SourceAuthorizationInput{
		SourceAccountID: "portal-1", State: "completed",
		GrantedScopes: []string{
			"crm.objects.companies.read", "crm.objects.contacts.read", "crm.objects.deals.read",
		},
	}); err != nil {
		t.Fatalf("authorize source: %v", err)
	}
	queued, err := f.svc.BeginSourceBackfill(f.ctx, f.user, "hubspot", "portal-1")
	if err != nil {
		t.Fatalf("begin backfill: %v", err)
	}
	if queued.Status != "backfilling" || queued.BackfillPhase != "queued" || queued.Completeness != "rebuilding" {
		t.Fatalf("queued source is not truthful: %#v", queued)
	}
	partial, err := f.svc.ReportSourceSyncProgress(f.ctx, f.user, SourceSyncProgressInput{
		Source: "hubspot", SourceAccountID: "portal-1", Completed: 25, Total: 100,
		Watermark: "cursor-25", OccurredAt: base.Add(time.Minute),
	})
	if err != nil {
		t.Fatalf("partial progress: %v", err)
	}
	if partial.BackfillPhase != "running" || partial.Completeness != "partial" || partial.BackfillCompleted != 25 {
		t.Fatalf("partial source state: %#v", partial)
	}
	live, err := f.svc.ReportSourceSyncProgress(f.ctx, f.user, SourceSyncProgressInput{
		Source: "hubspot", SourceAccountID: "portal-1", Completed: 100, Total: 100,
		Watermark: "cursor-100", Done: true, OccurredAt: base.Add(2 * time.Minute),
	})
	if err != nil || live.Status != "live" || live.BackfillPhase != "live" || live.Completeness != "complete" || live.AuthorizedAt == nil || live.BackfillCompletedAt == nil {
		t.Fatalf("live source: %#v err=%v", live, err)
	}

	f.svc.now = func() time.Time { return base.Add(2*time.Minute + 2*time.Hour) }
	statuses, err := f.svc.RelationshipSourceStatuses(f.ctx, f.user)
	if err != nil || len(statuses) != 1 || statuses[0].Status != "stale" || statuses[0].Completeness != "stale" {
		t.Fatalf("freshness boundary not projected: %#v err=%v", statuses, err)
	}

	f.svc.now = func() time.Time { return base.Add(3 * time.Hour) }
	failed, err := f.svc.MarkSourceSyncFailure(f.ctx, f.user, "hubspot", "portal-1", "missing_scope")
	if err != nil {
		t.Fatalf("mark failure: %v", err)
	}
	if failed.Status != "reconnect_required" || failed.ErrorCode != "missing_scope" || failed.NextRetryAt != nil {
		t.Fatalf("missing scope state: %#v", failed)
	}
	if _, err := f.svc.BeginSourceBackfill(f.ctx, f.user, "hubspot", "portal-1"); !errors.Is(err, ErrSourceIncomplete) {
		t.Fatalf("missing-scope source bypassed reconnect: %v", err)
	}
	if _, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "hubspot", SourceAuthorizationInput{
		SourceAccountID: "portal-1", State: "completed",
		GrantedScopes: []string{
			"crm.objects.companies.read", "crm.objects.contacts.read", "crm.objects.deals.read",
		},
	}); err != nil {
		t.Fatalf("reauthorize source: %v", err)
	}
	rebuilding, err := f.svc.BeginSourceBackfill(f.ctx, f.user, "hubspot", "portal-1")
	if err != nil || rebuilding.Status != "backfilling" || rebuilding.RetryCount != 0 {
		t.Fatalf("repair/resync: %#v err=%v", rebuilding, err)
	}
	disconnected, err := f.svc.MarkSourceDisconnected(f.ctx, f.user, "hubspot", "portal-1")
	if err != nil || disconnected.Status != "disconnected" || disconnected.Completeness != "disconnected" || disconnected.Watermark != "" || disconnected.DisconnectedAt == nil {
		t.Fatalf("disconnect: %#v err=%v", disconnected, err)
	}
	// A provider event already in flight may still be retained as evidence, but it
	// cannot silently reactivate a source the operator disconnected.
	rel := f.relationship(t)
	_, err = f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		RelationshipID: rel.ID, Source: "hubspot", SourceAccountID: "portal-1",
		ExternalID: "delayed-after-disconnect", SourceVersion: "1", EventType: "crm.activity",
		OccurredAt: base.Add(3*time.Hour + time.Minute), ReceivedAt: base.Add(3*time.Hour + time.Minute),
	}})
	if err != nil {
		t.Fatalf("retain delayed evidence: %v", err)
	}
	sticky := f.client.RelationshipSourceStatus.GetX(f.ctx, disconnected.ID)
	if sticky.Status != "disconnected" || sticky.DisconnectedAt == nil {
		t.Fatalf("delayed observation reactivated disconnected source: %#v", sticky)
	}
}

func TestSourceBackfillRequiresCompletedAuthorizationAndAllReadScopes(t *testing.T) {
	f := newFixture(t)

	if _, err := f.svc.ReportSourceSyncProgress(f.ctx, f.user, SourceSyncProgressInput{
		Source: "google", SourceAccountID: "owner@example.com", Completed: 1, Total: 1, Done: true,
	}); !errors.Is(err, ErrSourceIncomplete) {
		t.Fatalf("unconnected source reported itself live: %v", err)
	}
	if _, err := f.svc.BeginSourceBackfill(f.ctx, f.user, "google", "owner@example.com"); !errors.Is(err, ErrSourceIncomplete) {
		t.Fatalf("unconnected source began backfill: %v", err)
	}
	if _, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "google", SourceAuthorizationInput{
		SourceAccountID: "owner@example.com", State: "completed",
		GrantedScopes: []string{"https://www.googleapis.com/auth/gmail.readonly"},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.BeginSourceBackfill(f.ctx, f.user, "google", "owner@example.com"); !errors.Is(err, ErrSourceIncomplete) {
		t.Fatalf("under-scoped source began backfill: %v", err)
	}
	if _, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "google", SourceAuthorizationInput{
		SourceAccountID: "owner@example.com", State: "completed",
		GrantedScopes: []string{
			"https://www.googleapis.com/auth/gmail.readonly",
			"https://www.googleapis.com/auth/calendar.events.readonly",
		},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.BeginSourceBackfill(f.ctx, f.user, "google", "owner@example.com"); err != nil {
		t.Fatalf("fully authorized source could not begin backfill: %v", err)
	}
	if _, err := f.svc.BeginSourceBackfill(f.ctx, f.user, "google", "owner@example.com"); !errors.Is(err, ErrConflict) {
		t.Fatalf("running source accepted duplicate backfill: %v", err)
	}
}

func TestSourceRevocationCannotBeDowngradedByInflightProgressOrFailure(t *testing.T) {
	f := newFixture(t)
	if _, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "slack", SourceAuthorizationInput{
		SourceAccountID: "T-PILOT", State: "completed",
		GrantedScopes: []string{"channels:history", "channels:read", "users:read"},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.BeginSourceBackfill(f.ctx, f.user, "slack", "T-PILOT"); err != nil {
		t.Fatal(err)
	}
	revoked, err := f.svc.MarkSourceSyncFailure(f.ctx, f.user, "slack", "T-PILOT", "revoked_credential")
	if err != nil || revoked.Status != "reconnect_required" || revoked.RevokedAt == nil || revoked.NextRetryAt != nil {
		t.Fatalf("revoke source: status=%#v err=%v", revoked, err)
	}
	if _, err := f.svc.ReportSourceSyncProgress(f.ctx, f.user, SourceSyncProgressInput{
		Source: "slack", SourceAccountID: "T-PILOT", Completed: 1, Total: 1, Done: true,
	}); !errors.Is(err, ErrConflict) {
		t.Fatalf("in-flight progress revived revoked source: %v", err)
	}
	sticky, err := f.svc.MarkSourceSyncFailure(f.ctx, f.user, "slack", "T-PILOT", "provider_outage")
	if err != nil || sticky.Status != "reconnect_required" || sticky.ErrorCode != "revoked_credential" || sticky.RevokedAt == nil {
		t.Fatalf("transient failure downgraded revocation: status=%#v err=%v", sticky, err)
	}
	rel := f.relationship(t)
	if _, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		RelationshipID: rel.ID, Source: "slack", SourceAccountID: "T-PILOT",
		ExternalID: "delayed-after-revocation", SourceVersion: "1", EventType: "message.created",
		OccurredAt: time.Now().UTC(), ReceivedAt: time.Now().UTC(),
	}}); err != nil {
		t.Fatalf("retain delayed evidence after revocation: %v", err)
	}
	stillRevoked := f.client.RelationshipSourceStatus.GetX(f.ctx, revoked.ID)
	if stillRevoked.Status != "reconnect_required" || stillRevoked.RevokedAt == nil || stillRevoked.ErrorCode != "revoked_credential" {
		t.Fatalf("delayed observation reactivated revoked source: %#v", stillRevoked)
	}
}

func TestSourceInventoryExplainsScopesAndActions(t *testing.T) {
	f := newFixture(t)
	inventory, err := f.svc.RelationshipSourceInventory(f.ctx, f.user)
	if err != nil {
		t.Fatalf("inventory: %v", err)
	}
	if len(inventory) != 3 {
		t.Fatalf("want Google, Slack, HubSpot cards: %#v", inventory)
	}
	for _, item := range inventory {
		if item.DisplayName == "" || len(item.Evidence) == 0 || len(item.ReadScopes) == 0 || item.ScopeExplanation == "" || item.ConnectPath == "" || item.DisconnectPath == "" {
			t.Fatalf("incomplete guided source card: %#v", item)
		}
	}
}
