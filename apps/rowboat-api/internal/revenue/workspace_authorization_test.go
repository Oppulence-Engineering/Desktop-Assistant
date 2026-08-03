package revenue

import (
	"errors"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
)

func TestWorkspaceRoleAndResourceAuthorizationMatrix(t *testing.T) {
	f := newFixture(t)
	ownerWorkspace, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatalf("owner workspace: %v", err)
	}
	rel := f.relationship(t)

	memberUser := newUser(t, f.client, "member@x.co", "user_workspace_member")
	member, err := f.svc.UpsertWorkspaceMember(f.ctx, f.user, memberUser.ID, "member")
	if err != nil {
		t.Fatalf("grant member: %v", err)
	}
	memberCtx := auth.WithUser(f.ctx, memberUser)
	memberWorkspace, err := f.svc.CurrentWorkspace(memberCtx, memberUser)
	if err != nil || memberWorkspace.ID != ownerWorkspace.ID {
		t.Fatalf("member workspace: ws=%#v err=%v", memberWorkspace, err)
	}
	if got, err := f.svc.GetRelationship(memberCtx, rel.ID); err != nil || got.ID != rel.ID {
		t.Fatalf("member cannot read shared relationship: rel=%#v err=%v", got, err)
	}
	if _, err := f.svc.CreateRelationship(memberCtx, memberUser, RelationshipInput{
		Kind: "company", DisplayName: "Member-created account",
	}); err != nil {
		t.Fatalf("member contribute: %v", err)
	}
	if _, err := rel.Update().SetSummary("member update").Save(memberCtx); err != nil {
		t.Fatalf("database boundary rejected member write: %v", err)
	}
	if _, err := f.svc.UpsertWorkspaceMember(memberCtx, memberUser, f.user.ID, "viewer"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member must not manage members, got %v", err)
	}

	viewerUser := newUser(t, f.client, "viewer@x.co", "user_workspace_viewer")
	viewer, err := f.svc.UpsertWorkspaceMember(f.ctx, f.user, viewerUser.ID, "viewer")
	if err != nil {
		t.Fatalf("grant viewer: %v", err)
	}
	viewerCtx := auth.WithUser(f.ctx, viewerUser)
	if got, err := f.svc.GetRelationship(viewerCtx, rel.ID); err != nil || got.ID != rel.ID {
		t.Fatalf("viewer read: rel=%#v err=%v", got, err)
	}
	if _, err := f.svc.CreateRelationship(viewerCtx, viewerUser, RelationshipInput{
		Kind: "company", DisplayName: "Forbidden account",
	}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("viewer service write must fail with ErrForbidden, got %v", err)
	}
	if _, err := rel.Update().SetSummary("viewer corruption").Save(viewerCtx); err == nil || !ent.IsNotFound(err) {
		t.Fatalf("viewer direct mutation must fail closed, got %v", err)
	}

	adminUser := newUser(t, f.client, "admin@x.co", "user_workspace_admin")
	if _, err := f.svc.UpsertWorkspaceMember(f.ctx, f.user, adminUser.ID, "admin"); err != nil {
		t.Fatalf("owner grant admin: %v", err)
	}
	adminCtx := auth.WithUser(f.ctx, adminUser)
	invitee := newUser(t, f.client, "invitee@x.co", "user_workspace_invitee")
	if _, err := f.svc.UpsertWorkspaceMember(adminCtx, adminUser, invitee.ID, "member"); err != nil {
		t.Fatalf("admin grant member: %v", err)
	}
	if _, err := f.svc.UpsertWorkspaceMember(adminCtx, adminUser, invitee.ID, "admin"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("only owner may grant admin, got %v", err)
	}

	if _, err := f.svc.RemoveWorkspaceMember(f.ctx, f.user, member.ID); err != nil {
		t.Fatalf("remove member: %v", err)
	}
	if _, err := f.svc.GetRelationship(memberCtx, rel.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("removed member retained resource access: %v", err)
	}
	if _, err := f.svc.RemoveWorkspaceMember(f.ctx, f.user, viewer.ID); err != nil {
		t.Fatalf("remove viewer: %v", err)
	}
}

func TestWorkspaceBoundaryRejectsUnrelatedTenant(t *testing.T) {
	f := newFixture(t)
	rel := f.relationship(t)
	intruder := newUser(t, f.client, "unrelated@x.co", "user_unrelated_workspace")
	intruderCtx := auth.WithUser(f.ctx, intruder)

	if _, err := f.svc.GetRelationship(intruderCtx, rel.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-workspace relationship read: %v", err)
	}
	if _, err := rel.Update().SetSummary("cross-tenant corruption").Save(intruderCtx); err == nil {
		t.Fatal("cross-workspace direct mutation succeeded")
	}
	if _, err := f.client.RevenueWorkspaceMember.Create().
		SetWorkspaceID(rel.QueryWorkspace().OnlyX(f.ctx).ID).
		SetUser(intruder).
		SetRole("member").
		Save(intruderCtx); !errors.Is(err, db.ErrTenantMutation) {
		// Creation requires a workspace edge and actor-safe service path; direct
		// self-enrollment must never become the authorization API.
		t.Fatalf("direct self-enrollment must fail closed, got %v", err)
	}
}
