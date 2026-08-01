package revenue

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
)

const maxReconciliationAttempts = 7

var reconciliationBackoff = [...]time.Duration{
	time.Minute, 5 * time.Minute, 15 * time.Minute, time.Hour, 6 * time.Hour, 24 * time.Hour,
}

// ReconcileAmbiguousAction performs exactly one read-only provider lookup for
// an ambiguous write. It never calls Execute, even after all attempts fail.
func (s *Service) ReconcileAmbiguousAction(ctx context.Context, u *ent.User, id uuid.UUID) (*ent.RevenueAction, error) {
	action, err := s.GetAction(ctx, id)
	if err != nil {
		return nil, err
	}
	if action.ExecutionStatus != ExecAmbiguous {
		return action, nil
	}
	if action.AssignedUserID != nil && *action.AssignedUserID != u.ID {
		return s.markReconciliationManual(ctx, action, "action is assigned to another provider credential")
	}
	if strings.TrimSpace(action.ExecutionIdempotencyKey) == "" {
		// Older or corrupted ambiguous rows have no safe provider marker. Any
		// lookup would risk matching a different write, so fail closed.
		return s.markReconciliationManual(ctx, action, "execution idempotency key is missing")
	}
	ws, err := s.CurrentWorkspace(ctx, u)
	if err != nil {
		return nil, err
	}
	reconciler, ok := s.executor.(Reconciler)
	if !ok {
		return s.markReconciliationManual(ctx, action, "execution backend does not support provider reconciliation")
	}
	result, found, reconcileErr := reconciler.Reconcile(ctx, ExecRequest{
		Action: action, Workspace: ws, UserID: u.ID, Mode: action.ExecutionMode,
		IdempotencyKey: action.ExecutionIdempotencyKey,
	})
	if reconcileErr == nil && found && result == nil {
		found = false
		reconcileErr = errors.New("provider reconciliation reported a match without a receipt")
	}
	now := s.now().UTC()
	attempts := action.ReconciliationAttempts + 1
	if reconcileErr == nil && found {
		update := s.client.RevenueAction.Update().
			Where(
				revenueaction.IDEQ(action.ID),
				revenueaction.ExecutionStatusEQ(ExecAmbiguous),
				revenueaction.ReconciliationAttemptsEQ(action.ReconciliationAttempts),
			).
			SetExecutionStatus(ExecSent).
			SetQueueStatus(QueueHandled).
			SetHandledAt(now).
			SetExecutedAt(now).
			SetReconciliationStatus("found").
			SetReconciliationAttempts(attempts).
			SetReconciliationCheckedAt(now).
			ClearReconciliationNextAt().
			ClearReconciliationError().
			ClearExecutionError()
		if result != nil && result.ProviderMessageID != "" {
			update.SetProviderMessageID(result.ProviderMessageID)
		}
		if result != nil && result.ProviderThreadID != "" {
			update.SetProviderThreadID(result.ProviderThreadID)
		}
		n, err := update.Save(ctx)
		if err != nil {
			return nil, err
		}
		if n > 0 {
			_ = s.appendOutbox(ctx, s.client, ws, u, "revenue.action.reconciled.v1", action.ID,
				"reconciled:"+action.ExecutionIdempotencyKey,
				map[string]any{"revision": action.Revision, "attempts": attempts}, now)
		}
		return s.GetAction(ctx, id)
	}

	status := "not_found"
	errorMessage := ""
	if reconcileErr != nil {
		status = "error"
		errorMessage = truncateRunes(reconcileErr.Error(), 1000)
	}
	manual := attempts >= maxReconciliationAttempts
	if manual {
		status = "manual_review"
		if errorMessage == "" {
			errorMessage = "provider marker was not found after bounded reconciliation attempts"
		}
	}
	update := s.client.RevenueAction.Update().
		Where(
			revenueaction.IDEQ(action.ID),
			revenueaction.ExecutionStatusEQ(ExecAmbiguous),
			revenueaction.ReconciliationAttemptsEQ(action.ReconciliationAttempts),
		).
		SetReconciliationStatus(status).
		SetReconciliationAttempts(attempts).
		SetReconciliationCheckedAt(now)
	if errorMessage != "" {
		update.SetReconciliationError(errorMessage)
	} else {
		update.ClearReconciliationError()
	}
	if manual {
		update.ClearReconciliationNextAt()
	} else {
		update.SetReconciliationNextAt(now.Add(reconciliationBackoff[attempts-1]))
	}
	if _, err := update.Save(ctx); err != nil {
		return nil, err
	}
	return s.GetAction(ctx, id)
}

func (s *Service) markReconciliationManual(ctx context.Context, action *ent.RevenueAction, reason string) (*ent.RevenueAction, error) {
	now := s.now().UTC()
	_, err := s.client.RevenueAction.Update().
		Where(revenueaction.IDEQ(action.ID), revenueaction.ExecutionStatusEQ(ExecAmbiguous)).
		SetReconciliationStatus("manual_review").
		SetReconciliationAttempts(maxReconciliationAttempts).
		SetReconciliationCheckedAt(now).
		SetReconciliationError(truncateRunes(reason, 1000)).
		ClearReconciliationNextAt().
		Save(ctx)
	if err != nil {
		return nil, err
	}
	return s.GetAction(ctx, action.ID)
}

// ReconcileAmbiguousExecutions processes a bounded batch for one tenant.
func (s *Service) ReconcileAmbiguousExecutions(ctx context.Context, u *ent.User, limit int) (int, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	now := s.now().UTC()
	actions, err := s.client.RevenueAction.Query().
		Where(
			revenueaction.HasUserWith(user.IDEQ(u.ID)),
			revenueaction.ExecutionStatusEQ(ExecAmbiguous),
			revenueaction.ReconciliationAttemptsLT(maxReconciliationAttempts),
			revenueaction.Or(
				revenueaction.ReconciliationNextAtIsNil(),
				revenueaction.ReconciliationNextAtLTE(now),
			),
		).
		Order(ent.Asc(revenueaction.FieldReconciliationNextAt), ent.Asc(revenueaction.FieldUpdatedAt)).
		Limit(limit).
		All(ctx)
	if err != nil {
		return 0, err
	}
	processed := 0
	var joined error
	for _, action := range actions {
		if _, err := s.ReconcileAmbiguousAction(ctx, u, action.ID); err != nil {
			joined = errors.Join(joined, fmt.Errorf("%s: %w", action.ID, err))
			continue
		}
		processed++
	}
	return processed, joined
}

// AmbiguousExecutionReconciler continuously discovers due tenants. It is safe
// on multiple server replicas: provider operations are reads and action state
// transitions use optimistic predicates.
type AmbiguousExecutionReconciler struct {
	svc      *Service
	interval time.Duration
	maxUsers int
	log      *zap.Logger
}

// NewAmbiguousExecutionReconciler creates the background reconciliation loop.
func NewAmbiguousExecutionReconciler(svc *Service, interval time.Duration, maxUsers int, log *zap.Logger) *AmbiguousExecutionReconciler {
	if interval <= 0 {
		interval = time.Minute
	}
	if maxUsers <= 0 {
		maxUsers = 200
	}
	return &AmbiguousExecutionReconciler{svc: svc, interval: interval, maxUsers: maxUsers, log: log}
}

// Run reconciles due ambiguous executions until the context is canceled.
func (r *AmbiguousExecutionReconciler) Run(ctx context.Context) error {
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

func (r *AmbiguousExecutionReconciler) sweep(ctx context.Context) {
	now := r.svc.now().UTC()
	actions, err := r.svc.client.RevenueAction.Query().
		Where(
			revenueaction.ExecutionStatusEQ(ExecAmbiguous),
			revenueaction.ReconciliationAttemptsLT(maxReconciliationAttempts),
			revenueaction.Or(
				revenueaction.ReconciliationNextAtIsNil(),
				revenueaction.ReconciliationNextAtLTE(now),
			),
		).
		WithUser().WithWorkspace().
		Order(ent.Asc(revenueaction.FieldReconciliationNextAt), ent.Asc(revenueaction.FieldUpdatedAt)).
		Limit(r.maxUsers).
		All(auth.WithInternalOnly(ctx))
	if err != nil {
		r.log.Warn("ambiguous execution reconciliation: list actions", zap.Error(err))
		return
	}
	for _, action := range actions {
		if ctx.Err() != nil {
			return
		}
		actor, actorErr := action.Edges.UserOrErr()
		ws, workspaceErr := action.Edges.WorkspaceOrErr()
		if actorErr == nil && action.AssignedUserID != nil && actor.ID != *action.AssignedUserID {
			actor, actorErr = r.svc.client.User.Get(auth.WithInternalOnly(ctx), *action.AssignedUserID)
		}
		if actorErr != nil || workspaceErr != nil {
			_, _ = r.svc.markReconciliationManual(
				auth.WithInternalOnly(context.WithoutCancel(ctx)), action,
				"assigned provider actor or workspace is unavailable",
			)
			continue
		}
		if _, capabilityErr := r.svc.RequireWorkspaceCapability(
			auth.WithInternalOnly(ctx), actor, ws, WorkspaceExecute,
		); capabilityErr != nil {
			_, _ = r.svc.markReconciliationManual(
				auth.WithInternalOnly(context.WithoutCancel(ctx)), action,
				"assigned provider actor is no longer authorized for this workspace",
			)
			continue
		}
		if _, err := r.svc.ReconcileAmbiguousAction(auth.WithUser(ctx, actor), actor, action.ID); err != nil {
			r.log.Warn("ambiguous execution reconciliation", zap.String("action", action.ID.String()), zap.Error(err))
		}
	}
}
