// Package mixin holds reusable ent field sets shared across schemas.
package mixin

import (
	"context"
	"strings"
	"time"

	"entgo.io/contrib/entproto"
	"entgo.io/ent"
	"entgo.io/ent/privacy"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/mixin"
	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/optimistic"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/tenant"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/viewer"
)

// BaseMixin gives every schema a UUID primary key and created/updated
// timestamps, keeping timestamp semantics uniform across the model.
// The entproto.Field numbers (1–3) apply only to schemas annotated with
// entproto.Message (currently User); other schemas ignore them.
type BaseMixin struct{ mixin.Schema }

// UserTenantMixin marks a schema scoped through its immutable user edge.
type UserTenantMixin struct{ BaseMixin }

// UserTenantPolicyMixin adds tenant metadata and privacy without BaseMixin
// fields. CreditLedger uses its historical id/timestamp layout and therefore
// cannot embed BaseMixin without changing its storage contract.
type UserTenantPolicyMixin struct{ mixin.Schema }

// WorkspaceTenantMixin marks a schema scoped through its immutable workspace edge.
type WorkspaceTenantMixin struct{ BaseMixin }

// WorkspaceRootTenantMixin marks RevenueWorkspace, which authorizes through
// either its founding owner or an active membership.
type WorkspaceRootTenantMixin struct{ BaseMixin }

// ActionWorkspaceTenantMixin marks records scoped through action.workspace.
type ActionWorkspaceTenantMixin struct{ BaseMixin }

// OptimisticLockMixin marks a schema whose updates use a compare-and-swap
// field. It adds metadata only; the field remains domain-owned.
type OptimisticLockMixin struct {
	mixin.Schema
	Field string
}

// Annotations returns the compare-and-swap field descriptor.
func (m OptimisticLockMixin) Annotations() []schema.Annotation {
	return []schema.Annotation{optimistic.Annotation{Field: m.Field}}
}

// Annotations returns the user-edge tenant descriptor.
func (UserTenantMixin) Annotations() []schema.Annotation {
	return []schema.Annotation{tenant.Annotation{Scope: tenant.ScopeUser}}
}

// Annotations returns the user-edge tenant descriptor without adding fields.
func (UserTenantPolicyMixin) Annotations() []schema.Annotation {
	return []schema.Annotation{tenant.Annotation{Scope: tenant.ScopeUser}}
}

// Annotations returns the workspace-edge tenant descriptor.
func (WorkspaceTenantMixin) Annotations() []schema.Annotation {
	return []schema.Annotation{tenant.Annotation{Scope: tenant.ScopeWorkspace}}
}

// Annotations returns the workspace-root tenant descriptor.
func (WorkspaceRootTenantMixin) Annotations() []schema.Annotation {
	return []schema.Annotation{tenant.Annotation{Scope: tenant.ScopeWorkspaceRoot}}
}

// Annotations returns the action-workspace tenant descriptor.
func (ActionWorkspaceTenantMixin) Annotations() []schema.Annotation {
	return []schema.Annotation{tenant.Annotation{Scope: tenant.ScopeActionWorkspace}}
}

// Policy requires an authenticated or internal viewer.
func (UserTenantMixin) Policy() ent.Policy { return tenantViewerPolicy() }

// Policy requires an authenticated or internal viewer.
func (UserTenantPolicyMixin) Policy() ent.Policy { return tenantViewerPolicy() }

// Policy requires an authenticated or internal viewer.
func (WorkspaceTenantMixin) Policy() ent.Policy { return tenantViewerPolicy() }

// Policy requires an authenticated or internal viewer.
func (WorkspaceRootTenantMixin) Policy() ent.Policy { return tenantViewerPolicy() }

// Policy requires an authenticated or internal viewer.
func (ActionWorkspaceTenantMixin) Policy() ent.Policy { return tenantViewerPolicy() }

// tenantViewerPolicy is the native Ent privacy boundary. Typed interceptors
// and mutation hooks add row predicates independently; this policy ensures a
// tenant-owned builder cannot execute at all without an explicit viewer.
func tenantViewerPolicy() ent.Policy {
	rule := privacy.ContextQueryMutationRule(func(ctx context.Context) error {
		if query := ent.QueryFromContext(ctx); query != nil && strings.HasSuffix(query.Type, "History") {
			if viewer.IsInternal(ctx) {
				return privacy.Skip
			}
			return privacy.Denyf("rowboat tenant history requires an internal viewer")
		}
		if _, ok := viewer.UserID(ctx); ok || viewer.IsInternal(ctx) {
			return privacy.Skip
		}
		return privacy.Denyf("rowboat tenant entity requires an authenticated or internal viewer")
	})
	return privacy.Policy{
		Query:    privacy.QueryPolicy{rule},
		Mutation: privacy.MutationPolicy{rule},
	}
}

// UTCNow is the shared time default for every schema timestamp. Always UTC:
// SQLite stores time as TEXT, so a local-zone default makes ts-window queries
// and keyset cursors (which compare against UTC bounds) silently miss or
// duplicate rows around the local/UTC date boundary — daily spend caps and
// cloud-event pagination both hit this in dev. Postgres (timestamptz) is
// unaffected either way.
func UTCNow() time.Time { return time.Now().UTC() }

// Fields of the BaseMixin.
func (BaseMixin) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Default(uuid.New).
			Annotations(entproto.Field(1)),
		field.Time("created_at").Default(UTCNow).Immutable().
			Annotations(entproto.Field(2)),
		field.Time("updated_at").Default(UTCNow).UpdateDefault(UTCNow).
			Annotations(entproto.Field(3)),
	}
}
