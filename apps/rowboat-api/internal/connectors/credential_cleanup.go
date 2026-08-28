package connectors

import (
	"context"
	"errors"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/connectorcredentialcleanupjob"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const credentialCleanupClaimTTL = 2 * time.Minute
const credentialCleanupAdoptionGrace = time.Minute

func (d *refreshDeduper) enqueueCredentialCleanup(ctx context.Context, bound connectorRefreshContext, refreshToken string) (uuid.UUID, error) {
	connectionID, err := uuid.Parse(bound.ConnectionID)
	if err != nil {
		return uuid.Nil, err
	}
	sealed, err := d.sealer.SealString(refreshToken)
	if err != nil {
		return uuid.Nil, err
	}
	job, err := d.client.ConnectorCredentialCleanupJob.Create().
		SetConnectionID(connectionID).
		SetConnector(bound.Connector).
		SetExpectedCredentialGeneration(bound.ExpectedCredentialGeneration).
		SetRefreshTokenEncrypted(sealed).
		SetStatus("pending").
		// A staged row is not actionable until the bounded refresh/persistence
		// path has had ample time to atomically adopt and delete it.
		SetNextAttemptAt(time.Now().UTC().Add(credentialCleanupAdoptionGrace)).
		Save(auth.WithInternal(ctx))
	if err != nil {
		return uuid.Nil, err
	}
	return job.ID, nil
}

func revokeCredentialBounded(parent context.Context, ory *oryClient, refreshToken string) error {
	if refreshToken == "" {
		return nil
	}
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		ctx, cancel := context.WithTimeout(parent, 3*time.Second)
		lastErr = ory.revoke(ctx, refreshToken)
		cancel()
		if lastErr == nil {
			return nil
		}
		if attempt < 2 {
			timer := time.NewTimer(time.Duration(attempt+1) * 100 * time.Millisecond)
			select {
			case <-parent.Done():
				timer.Stop()
				return lastErr
			case <-timer.C:
			}
		}
	}
	return lastErr
}

func (d *refreshDeduper) compensateCredential(ctx context.Context, ory *oryClient, cleanupID uuid.UUID, refreshToken, reason string) {
	if cleanupID == uuid.Nil || refreshToken == "" {
		return
	}
	claimID := uuid.New()
	now := time.Now().UTC()
	claimed, claimErr := d.client.ConnectorCredentialCleanupJob.UpdateOneID(cleanupID).
		Where(connectorcredentialcleanupjob.StatusEQ("pending")).
		SetStatus("processing").SetClaimID(claimID).SetClaimedUntil(now.Add(credentialCleanupClaimTTL)).
		Save(auth.WithInternal(ctx))
	if claimErr != nil || claimed.ClaimID != claimID {
		// The persistence transaction already deleted the escrow row, so this
		// credential was adopted and must not be revoked.
		return
	}
	if err := revokeCredentialBounded(ctx, ory, refreshToken); err != nil {
		_ = d.client.ConnectorCredentialCleanupJob.UpdateOneID(cleanupID).
			Where(connectorcredentialcleanupjob.ClaimIDEQ(claimID), connectorcredentialcleanupjob.StatusEQ("processing")).
			SetStatus("pending").ClearClaimID().ClearClaimedUntil().AddAttempts(1).
			SetLastErrorCode("provider_revoke_unconfirmed").
			SetNextAttemptAt(now).
			Exec(auth.WithInternal(ctx))
		if d.log != nil {
			d.log.Warn("connector orphan credential cleanup deferred", zap.String("reason", reason), zap.String("cleanup_job_id", cleanupID.String()))
		}
		return
	}
	_, _ = d.client.ConnectorCredentialCleanupJob.Delete().Where(
		connectorcredentialcleanupjob.IDEQ(cleanupID),
		connectorcredentialcleanupjob.ClaimIDEQ(claimID),
		connectorcredentialcleanupjob.StatusEQ("processing"),
	).Exec(auth.WithInternal(ctx))
	if d.log != nil {
		d.log.Info("connector orphan credential revoked", zap.String("reason", reason), zap.String("cleanup_job_id", cleanupID.String()))
	}
}

// ProcessCredentialCleanupJobs retries credential-only compensation. It never
// queries or mutates MCPConnection, so a current or newer grant cannot be
// tombstoned by stale cleanup work.
func (h *Handler) ProcessCredentialCleanupJobs(ctx context.Context, limit int) (int, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	now := time.Now().UTC()
	jobs, err := h.client.ConnectorCredentialCleanupJob.Query().Where(
		connectorcredentialcleanupjob.Or(
			connectorcredentialcleanupjob.And(connectorcredentialcleanupjob.StatusEQ("pending"), connectorcredentialcleanupjob.NextAttemptAtLTE(now)),
			connectorcredentialcleanupjob.And(connectorcredentialcleanupjob.StatusEQ("processing"), connectorcredentialcleanupjob.ClaimedUntilLTE(now)),
		),
	).Order(ent.Asc(connectorcredentialcleanupjob.FieldNextAttemptAt)).Limit(limit).All(auth.WithInternal(ctx))
	if err != nil {
		return 0, err
	}
	completed := 0
	for _, job := range jobs {
		claimID := uuid.New()
		claimed, claimErr := job.Update().Where(
			connectorcredentialcleanupjob.Or(
				connectorcredentialcleanupjob.And(connectorcredentialcleanupjob.StatusEQ("pending"), connectorcredentialcleanupjob.NextAttemptAtLTE(now)),
				connectorcredentialcleanupjob.And(connectorcredentialcleanupjob.StatusEQ("processing"), connectorcredentialcleanupjob.ClaimedUntilLTE(now)),
			),
		).SetStatus("processing").SetClaimID(claimID).SetClaimedUntil(now.Add(credentialCleanupClaimTTL)).Save(auth.WithInternal(ctx))
		if claimErr != nil || claimed.ClaimID != claimID {
			continue
		}
		plain, openErr := h.sealer.OpenString(claimed.RefreshTokenEncrypted)
		if openErr != nil {
			_ = claimed.Update().Where(connectorcredentialcleanupjob.ClaimIDEQ(claimID)).SetStatus("pending").ClearClaimID().ClearClaimedUntil().AddAttempts(1).SetLastErrorCode("credential_open_failed").SetNextAttemptAt(now.Add(time.Minute)).Exec(auth.WithInternal(ctx))
			continue
		}
		revokeErr := revokeCredentialBounded(ctx, h.ory, plain)
		if revokeErr != nil {
			delay := time.Duration(min(claimed.Attempts+1, 8)) * time.Minute
			_ = claimed.Update().Where(connectorcredentialcleanupjob.ClaimIDEQ(claimID)).SetStatus("pending").ClearClaimID().ClearClaimedUntil().AddAttempts(1).SetLastErrorCode("provider_revoke_unconfirmed").SetNextAttemptAt(now.Add(delay)).Exec(auth.WithInternal(ctx))
			continue
		}
		if deleteErr := h.client.ConnectorCredentialCleanupJob.DeleteOneID(claimed.ID).Exec(auth.WithInternal(ctx)); deleteErr != nil && !errors.Is(deleteErr, context.Canceled) {
			return completed, deleteErr
		}
		completed++
		h.log.Info("connector orphan credential cleanup completed", zap.String("cleanup_job_id", claimed.ID.String()), zap.String("connector", claimed.Connector))
	}
	return completed, nil
}

func (h *Handler) RunCredentialCleanupWorker(ctx context.Context) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		if _, err := h.ProcessCredentialCleanupJobs(ctx, 25); err != nil && ctx.Err() == nil {
			h.log.Warn("process connector credential cleanup jobs", zap.Error(err))
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
