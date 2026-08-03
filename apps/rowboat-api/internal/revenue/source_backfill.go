package revenue

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipsourcestatus"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/revenuemetrics"
	"go.uber.org/zap"
)

const sourceBackfillTimeout = 10 * time.Minute

// SourceBackfillBatch is one bounded provider read. Observations are committed
// before progress advances, so a crash can replay a batch but cannot report work
// that was never accepted. Ingestion's provider identity makes that replay safe.
type SourceBackfillBatch struct {
	Observations []RelationshipObservationInput
	Completed    int
	Total        int
	Watermark    string
}

// SourceBackfillProvider reads one authorized provider account. Implementations
// must never accept a token from the caller; they resolve the user's sealed
// connection at execution time and emit at most 100 observations per batch.
type SourceBackfillProvider interface {
	Backfill(
		ctx context.Context,
		u *ent.User,
		sourceAccountID string,
		emit func(SourceBackfillBatch) error,
	) error
}

// SourceBackfillRunner turns RelationshipSourceStatus into a durable queue.
// The row is claimed with a compare-and-set phase transition, which makes the
// worker safe to run on every API replica without a second in-memory job list.
type SourceBackfillRunner struct {
	svc       *Service
	providers map[string]SourceBackfillProvider
	interval  time.Duration
	batchSize int
	log       *zap.Logger
}

// NewSourceBackfillRunner constructs a bounded multi-replica-safe worker over
// the durable source lifecycle queue.
func NewSourceBackfillRunner(
	svc *Service,
	providers map[string]SourceBackfillProvider,
	interval time.Duration,
	batchSize int,
	log *zap.Logger,
) *SourceBackfillRunner {
	if interval <= 0 {
		interval = 5 * time.Second
	}
	if batchSize <= 0 || batchSize > 200 {
		batchSize = 50
	}
	if log == nil {
		log = zap.NewNop()
	}
	canonical := make(map[string]SourceBackfillProvider, len(providers))
	for source, provider := range providers {
		if provider != nil {
			canonical[canonicalSource(source)] = provider
		}
	}
	return &SourceBackfillRunner{
		svc: svc, providers: canonical, interval: interval, batchSize: batchSize, log: log,
	}
}

// Run drains eligible source backfills until the context is canceled.
func (r *SourceBackfillRunner) Run(ctx context.Context) error {
	if r == nil || r.svc == nil {
		return errors.New("revenue: source backfill runner is not configured")
	}
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

func (r *SourceBackfillRunner) sweep(ctx context.Context) {
	if ctx.Err() != nil || r == nil || r.svc == nil {
		return
	}
	now := r.svc.now().UTC()
	startedAt := time.Now()
	result := "success"
	defer func() {
		revenuemetrics.RelationshipLoopSweeps.WithLabelValues("source_backfill", result).Inc()
		revenuemetrics.RelationshipLoopDuration.WithLabelValues("source_backfill_sweep").Observe(time.Since(startedAt).Seconds())
		if result == "success" {
			revenuemetrics.RelationshipLoopLastSuccess.WithLabelValues("source_backfill_sweep").SetToCurrentTime()
		}
	}()
	staleBefore := now.Add(-2 * sourceBackfillTimeout)
	eligible := relationshipsourcestatus.Or(
		relationshipsourcestatus.BackfillPhaseEQ("queued"),
		relationshipsourcestatus.And(
			relationshipsourcestatus.BackfillPhaseEQ("failed"),
			relationshipsourcestatus.NextRetryAtLTE(now),
			relationshipsourcestatus.ErrorCodeIn(
				"provider_outage", "provider_unavailable", "rate_limited", "cursor_lost",
			),
		),
		relationshipsourcestatus.And(
			relationshipsourcestatus.BackfillPhaseEQ("running"),
			relationshipsourcestatus.Or(
				relationshipsourcestatus.SyncStartedAtLT(staleBefore),
				relationshipsourcestatus.SyncStartedAtIsNil(),
			),
		),
	)
	statuses, err := r.svc.client.RelationshipSourceStatus.Query().
		Where(
			relationshipsourcestatus.DisconnectedAtIsNil(),
			relationshipsourcestatus.RevokedAtIsNil(),
			eligible,
		).
		WithWorkspace().
		WithUser().
		Order(ent.Asc(relationshipsourcestatus.FieldUpdatedAt)).
		Limit(r.batchSize).
		All(auth.WithInternalOnly(ctx))
	if err != nil {
		result = "error"
		r.log.Warn("relationship source backfill sweep", zap.Error(err))
		return
	}
	queueDepth, depthErr := r.svc.client.RelationshipSourceStatus.Query().
		Where(relationshipsourcestatus.DisconnectedAtIsNil(), relationshipsourcestatus.RevokedAtIsNil(), eligible).
		Count(auth.WithInternalOnly(ctx))
	if depthErr == nil {
		revenuemetrics.RelationshipQueueDepth.WithLabelValues("source_backfill_eligible").Set(float64(queueDepth))
	} else {
		result = "partial"
	}
	for _, status := range statuses {
		if ctx.Err() != nil {
			return
		}
		claim := r.svc.client.RelationshipSourceStatus.Update().
			Where(
				relationshipsourcestatus.IDEQ(status.ID),
				relationshipsourcestatus.BackfillPhaseEQ(status.BackfillPhase),
			)
		// A stale running row is reclaimed by transitioning running -> running.
		// Include the observed lease timestamp in the compare-and-set so two
		// replicas cannot both win that otherwise identity-looking transition.
		if status.SyncStartedAt == nil {
			claim = claim.Where(relationshipsourcestatus.SyncStartedAtIsNil())
		} else {
			claim = claim.Where(relationshipsourcestatus.SyncStartedAtEQ(*status.SyncStartedAt))
		}
		claimed, claimErr := claim.
			SetStatus("backfilling").
			SetBackfillPhase("running").
			SetCompleteness("partial").
			SetSyncStartedAt(now).
			ClearNextRetryAt().
			ClearLastError().
			ClearErrorCode().
			Save(auth.WithInternalOnly(ctx))
		if claimErr != nil {
			result = "partial"
			r.log.Warn("claim relationship source backfill", zap.String("source", status.Source), zap.Error(claimErr))
			continue
		}
		if claimed != 1 {
			revenuemetrics.RelationshipLoopItems.WithLabelValues("source_backfill", "claim_lost").Inc()
			continue
		}
		revenuemetrics.RelationshipLoopItems.WithLabelValues("source_backfill", "claimed").Inc()
		r.process(ctx, status)
	}
}

func (r *SourceBackfillRunner) process(parent context.Context, status *ent.RelationshipSourceStatus) {
	startedAt := time.Now()
	succeeded := false
	defer func() {
		revenuemetrics.RelationshipLoopDuration.WithLabelValues("source_backfill_job").Observe(time.Since(startedAt).Seconds())
		outcome := "failed"
		if succeeded {
			outcome = "completed"
			revenuemetrics.RelationshipLoopLastSuccess.WithLabelValues("source_backfill_job").SetToCurrentTime()
		}
		revenuemetrics.RelationshipLoopItems.WithLabelValues("source_backfill", outcome).Inc()
	}()
	provider := r.providers[canonicalSource(status.Source)]
	u, err := r.sourceBackfillActor(parent, status)
	if err != nil {
		r.fail(parent, status, nil, sourceBackfillErrorCode(err), err)
		return
	}
	userCtx := auth.WithUser(context.WithoutCancel(parent), u)
	ctx, cancel := context.WithTimeout(userCtx, sourceBackfillTimeout)
	defer cancel()
	if provider == nil {
		r.fail(ctx, status, u, "provider_unavailable", errors.New("source provider is not configured"))
		return
	}

	completed := 0
	total := 0
	watermark := ""
	err = provider.Backfill(ctx, u, status.SourceAccountID, func(batch SourceBackfillBatch) error {
		if len(batch.Observations) > 100 {
			return fmt.Errorf("source backfill emitted %d observations; maximum is 100", len(batch.Observations))
		}
		for index := range batch.Observations {
			if canonicalSource(batch.Observations[index].Source) != canonicalSource(status.Source) {
				return fmt.Errorf(
					"source backfill provider emitted %q evidence for %q",
					batch.Observations[index].Source, status.Source,
				)
			}
			batch.Observations[index].SourceAccountID = status.SourceAccountID
		}
		if len(batch.Observations) > 0 {
			if _, ingestErr := r.svc.IngestRelationshipObservations(ctx, u, batch.Observations); ingestErr != nil {
				return ingestErr
			}
		}
		if batch.Completed < completed || batch.Total < 0 || (batch.Total > 0 && batch.Completed > batch.Total) {
			return errors.New("source backfill emitted invalid progress")
		}
		if total > 0 && batch.Total != total {
			return errors.New("source backfill changed its advertised total")
		}
		completed = batch.Completed
		if batch.Total > 0 {
			total = batch.Total
		}
		if strings.TrimSpace(batch.Watermark) != "" {
			watermark = strings.TrimSpace(batch.Watermark)
		}
		_, progressErr := r.svc.ReportSourceSyncProgress(ctx, u, SourceSyncProgressInput{
			Source: status.Source, SourceAccountID: status.SourceAccountID,
			Completed: completed, Total: total, Watermark: watermark,
			OccurredAt: r.svc.now().UTC(),
		})
		return progressErr
	})
	if err != nil {
		r.fail(ctx, status, u, sourceBackfillErrorCode(err), err)
		return
	}
	if total > 0 && completed != total {
		r.fail(ctx, status, u, "provider_outage", errors.New("source provider stopped before advertised total"))
		return
	}
	if _, err := r.svc.ReportSourceSyncProgress(ctx, u, SourceSyncProgressInput{
		Source: status.Source, SourceAccountID: status.SourceAccountID,
		Completed: completed, Total: total, Watermark: watermark, Done: true,
		OccurredAt: r.svc.now().UTC(),
	}); err != nil {
		r.log.Warn("complete relationship source backfill", zap.String("source", status.Source), zap.Error(err))
		return
	}
	succeeded = true
}

func (r *SourceBackfillRunner) sourceBackfillActor(
	ctx context.Context,
	status *ent.RelationshipSourceStatus,
) (*ent.User, error) {
	ws, err := status.Edges.WorkspaceOrErr()
	if err != nil {
		return nil, err
	}
	creator, creatorErr := status.Edges.UserOrErr()
	var actor *ent.User
	switch {
	case status.ConsentingActorID == nil:
		actor, err = creator, creatorErr
	case creatorErr == nil && creator.ID == *status.ConsentingActorID:
		actor = creator
	default:
		// The source row remains an audit record of its creator, while the explicit
		// consenting actor identifies whose sealed provider connection is current.
		// Use an internal-only lookup here, then authorize that actor against the
		// exact source workspace rather than allowing CurrentWorkspace to create a
		// new tenant for a member who has since been removed.
		actor, err = r.svc.client.User.Get(auth.WithInternalOnly(ctx), *status.ConsentingActorID)
	}
	if err != nil {
		return nil, err
	}
	if _, err := r.svc.RequireWorkspaceCapability(
		auth.WithInternalOnly(ctx), actor, ws, WorkspaceManageSources,
	); err != nil {
		return nil, err
	}
	return actor, nil
}

func (r *SourceBackfillRunner) fail(
	ctx context.Context,
	status *ent.RelationshipSourceStatus,
	u *ent.User,
	code string,
	err error,
) {
	if u != nil {
		if _, markErr := r.svc.MarkSourceSyncFailure(
			auth.WithUser(context.WithoutCancel(ctx), u), u, status.Source, status.SourceAccountID, code,
		); markErr == nil {
			r.log.Warn("relationship source backfill failed", zap.String("source", status.Source), zap.String("errorCode", code), zap.Error(err))
			return
		}
	}
	// Edge corruption or a removed membership must not leave an unclaimable
	// running row forever. This fallback writes only categorical diagnostics.
	now := r.svc.now().UTC()
	retryCount := status.RetryCount + 1
	backoff := time.Duration(1<<min(retryCount, 8)) * time.Minute
	state := "degraded"
	reconnectRequired := code == "missing_scope" || code == "invalid_grant" || code == "revoked_credential"
	if reconnectRequired {
		state = "reconnect_required"
	} else if code == "cursor_lost" {
		state = "rebuilding"
	}
	update := r.svc.client.RelationshipSourceStatus.Update().
		Where(
			relationshipsourcestatus.IDEQ(status.ID),
			relationshipsourcestatus.BackfillPhaseEQ("running"),
			relationshipsourcestatus.DisconnectedAtIsNil(),
			relationshipsourcestatus.RevokedAtIsNil(),
			relationshipsourcestatus.StatusNEQ("reconnect_required"),
		).
		SetStatus(state).SetBackfillPhase("failed").SetCompleteness("stale").
		SetErrorCode(code).SetLastError(safeSourceError(code)).
		SetRetryCount(retryCount).SetLastFailedSyncAt(now)
	if reconnectRequired {
		update.ClearNextRetryAt()
		if code == "revoked_credential" {
			update.SetRevokedAt(now)
		}
	} else {
		update.SetNextRetryAt(now.Add(backoff))
	}
	_, _ = update.Save(auth.WithInternalOnly(context.WithoutCancel(ctx)))
}

func sourceBackfillErrorCode(err error) string {
	if errors.Is(err, ErrForbidden) || ent.IsNotFound(err) {
		return "revoked_credential"
	}
	text := strings.ToLower(err.Error())
	switch {
	case strings.Contains(text, "missing_scope"), strings.Contains(text, "missing scope"):
		return "missing_scope"
	case strings.Contains(text, "invalid_grant"), strings.Contains(text, "refresh token is invalid"):
		return "invalid_grant"
	case strings.Contains(text, "revoked"):
		return "revoked_credential"
	case strings.Contains(text, "rate limit"), strings.Contains(text, "status 429"), strings.Contains(text, "returned 429"):
		return "rate_limited"
	case strings.Contains(text, "cursor"), strings.Contains(text, "history id too old"):
		return "cursor_lost"
	default:
		return "provider_outage"
	}
}
