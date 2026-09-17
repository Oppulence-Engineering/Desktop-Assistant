// Package console owns authenticated, durable console preferences and
// user-authored workspace artifacts.
package console

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
)

// Stable domain errors are translated to RFC 9457 responses by the handler.
var (
	ErrForbidden    = errors.New("console access forbidden")
	ErrNotFound     = errors.New("console resource not found")
	ErrInvalidInput = errors.New("invalid console input")
	ErrDuplicate    = errors.New("console resource already exists")
)

// ResourceKind is the closed set of persisted console artifact types.
type ResourceKind string

const (
	// KindNoteTemplate identifies reusable note authoring content.
	KindNoteTemplate ResourceKind = "note_template"
	// KindNoteFavorite identifies an idempotent note reference.
	KindNoteFavorite ResourceKind = "note_favorite"
	// KindGraphSavedView identifies saved relationship graph controls.
	KindGraphSavedView ResourceKind = "graph_saved_view"
)

// WorkspaceAccess distinguishes read resolution from mutating authorization.
type WorkspaceAccess string

const (
	// WorkspaceRead requires an active membership with view capability.
	WorkspaceRead WorkspaceAccess = "read"
	// WorkspaceWrite requires an active contributor, admin, or owner role.
	WorkspaceWrite WorkspaceAccess = "write"
)

// WorkspaceResolver is the narrow seam between console state and the revenue
// workspace domain. It keeps organization selection and role policy canonical
// without making either feature package depend on the other.
type WorkspaceResolver interface {
	ResolveConsoleWorkspace(context.Context, *ent.User, string, WorkspaceAccess) (*ent.RevenueWorkspace, error)
}

// WorkspaceResolverFunc adapts composition-root policy to WorkspaceResolver.
type WorkspaceResolverFunc func(context.Context, *ent.User, string, WorkspaceAccess) (*ent.RevenueWorkspace, error)

// ResolveConsoleWorkspace calls f.
func (f WorkspaceResolverFunc) ResolveConsoleWorkspace(
	ctx context.Context,
	user *ent.User,
	workosOrgID string,
	access WorkspaceAccess,
) (*ent.RevenueWorkspace, error) {
	return f(ctx, user, workosOrgID, access)
}

// Preferences is the complete server-synced preference document.
type Preferences struct {
	DisplayName        string `json:"displayName"`
	DefaultAgentSlug   string `json:"defaultAgentSlug"`
	ShareUsageData     bool   `json:"shareUsageData"`
	NotificationLevel  string `json:"notificationLevel"`
	ShowModelReasoning bool   `json:"showModelReasoning"`
	Theme              string `json:"theme"`
}

// PreferencesPatch uses pointers so false and empty values remain meaningful.
type PreferencesPatch struct {
	DisplayName        *string `json:"displayName"`
	DefaultAgentSlug   *string `json:"defaultAgentSlug"`
	ShareUsageData     *bool   `json:"shareUsageData"`
	NotificationLevel  *string `json:"notificationLevel"`
	ShowModelReasoning *bool   `json:"showModelReasoning"`
	Theme              *string `json:"theme"`
}

// ResourceCreate is the transport-independent create command.
type ResourceCreate struct {
	Kind      ResourceKind    `json:"kind"`
	Name      string          `json:"name"`
	Payload   json.RawMessage `json:"payload"`
	SortOrder int             `json:"sortOrder"`
}

// ResourcePatch updates mutable resource fields while preserving kind/owner.
type ResourcePatch struct {
	Name      *string          `json:"name"`
	Payload   *json.RawMessage `json:"payload"`
	SortOrder *int             `json:"sortOrder"`
}

// Resource is the explicit public DTO; persistence-only normalized keys and
// ownership foreign keys never leave the service.
type Resource struct {
	ID        string          `json:"id"`
	Kind      ResourceKind    `json:"kind"`
	Name      string          `json:"name,omitempty"`
	Payload   json.RawMessage `json:"payload"`
	SortOrder int             `json:"sortOrder"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// ResourcePage is a bounded list response.
type ResourcePage struct {
	Resources []Resource `json:"resources"`
	Limit     int        `json:"limit"`
	Offset    int        `json:"offset"`
}
