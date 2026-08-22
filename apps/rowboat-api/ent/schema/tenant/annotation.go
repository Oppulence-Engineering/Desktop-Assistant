// Package tenant defines Rowboat-specific Ent schema annotations.
package tenant

import "entgo.io/ent/schema"

// Scope describes how a tenant-owned row is reachable from an authorized user.
type Scope string

// Tenant scope values describe each supported authorization path.
const (
	ScopeUser            Scope = "user"
	ScopeWorkspace       Scope = "workspace"
	ScopeWorkspaceRoot   Scope = "workspace_root"
	ScopeActionWorkspace Scope = "action_workspace"
)

// Annotation marks a schema as tenant-owned and records its authorization path.
// The descriptor is consumed by entc's generation-time validation hook.
type Annotation struct {
	Scope Scope `json:"scope"`
}

// Name implements schema.Annotation.
func (Annotation) Name() string { return "RowboatTenant" }

var _ schema.Annotation = Annotation{}
