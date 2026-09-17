package console

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/revenue"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const testOrganizationID = "org_console_test"

type consoleFixture struct {
	database  *db.DB
	client    *ent.Client
	revenue   *revenue.Service
	service   *Service
	owner     *ent.User
	ownerCtx  context.Context
	workspace *ent.RevenueWorkspace
	internal  context.Context
}

func newConsoleFixture(t *testing.T) *consoleFixture {
	t.Helper()
	database, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	internal := auth.WithInternal(context.Background())
	owner := database.Client.User.Create().
		SetEmail("owner@example.com").
		SetWorkosUserID("user_console_owner").
		SetWorkosOrgID(testOrganizationID).
		SaveX(internal)
	ownerCtx := auth.WithUser(context.Background(), owner)
	revenueService := revenue.NewService(database.Client, nil, nil, zap.NewNop())
	workspace, err := revenueService.CurrentWorkspace(ownerCtx, owner)
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	resolver := WorkspaceResolverFunc(func(
		ctx context.Context,
		user *ent.User,
		organizationID string,
		access WorkspaceAccess,
	) (*ent.RevenueWorkspace, error) {
		workspace, err := revenueService.CurrentWorkspaceForOrg(ctx, user, organizationID)
		if err != nil {
			if ent.IsNotFound(err) || errors.Is(err, revenue.ErrForbidden) {
				return nil, ErrForbidden
			}
			return nil, err
		}
		capability := revenue.WorkspaceView
		if access == WorkspaceWrite {
			capability = revenue.WorkspaceContribute
		}
		if _, err := revenueService.RequireWorkspaceCapability(ctx, user, workspace, capability); err != nil {
			if errors.Is(err, revenue.ErrForbidden) {
				return nil, ErrForbidden
			}
			return nil, err
		}
		return workspace, nil
	})
	return &consoleFixture{
		database: database, client: database.Client, revenue: revenueService,
		service: NewService(database.Client, resolver),
		owner:   owner, ownerCtx: ownerCtx, workspace: workspace, internal: internal,
	}
}

func TestPreferencesPatchMergesTypedDocument(t *testing.T) {
	fixture := newConsoleFixture(t)
	defaults, err := fixture.service.GetPreferences(fixture.ownerCtx, fixture.owner)
	if err != nil {
		t.Fatal(err)
	}
	if defaults.Theme != "system" || defaults.NotificationLevel != "off" {
		t.Fatalf("unexpected defaults: %#v", defaults)
	}

	name, usage, theme := " Ada Lovelace ", true, "dark"
	updated, err := fixture.service.PatchPreferences(fixture.ownerCtx, fixture.owner, PreferencesPatch{
		DisplayName: &name, ShareUsageData: &usage, Theme: &theme,
	})
	if err != nil {
		t.Fatalf("patch preferences: %v", err)
	}
	if updated.DisplayName != "Ada Lovelace" || !updated.ShareUsageData || updated.Theme != "dark" {
		t.Fatalf("unexpected updated preferences: %#v", updated)
	}
	reloaded, err := fixture.service.GetPreferences(fixture.ownerCtx, fixture.owner)
	if err != nil || reloaded != updated {
		t.Fatalf("reloaded preferences = %#v, %v; want %#v", reloaded, err, updated)
	}

	invalidTheme := "sepia"
	if _, err := fixture.service.PatchPreferences(fixture.ownerCtx, fixture.owner, PreferencesPatch{Theme: &invalidTheme}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid theme error = %v, want ErrInvalidInput", err)
	}
	unchanged, _ := fixture.service.GetPreferences(fixture.ownerCtx, fixture.owner)
	if unchanged != updated {
		t.Fatalf("invalid patch mutated preferences: %#v", unchanged)
	}
}

func TestResourceKindsValidateAndPersistCanonicalPayloads(t *testing.T) {
	fixture := newConsoleFixture(t)
	cases := []ResourceCreate{
		{
			Kind: KindNoteTemplate, Name: " Weekly Review ",
			Payload: json.RawMessage(`{"title":"Weekly Review","body":"Agenda","content":[{"type":"p","children":[{"text":"Hello"}]}]}`),
		},
		{
			Kind:    KindNoteFavorite,
			Payload: json.RawMessage(`{"noteId":"note-123"}`),
		},
		{
			Kind: KindGraphSavedView, Name: "At Risk",
			Payload: json.RawMessage(`{"state":{"scope":"portfolio","query":"at risk","layout":"force","density":0.72,"hideIsolated":false,"focusDepth":0,"changedSinceReview":true}}`),
		},
	}
	for _, input := range cases {
		resource, created, err := fixture.service.CreateResource(fixture.ownerCtx, fixture.owner, testOrganizationID, input)
		if err != nil || !created {
			t.Fatalf("create %s: created=%v err=%v", input.Kind, created, err)
		}
		if resource.Kind != input.Kind || !json.Valid(resource.Payload) {
			t.Fatalf("invalid %s response: %#v", input.Kind, resource)
		}
	}
	for _, kind := range []ResourceKind{KindNoteTemplate, KindNoteFavorite, KindGraphSavedView} {
		page, err := fixture.service.ListResources(fixture.ownerCtx, fixture.owner, testOrganizationID, kind, 10, 0)
		if err != nil || len(page.Resources) != 1 {
			t.Fatalf("list %s: page=%#v err=%v", kind, page, err)
		}
	}

	invalid := []ResourceCreate{
		{Kind: KindNoteTemplate, Name: "", Payload: json.RawMessage(`{"title":"x"}`)},
		{Kind: KindNoteFavorite, Payload: json.RawMessage(`{"noteId":"","extra":true}`)},
		{Kind: KindGraphSavedView, Name: "Bad", Payload: json.RawMessage(`{"state":{"scope":"portfolio","layout":"force","density":2,"focusDepth":0}}`)},
	}
	for _, input := range invalid {
		if _, _, err := fixture.service.CreateResource(fixture.ownerCtx, fixture.owner, testOrganizationID, input); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("invalid %s error = %v, want ErrInvalidInput", input.Kind, err)
		}
	}
}

func TestFavoriteReplayIsIdempotentAndNamesAreUnique(t *testing.T) {
	fixture := newConsoleFixture(t)
	favorite := ResourceCreate{Kind: KindNoteFavorite, Payload: json.RawMessage(`{"noteId":"note-123"}`)}
	first, created, err := fixture.service.CreateResource(fixture.ownerCtx, fixture.owner, testOrganizationID, favorite)
	if err != nil || !created {
		t.Fatalf("first favorite: created=%v err=%v", created, err)
	}
	second, created, err := fixture.service.CreateResource(fixture.ownerCtx, fixture.owner, testOrganizationID, favorite)
	if err != nil || created || second.ID != first.ID {
		t.Fatalf("replayed favorite: resource=%#v created=%v err=%v", second, created, err)
	}
	if got := fixture.client.ConsoleResource.Query().CountX(fixture.internal); got != 1 {
		t.Fatalf("favorite replay persisted %d rows, want 1", got)
	}

	template := ResourceCreate{
		Kind: KindNoteTemplate, Name: "Pipeline Review",
		Payload: json.RawMessage(`{"title":"Pipeline Review"}`),
	}
	if _, _, err := fixture.service.CreateResource(fixture.ownerCtx, fixture.owner, testOrganizationID, template); err != nil {
		t.Fatal(err)
	}
	template.Name = "  PIPELINE   REVIEW "
	if _, _, err := fixture.service.CreateResource(fixture.ownerCtx, fixture.owner, testOrganizationID, template); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("duplicate normalized name error = %v, want ErrDuplicate", err)
	}
}

func TestResourcesAreIsolatedByWorkspaceAndUser(t *testing.T) {
	fixture := newConsoleFixture(t)
	ownerResource, _, err := fixture.service.CreateResource(
		fixture.ownerCtx,
		fixture.owner,
		testOrganizationID,
		ResourceCreate{Kind: KindNoteFavorite, Payload: json.RawMessage(`{"noteId":"owner-note"}`)},
	)
	if err != nil {
		t.Fatal(err)
	}

	member := fixture.client.User.Create().
		SetEmail("member@example.com").
		SetWorkosUserID("user_console_member").
		SaveX(fixture.internal)
	if _, err := fixture.revenue.UpsertWorkspaceMember(fixture.ownerCtx, fixture.owner, member.ID, "member"); err != nil {
		t.Fatalf("add member: %v", err)
	}
	memberCtx := auth.WithUser(context.Background(), member)
	memberResource, _, err := fixture.service.CreateResource(
		memberCtx,
		member,
		testOrganizationID,
		ResourceCreate{Kind: KindNoteFavorite, Payload: json.RawMessage(`{"noteId":"member-note"}`)},
	)
	if err != nil {
		t.Fatalf("member create: %v", err)
	}
	memberPage, err := fixture.service.ListResources(memberCtx, member, testOrganizationID, KindNoteFavorite, 10, 0)
	if err != nil || len(memberPage.Resources) != 1 || memberPage.Resources[0].ID != memberResource.ID {
		t.Fatalf("member list leaked owner data: %#v, %v", memberPage, err)
	}
	if _, err := fixture.service.GetResource(memberCtx, member, testOrganizationID, mustUUID(t, ownerResource.ID)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("member read owner resource error = %v, want ErrNotFound", err)
	}

	intruder := fixture.client.User.Create().
		SetEmail("intruder@example.com").
		SetWorkosUserID("user_console_intruder").
		SaveX(fixture.internal)
	intruderCtx := auth.WithUser(context.Background(), intruder)
	if _, err := fixture.service.ListResources(intruderCtx, intruder, testOrganizationID, KindNoteFavorite, 10, 0); !errors.Is(err, ErrForbidden) {
		t.Fatalf("unrelated workspace list error = %v, want ErrForbidden", err)
	}
	if _, err := fixture.client.ConsoleResource.Create().
		SetWorkspace(fixture.workspace).
		SetUser(intruder).
		SetKind(string(KindNoteFavorite)).
		SetNoteID("forged-note").
		SetPayloadJSON(`{"noteId":"forged-note"}`).
		Save(intruderCtx); !errors.Is(err, db.ErrTenantMutation) {
		t.Fatalf("direct cross-workspace create error = %v, want ErrTenantMutation", err)
	}
	if _, err := fixture.client.ConsoleResource.Get(intruderCtx, mustUUID(t, ownerResource.ID)); !ent.IsNotFound(err) {
		t.Fatalf("tenant interceptor exposed owner resource: %v", err)
	}
}

func TestViewerCanReadOwnResourcesButCannotMutate(t *testing.T) {
	fixture := newConsoleFixture(t)
	viewer := fixture.client.User.Create().
		SetEmail("viewer@example.com").
		SetWorkosUserID("user_console_viewer").
		SaveX(fixture.internal)
	if _, err := fixture.revenue.UpsertWorkspaceMember(fixture.ownerCtx, fixture.owner, viewer.ID, "viewer"); err != nil {
		t.Fatalf("add viewer: %v", err)
	}
	fixture.client.ConsoleResource.Create().
		SetWorkspace(fixture.workspace).
		SetUser(viewer).
		SetKind(string(KindNoteFavorite)).
		SetNoteID("viewer-note").
		SetPayloadJSON(`{"noteId":"viewer-note"}`).
		SaveX(fixture.internal)
	viewerCtx := auth.WithUser(context.Background(), viewer)
	page, err := fixture.service.ListResources(viewerCtx, viewer, testOrganizationID, KindNoteFavorite, 10, 0)
	if err != nil || len(page.Resources) != 1 {
		t.Fatalf("viewer read: page=%#v err=%v", page, err)
	}
	if _, _, err := fixture.service.CreateResource(
		viewerCtx,
		viewer,
		testOrganizationID,
		ResourceCreate{Kind: KindNoteFavorite, Payload: json.RawMessage(`{"noteId":"blocked"}`)},
	); !errors.Is(err, ErrForbidden) {
		t.Fatalf("viewer create error = %v, want ErrForbidden", err)
	}
}

func TestAccountDeletionCascadesConsoleState(t *testing.T) {
	fixture := newConsoleFixture(t)
	enabled := true
	if _, err := fixture.service.PatchPreferences(fixture.ownerCtx, fixture.owner, PreferencesPatch{ShareUsageData: &enabled}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := fixture.service.CreateResource(
		fixture.ownerCtx,
		fixture.owner,
		testOrganizationID,
		ResourceCreate{Kind: KindNoteFavorite, Payload: json.RawMessage(`{"noteId":"delete-me"}`)},
	); err != nil {
		t.Fatal(err)
	}
	if err := fixture.database.DeleteAccount(fixture.ownerCtx, fixture.owner.ID, nil); err != nil {
		t.Fatalf("delete account: %v", err)
	}
	if got := fixture.client.UserPreference.Query().CountX(fixture.internal); got != 0 {
		t.Fatalf("%d preference rows survived account deletion", got)
	}
	if got := fixture.client.ConsoleResource.Query().CountX(fixture.internal); got != 0 {
		t.Fatalf("%d console resources survived account deletion", got)
	}
}

func mustUUID(t *testing.T, value string) uuid.UUID {
	t.Helper()
	parsed, err := uuid.Parse(value)
	if err != nil {
		t.Fatalf("parse UUID %q: %v", value, err)
	}
	return parsed
}
