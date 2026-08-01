package revenue

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipassertion"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipprojectionjob"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipstatesnapshot"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
)

func timePointer(value time.Time) *time.Time { return &value }

func TestRelationshipProjectionUsesExplicitEvaluationTimeAndStableHash(t *testing.T) {
	f := newFixture(t)
	base := time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC)
	evaluatedAt := base.Add(30 * time.Minute)
	f.svc.now = func() time.Time { return evaluatedAt }

	results, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		DisplayName:   "Temporal Account",
		AccountDomain: "temporal.example",
		Source:        "hubspot",
		ExternalID:    "company-temporal",
		EventType:     "company.updated",
		OccurredAt:    base,
		ReceivedAt:    base,
		Assertions: []RelationshipAssertionInput{
			{
				Dimension:  "health",
				Value:      "healthy",
				SourceType: "source_fact",
				Confidence: 1,
				Reason:     "The durable source baseline is healthy.",
				ValidFrom:  base.Add(-time.Hour),
			},
			{
				Dimension:  "health",
				Value:      "critical",
				SourceType: "source_fact",
				Confidence: 1,
				Reason:     "A temporary escalation is active.",
				ValidFrom:  base,
				ValidTo:    timePointer(base.Add(time.Hour)),
			},
			{
				Dimension:  "health",
				Value:      "needs_attention",
				SourceType: "source_fact",
				Confidence: 1,
				Reason:     "A scheduled review becomes valid later.",
				ValidFrom:  base.Add(3 * time.Hour),
			},
		},
	}})
	if err != nil {
		t.Fatalf("ingest temporal assertions: %v", err)
	}
	rel, err := f.svc.GetRelationship(f.ctx, results[0].Relationship.ID)
	if err != nil {
		t.Fatalf("get projected relationship: %v", err)
	}
	if rel.Health != "critical" || rel.StateVersion != 1 {
		t.Fatalf("evaluation should select the active temporary assertion: %#v", rel)
	}
	if rel.StateHash == "" || rel.ProjectorVersion != relationshipProjectorVersion ||
		rel.ProjectedAt == nil || !rel.ProjectedAt.Equal(evaluatedAt) {
		t.Fatalf("projection metadata missing: %#v", rel)
	}
	firstHash := rel.StateHash

	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatalf("workspace: %v", err)
	}
	afterExpiry := base.Add(2 * time.Hour)
	rel, err = projectRelationshipStateAt(f.ctx, f.client, ws, f.user, rel, afterExpiry)
	if err != nil {
		t.Fatalf("project after expiry: %v", err)
	}
	if rel.Health != "healthy" || rel.StateVersion != 2 || rel.StateHash == firstHash {
		t.Fatalf("expired assertion should reveal the prior active fact: %#v", rel)
	}
	afterExpiryHash := rel.StateHash

	replayed, err := projectRelationshipStateAt(f.ctx, f.client, ws, f.user, rel, afterExpiry)
	if err != nil {
		t.Fatalf("replay projection: %v", err)
	}
	if replayed.StateVersion != rel.StateVersion || replayed.StateHash != afterExpiryHash {
		t.Fatalf("same versioned inputs must replay identically: before=%#v after=%#v", rel, replayed)
	}

	afterFuture := base.Add(4 * time.Hour)
	replayed, err = projectRelationshipStateAt(f.ctx, f.client, ws, f.user, replayed, afterFuture)
	if err != nil {
		t.Fatalf("project future assertion: %v", err)
	}
	if replayed.Health != "needs_attention" || replayed.StateVersion != 3 {
		t.Fatalf("future assertion should apply only at its evaluation boundary: %#v", replayed)
	}

	snapshots, err := f.client.RelationshipStateSnapshot.Query().
		Order(ent.Asc(relationshipstatesnapshot.FieldVersion)).
		All(f.ctx)
	if err != nil {
		t.Fatalf("query snapshots: %v", err)
	}
	if len(snapshots) != 3 {
		t.Fatalf("idempotent replay must not create a snapshot: got %d", len(snapshots))
	}
	for _, snapshot := range snapshots {
		if snapshot.StateHash == "" || snapshot.ProjectorVersion != relationshipProjectorVersion || snapshot.EvaluatedAt.IsZero() {
			t.Fatalf("snapshot is missing deterministic metadata: %#v", snapshot)
		}
	}
}

func TestRelationshipCorrectionRetractionRestoresSourceFact(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 7, 31, 15, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	results, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		DisplayName:   "Retraction Account",
		AccountDomain: "retraction.example",
		Source:        "hubspot",
		ExternalID:    "company-retraction",
		EventType:     "company.updated",
		OccurredAt:    now,
		ReceivedAt:    now,
		Assertions: []RelationshipAssertionInput{{
			Dimension:  "health",
			Value:      "needs_attention",
			SourceType: "source_fact",
			Confidence: 1,
			Reason:     "The source reports an unresolved blocker.",
			ValidFrom:  now,
		}},
	}})
	if err != nil {
		t.Fatalf("ingest source fact: %v", err)
	}
	relID := results[0].Relationship.ID
	corrected, err := f.svc.CorrectRelationship(f.ctx, f.user, relID, RelationshipCorrectionInput{
		Dimension: "health",
		Value:     "healthy",
		Reason:    "The user verified the blocker is resolved.",
	})
	if err != nil {
		t.Fatalf("correct relationship: %v", err)
	}
	if corrected.Health != "healthy" {
		t.Fatalf("user correction should win: %#v", corrected)
	}
	correction, err := f.client.RelationshipAssertion.Query().
		Where(relationshipassertion.SourceTypeEQ("user_correction")).
		Only(f.ctx)
	if err != nil {
		t.Fatalf("query correction: %v", err)
	}

	retracted, err := f.svc.RetractRelationshipAssertion(
		f.ctx, f.user, relID, correction.ID, "The correction was entered against the wrong call.",
	)
	if err != nil {
		t.Fatalf("retract correction: %v", err)
	}
	if retracted.Health != "needs_attention" || retracted.StateVersion != corrected.StateVersion+1 {
		t.Fatalf("retraction should restore the active source fact: %#v", retracted)
	}
	stored, err := f.client.RelationshipAssertion.Get(f.ctx, correction.ID)
	if err != nil {
		t.Fatalf("reload retracted assertion: %v", err)
	}
	if stored.Status != "retracted" || stored.RetractedAt == nil || stored.ValidTo == nil || stored.RetractionReason == "" {
		t.Fatalf("retraction audit metadata missing: %#v", stored)
	}

	idempotent, err := f.svc.RetractRelationshipAssertion(
		f.ctx, f.user, relID, correction.ID, "Repeated client delivery.",
	)
	if err != nil {
		t.Fatalf("idempotent retraction: %v", err)
	}
	if idempotent.StateVersion != retracted.StateVersion {
		t.Fatalf("idempotent retraction changed state version: %d != %d", idempotent.StateVersion, retracted.StateVersion)
	}
}

func TestRelationshipCorrectionRejectsCrossDimensionSupersession(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 7, 31, 17, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	results, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		DisplayName:   "Supersession Account",
		AccountDomain: "supersession.example",
		Source:        "hubspot",
		ExternalID:    "company-supersession",
		EventType:     "company.updated",
		OccurredAt:    now,
		ReceivedAt:    now,
		Assertions: []RelationshipAssertionInput{{
			Dimension:  "lifecycle",
			Value:      "onboarding",
			SourceType: "source_fact",
			Confidence: 1,
			ValidFrom:  now,
		}},
	}})
	if err != nil {
		t.Fatalf("ingest assertion: %v", err)
	}
	assertion, err := f.client.RelationshipAssertion.Query().Only(f.ctx)
	if err != nil {
		t.Fatalf("query source assertion: %v", err)
	}
	_, err = f.svc.CorrectRelationship(f.ctx, f.user, results[0].Relationship.ID, RelationshipCorrectionInput{
		Dimension:             "health",
		Value:                 "healthy",
		Reason:                "Invalid cross-dimension replacement.",
		SupersedesAssertionID: assertion.ID.String(),
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("cross-dimension supersession should fail closed, got %v", err)
	}
	count, err := f.client.RelationshipAssertion.Query().
		Where(relationshipassertion.SourceTypeEQ("user_correction")).
		Count(f.ctx)
	if err != nil || count != 0 {
		t.Fatalf("invalid supersession must roll back: count=%d err=%v", count, err)
	}
}

func TestProjectionFailurePreservesAcceptedEvidenceAndDeadLetters(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 7, 31, 18, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	results, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		DisplayName: "Forward Projector Account", AccountDomain: "forward-projector.example",
		Source: "hubspot", ExternalID: "forward-projector", EventType: "company.updated",
		OccurredAt: now, ReceivedAt: now,
		Assertions: []RelationshipAssertionInput{{
			Dimension: "health", Value: "healthy", SourceType: "source_fact",
			Confidence: 1, Reason: "Requires a future projector.", ValidFrom: now,
			ProjectorCompatVersion: relationshipProjectorVersion + 1,
		}},
	}})
	if err != nil {
		t.Fatalf("ingest must preserve evidence when projection fails: %v", err)
	}
	if results[0].ProjectionStatus != "failed" || results[0].ProjectionJobID == [16]byte{} {
		t.Fatalf("projection failure must be explicit: %#v", results[0])
	}
	if _, err := f.client.RelationshipObservation.Get(f.ctx, results[0].Observation.ID); err != nil {
		t.Fatalf("accepted observation was rolled back: %v", err)
	}

	job, err := f.client.RelationshipProjectionJob.Get(f.ctx, results[0].ProjectionJobID)
	if err != nil || job.Attempts != 1 || job.Status != "failed" {
		t.Fatalf("first retry state: job=%#v err=%v", job, err)
	}
	for attempt := 2; attempt <= maxRelationshipProjectionAttempts; attempt++ {
		job, err = job.Update().SetNextAttemptAt(now.Add(-time.Second)).Save(f.ctx)
		if err != nil {
			t.Fatalf("make retry due: %v", err)
		}
		_, _, _ = f.svc.ProcessRelationshipProjectionJob(f.ctx, f.user, job.ID, "failure-test-worker")
		job, err = f.client.RelationshipProjectionJob.Get(f.ctx, job.ID)
		if err != nil {
			t.Fatalf("reload retry: %v", err)
		}
	}
	if job.Status != "dead" || job.Attempts != maxRelationshipProjectionAttempts || job.LastError == "" {
		t.Fatalf("bounded retries must dead-letter with diagnostics: %#v", job)
	}
	assertion, err := f.client.RelationshipAssertion.Query().
		Where(relationshipassertion.ProjectorCompatVersionEQ(relationshipProjectorVersion + 1)).
		Only(f.ctx)
	if err != nil {
		t.Fatalf("load forward assertion: %v", err)
	}
	if _, err := assertion.Update().SetProjectorCompatVersion(relationshipProjectorVersion).Save(f.ctx); err != nil {
		t.Fatalf("simulate projector upgrade: %v", err)
	}
	repaired, replacementID, status, err := f.svc.RepairRelationshipProjectionJob(
		f.ctx, f.user, job.ID, "projector compatibility deployed",
	)
	if err != nil || status != "completed" || replacementID == [16]byte{} || repaired.Health != "healthy" {
		t.Fatalf("operator repair: rel=%#v replacement=%s status=%s err=%v", repaired, replacementID, status, err)
	}
	original, err := f.client.RelationshipProjectionJob.Get(f.ctx, job.ID)
	if err != nil || original.Status != "dead" {
		t.Fatalf("repair must preserve failed audit row: %#v err=%v", original, err)
	}
}

func TestProjectionLeaseRecoveryAndConcurrentWorkersPublishOnce(t *testing.T) {
	f := newFixture(t)
	base := time.Date(2026, 7, 31, 19, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return base }
	boundary := base.Add(time.Hour)
	results, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		DisplayName: "Leased Account", AccountDomain: "leased.example",
		Source: "hubspot", ExternalID: "leased", EventType: "company.updated",
		OccurredAt: base, ReceivedAt: base,
		Assertions: []RelationshipAssertionInput{{
			Dimension: "health", Value: "healthy", SourceType: "source_fact",
			Confidence: 1, Reason: "Scheduled state.", ValidFrom: boundary,
		}},
	}})
	if err != nil {
		t.Fatalf("ingest: %v", err)
	}
	boundaryJob, err := f.client.RelationshipProjectionJob.Query().
		Where(
			relationshipprojectionjob.StatusEQ("pending"),
			relationshipprojectionjob.EvaluatedAtEQ(boundary),
		).
		Only(f.ctx)
	if err != nil {
		t.Fatalf("scheduled boundary job: %v", err)
	}
	_, err = boundaryJob.Update().
		SetStatus("running").
		SetLeaseOwner("crashed-worker").
		SetLeaseExpiresAt(boundary.Add(-time.Minute)).
		Save(f.ctx)
	if err != nil {
		t.Fatalf("seed expired lease: %v", err)
	}
	f.svc.now = func() time.Time { return boundary }

	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for _, worker := range []string{"worker-a", "worker-b"} {
		wg.Add(1)
		go func(worker string) {
			defer wg.Done()
			_, _, processErr := f.svc.ProcessRelationshipProjectionJob(f.ctx, f.user, boundaryJob.ID, worker)
			errs <- processErr
		}(worker)
	}
	wg.Wait()
	close(errs)
	successes := 0
	for processErr := range errs {
		if processErr == nil {
			successes++
		} else if !errors.Is(processErr, ErrConflict) {
			t.Fatalf("unexpected concurrent worker error: %v", processErr)
		}
	}
	if successes != 1 {
		t.Fatalf("exactly one worker must publish, got %d", successes)
	}
	job, err := f.client.RelationshipProjectionJob.Get(f.ctx, boundaryJob.ID)
	if err != nil || job.Status != "completed" || job.Attempts != 1 {
		t.Fatalf("reclaimed job: %#v err=%v", job, err)
	}
	rel, err := f.svc.GetRelationship(f.ctx, results[0].Relationship.ID)
	if err != nil || rel.Health != "healthy" {
		t.Fatalf("boundary projection missing: rel=%#v err=%v", rel, err)
	}
	snapshotCount, err := f.client.RelationshipStateSnapshot.Query().Count(f.ctx)
	if err != nil || snapshotCount != 1 {
		t.Fatalf("concurrent redelivery published duplicate snapshot: count=%d err=%v", snapshotCount, err)
	}
}

func TestProjectionReplayAndRepairAreDurable(t *testing.T) {
	f := newFixture(t)
	now := time.Date(2026, 7, 31, 20, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	results, err := f.svc.IngestRelationshipObservations(f.ctx, f.user, []RelationshipObservationInput{{
		DisplayName: "Replay Account", AccountDomain: "replay.example",
		Source: "hubspot", ExternalID: "replay", EventType: "company.updated",
		OccurredAt: now, ReceivedAt: now,
		Assertions: []RelationshipAssertionInput{{
			Dimension: "health", Value: "healthy", SourceType: "source_fact",
			Confidence: 1, Reason: "Replay fixture.", ValidFrom: now,
		}},
	}})
	if err != nil {
		t.Fatalf("ingest: %v", err)
	}
	relationshipID := results[0].Relationship.ID
	processed, err := f.svc.ReplayRelationshipProjections(
		f.ctx, f.user, &relationshipID, now, "replay-test",
	)
	if err != nil || processed != 1 {
		t.Fatalf("operator replay: processed=%d err=%v", processed, err)
	}
	snapshotCount, err := f.client.RelationshipStateSnapshot.Query().Count(f.ctx)
	if err != nil || snapshotCount != 1 {
		t.Fatalf("same-boundary replay must be idempotent: count=%d err=%v", snapshotCount, err)
	}
}

func TestProjectionRunnerUsesWorkspaceOwnerAfterContributingMemberIsRemoved(t *testing.T) {
	f := newFixture(t)
	base := time.Date(2026, 7, 31, 21, 0, 0, 0, time.UTC)
	boundary := base.Add(time.Hour)
	f.svc.now = func() time.Time { return base }
	member := newUser(t, f.client, "projection-member@x.co", "user_projection_member")
	membership, err := f.svc.UpsertWorkspaceMember(f.ctx, f.user, member.ID, "member")
	if err != nil {
		t.Fatal(err)
	}
	memberCtx := auth.WithUser(context.Background(), member)
	results, err := f.svc.IngestRelationshipObservations(memberCtx, member, []RelationshipObservationInput{{
		DisplayName: "Member Projection Account", AccountDomain: "member-projection.example",
		Source: "hubspot", ExternalID: "member-projection", EventType: "company.updated",
		OccurredAt: base, ReceivedAt: base,
		Assertions: []RelationshipAssertionInput{{
			Dimension: "health", Value: "healthy", SourceType: "source_fact",
			Confidence: 1, Reason: "Scheduled member-contributed state.", ValidFrom: boundary,
		}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	job, err := f.client.RelationshipProjectionJob.Query().Where(
		relationshipprojectionjob.StatusEQ("pending"),
		relationshipprojectionjob.EvaluatedAtEQ(boundary),
	).Only(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.RemoveWorkspaceMember(f.ctx, f.user, membership.ID); err != nil {
		t.Fatal(err)
	}

	f.svc.now = func() time.Time { return boundary }
	NewRelationshipProjectionRunner(f.svc, time.Second, 10, "owner-sweep", nil).sweep(context.Background())
	completed, err := f.client.RelationshipProjectionJob.Get(f.ctx, job.ID)
	if err != nil || completed.Status != "completed" {
		t.Fatalf("workspace-owned job was stranded after contributor removal: job=%+v err=%v", completed, err)
	}
	rel, err := f.svc.GetRelationship(f.ctx, results[0].Relationship.ID)
	if err != nil || rel.Health != "healthy" {
		t.Fatalf("workspace owner did not publish scheduled projection: rel=%+v err=%v", rel, err)
	}
}
