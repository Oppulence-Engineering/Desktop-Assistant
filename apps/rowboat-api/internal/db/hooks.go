package db

import (
	"context"
	"errors"
	"fmt"

	"entgo.io/ent/dialect/sql"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/hook"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// ErrTenantMutation is returned when a caller attempts to create or re-parent
// a tenant-owned row for another user.
var ErrTenantMutation = errors.New("db: tenant mutation ownership mismatch")

// userScopedMutation is implemented by every Ent mutation whose schema has the
// required unique `user` edge. Keeping this structural avoids a hand-written
// hook per entity while still relying on generated, typed mutation methods.
type userScopedMutation interface {
	ent.Mutation
	UserID() (uuid.UUID, bool)
	UserCleared() bool
	WhereP(...func(*sql.Selector))
}

// registerHooks installs write-side middleware on the client:
//   - append-only enforcement on the credit ledger
//   - audit logging on sensitive writes
func registerHooks(client *ent.Client, log *zap.Logger) {
	// Defense in depth for every tenant-owned mutation. Reads already have Ent
	// interceptors, but without this hook a future Update/Delete built directly
	// from request input could cross tenants without ever performing a scoped
	// read first.
	client.Use(tenantMutationHook())

	// The credit ledger is append-only: reject any update or delete at the ORM
	// layer (belt-and-suspenders with the (request_id, reason) unique index).
	client.CreditLedger.Use(
		hook.Reject(ent.OpUpdate | ent.OpUpdateOne | ent.OpDelete | ent.OpDeleteOne),
	)

	// Audit sensitive writes. Logs metadata only — never token/secret values.
	client.CreditLedger.Use(auditHook(log, "credit_ledger"))
	client.OAuthConnection.Use(auditHook(log, "oauth_connection"))
	client.MCPConnection.Use(auditHook(log, "mcp_connection"))
	client.Subscription.Use(auditHook(log, "subscription"))
	client.BackgroundTask.Use(auditHook(log, "background_task"))
	client.BackgroundTaskArtifact.Use(auditHook(log, "background_task_artifact"))
	client.BackgroundTaskRun.Use(auditHook(log, "background_task_run"))
	client.BackgroundTaskRunEvent.Use(auditHook(log, "background_task_run_event"))
}

func tenantMutationHook() ent.Hook {
	return func(next ent.Mutator) ent.Mutator {
		return ent.MutateFunc(func(ctx context.Context, mutation ent.Mutation) (ent.Value, error) {
			m, ok := mutation.(userScopedMutation)
			if !ok {
				return next.Mutate(ctx, mutation)
			}

			owner, hasOwner := auth.UserFromCtx(ctx)
			if !hasOwner {
				if auth.IsInternalCaller(ctx) {
					return next.Mutate(ctx, mutation)
				}
				return nil, ErrNoViewer
			}

			if m.UserCleared() {
				return nil, fmt.Errorf("%w: cannot clear owner", ErrTenantMutation)
			}
			if requested, exists := m.UserID(); exists && requested != owner.ID {
				return nil, fmt.Errorf("%w: requested owner does not match viewer", ErrTenantMutation)
			}

			switch {
			case mutation.Op().Is(ent.OpCreate):
				// Required user edges should always be explicit. Reject instead of
				// silently filling it so a missing owner remains visible to callers.
				if !hasMutationUser(m) {
					return nil, fmt.Errorf("%w: owner is required", ErrTenantMutation)
				}
			case mutation.Op().Is(ent.OpUpdate | ent.OpUpdateOne | ent.OpDelete | ent.OpDeleteOne):
				column, exists := tenantUserColumns[mutation.Type()]
				if !exists {
					return nil, fmt.Errorf("%w: missing tenant column for %s", ErrTenantMutation, mutation.Type())
				}
				uid := owner.ID
				m.WhereP(func(s *sql.Selector) {
					s.Where(sql.EQ(s.C(column), uid))
				})
			}
			return next.Mutate(ctx, mutation)
		})
	}
}

func hasMutationUser(m userScopedMutation) bool {
	_, exists := m.UserID()
	return exists
}

// auditHook logs one structured line per successful mutation. For the credit
// ledger it captures the non-sensitive accounting fields; for everything else
// it records the set of changed field names (never their values).
func auditHook(log *zap.Logger, entity string) ent.Hook {
	return func(next ent.Mutator) ent.Mutator {
		return ent.MutateFunc(func(ctx context.Context, m ent.Mutation) (ent.Value, error) {
			v, err := next.Mutate(ctx, m)
			if err != nil {
				return v, err
			}
			fields := []zap.Field{
				zap.String("entity", entity),
				zap.String("op", m.Op().String()),
			}
			if cl, ok := m.(*ent.CreditLedgerMutation); ok {
				if d, exists := cl.Delta(); exists {
					fields = append(fields, zap.Int("delta", d))
				}
				if r, exists := cl.Reason(); exists {
					fields = append(fields, zap.String("reason", r))
				}
				if rid, exists := cl.RequestID(); exists {
					fields = append(fields, zap.String("request_id", rid.String()))
				}
			} else {
				fields = append(fields, zap.Strings("changed", m.Fields()))
			}
			log.Info("audit.write", fields...)
			return v, err
		})
	}
}
