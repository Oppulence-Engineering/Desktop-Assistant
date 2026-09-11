package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspacemember"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/workspacefeaturecontrol"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/credits"
	"github.com/google/uuid"
)

// NewWorkspaceReadTool exposes the existing tenant-scoped workspace reads to agents.
func NewWorkspaceReadTool(client *ent.Client, ownerID uuid.UUID) Tool {
	return &workspaceReadTool{client: client, ownerID: ownerID}
}

type workspaceReadTool struct {
	client  *ent.Client
	ownerID uuid.UUID
}

func (t *workspaceReadTool) Name() string { return "workspace.read" }
func (t *workspaceReadTool) Description() string {
	return "List accessible Oppulence workspaces, read one exact workspace's summary, member access, or feature controls, or read the signed-in user's account billing and credit balance without changing them."
}
func (t *workspaceReadTool) AuditInfo(json.RawMessage) ToolAudit {
	return ToolAudit{TrustTier: TierRead, Operation: "workspace.read"}
}
func (t *workspaceReadTool) JSONSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{"view":{"type":"string","enum":["workspaces","summary","members","features","billing"]},"workspaceId":{"type":"string","format":"uuid","description":"Exact workspace ID returned by view workspaces. Required for summary, members, or features when more than one workspace is accessible. Billing is account-scoped and does not use it."}},"required":["view"],"additionalProperties":false}`)
}

type workspaceReadAccess struct {
	workspace *ent.RevenueWorkspace
	role      string
}

func (t *workspaceReadTool) accessibleWorkspaces(ctx context.Context) ([]workspaceReadAccess, error) {
	internal := auth.WithInternal(ctx)
	memberships, err := t.client.RevenueWorkspaceMember.Query().Where(
		revenueworkspacemember.StatusEQ("active"),
		revenueworkspacemember.HasUserWith(user.IDEQ(t.ownerID)),
	).WithWorkspace().All(internal)
	if err != nil {
		return nil, err
	}
	access := make([]workspaceReadAccess, 0, len(memberships))
	seen := make(map[uuid.UUID]bool, len(memberships))
	for _, membership := range memberships {
		workspace, edgeErr := membership.Edges.WorkspaceOrErr()
		if edgeErr != nil {
			return nil, edgeErr
		}
		access = append(access, workspaceReadAccess{workspace: workspace, role: membership.Role})
		seen[workspace.ID] = true
	}
	// Founding-owner edges remain readable for pre-membership workspaces, but a
	// read must never create or backfill membership state.
	founded, err := t.client.RevenueWorkspace.Query().Where(
		revenueworkspace.HasUserWith(user.IDEQ(t.ownerID)),
	).All(internal)
	if err != nil {
		return nil, err
	}
	for _, workspace := range founded {
		if !seen[workspace.ID] {
			access = append(access, workspaceReadAccess{workspace: workspace, role: "owner"})
		}
	}
	sort.Slice(access, func(i, j int) bool {
		if access[i].workspace.CreatedAt.Equal(access[j].workspace.CreatedAt) {
			return access[i].workspace.ID.String() < access[j].workspace.ID.String()
		}
		return access[i].workspace.CreatedAt.Before(access[j].workspace.CreatedAt)
	})
	return access, nil
}

func (t *workspaceReadTool) Invoke(ctx context.Context, scope ToolScope, args json.RawMessage) (json.RawMessage, error) {
	if t == nil || t.client == nil || t.ownerID == uuid.Nil {
		return nil, errors.New("workspace reader is not configured")
	}
	if scope.UserID != "" && scope.UserID != t.ownerID.String() {
		return nil, errors.New("workspace reader scope does not match workflow owner")
	}
	var input struct {
		View        string `json:"view"`
		WorkspaceID string `json:"workspaceId"`
	}
	if err := json.Unmarshal(args, &input); err != nil {
		return nil, fmt.Errorf("decode workspace read input: %w", err)
	}
	input.View = strings.ToLower(strings.TrimSpace(input.View))
	switch input.View {
	case "workspaces", "summary", "members", "features", "billing":
	default:
		return nil, errors.New("view must be workspaces, summary, members, features, or billing")
	}
	internal := auth.WithInternal(ctx)
	if input.View == "billing" {
		owner, err := t.client.User.Get(internal, t.ownerID)
		if err != nil {
			return nil, fmt.Errorf("load billing owner: %w", err)
		}
		userCtx := auth.WithUser(ctx, owner)
		subscription, err := t.client.Subscription.Query().Only(userCtx)
		if err != nil {
			return nil, fmt.Errorf("load billing subscription: %w", err)
		}
		available, err := credits.Available(userCtx, t.client, subscription.SanctionedCredits)
		if err != nil {
			return nil, fmt.Errorf("compute available credits: %w", err)
		}
		used := subscription.SanctionedCredits - available
		if used < 0 {
			used = 0
		}
		data := map[string]any{
			"plan": subscription.Plan, "status": subscription.Status,
			"sanctionedCredits": subscription.SanctionedCredits,
			"usedCredits":       used, "availableCredits": available,
		}
		if subscription.TrialExpiresAt != nil {
			data["trialExpiresAt"] = subscription.TrialExpiresAt.UTC().Format(time.RFC3339)
		}
		return json.Marshal(map[string]any{
			"view": input.View, "scope": "account",
			"asOf": time.Now().UTC().Format(time.RFC3339), "data": data,
		})
	}
	access, err := t.accessibleWorkspaces(ctx)
	if err != nil {
		return nil, fmt.Errorf("list accessible workspaces: %w", err)
	}

	var data any
	if input.View == "workspaces" {
		items := make([]map[string]any, 0, len(access))
		for _, item := range access {
			items = append(items, map[string]any{
				"id": item.workspace.ID.String(), "organizationId": item.workspace.WorkosOrgID,
				"role": item.role, "mode": item.workspace.Mode, "status": item.workspace.Status,
			})
		}
		data = items
		return json.Marshal(map[string]any{
			"view": input.View, "asOf": time.Now().UTC().Format(time.RFC3339), "data": data,
		})
	}

	var selected workspaceReadAccess
	workspaceID := strings.TrimSpace(input.WorkspaceID)
	if workspaceID == "" {
		if len(access) != 1 {
			return nil, errors.New("workspaceId is required when zero or multiple workspaces are accessible; use view workspaces first")
		}
		selected = access[0]
	} else {
		id, parseErr := uuid.Parse(workspaceID)
		if parseErr != nil {
			return nil, errors.New("workspaceId must be a UUID")
		}
		for _, item := range access {
			if item.workspace.ID == id {
				selected = item
				break
			}
		}
		if selected.workspace == nil {
			return nil, errors.New("workspace not found")
		}
	}
	switch input.View {
	case "summary":
		data = map[string]any{
			"id": selected.workspace.ID.String(), "organizationId": selected.workspace.WorkosOrgID,
			"role": selected.role, "mode": selected.workspace.Mode, "status": selected.workspace.Status,
		}
	case "members":
		members, err := t.client.RevenueWorkspaceMember.Query().Where(
			revenueworkspacemember.HasWorkspaceWith(revenueworkspace.IDEQ(selected.workspace.ID)),
		).WithUser().Order(ent.Asc(revenueworkspacemember.FieldCreatedAt)).All(internal)
		if err != nil {
			return nil, err
		}
		items := make([]map[string]any, 0, len(members))
		for _, member := range members {
			item := map[string]any{"role": member.Role, "status": member.Status}
			if user, edgeErr := member.Edges.UserOrErr(); edgeErr == nil {
				item["email"] = user.Email
			}
			items = append(items, item)
		}
		data = items
	case "features":
		controls, err := t.client.WorkspaceFeatureControl.Query().Where(
			workspacefeaturecontrol.HasWorkspaceWith(revenueworkspace.IDEQ(selected.workspace.ID)),
		).Order(ent.Asc(workspacefeaturecontrol.FieldCapability)).All(internal)
		if err != nil {
			return nil, err
		}
		items := make([]map[string]any, 0, len(controls))
		for _, control := range controls {
			items = append(items, map[string]any{
				"capability": control.Capability, "enabled": control.Enabled,
				"rolloutStage": control.RolloutStage, "reasonCode": control.ReasonCode,
			})
		}
		data = items
	}
	return json.Marshal(map[string]any{
		"view": input.View, "workspaceId": selected.workspace.ID.String(),
		"asOf": time.Now().UTC().Format(time.RFC3339), "data": data,
	})
}
