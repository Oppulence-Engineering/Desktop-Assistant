package connectors

import (
	"context"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/connectorcredentialcleanupjob"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// revokeSupersededCredential performs the best-effort immediate revocation for
// a reconnect. The encrypted cleanup row was committed atomically with the new
// grant and remains durable until revocation is confirmed. It contains only the
// exact superseded bytes, so this path never reads or revokes the current grant.
func (h *Handler) revokeSupersededCredential(ctx context.Context, cleanupID uuid.UUID) {
	if cleanupID == uuid.Nil {
		return
	}
	now := time.Now().UTC()
	claimID := uuid.New()
	job, err := h.client.ConnectorCredentialCleanupJob.UpdateOneID(cleanupID).
		Where(connectorcredentialcleanupjob.StatusEQ("pending")).
		SetStatus("processing").
		SetClaimID(claimID).
		SetClaimedUntil(now.Add(credentialCleanupClaimTTL)).
		Save(auth.WithInternal(ctx))
	if err != nil || job.ClaimID != claimID {
		return
	}
	refreshToken, err := h.sealer.OpenString(job.RefreshTokenEncrypted)
	if err == nil {
		err = revokeCredentialBounded(ctx, h.ory, refreshToken)
	}
	if err != nil {
		_ = h.client.ConnectorCredentialCleanupJob.UpdateOneID(cleanupID).
			Where(connectorcredentialcleanupjob.StatusEQ("processing"), connectorcredentialcleanupjob.ClaimIDEQ(claimID)).
			SetStatus("pending").
			ClearClaimID().
			ClearClaimedUntil().
			AddAttempts(1).
			SetLastErrorCode("provider_revoke_unconfirmed").
			SetNextAttemptAt(now).
			Exec(auth.WithInternal(ctx))
		if h.log != nil {
			h.log.Warn("superseded connector credential revocation deferred", zap.String("cleanup_job_id", cleanupID.String()), zap.Error(err))
		}
		return
	}
	_, _ = h.client.ConnectorCredentialCleanupJob.Delete().Where(
		connectorcredentialcleanupjob.IDEQ(cleanupID),
		connectorcredentialcleanupjob.StatusEQ("processing"),
		connectorcredentialcleanupjob.ClaimIDEQ(claimID),
	).Exec(auth.WithInternal(ctx))
}
