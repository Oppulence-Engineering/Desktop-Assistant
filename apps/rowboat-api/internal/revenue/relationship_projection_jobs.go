package revenue

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipprojectionjob"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/revenuemetrics"
)

const (
	maxRelationshipProjectionAttempts = 5
	relationshipProjectionLease       = 2 * time.Minute
)

var relationshipProjectionBackoff = [...]time.Duration{
	5 * time.Second,
	30 * time.Second,
	2 * time.Minute,
	10 * time.Minute,
}

func normalizeProjectionTriggerRefs(refs []string) []string {
	seen := make(map[string]struct{}, len(refs))
	out := make([]string, 0, len(refs))
	for _, ref := range refs {
		ref = strings.TrimSpace(ref)
		if ref == "" {
			continue
		}
		if _, ok := seen[ref]; ok {
			continue
		}
		seen[ref] = struct{}{}
		out = append(out, ref)
	}
	sort.Strings(out)
	return out
}

func relationshipProjectionIdempotencyKey(
	relationshipID uuid.UUID,
	evaluatedAt time.Time,
	triggerRefs []string,
) string {
	payload := fmt.Sprintf(
		"relationship-projection:v%d:%s:%s:%s",
		relationshipProjectorVersion,
		relationshipID,
		evaluatedAt.UTC().Format(time.RFC3339Nano),
		strings.Join(normalizeProjectionTriggerRefs(triggerRefs), "\x00"),
	)
	digest := sha256.Sum256([]byte(payload))
	return "relationship-projection:" + hex.EncodeToString(digest[:])
}

// enqueueRelationshipProjectionTx appends a durable projection job using the
// same Ent transaction that accepted the triggering evidence or correction.
func (s *Service) enqueueRelationshipProjectionTx(
	ctx context.Context,
	client *ent.Client,
	ws *ent.RevenueWorkspace,
	u *ent.User,
	rel *ent.Relationship,
	evaluatedAt time.Time,
	triggerRefs []string,
) (*ent.RelationshipProjectionJob, error) {
	evaluatedAt = evaluatedAt.UTC()
	triggerRefs = normalizeProjectionTriggerRefs(triggerRefs)
	key := relationshipProjectionIdempotencyKey(rel.ID, evaluatedAt, triggerRefs)
	create := client.RelationshipProjectionJob.Create().
		SetWorkspace(ws).
		SetRelationship(rel).
		SetUser(u).
		SetIdempotencyKey(key).
		SetStatus("pending").
		SetProjectorVersion(relationshipProjectorVersion).
		SetEvaluatedAt(evaluatedAt).
		SetTriggerRefs(triggerRefs)
	if evaluatedAt.After(s.now().UTC()) {
		create.SetNextAttemptAt(evaluatedAt)
	}
	job, err := create.Save(ctx)
	if err == nil {
		return job, nil
	}
	if !ent.IsConstraintError(err) {
		return nil, err
	}
	return client.RelationshipProjectionJob.Query().
		Where(relationshipprojectionjob.IdempotencyKeyEQ(key)).
		Only(ctx)
}

func dueRelationshipProjectionPredicate(now time.Time) predicateRelationshipProjectionJob {
	return func(selector *ent.RelationshipProjectionJobQuery) *ent.RelationshipProjectionJobQuery {
		return selector.Where(relationshipprojectionjob.Or(
			relationshipprojectionjob.And(
				relationshipprojectionjob.StatusIn("pending", "failed"),
				relationshipprojectionjob.Or(
					relationshipprojectionjob.NextAttemptAtIsNil(),
					relationshipprojectionjob.NextAttemptAtLTE(now),
				),
			),
			relationshipprojectionjob.And(
				relationshipprojectionjob.StatusEQ("running"),
				relationshipprojectionjob.LeaseExpiresAtNotNil(),
				relationshipprojectionjob.LeaseExpiresAtLTE(now),
			),
		))
	}
}

type predicateRelationshipProjectionJob func(*ent.RelationshipProjectionJobQuery) *ent.RelationshipProjectionJobQuery

func claimRelationshipProjectionJob(
	ctx context.Context,
	client *ent.Client,
	jobID uuid.UUID,
	workerID string,
	now time.Time,
) (*ent.RelationshipProjectionJob, error) {
	workerID = strings.TrimSpace(workerID)
	if workerID == "" {
		return nil, fmt.Errorf("%w: projection worker id is required", ErrInvalidInput)
	}
	due := relationshipprojectionjob.Or(
		relationshipprojectionjob.And(
			relationshipprojectionjob.StatusIn("pending", "failed"),
			relationshipprojectionjob.Or(
				relationshipprojectionjob.NextAttemptAtIsNil(),
				relationshipprojectionjob.NextAttemptAtLTE(now),
			),
		),
		relationshipprojectionjob.And(
			relationshipprojectionjob.StatusEQ("running"),
			relationshipprojectionjob.LeaseExpiresAtNotNil(),
			relationshipprojectionjob.LeaseExpiresAtLTE(now),
		),
	)
	updated, err := client.RelationshipProjectionJob.Update().
		Where(relationshipprojectionjob.IDEQ(jobID), due).
		SetStatus("running").
		SetLeaseOwner(workerID).
		SetLeaseExpiresAt(now.Add(relationshipProjectionLease)).
		ClearNextAttemptAt().
		ClearLastError().
		AddAttempts(1).
		Save(ctx)
	if err != nil {
		return nil, err
	}
	if updated != 1 {
		return nil, ErrConflict
	}
	return client.RelationshipProjectionJob.Query().
		Where(relationshipprojectionjob.IDEQ(jobID)).
		WithRelationship().
		WithWorkspace().
		Only(ctx)
}

// ProcessRelationshipProjectionJob leases and projects one job. The state,
// snapshot, contradiction artifacts, and completed job transition commit in
// one transaction.
func (s *Service) ProcessRelationshipProjectionJob(
	ctx context.Context,
	u *ent.User,
	jobID uuid.UUID,
	workerID string,
) (*ent.Relationship, string, error) {
	started := time.Now()
	defer func() { revenuemetrics.ProjectionDuration.Observe(time.Since(started).Seconds()) }()
	if _, err := s.CurrentWorkspace(ctx, u); err != nil {
		return nil, "", err
	}
	now := s.now().UTC()
	job, err := claimRelationshipProjectionJob(ctx, s.client, jobID, workerID, now)
	if errors.Is(err, ErrConflict) {
		existing, queryErr := s.client.RelationshipProjectionJob.Query().
			Where(relationshipprojectionjob.IDEQ(jobID)).
			WithRelationship().
			Only(ctx)
		if queryErr != nil {
			return nil, "", queryErr
		}
		// A worker that did not acquire the lease must never report that it
		// published the projection, even if the winning worker completed before
		// this read. Returning the canonical row and status still lets callers
		// observe the result while ErrConflict preserves single-publisher
		// semantics and keeps concurrent delivery accounting honest.
		return existing.Edges.Relationship, existing.Status, ErrConflict
	}
	if err != nil {
		return nil, "", err
	}
	if job.ProjectorVersion != relationshipProjectorVersion {
		err = fmt.Errorf(
			"%w: projection job requires projector version %d",
			ErrReviewRequired, job.ProjectorVersion,
		)
		return nil, s.failRelationshipProjectionJob(ctx, job, workerID, err), err
	}

	tx, err := s.client.Tx(ctx)
	if err != nil {
		return nil, s.failRelationshipProjectionJob(ctx, job, workerID, err), err
	}
	txc := tx.Client()
	txJob, err := txc.RelationshipProjectionJob.Query().
		Where(
			relationshipprojectionjob.IDEQ(job.ID),
			relationshipprojectionjob.StatusEQ("running"),
			relationshipprojectionjob.LeaseOwnerEQ(workerID),
		).
		WithRelationship().
		WithWorkspace().
		Only(ctx)
	if err != nil {
		_ = tx.Rollback()
		return nil, s.failRelationshipProjectionJob(ctx, job, workerID, err), err
	}
	rel := txJob.Edges.Relationship
	ws := txJob.Edges.Workspace
	projected, err := projectRelationshipStateAt(ctx, txc, ws, u, rel, txJob.EvaluatedAt)
	if err == nil {
		err = persistContradictionArtifacts(ctx, txc, ws, u, projected, txJob.EvaluatedAt)
	}
	if err != nil {
		_ = tx.Rollback()
		return nil, s.failRelationshipProjectionJob(ctx, job, workerID, err), err
	}
	if err = appendTrustEvent(ctx, txc, ws, u, TrustEventInput{
		Name: "relationship_projected", Outcome: "succeeded",
		CorrelationID: txJob.IdempotencyKey, StateVersion: projected.StateVersion,
		OccurredAt: now, Relationship: projected,
	}); err != nil {
		_ = tx.Rollback()
		return nil, s.failRelationshipProjectionJob(ctx, job, workerID, err), err
	}
	if _, err = txJob.Update().
		SetStatus("completed").
		SetCompletedAt(now).
		SetResultStateHash(projected.StateHash).
		ClearLeaseOwner().
		ClearLeaseExpiresAt().
		ClearLastError().
		Save(ctx); err != nil {
		_ = tx.Rollback()
		return nil, s.failRelationshipProjectionJob(ctx, job, workerID, err), err
	}
	if err := tx.Commit(); err != nil {
		return nil, s.failRelationshipProjectionJob(ctx, job, workerID, err), err
	}
	revenuemetrics.ProjectionJobs.WithLabelValues("completed").Inc()
	_ = s.RefreshRelationshipAttention(ctx, u)
	return projected.Unwrap(), "completed", nil
}

func (s *Service) failRelationshipProjectionJob(
	ctx context.Context,
	job *ent.RelationshipProjectionJob,
	workerID string,
	cause error,
) string {
	status := "failed"
	update := s.client.RelationshipProjectionJob.Update().
		Where(
			relationshipprojectionjob.IDEQ(job.ID),
			relationshipprojectionjob.StatusEQ("running"),
			relationshipprojectionjob.LeaseOwnerEQ(workerID),
		).
		SetLastError(boundedProjectionError(cause)).
		ClearLeaseOwner().
		ClearLeaseExpiresAt()
	if job.Attempts >= maxRelationshipProjectionAttempts {
		status = "dead"
		update.SetStatus(status).ClearNextAttemptAt()
	} else {
		index := job.Attempts - 1
		if index < 0 {
			index = 0
		}
		if index >= len(relationshipProjectionBackoff) {
			index = len(relationshipProjectionBackoff) - 1
		}
		update.SetStatus(status).SetNextAttemptAt(s.now().UTC().Add(relationshipProjectionBackoff[index]))
	}
	if _, err := update.Save(ctx); err != nil {
		s.log.Error("relationship projection: record failure", zap.String("job", job.ID.String()), zap.Error(err))
	}
	revenuemetrics.ProjectionJobs.WithLabelValues(status).Inc()
	return status
}

func boundedProjectionError(err error) string {
	if err == nil {
		return "projection failed"
	}
	message := strings.TrimSpace(err.Error())
	if len(message) > 1024 {
		message = message[:1024]
	}
	return message
}

// RunDueRelationshipProjections processes a bounded set of due jobs for one
// tenant. Individual failures are retained on their jobs and returned joined.
func (s *Service) RunDueRelationshipProjections(
	ctx context.Context,
	u *ent.User,
	limit int,
	workerID string,
) (int, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	now := s.now().UTC()
	query := dueRelationshipProjectionPredicate(now)(s.client.RelationshipProjectionJob.Query())
	jobs, err := query.
		Order(ent.Asc(relationshipprojectionjob.FieldNextAttemptAt), ent.Asc(relationshipprojectionjob.FieldCreatedAt)).
		Limit(limit).
		All(ctx)
	if err != nil {
		return 0, err
	}
	processed := 0
	var joined error
	for _, job := range jobs {
		if _, _, err := s.ProcessRelationshipProjectionJob(ctx, u, job.ID, workerID); err != nil && !errors.Is(err, ErrConflict) {
			joined = errors.Join(joined, fmt.Errorf("projection job %s: %w", job.ID, err))
			continue
		}
		processed++
	}
	return processed, joined
}

// ReplayRelationshipProjections durably schedules a projector replay for one
// relationship or the caller's entire workspace, then runs each job inline.
// The explicit evaluation boundary makes a replay reproducible and suitable
// for projector upgrades or hash verification.
func (s *Service) ReplayRelationshipProjections(
	ctx context.Context,
	u *ent.User,
	relationshipID *uuid.UUID,
	evaluatedAt time.Time,
	workerID string,
) (int, error) {
	if evaluatedAt.IsZero() {
		return 0, fmt.Errorf("%w: replay evaluatedAt is required", ErrInvalidInput)
	}
	if strings.TrimSpace(workerID) == "" {
		workerID = "relationship-replay-" + uuid.NewString()
	}
	ws, err := s.CurrentWorkspace(ctx, u)
	if err != nil {
		return 0, err
	}
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return 0, err
	}
	txc := tx.Client()
	query := txc.Relationship.Query().
		Where(relationship.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID)))
	if relationshipID != nil {
		query.Where(relationship.IDEQ(*relationshipID))
	}
	relationships, err := query.All(ctx)
	if err != nil {
		_ = tx.Rollback()
		return 0, err
	}
	if relationshipID != nil && len(relationships) == 0 {
		_ = tx.Rollback()
		return 0, ErrNotFound
	}
	jobs := make([]uuid.UUID, 0, len(relationships))
	for _, rel := range relationships {
		job, enqueueErr := s.enqueueRelationshipProjectionTx(
			ctx, txc, ws, u, rel, evaluatedAt.UTC(),
			[]string{fmt.Sprintf("operator-replay:v%d", relationshipProjectorVersion)},
		)
		if enqueueErr != nil {
			_ = tx.Rollback()
			return 0, enqueueErr
		}
		jobs = append(jobs, job.ID)
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}

	processed := 0
	var joined error
	for _, jobID := range jobs {
		if _, _, processErr := s.ProcessRelationshipProjectionJob(ctx, u, jobID, workerID); processErr != nil {
			joined = errors.Join(joined, fmt.Errorf("replay job %s: %w", jobID, processErr))
			continue
		}
		processed++
	}
	return processed, joined
}

// RepairRelationshipProjectionJob preserves the failed/dead attempt and
// schedules a new traceable job. Operators never edit evidence or projection
// rows to recover a relationship.
func (s *Service) RepairRelationshipProjectionJob(
	ctx context.Context,
	u *ent.User,
	failedJobID uuid.UUID,
	reason string,
) (*ent.Relationship, uuid.UUID, string, error) {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return nil, uuid.Nil, "", fmt.Errorf("%w: repair reason is required", ErrInvalidInput)
	}
	failed, err := s.client.RelationshipProjectionJob.Query().
		Where(
			relationshipprojectionjob.IDEQ(failedJobID),
			relationshipprojectionjob.StatusIn("failed", "dead"),
		).
		WithRelationship().
		WithWorkspace().
		Only(ctx)
	if ent.IsNotFound(err) {
		return nil, uuid.Nil, "", ErrNotFound
	}
	if err != nil {
		return nil, uuid.Nil, "", err
	}
	now := s.now().UTC()
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return nil, uuid.Nil, "", err
	}
	job, err := s.enqueueRelationshipProjectionTx(
		ctx, tx.Client(), failed.Edges.Workspace, u, failed.Edges.Relationship, now,
		[]string{
			"operator-repair:" + failed.ID.String(),
			"repair-reason:" + boundedProjectionRepairReason(reason),
		},
	)
	if err != nil {
		_ = tx.Rollback()
		return nil, uuid.Nil, "", err
	}
	if err := tx.Commit(); err != nil {
		return nil, uuid.Nil, "", err
	}
	rel, status, processErr := s.ProcessRelationshipProjectionJob(
		ctx, u, job.ID, "relationship-repair-"+uuid.NewString(),
	)
	return rel, job.ID, status, processErr
}

func boundedProjectionRepairReason(reason string) string {
	reason = strings.Join(strings.Fields(reason), "-")
	if len(reason) > 80 {
		reason = reason[:80]
	}
	return reason
}

// RelationshipProjectionRunner discovers tenants with due jobs and processes
// them continuously. Leases make the sweep safe on multiple API replicas.
type RelationshipProjectionRunner struct {
	svc      *Service
	interval time.Duration
	maxUsers int
	workerID string
	log      *zap.Logger
}

// NewRelationshipProjectionRunner creates the durable projection sweep.
func NewRelationshipProjectionRunner(
	svc *Service,
	interval time.Duration,
	maxUsers int,
	workerID string,
	log *zap.Logger,
) *RelationshipProjectionRunner {
	if interval <= 0 {
		interval = 15 * time.Second
	}
	if maxUsers <= 0 {
		maxUsers = 200
	}
	if strings.TrimSpace(workerID) == "" {
		workerID = "relationship-projector-" + uuid.NewString()
	}
	if log == nil {
		log = zap.NewNop()
	}
	return &RelationshipProjectionRunner{
		svc: svc, interval: interval, maxUsers: maxUsers, workerID: workerID, log: log,
	}
}

// Run sweeps until the process context is canceled.
func (r *RelationshipProjectionRunner) Run(ctx context.Context) error {
	r.sweep(ctx)
	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			r.sweep(ctx)
		}
	}
}

func (r *RelationshipProjectionRunner) sweep(ctx context.Context) {
	now := r.svc.now().UTC()
	due := relationshipprojectionjob.Or(
		relationshipprojectionjob.And(
			relationshipprojectionjob.StatusIn("pending", "failed"),
			relationshipprojectionjob.Or(
				relationshipprojectionjob.NextAttemptAtIsNil(),
				relationshipprojectionjob.NextAttemptAtLTE(now),
			),
		),
		relationshipprojectionjob.And(
			relationshipprojectionjob.StatusEQ("running"),
			relationshipprojectionjob.LeaseExpiresAtNotNil(),
			relationshipprojectionjob.LeaseExpiresAtLTE(now),
		),
	)
	workspaces, err := r.svc.client.RevenueWorkspace.Query().
		Where(revenueworkspace.HasRelationshipProjectionJobsWith(due)).
		WithUser().
		Order(ent.Asc(revenueworkspace.FieldCreatedAt)).
		Limit(r.maxUsers).
		All(auth.WithInternalOnly(ctx))
	if err != nil {
		r.log.Warn("relationship projection: list tenants", zap.Error(err))
		return
	}
	for _, ws := range workspaces {
		if ctx.Err() != nil {
			return
		}
		owner, ownerErr := ws.Edges.UserOrErr()
		if ownerErr != nil {
			r.log.Warn("relationship projection: resolve tenant owner", zap.String("workspace", ws.ID.String()), zap.Error(ownerErr))
			continue
		}
		if _, err := r.svc.RunDueRelationshipProjections(
			auth.WithUser(ctx, owner), owner, 25, r.workerID,
		); err != nil {
			r.log.Warn("relationship projection sweep", zap.String("user", owner.ID.String()), zap.Error(err))
		}
	}
}
