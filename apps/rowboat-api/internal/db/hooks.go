package db

import (
	"context"
	"errors"
	"fmt"

	"entgo.io/ent/dialect/sql"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/hook"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspacemember"
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

type workspaceScopedMutation interface {
	userScopedMutation
	WorkspaceID() (uuid.UUID, bool)
	WorkspaceCleared() bool
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
	client.VoiceAPIKey.Use(auditHook(log, "voice_api_key"))
	client.VoiceSyncItem.Use(auditHook(log, "voice_sync_item"))
	client.CaptureArtifact.Use(auditHook(log, "capture_artifact"))
	// Identity decisions and lineage are append-only audit records. Corrections
	// are represented by a new compensating decision, never by rewriting history.
	client.RelationshipIdentityDecision.Use(
		hook.Reject(ent.OpUpdate | ent.OpUpdateOne | ent.OpDelete | ent.OpDeleteOne),
	)
	client.RelationshipLineageEvent.Use(
		hook.Reject(ent.OpUpdate | ent.OpUpdateOne | ent.OpDelete | ent.OpDeleteOne),
	)
	client.RelationshipReviewAcknowledgement.Use(
		hook.Reject(ent.OpUpdate | ent.OpUpdateOne | ent.OpDelete | ent.OpDeleteOne),
	)
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

			if mutation.Type() == ent.TypeRevenueWorkspace {
				if m.UserCleared() {
					return nil, fmt.Errorf("%w: cannot clear workspace owner", ErrTenantMutation)
				}
				if requested, exists := m.UserID(); exists && requested != owner.ID {
					return nil, fmt.Errorf("%w: cannot reassign workspace owner", ErrTenantMutation)
				}
				if mutation.Op().Is(ent.OpUpdate | ent.OpUpdateOne | ent.OpDelete | ent.OpDeleteOne) {
					uid := owner.ID
					m.WhereP(func(s *sql.Selector) {
						s.Where(sql.In(s.C(revenueworkspace.FieldID), writableRevenueWorkspaceIDs(uid)))
					})
				}
				return next.Mutate(ctx, mutation)
			}

			if workspaceColumn, workspaceOwned := workspaceTenantColumns[mutation.Type()]; workspaceOwned {
				wm, valid := mutation.(workspaceScopedMutation)
				if !valid {
					return nil, fmt.Errorf("%w: missing workspace mutation contract for %s", ErrTenantMutation, mutation.Type())
				}
				if wm.WorkspaceCleared() {
					return nil, fmt.Errorf("%w: cannot clear workspace", ErrTenantMutation)
				}
				if mutation.Op().Is(ent.OpCreate) {
					workspaceID, exists := wm.WorkspaceID()
					if !exists {
						return nil, fmt.Errorf("%w: workspace is required", ErrTenantMutation)
					}
					if !auth.CanWriteRevenueWorkspace(ctx, workspaceID) {
						return nil, fmt.Errorf("%w: workspace is not writable", ErrTenantMutation)
					}
					// The member edge points at the invited subject. Every other
					// entity records the actor and may not forge another user.
					if mutation.Type() != ent.TypeRevenueWorkspaceMember {
						if requested, exists := m.UserID(); !exists || requested != owner.ID {
							return nil, fmt.Errorf("%w: actor does not match viewer", ErrTenantMutation)
						}
					}
				} else if _, reparenting := wm.WorkspaceID(); reparenting {
					return nil, fmt.Errorf("%w: workspace re-parenting is forbidden", ErrTenantMutation)
				}
				if mutation.Op().Is(ent.OpUpdate | ent.OpUpdateOne | ent.OpDelete | ent.OpDeleteOne) {
					uid := owner.ID
					wm.WhereP(func(s *sql.Selector) {
						s.Where(sql.In(s.C(workspaceColumn), writableRevenueWorkspaceIDs(uid)))
					})
				}
				return next.Mutate(ctx, mutation)
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

// writableRevenueWorkspaceIDs returns owner/admin/member workspaces. Viewer
// membership is deliberately absent, making the database mutation boundary
// read-only even if a handler forgets its finer-grained capability check.
func writableRevenueWorkspaceIDs(uid uuid.UUID) *sql.Selector {
	workspaces := sql.Table(revenueworkspace.Table)
	members := sql.Table(revenueworkspacemember.Table)
	return sql.Select(workspaces.C(revenueworkspace.FieldID)).
		From(workspaces).
		LeftJoin(members).
		On(workspaces.C(revenueworkspace.FieldID), members.C(revenueworkspacemember.WorkspaceColumn)).
		Where(sql.Or(
			sql.EQ(workspaces.C(revenueworkspace.UserColumn), uid),
			sql.And(
				sql.EQ(members.C(revenueworkspacemember.UserColumn), uid),
				sql.EQ(members.C(revenueworkspacemember.FieldStatus), "active"),
				sql.In(members.C(revenueworkspacemember.FieldRole), "owner", "admin", "member"),
			),
		))
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
