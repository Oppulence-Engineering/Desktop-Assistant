package connectors

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/connectorcredentialcleanupjob"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/connectorcredentialrecovery"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/connectormetrics"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const credentialCleanupClaimTTL = 2 * time.Minute
const credentialCleanupAdoptionGrace = time.Minute

const (
	credentialRecoveryOwnerCallback = "oauth_callback"
	credentialRecoveryOwnerRotation = "refresh_rotation_fallback"
)

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

// persistCredentialRecovery writes the independent recovery journal. The
// caller supplies a stable id for callback grants, making retries idempotent.
// A duplicate is accepted only when it names the same durable owner.
func persistCredentialRecovery(
	ctx context.Context,
	client *ent.Client,
	sealer *crypto.Sealer,
	id uuid.UUID,
	connector, ownerKind, ownerID, refreshToken string,
	nextAttemptAt time.Time,
) (uuid.UUID, error) {
	if client == nil || sealer == nil || id == uuid.Nil || connector == "" || ownerKind == "" || ownerID == "" || refreshToken == "" {
		return uuid.Nil, errors.New("connector credential recovery input is incomplete")
	}
	sealed, err := sealer.SealString(refreshToken)
	if err != nil {
		return uuid.Nil, err
	}
	_, err = client.ConnectorCredentialRecovery.Create().
		SetID(id).
		SetConnector(connector).
		SetOwnerKind(ownerKind).
		SetOwnerID(ownerID).
		SetRefreshTokenEncrypted(sealed).
		SetStatus("pending").
		SetNextAttemptAt(nextAttemptAt.UTC()).
		Save(auth.WithInternal(ctx))
	if err == nil {
		return id, nil
	}
	existing, queryErr := client.ConnectorCredentialRecovery.Query().Where(
		connectorcredentialrecovery.IDEQ(id),
		connectorcredentialrecovery.OwnerKindEQ(ownerKind),
		connectorcredentialrecovery.OwnerIDEQ(ownerID),
	).Only(auth.WithInternal(ctx))
	if queryErr != nil {
		return uuid.Nil, err
	}
	plain, openErr := sealer.OpenString(existing.RefreshTokenEncrypted)
	if openErr != nil || plain != refreshToken {
		return uuid.Nil, fmt.Errorf("credential recovery id collision for %s/%s", ownerKind, ownerID)
	}
	return existing.ID, nil
}

// establishCredentialRecovery cannot return a live provider credential with no
// durable encrypted owner. If PostgreSQL and provider revocation both fail, it
// keeps alternating the two independent closure paths until one is confirmed.
// A process death before either acknowledgement remains the irreducible window
// for providers that offer neither idempotent exchange nor token introspection.
func establishCredentialRecovery(
	supervisor *credentialCustodySupervisor,
	permit *credentialCustodyPermit,
	client *ent.Client,
	sealer *crypto.Sealer,
	ory *oryClient,
	log *zap.Logger,
	id uuid.UUID,
	connector, ownerKind, ownerID, refreshToken string,
	nextAttemptAt time.Time,
) (uuid.UUID, bool, error) {
	if refreshToken == "" {
		return uuid.Nil, false, nil
	}
	if supervisor == nil {
		return uuid.Nil, false, errors.New("credential custody supervisor is not configured")
	}
	submit := supervisor.submit
	if permit != nil {
		submit = permit.submit
	}
	result := submit(func() credentialCustodyResult {
		for attempt := 0; ; attempt++ {
			writeCtx, cancel := context.WithTimeout(processContext(), 5*time.Second)
			recoveryID, err := persistCredentialRecovery(writeCtx, client, sealer, id, connector, ownerKind, ownerID, refreshToken, nextAttemptAt)
			cancel()
			if err == nil {
				connectormetrics.CredentialCustodyOutcomes.WithLabelValues("journaled").Inc()
				return credentialCustodyResult{recoveryID: recoveryID.String()}
			}
			persistErr := err
			revokeErr := revokeCredentialBounded(processContext(), ory, refreshToken)
			if revokeErr == nil {
				connectormetrics.CredentialCustodyOutcomes.WithLabelValues("revoked").Inc()
				return credentialCustodyResult{revoked: true, err: fmt.Errorf("durably journal connector credential: %w; provider revocation confirmed", persistErr)}
			}
			time.Sleep(time.Duration(min(attempt+1, 5)) * 200 * time.Millisecond)
			if attempt > 0 && attempt%5 == 0 && log != nil {
				log.Error("connector credential has no acknowledged custody path; retrying without returning",
					zap.String("connector", connector), zap.String("owner_kind", ownerKind), zap.String("owner_id", ownerID),
					zap.Error(persistErr), zap.NamedError("provider_revoke_error", revokeErr))
			}
		}
	})
	recoveryID, parseErr := uuid.Parse(result.recoveryID)
	if result.recoveryID == "" {
		recoveryID, parseErr = uuid.Nil, nil
	}
	if parseErr != nil {
		return uuid.Nil, result.revoked, parseErr
	}
	return recoveryID, result.revoked, result.err
}

func compensateCredentialRecovery(ctx context.Context, client *ent.Client, sealer *crypto.Sealer, ory *oryClient, log *zap.Logger, recoveryID uuid.UUID, reason string) {
	if recoveryID == uuid.Nil {
		return
	}
	claimID := uuid.New()
	now := time.Now().UTC()
	claimed, err := client.ConnectorCredentialRecovery.UpdateOneID(recoveryID).
		Where(connectorcredentialrecovery.StatusEQ("pending")).
		SetStatus("processing").SetClaimID(claimID).SetClaimedUntil(now.Add(credentialCleanupClaimTTL)).
		Save(auth.WithInternal(ctx))
	if err != nil || claimed.ClaimID != claimID {
		// A committed claim transaction deleted the journal atomically with
		// MCPConnection adoption. Never revoke when ownership is ambiguous.
		return
	}
	plain, err := sealer.OpenString(claimed.RefreshTokenEncrypted)
	if err == nil {
		err = revokeCredentialBounded(ctx, ory, plain)
	}
	if err != nil {
		_ = client.ConnectorCredentialRecovery.UpdateOneID(recoveryID).
			Where(connectorcredentialrecovery.ClaimIDEQ(claimID), connectorcredentialrecovery.StatusEQ("processing")).
			SetStatus("pending").ClearClaimID().ClearClaimedUntil().AddAttempts(1).
			SetLastErrorCode("provider_revoke_unconfirmed").SetNextAttemptAt(now).
			Exec(auth.WithInternal(ctx))
		if log != nil {
			log.Warn("connector credential recovery deferred", zap.String("reason", reason), zap.String("recovery_id", recoveryID.String()))
		}
		return
	}
	_, _ = client.ConnectorCredentialRecovery.Delete().Where(
		connectorcredentialrecovery.IDEQ(recoveryID),
		connectorcredentialrecovery.ClaimIDEQ(claimID),
		connectorcredentialrecovery.StatusEQ("processing"),
	).Exec(auth.WithInternal(ctx))
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
	recoveries, err := h.client.ConnectorCredentialRecovery.Query().Where(
		connectorcredentialrecovery.Or(
			connectorcredentialrecovery.And(connectorcredentialrecovery.StatusEQ("pending"), connectorcredentialrecovery.NextAttemptAtLTE(now)),
			connectorcredentialrecovery.And(connectorcredentialrecovery.StatusEQ("processing"), connectorcredentialrecovery.ClaimedUntilLTE(now)),
		),
	).Order(ent.Asc(connectorcredentialrecovery.FieldNextAttemptAt)).Limit(limit).All(auth.WithInternal(ctx))
	if err != nil {
		return completed, err
	}
	for _, recovery := range recoveries {
		claimID := uuid.New()
		claimed, claimErr := recovery.Update().Where(
			connectorcredentialrecovery.Or(
				connectorcredentialrecovery.And(connectorcredentialrecovery.StatusEQ("pending"), connectorcredentialrecovery.NextAttemptAtLTE(now)),
				connectorcredentialrecovery.And(connectorcredentialrecovery.StatusEQ("processing"), connectorcredentialrecovery.ClaimedUntilLTE(now)),
			),
		).SetStatus("processing").SetClaimID(claimID).SetClaimedUntil(now.Add(credentialCleanupClaimTTL)).Save(auth.WithInternal(ctx))
		if claimErr != nil || claimed.ClaimID != claimID {
			continue
		}
		plain, openErr := h.sealer.OpenString(claimed.RefreshTokenEncrypted)
		if openErr != nil {
			_ = claimed.Update().Where(connectorcredentialrecovery.ClaimIDEQ(claimID)).SetStatus("pending").ClearClaimID().ClearClaimedUntil().AddAttempts(1).SetLastErrorCode("credential_open_failed").SetNextAttemptAt(now.Add(time.Minute)).Exec(auth.WithInternal(ctx))
			continue
		}
		if revokeErr := revokeCredentialBounded(ctx, h.ory, plain); revokeErr != nil {
			delay := time.Duration(min(claimed.Attempts+1, 8)) * time.Minute
			_ = claimed.Update().Where(connectorcredentialrecovery.ClaimIDEQ(claimID)).SetStatus("pending").ClearClaimID().ClearClaimedUntil().AddAttempts(1).SetLastErrorCode("provider_revoke_unconfirmed").SetNextAttemptAt(now.Add(delay)).Exec(auth.WithInternal(ctx))
			continue
		}
		deleted, deleteErr := h.client.ConnectorCredentialRecovery.Delete().Where(
			connectorcredentialrecovery.IDEQ(claimed.ID),
			connectorcredentialrecovery.ClaimIDEQ(claimID),
			connectorcredentialrecovery.StatusEQ("processing"),
		).Exec(auth.WithInternal(ctx))
		if deleteErr != nil {
			return completed, deleteErr
		}
		if deleted == 1 {
			completed++
			h.log.Info("connector credential recovery completed", zap.String("recovery_id", claimed.ID.String()), zap.String("connector", claimed.Connector))
		}
	}
	return completed, nil
}

// RunCredentialCleanupWorker retries provider revocation for unadopted rotated credentials.
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
