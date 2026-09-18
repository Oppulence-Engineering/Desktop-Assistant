package console

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/consoleresource"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/userpreference"
	"github.com/google/uuid"
)

const (
	defaultPageLimit = 50
	maxPageLimit     = 100
	maxPageOffset    = 10_000
)

var agentSlugPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?$`)

// Service owns validation, authorization resolution, and Ent persistence for
// the console domain.
type Service struct {
	client     *ent.Client
	workspaces WorkspaceResolver
}

// NewService constructs a valid console service.
func NewService(client *ent.Client, workspaces WorkspaceResolver) *Service {
	return &Service{client: client, workspaces: workspaces}
}

// GetPreferences returns defaults when the user has not saved a document yet.
func (s *Service) GetPreferences(ctx context.Context, owner *ent.User) (Preferences, error) {
	if owner == nil {
		return Preferences{}, ErrForbidden
	}
	row, err := s.client.UserPreference.Query().
		Where(userpreference.HasUserWith(user.IDEQ(owner.ID))).
		Only(ctx)
	if ent.IsNotFound(err) {
		return defaultPreferences(), nil
	}
	if err != nil {
		return Preferences{}, fmt.Errorf("query preferences: %w", err)
	}
	var preferences Preferences
	if err := json.Unmarshal([]byte(row.PreferencesJSON), &preferences); err != nil {
		return Preferences{}, fmt.Errorf("decode stored preferences: %w", err)
	}
	return preferences, nil
}

// PatchPreferences validates and atomically replaces the canonical merged
// document. A uniqueness constraint makes first-write races converge.
func (s *Service) PatchPreferences(
	ctx context.Context,
	owner *ent.User,
	patch PreferencesPatch,
) (Preferences, error) {
	current, err := s.GetPreferences(ctx, owner)
	if err != nil {
		return Preferences{}, err
	}
	if err := applyPreferencesPatch(&current, patch); err != nil {
		return Preferences{}, err
	}
	encoded, err := json.Marshal(current)
	if err != nil {
		return Preferences{}, fmt.Errorf("encode preferences: %w", err)
	}

	row, queryErr := s.client.UserPreference.Query().
		Where(userpreference.HasUserWith(user.IDEQ(owner.ID))).
		Only(ctx)
	switch {
	case queryErr == nil:
		if _, err := row.Update().SetPreferencesJSON(string(encoded)).Save(ctx); err != nil {
			return Preferences{}, fmt.Errorf("update preferences: %w", err)
		}
	case ent.IsNotFound(queryErr):
		if _, err := s.client.UserPreference.Create().
			SetUser(owner).
			SetPreferencesJSON(string(encoded)).
			Save(ctx); err != nil {
			if !ent.IsConstraintError(err) {
				return Preferences{}, fmt.Errorf("create preferences: %w", err)
			}
			row, winnerErr := s.client.UserPreference.Query().
				Where(userpreference.HasUserWith(user.IDEQ(owner.ID))).
				Only(ctx)
			if winnerErr != nil {
				return Preferences{}, fmt.Errorf("load concurrent preferences: %w", winnerErr)
			}
			if _, winnerErr = row.Update().SetPreferencesJSON(string(encoded)).Save(ctx); winnerErr != nil {
				return Preferences{}, fmt.Errorf("update concurrent preferences: %w", winnerErr)
			}
		}
	default:
		return Preferences{}, fmt.Errorf("query preferences for update: %w", queryErr)
	}
	return current, nil
}

// ListResources returns one bounded, deterministic page for the caller.
func (s *Service) ListResources(
	ctx context.Context,
	owner *ent.User,
	workosOrgID string,
	kind ResourceKind,
	limit int,
	offset int,
) (ResourcePage, error) {
	workspace, err := s.resolveWorkspace(ctx, owner, workosOrgID, WorkspaceRead)
	if err != nil {
		return ResourcePage{}, err
	}
	if !validKind(kind) {
		return ResourcePage{}, invalid("kind must be note_template, note_favorite, or graph_saved_view")
	}
	if limit == 0 {
		limit = defaultPageLimit
	}
	if limit < 1 || limit > maxPageLimit || offset < 0 || offset > maxPageOffset {
		return ResourcePage{}, invalid("limit must be 1-%d and offset must be 0-%d", maxPageLimit, maxPageOffset)
	}
	rows, err := s.client.ConsoleResource.Query().
		Where(
			consoleresource.KindEQ(string(kind)),
			consoleresource.HasWorkspaceWith(revenueworkspace.IDEQ(workspace.ID)),
			consoleresource.HasUserWith(user.IDEQ(owner.ID)),
		).
		Order(
			ent.Asc(consoleresource.FieldSortOrder),
			ent.Desc(consoleresource.FieldCreatedAt),
			ent.Asc(consoleresource.FieldID),
		).
		Limit(limit).
		Offset(offset).
		All(ctx)
	if err != nil {
		return ResourcePage{}, fmt.Errorf("list console resources: %w", err)
	}
	resources := make([]Resource, 0, len(rows))
	for _, row := range rows {
		resources = append(resources, resourceDTO(row))
	}
	return ResourcePage{Resources: resources, Limit: limit, Offset: offset}, nil
}

// CreateResource validates and persists an artifact. Repeated favorite creates
// return the existing row, while duplicate names remain visible conflicts.
func (s *Service) CreateResource(
	ctx context.Context,
	owner *ent.User,
	workosOrgID string,
	input ResourceCreate,
) (Resource, bool, error) {
	workspace, err := s.resolveWorkspace(ctx, owner, workosOrgID, WorkspaceWrite)
	if err != nil {
		return Resource{}, false, err
	}
	normalized, err := normalizeResource(input.Kind, input.Name, input.Payload, input.SortOrder)
	if err != nil {
		return Resource{}, false, err
	}
	row, err := s.client.ConsoleResource.Create().
		SetWorkspace(workspace).
		SetUser(owner).
		SetKind(string(input.Kind)).
		SetName(normalized.name).
		SetNillableNameKey(normalized.nameKey).
		SetNillableNoteID(normalized.noteID).
		SetPayloadJSON(normalized.payloadJSON).
		SetSortOrder(normalized.sortOrder).
		Save(ctx)
	if err == nil {
		return resourceDTO(row), true, nil
	}
	if !ent.IsConstraintError(err) {
		return Resource{}, false, fmt.Errorf("create console resource: %w", err)
	}
	if input.Kind != KindNoteFavorite || normalized.noteID == nil {
		return Resource{}, false, ErrDuplicate
	}
	existing, queryErr := s.scopedResourceQuery(owner, workspace.ID).
		Where(
			consoleresource.KindEQ(string(KindNoteFavorite)),
			consoleresource.NoteIDEQ(*normalized.noteID),
		).
		Only(ctx)
	if queryErr != nil {
		return Resource{}, false, fmt.Errorf("load idempotent favorite: %w", queryErr)
	}
	return resourceDTO(existing), false, nil
}

// GetResource returns one caller-owned resource in the asserted workspace.
func (s *Service) GetResource(
	ctx context.Context,
	owner *ent.User,
	workosOrgID string,
	resourceID uuid.UUID,
) (Resource, error) {
	workspace, err := s.resolveWorkspace(ctx, owner, workosOrgID, WorkspaceRead)
	if err != nil {
		return Resource{}, err
	}
	row, err := s.scopedResourceQuery(owner, workspace.ID).
		Where(consoleresource.IDEQ(resourceID)).
		Only(ctx)
	if ent.IsNotFound(err) {
		return Resource{}, ErrNotFound
	}
	if err != nil {
		return Resource{}, fmt.Errorf("get console resource: %w", err)
	}
	return resourceDTO(row), nil
}

// PatchResource validates the complete resulting artifact before mutation.
func (s *Service) PatchResource(
	ctx context.Context,
	owner *ent.User,
	workosOrgID string,
	resourceID uuid.UUID,
	patch ResourcePatch,
) (Resource, error) {
	workspace, err := s.resolveWorkspace(ctx, owner, workosOrgID, WorkspaceWrite)
	if err != nil {
		return Resource{}, err
	}
	row, err := s.scopedResourceQuery(owner, workspace.ID).
		Where(consoleresource.IDEQ(resourceID)).
		Only(ctx)
	if ent.IsNotFound(err) {
		return Resource{}, ErrNotFound
	}
	if err != nil {
		return Resource{}, fmt.Errorf("get console resource for update: %w", err)
	}
	name := row.Name
	payload := json.RawMessage(row.PayloadJSON)
	sortOrder := row.SortOrder
	if patch.Name != nil {
		name = *patch.Name
	}
	if patch.Payload != nil {
		payload = *patch.Payload
	}
	if patch.SortOrder != nil {
		sortOrder = *patch.SortOrder
	}
	normalized, err := normalizeResource(ResourceKind(row.Kind), name, payload, sortOrder)
	if err != nil {
		return Resource{}, err
	}
	update := row.Update().
		SetName(normalized.name).
		SetPayloadJSON(normalized.payloadJSON).
		SetSortOrder(normalized.sortOrder)
	if normalized.nameKey == nil {
		update.ClearNameKey()
	} else {
		update.SetNameKey(*normalized.nameKey)
	}
	if normalized.noteID == nil {
		update.ClearNoteID()
	} else {
		update.SetNoteID(*normalized.noteID)
	}
	updated, err := update.Save(ctx)
	if ent.IsConstraintError(err) {
		return Resource{}, ErrDuplicate
	}
	if ent.IsNotFound(err) {
		return Resource{}, ErrNotFound
	}
	if err != nil {
		return Resource{}, fmt.Errorf("update console resource: %w", err)
	}
	return resourceDTO(updated), nil
}

// DeleteResource removes one caller-owned artifact.
func (s *Service) DeleteResource(
	ctx context.Context,
	owner *ent.User,
	workosOrgID string,
	resourceID uuid.UUID,
) error {
	workspace, err := s.resolveWorkspace(ctx, owner, workosOrgID, WorkspaceWrite)
	if err != nil {
		return err
	}
	row, err := s.scopedResourceQuery(owner, workspace.ID).
		Where(consoleresource.IDEQ(resourceID)).
		Only(ctx)
	if ent.IsNotFound(err) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("get console resource for delete: %w", err)
	}
	if err := s.client.ConsoleResource.DeleteOne(row).Exec(ctx); ent.IsNotFound(err) {
		return ErrNotFound
	} else if err != nil {
		return fmt.Errorf("delete console resource: %w", err)
	}
	return nil
}

func (s *Service) resolveWorkspace(
	ctx context.Context,
	owner *ent.User,
	workosOrgID string,
	access WorkspaceAccess,
) (*ent.RevenueWorkspace, error) {
	if owner == nil || s.workspaces == nil || strings.TrimSpace(workosOrgID) == "" {
		return nil, ErrForbidden
	}
	workspace, err := s.workspaces.ResolveConsoleWorkspace(ctx, owner, workosOrgID, access)
	if err != nil || workspace == nil {
		if errors.Is(err, ErrForbidden) || ent.IsNotFound(err) {
			return nil, ErrForbidden
		}
		if err != nil {
			return nil, fmt.Errorf("resolve console workspace: %w", err)
		}
		return nil, ErrForbidden
	}
	return workspace, nil
}

func (s *Service) scopedResourceQuery(owner *ent.User, workspaceID uuid.UUID) *ent.ConsoleResourceQuery {
	return s.client.ConsoleResource.Query().Where(
		consoleresource.HasUserWith(user.IDEQ(owner.ID)),
		consoleresource.HasWorkspaceWith(revenueworkspace.IDEQ(workspaceID)),
	)
}

func resourceDTO(row *ent.ConsoleResource) Resource {
	return Resource{
		ID:        row.ID.String(),
		Kind:      ResourceKind(row.Kind),
		Name:      row.Name,
		Payload:   json.RawMessage(row.PayloadJSON),
		SortOrder: row.SortOrder,
		CreatedAt: row.CreatedAt,
		UpdatedAt: row.UpdatedAt,
	}
}

func defaultPreferences() Preferences {
	return Preferences{NotificationLevel: "off", Theme: "system"}
}

func applyPreferencesPatch(current *Preferences, patch PreferencesPatch) error {
	if patch.DisplayName != nil {
		value := strings.TrimSpace(*patch.DisplayName)
		if !utf8.ValidString(value) || utf8.RuneCountInString(value) > maxNameRunes {
			return invalid("displayName must be valid UTF-8 and at most %d characters", maxNameRunes)
		}
		current.DisplayName = value
	}
	if patch.DefaultAgentSlug != nil {
		value := strings.TrimSpace(*patch.DefaultAgentSlug)
		if value != "" && !agentSlugPattern.MatchString(value) {
			return invalid("defaultAgentSlug must be a valid agent slug")
		}
		current.DefaultAgentSlug = value
	}
	if patch.ShareUsageData != nil {
		current.ShareUsageData = *patch.ShareUsageData
	}
	if patch.NotificationLevel != nil {
		if value := *patch.NotificationLevel; value != "off" && value != "attention" && value != "all" {
			return invalid("notificationLevel must be off, attention, or all")
		}
		current.NotificationLevel = *patch.NotificationLevel
	}
	if patch.ShowModelReasoning != nil {
		current.ShowModelReasoning = *patch.ShowModelReasoning
	}
	if patch.Theme != nil {
		if value := *patch.Theme; value != "light" && value != "dark" && value != "system" {
			return invalid("theme must be light, dark, or system")
		}
		current.Theme = *patch.Theme
	}
	return nil
}

func validKind(kind ResourceKind) bool {
	return kind == KindNoteTemplate || kind == KindNoteFavorite || kind == KindGraphSavedView
}
