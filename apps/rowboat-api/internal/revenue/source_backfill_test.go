package revenue

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipobservation"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"go.uber.org/zap"
)

type fixtureSourceBackfiller struct {
	mu    sync.Mutex
	calls int
	err   error
	actor string
}

type blockingSourceBackfiller struct {
	mu      sync.Mutex
	calls   int
	entered chan struct{}
	release chan struct{}
}

func (f *blockingSourceBackfiller) Backfill(
	ctx context.Context,
	_ *ent.User,
	_ string,
	_ func(SourceBackfillBatch) error,
) error {
	f.mu.Lock()
	f.calls++
	if f.calls == 1 {
		close(f.entered)
	}
	f.mu.Unlock()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-f.release:
		return nil
	}
}

func (f *blockingSourceBackfiller) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func (f *fixtureSourceBackfiller) Backfill(
	_ context.Context,
	u *ent.User,
	accountID string,
	emit func(SourceBackfillBatch) error,
) error {
	f.mu.Lock()
	f.calls++
	f.actor = u.ID.String()
	f.mu.Unlock()
	if f.err != nil {
		return f.err
	}
	return emit(SourceBackfillBatch{
		Observations: []RelationshipObservationInput{{
			DisplayName: "Acme", AccountDomain: "acme.example",
			ResourceRefs: []string{"hubspot:company:company-1"},
			Source:       "hubspot", SourceAccountID: accountID,
			ExternalID: "company-1", SourceVersion: "2026-08-01T12:00:00Z",
			EventType:  "company.snapshot",
			OccurredAt: time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC),
		}},
		Completed: 1, Total: 1, Watermark: "opaque-company-watermark",
	})
}

func (f *fixtureSourceBackfiller) actorID() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.actor
}

func (f *fixtureSourceBackfiller) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func TestSourceBackfillRunnerConsumesDurableQueueAndReplaysIdempotently(t *testing.T) {
	f := newFixture(t)
	base := time.Date(2026, 8, 1, 12, 1, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return base }
	if _, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "hubspot", SourceAuthorizationInput{
		SourceAccountID: "portal-1", State: "completed",
		GrantedScopes: []string{
			"crm.objects.companies.read", "crm.objects.contacts.read", "crm.objects.deals.read",
		},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.BeginSourceBackfill(f.ctx, f.user, "hubspot", "portal-1"); err != nil {
		t.Fatal(err)
	}

	provider := &fixtureSourceBackfiller{}
	runner := NewSourceBackfillRunner(f.svc, map[string]SourceBackfillProvider{
		"hubspot": provider,
	}, time.Second, 10, zap.NewNop())
	runner.sweep(f.ctx)

	statuses, err := f.svc.RelationshipSourceStatuses(f.ctx, f.user)
	if err != nil || len(statuses) != 1 {
		t.Fatalf("statuses: %#v err=%v", statuses, err)
	}
	status := statuses[0]
	if status.Status != "live" || status.BackfillPhase != "live" || status.Completeness != "complete" || status.BackfillCompleted != 1 || status.BackfillTotal != 1 {
		t.Fatalf("backfill did not complete truthfully: %#v", status)
	}
	if provider.callCount() != 1 {
		t.Fatalf("provider calls=%d want=1", provider.callCount())
	}
	if count := f.client.RelationshipObservation.Query().Where(
		relationshipobservation.SourceEQ("hubspot"),
		relationshipobservation.ExternalIDEQ("company-1"),
	).CountX(f.ctx); count != 1 {
		t.Fatalf("observations=%d want=1", count)
	}

	// A process restart sees no queued work. An explicit resync may replay the
	// same provider version, but ingestion and projection remain append-only and
	// idempotent while lifecycle progress still returns to live.
	runner.sweep(f.ctx)
	if provider.callCount() != 1 {
		t.Fatalf("completed row was claimed again: calls=%d", provider.callCount())
	}
	if _, err := f.svc.BeginSourceBackfill(f.ctx, f.user, "hubspot", "portal-1"); err != nil {
		t.Fatal(err)
	}
	runner.sweep(f.ctx)
	if provider.callCount() != 2 {
		t.Fatalf("explicit resync was not consumed: calls=%d", provider.callCount())
	}
	if count := f.client.RelationshipObservation.Query().Where(
		relationshipobservation.SourceEQ("hubspot"),
		relationshipobservation.ExternalIDEQ("company-1"),
	).CountX(f.ctx); count != 1 {
		t.Fatalf("provider replay duplicated observation history: %d", count)
	}
}

func TestSourceBackfillStaleReclaimHasSingleWinner(t *testing.T) {
	f := newFixture(t)
	base := time.Date(2026, 8, 2, 11, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return base }
	if _, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "hubspot", SourceAuthorizationInput{
		SourceAccountID: "portal-stale", State: "completed",
		GrantedScopes: []string{
			"crm.objects.companies.read", "crm.objects.contacts.read", "crm.objects.deals.read",
		},
	}); err != nil {
		t.Fatal(err)
	}
	queued, err := f.svc.BeginSourceBackfill(f.ctx, f.user, "hubspot", "portal-stale")
	if err != nil {
		t.Fatal(err)
	}
	queued.Update().
		SetBackfillPhase("running").
		SetSyncStartedAt(base.Add(-3 * sourceBackfillTimeout)).
		SaveX(f.ctx)

	provider := &blockingSourceBackfiller{entered: make(chan struct{}), release: make(chan struct{})}
	runnerA := NewSourceBackfillRunner(f.svc, map[string]SourceBackfillProvider{"hubspot": provider}, time.Second, 10, zap.NewNop())
	runnerB := NewSourceBackfillRunner(f.svc, map[string]SourceBackfillProvider{"hubspot": provider}, time.Second, 10, zap.NewNop())
	done := make(chan struct{}, 2)
	start := make(chan struct{})
	for _, runner := range []*SourceBackfillRunner{runnerA, runnerB} {
		go func(runner *SourceBackfillRunner) {
			<-start
			runner.sweep(context.Background())
			done <- struct{}{}
		}(runner)
	}
	close(start)
	select {
	case <-provider.entered:
	case <-time.After(2 * time.Second):
		t.Fatal("stale backfill was not reclaimed")
	}
	time.Sleep(50 * time.Millisecond)
	if calls := provider.callCount(); calls != 1 {
		t.Fatalf("stale running row was claimed by %d replicas, want 1", calls)
	}
	close(provider.release)
	<-done
	<-done
}

func TestSourceBackfillRunnerFailsClosedWithCategoricalRetry(t *testing.T) {
	f := newFixture(t)
	base := time.Date(2026, 8, 1, 12, 1, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return base }
	if _, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "slack", SourceAuthorizationInput{
		SourceAccountID: "T-PILOT", State: "completed",
		GrantedScopes: []string{"channels:history", "channels:read", "users:read"},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.BeginSourceBackfill(f.ctx, f.user, "slack", "T-PILOT"); err != nil {
		t.Fatal(err)
	}
	provider := &fixtureSourceBackfiller{err: context.DeadlineExceeded}
	NewSourceBackfillRunner(f.svc, map[string]SourceBackfillProvider{
		"slack": provider,
	}, time.Second, 10, zap.NewNop()).sweep(f.ctx)

	statuses, err := f.svc.RelationshipSourceStatuses(f.ctx, f.user)
	if err != nil || len(statuses) != 1 {
		t.Fatalf("statuses: %#v err=%v", statuses, err)
	}
	status := statuses[0]
	if status.Status != "degraded" || status.BackfillPhase != "failed" || status.ErrorCode != "provider_outage" || status.NextRetryAt == nil {
		t.Fatalf("failed provider work did not remain repairable: %#v", status)
	}
}

func TestSourceBackfillRunnerUsesLatestConsentingActor(t *testing.T) {
	f := newFixture(t)
	if _, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "hubspot", SourceAuthorizationInput{
		SourceAccountID: "portal-1", State: "completed",
		GrantedScopes: []string{
			"crm.objects.companies.read", "crm.objects.contacts.read", "crm.objects.deals.read",
		},
	}); err != nil {
		t.Fatal(err)
	}
	admin := newUser(t, f.client, "connector-admin@x.co", "user_connector_admin")
	if _, err := f.svc.UpsertWorkspaceMember(f.ctx, f.user, admin.ID, "admin"); err != nil {
		t.Fatal(err)
	}
	adminCtx := auth.WithUser(context.Background(), admin)
	if _, err := f.svc.ReportSourceAuthorization(adminCtx, admin, "hubspot", SourceAuthorizationInput{
		SourceAccountID: "portal-1", State: "completed",
		GrantedScopes: []string{
			"crm.objects.companies.read", "crm.objects.contacts.read", "crm.objects.deals.read",
		},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.BeginSourceBackfill(adminCtx, admin, "hubspot", "portal-1"); err != nil {
		t.Fatal(err)
	}

	provider := &fixtureSourceBackfiller{}
	NewSourceBackfillRunner(f.svc, map[string]SourceBackfillProvider{
		"hubspot": provider,
	}, time.Second, 10, zap.NewNop()).sweep(context.Background())
	if provider.actorID() != admin.ID.String() {
		t.Fatalf("provider used stale connector owner %q; want latest consenting actor %q", provider.actorID(), admin.ID)
	}
}

func TestSourceBackfillRunnerRevokesQueueWhenConsentingActorIsRemoved(t *testing.T) {
	f := newFixture(t)
	admin := newUser(t, f.client, "removed-connector-admin@x.co", "user_removed_connector_admin")
	membership, err := f.svc.UpsertWorkspaceMember(f.ctx, f.user, admin.ID, "admin")
	if err != nil {
		t.Fatal(err)
	}
	adminCtx := auth.WithUser(context.Background(), admin)
	if _, err := f.svc.ReportSourceAuthorization(adminCtx, admin, "hubspot", SourceAuthorizationInput{
		SourceAccountID: "portal-removed", State: "completed",
		GrantedScopes: []string{
			"crm.objects.companies.read", "crm.objects.contacts.read", "crm.objects.deals.read",
		},
	}); err != nil {
		t.Fatal(err)
	}
	queued, err := f.svc.BeginSourceBackfill(adminCtx, admin, "hubspot", "portal-removed")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.RemoveWorkspaceMember(f.ctx, f.user, membership.ID); err != nil {
		t.Fatal(err)
	}

	provider := &fixtureSourceBackfiller{}
	NewSourceBackfillRunner(f.svc, map[string]SourceBackfillProvider{
		"hubspot": provider,
	}, time.Second, 10, zap.NewNop()).sweep(context.Background())
	if provider.callCount() != 0 {
		t.Fatalf("provider was called with a removed actor: calls=%d", provider.callCount())
	}
	status := f.client.RelationshipSourceStatus.GetX(f.ctx, queued.ID)
	if status.Status != "reconnect_required" || status.ErrorCode != "revoked_credential" ||
		status.RevokedAt == nil || status.NextRetryAt != nil {
		t.Fatalf("removed actor did not revoke the durable queue: %#v", status)
	}
}

func TestSourceBackfillFallbackCannotOverwriteOperatorDisconnect(t *testing.T) {
	f := newFixture(t)
	if _, err := f.svc.ReportSourceAuthorization(f.ctx, f.user, "slack", SourceAuthorizationInput{
		SourceAccountID: "T-PILOT", State: "completed",
		GrantedScopes: []string{"channels:history", "channels:read", "users:read"},
	}); err != nil {
		t.Fatal(err)
	}
	status, err := f.svc.BeginSourceBackfill(f.ctx, f.user, "slack", "T-PILOT")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.MarkSourceDisconnected(f.ctx, f.user, "slack", "T-PILOT"); err != nil {
		t.Fatal(err)
	}
	runner := NewSourceBackfillRunner(f.svc, nil, time.Second, 10, zap.NewNop())
	runner.fail(context.Background(), status, nil, "provider_outage", context.DeadlineExceeded)

	got := f.client.RelationshipSourceStatus.GetX(f.ctx, status.ID)
	if got.Status != "disconnected" || got.DisconnectedAt == nil || got.ErrorCode != "" {
		t.Fatalf("fallback failure overwrote sticky disconnect: %#v", got)
	}
}
