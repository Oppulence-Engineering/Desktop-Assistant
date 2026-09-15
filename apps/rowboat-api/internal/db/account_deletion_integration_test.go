package db_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentdefinitionhistory"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/llmusagehistory"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/person"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipreviewacknowledgement"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueaction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueactionrevision"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspacemember"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/subscription"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/subscriptionhistory"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/userhistory"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
)

var deletionCtx = auth.WithInternal(context.Background())

type deletionAccount struct {
	user         *ent.User
	workspace    *ent.RevenueWorkspace
	relationship *ent.Relationship
}

func deletionUser(c *ent.Client, name string) *ent.User {
	return c.User.Create().SetEmail(name + "@example.test").SetWorkosUserID("user_" + name).SaveX(deletionCtx)
}

func deletionOwner(c *ent.Client, name string) deletionAccount {
	u := deletionUser(c, name)
	ws := c.RevenueWorkspace.Create().SetUser(u).SaveX(deletionCtx)
	deletionMembership(c, ws, u, "owner", "active")
	rel := c.Relationship.Create().SetWorkspace(ws).SetUser(u).SetKind("company").SetDisplayName(name + " account").SaveX(deletionCtx)
	return deletionAccount{user: u, workspace: ws, relationship: rel}
}

func deletionMembership(c *ent.Client, ws *ent.RevenueWorkspace, u *ent.User, role, status string) {
	c.RevenueWorkspaceMember.Create().SetWorkspace(ws).SetUser(u).SetRole(role).SetStatus(status).SaveX(deletionCtx)
}

func deletionPerson(c *ent.Client, ws *ent.RevenueWorkspace, u *ent.User, email string) *ent.Person {
	return c.Person.Create().SetWorkspace(ws).SetUser(u).SetDisplayName("Ada").SetPrimaryEmail(email).SaveX(deletionCtx)
}

func deletionAction(c *ent.Client, ws *ent.RevenueWorkspace, rel *ent.Relationship, u *ent.User, key string) *ent.RevenueAction {
	return c.RevenueAction.Create().SetWorkspace(ws).SetRelationship(rel).SetUser(u).
		SetActionType("warm_follow_up").SetChannel("email").SetDetector("manual").
		SetDedupeKey(key).SetRevisionHash("hash-" + key).SetReason("Follow up on the renewal.").
		SetPriorityScore(50).SaveX(deletionCtx)
}

func deletionRevision(c *ent.Client, action *ent.RevenueAction, u *ent.User) *ent.RevenueActionRevision {
	return c.RevenueActionRevision.Create().SetAction(action).SetUser(u).SetRevision(1).
		SetRevisionHash(action.RevisionHash).SetActionType(action.ActionType).SetChannel(action.Channel).SaveX(deletionCtx)
}

func deletionAck(c *ent.Client, ws *ent.RevenueWorkspace, rel *ent.Relationship, u *ent.User, version int) *ent.RelationshipReviewAcknowledgement {
	return c.RelationshipReviewAcknowledgement.Create().SetWorkspace(ws).SetRelationship(rel).SetUser(u).
		SetStateVersion(version).SetAcknowledgedAt(time.Now().UTC()).SaveX(deletionCtx)
}

func TestDeleteAccountRemovesTheUserAndEveryRowTheyOwn(t *testing.T) {
	d := openTest(t)
	c := d.Client
	gone := deletionOwner(c, "gone")

	sub := c.Subscription.Create().SetUser(gone.user).SetSanctionedCredits(10).SaveX(deletionCtx)
	c.Subscription.UpdateOne(sub).SetPlan("pro").SaveX(deletionCtx)
	usage := c.LLMUsage.Create().SetUser(gone.user).SetModel("gpt-test").SetRequestID(uuid.New()).SaveX(deletionCtx)
	c.LLMUsage.UpdateOne(usage).SetCostUnits(7).SaveX(deletionCtx)
	agent := c.AgentDefinition.Create().SetUser(gone.user).SetSlug("helper").SetName("Helper").SaveX(deletionCtx)
	c.AgentDefinition.UpdateOne(agent).SetName("Helper v2").SaveX(deletionCtx)
	c.User.UpdateOne(gone.user).SetEmail("gone-renamed@example.test").SaveX(deletionCtx)
	c.CreditLedger.Create().SetUser(gone.user).SetDelta(-5).SetReason("llm_call.reserve").
		SetRequestID(uuid.New()).SetTs(time.Now().UTC()).SaveX(deletionCtx)
	ack := deletionAck(c, gone.workspace, gone.relationship, gone.user, 1) // append-only in the ORM
	action := deletionAction(c, gone.workspace, gone.relationship, gone.user, "solo")
	revision := deletionRevision(c, action, gone.user)
	p := deletionPerson(c, gone.workspace, gone.user, "ada@solo.test")

	histories := map[string]func() int{
		"subscription_histories": func() int {
			return c.SubscriptionHistory.Query().Where(subscriptionhistory.RefEQ(sub.ID)).CountX(deletionCtx)
		},
		"llm_usage_histories": func() int {
			return c.LLMUsageHistory.Query().Where(llmusagehistory.RefEQ(usage.ID)).CountX(deletionCtx)
		},
		"agentdefinition_history": func() int {
			return c.AgentDefinitionHistory.Query().Where(agentdefinitionhistory.RefEQ(agent.ID)).CountX(deletionCtx)
		},
		"user_histories": func() int { return c.UserHistory.Query().Where(userhistory.RefEQ(gone.user.ID)).CountX(deletionCtx) },
	}
	for name, count := range histories {
		if count() == 0 {
			t.Fatalf("precondition: no %s rows were written, so the purge check would prove nothing", name)
		}
	}

	if err := d.DeleteAccount(context.Background(), gone.user.ID, nil); err != nil {
		t.Fatalf("DeleteAccount: %v", err)
	}

	remaining := map[string]bool{
		"user":          c.User.Query().Where(user.IDEQ(gone.user.ID)).ExistX(deletionCtx),
		"workspace":     c.RevenueWorkspace.Query().Where(revenueworkspace.IDEQ(gone.workspace.ID)).ExistX(deletionCtx),
		"membership":    c.RevenueWorkspaceMember.Query().Where(revenueworkspacemember.HasWorkspaceWith(revenueworkspace.IDEQ(gone.workspace.ID))).ExistX(deletionCtx),
		"relationship":  c.Relationship.Query().Where(relationship.IDEQ(gone.relationship.ID)).ExistX(deletionCtx),
		"person":        c.Person.Query().Where(person.IDEQ(p.ID)).ExistX(deletionCtx),
		"review ack":    c.RelationshipReviewAcknowledgement.Query().Where(relationshipreviewacknowledgement.IDEQ(ack.ID)).ExistX(deletionCtx),
		"action":        c.RevenueAction.Query().Where(revenueaction.IDEQ(action.ID)).ExistX(deletionCtx),
		"revision":      c.RevenueActionRevision.Query().Where(revenueactionrevision.IDEQ(revision.ID)).ExistX(deletionCtx),
		"subscription":  c.Subscription.Query().CountX(deletionCtx) > 0,
		"credit ledger": c.CreditLedger.Query().CountX(deletionCtx) > 0,
		"llm usage":     c.LLMUsage.Query().CountX(deletionCtx) > 0,
		"agent":         c.AgentDefinition.Query().CountX(deletionCtx) > 0,
	}
	for name, exists := range remaining {
		if exists {
			t.Errorf("%s survived the account deletion", name)
		}
	}
	for name, count := range histories {
		if n := count(); n != 0 {
			t.Errorf("%s still holds %d rows for the deleted account", name, n)
		}
	}
}

func TestDeleteAccountLeavesOtherAccountsAndTheirHistory(t *testing.T) {
	d := openTest(t)
	c := d.Client
	gone := deletionOwner(c, "gone")
	kept := deletionOwner(c, "kept")
	for _, u := range []*ent.User{gone.user, kept.user} {
		sub := c.Subscription.Create().SetUser(u).SetSanctionedCredits(10).SaveX(deletionCtx)
		c.Subscription.UpdateOne(sub).SetPlan("starter").SaveX(deletionCtx)
	}
	keptSub := c.Subscription.Query().Where(subscription.HasUserWith(user.IDEQ(kept.user.ID))).OnlyX(deletionCtx)
	keptSubHistory := c.SubscriptionHistory.Query().Where(subscriptionhistory.RefEQ(keptSub.ID)).CountX(deletionCtx)
	keptUserHistory := c.UserHistory.Query().Where(userhistory.RefEQ(kept.user.ID)).CountX(deletionCtx)

	if err := d.DeleteAccount(context.Background(), gone.user.ID, nil); err != nil {
		t.Fatal(err)
	}

	if !c.User.Query().Where(user.IDEQ(kept.user.ID)).ExistX(deletionCtx) ||
		!c.RevenueWorkspace.Query().Where(revenueworkspace.IDEQ(kept.workspace.ID)).ExistX(deletionCtx) ||
		!c.Relationship.Query().Where(relationship.IDEQ(kept.relationship.ID)).ExistX(deletionCtx) {
		t.Fatal("the other account lost data")
	}
	if n := c.SubscriptionHistory.Query().Where(subscriptionhistory.RefEQ(keptSub.ID)).CountX(deletionCtx); n != keptSubHistory {
		t.Errorf("other account subscription history = %d rows, want %d", n, keptSubHistory)
	}
	if n := c.UserHistory.Query().Where(userhistory.RefEQ(kept.user.ID)).CountX(deletionCtx); n != keptUserHistory {
		t.Errorf("other account user history = %d rows, want %d", n, keptUserHistory)
	}
}

func TestDeleteAccountReportsAMissingUser(t *testing.T) {
	d := openTest(t)
	kept := deletionOwner(d.Client, "kept")
	err := d.DeleteAccount(context.Background(), uuid.New(), nil)
	if !errors.Is(err, db.ErrAccountNotFound) {
		t.Fatalf("DeleteAccount(unknown) = %v, want ErrAccountNotFound", err)
	}
	if !d.Client.User.Query().Where(user.IDEQ(kept.user.ID)).ExistX(deletionCtx) {
		t.Fatal("a failed deletion removed another account")
	}
}

func assertOwner(t *testing.T, c *ent.Client, ws *ent.RevenueWorkspace, want *ent.User) {
	t.Helper()
	if got := c.RevenueWorkspace.Query().Where(revenueworkspace.IDEQ(ws.ID)).QueryUser().OnlyIDX(deletionCtx); got != want.ID {
		t.Fatalf("workspace owner = %s, want %s", got, want.ID)
	}
}

func TestDeleteAccountRollsBackWhenTheWorkspaceIsNotTheUsers(t *testing.T) {
	d := openTest(t)
	c := d.Client
	gone := deletionOwner(c, "gone")
	other := deletionOwner(c, "other")

	err := d.DeleteAccount(context.Background(), gone.user.ID, []db.WorkspaceTransfer{{WorkspaceID: other.workspace.ID, SuccessorID: other.user.ID}})
	if !errors.Is(err, db.ErrWorkspaceTransferConflict) {
		t.Fatalf("DeleteAccount = %v, want ErrWorkspaceTransferConflict", err)
	}
	if !c.User.Query().Where(user.IDEQ(gone.user.ID)).ExistX(deletionCtx) {
		t.Fatal("the account was deleted despite the conflict")
	}
	assertOwner(t, c, gone.workspace, gone.user)
	assertOwner(t, c, other.workspace, other.user)
}

func TestDeleteAccountRollsBackWhenTheSuccessorIsNotAnActiveMember(t *testing.T) {
	d := openTest(t)
	c := d.Client
	gone := deletionOwner(c, "gone")
	former := deletionUser(c, "former")
	deletionMembership(c, gone.workspace, former, "admin", "removed")

	err := d.DeleteAccount(context.Background(), gone.user.ID, []db.WorkspaceTransfer{{WorkspaceID: gone.workspace.ID, SuccessorID: former.ID}})
	if !errors.Is(err, db.ErrWorkspaceTransferConflict) {
		t.Fatalf("DeleteAccount = %v, want ErrWorkspaceTransferConflict", err)
	}
	// The owner column was already updated inside the transaction; it must roll back.
	assertOwner(t, c, gone.workspace, gone.user)
	if !c.User.Query().Where(user.IDEQ(gone.user.ID)).ExistX(deletionCtx) {
		t.Fatal("the account was deleted despite the conflict")
	}
}

func TestDeleteAccountRollsBackWhenTheSuccessorAlreadyOwnsAWorkspace(t *testing.T) {
	d := openTest(t)
	c := d.Client
	gone := deletionOwner(c, "gone")
	busy := deletionOwner(c, "busy")
	deletionMembership(c, gone.workspace, busy.user, "admin", "active")

	err := d.DeleteAccount(context.Background(), gone.user.ID, []db.WorkspaceTransfer{{WorkspaceID: gone.workspace.ID, SuccessorID: busy.user.ID}})
	if err == nil {
		t.Fatal("DeleteAccount succeeded although the successor already owns a workspace")
	}
	assertOwner(t, c, gone.workspace, gone.user)
	assertOwner(t, c, busy.workspace, busy.user)
	if !c.User.Query().Where(user.IDEQ(gone.user.ID)).ExistX(deletionCtx) {
		t.Fatal("the account was deleted despite the failure")
	}
}

func TestDeleteAccountMovesSharedRowsToTheNewOwner(t *testing.T) {
	d := openTest(t)
	c := d.Client
	owner := deletionOwner(c, "owner")
	member := deletionUser(c, "member")
	deletionMembership(c, owner.workspace, member, "member", "active")
	p := deletionPerson(c, owner.workspace, owner.user, "ada@shared.test")
	action := deletionAction(c, owner.workspace, owner.relationship, owner.user, "shared")
	revision := deletionRevision(c, action, owner.user)
	memberAck := deletionAck(c, owner.workspace, owner.relationship, member, 1)
	conflictingAck := deletionAck(c, owner.workspace, owner.relationship, owner.user, 1)
	ownerAck := deletionAck(c, owner.workspace, owner.relationship, owner.user, 2)

	err := d.DeleteAccount(context.Background(), owner.user.ID, []db.WorkspaceTransfer{{WorkspaceID: owner.workspace.ID, SuccessorID: member.ID}})
	if err != nil {
		t.Fatalf("DeleteAccount: %v", err)
	}

	assertOwner(t, c, owner.workspace, member)
	members := c.RevenueWorkspaceMember.Query().Where(revenueworkspacemember.HasWorkspaceWith(revenueworkspace.IDEQ(owner.workspace.ID))).AllX(deletionCtx)
	if len(members) != 1 || members[0].Role != "owner" {
		t.Fatalf("memberships after transfer = %+v, want only the successor as owner", members)
	}
	authors := map[string]uuid.UUID{
		"relationship": c.Relationship.Query().Where(relationship.IDEQ(owner.relationship.ID)).QueryUser().OnlyIDX(deletionCtx),
		"person":       c.Person.Query().Where(person.IDEQ(p.ID)).QueryUser().OnlyIDX(deletionCtx),
		"action":       c.RevenueAction.Query().Where(revenueaction.IDEQ(action.ID)).QueryUser().OnlyIDX(deletionCtx),
		"revision":     c.RevenueActionRevision.Query().Where(revenueactionrevision.IDEQ(revision.ID)).QueryUser().OnlyIDX(deletionCtx),
		"review ack":   c.RelationshipReviewAcknowledgement.Query().Where(relationshipreviewacknowledgement.IDEQ(ownerAck.ID)).QueryUser().OnlyIDX(deletionCtx),
	}
	for name, author := range authors {
		if author != member.ID {
			t.Errorf("%s author = %s, want the successor", name, author)
		}
	}
	if !c.RelationshipReviewAcknowledgement.Query().Where(relationshipreviewacknowledgement.IDEQ(memberAck.ID)).ExistX(deletionCtx) {
		t.Error("the successor's own acknowledgement was deleted")
	}
	if c.RelationshipReviewAcknowledgement.Query().Where(relationshipreviewacknowledgement.IDEQ(conflictingAck.ID)).ExistX(deletionCtx) {
		t.Error("the owner's duplicate acknowledgement survived; it would break the unique index")
	}
	if n := c.RelationshipReviewAcknowledgement.Query().Where(relationshipreviewacknowledgement.StateVersionEQ(1)).CountX(deletionCtx); n != 1 {
		t.Errorf("state_version 1 acknowledgements = %d, want 1", n)
	}
}

func TestDeleteAccountMovesRowsInWorkspacesOwnedByOthers(t *testing.T) {
	d := openTest(t)
	c := d.Client
	owner := deletionOwner(c, "owner")
	leaver := deletionOwner(c, "leaver") // also owns a workspace nobody else uses
	deletionMembership(c, owner.workspace, leaver.user, "member", "active")
	rel := c.Relationship.Create().SetWorkspace(owner.workspace).SetUser(leaver.user).SetKind("company").SetDisplayName("Written by the leaver").SaveX(deletionCtx)
	p := deletionPerson(c, owner.workspace, leaver.user, "ada@others.test")

	if err := d.DeleteAccount(context.Background(), leaver.user.ID, nil); err != nil {
		t.Fatalf("DeleteAccount: %v", err)
	}

	assertOwner(t, c, owner.workspace, owner.user)
	if got := c.Relationship.Query().Where(relationship.IDEQ(rel.ID)).QueryUser().OnlyIDX(deletionCtx); got != owner.user.ID {
		t.Errorf("relationship author = %s, want the workspace owner", got)
	}
	if got := c.Person.Query().Where(person.IDEQ(p.ID)).QueryUser().OnlyIDX(deletionCtx); got != owner.user.ID {
		t.Errorf("person author = %s, want the workspace owner", got)
	}
	if n := c.RevenueWorkspaceMember.Query().Where(revenueworkspacemember.HasWorkspaceWith(revenueworkspace.IDEQ(owner.workspace.ID))).CountX(deletionCtx); n != 1 {
		t.Errorf("memberships in the owner's workspace = %d, want 1", n)
	}
	if c.RevenueWorkspace.Query().Where(revenueworkspace.IDEQ(leaver.workspace.ID)).ExistX(deletionCtx) {
		t.Error("the leaver's own workspace survived")
	}
}

func TestDeleteAccountRemovesTheEmailFromUserHistory(t *testing.T) {
	d := openTest(t)
	c := d.Client
	u := deletionUser(c, "private")
	c.User.UpdateOne(u).SetEmail("private-new@example.test").SaveX(deletionCtx)
	if c.UserHistory.Query().Where(userhistory.EmailEQ("private@example.test")).CountX(deletionCtx)+
		c.UserHistory.Query().Where(userhistory.EmailEQ("private-new@example.test")).CountX(deletionCtx) == 0 {
		t.Fatal("precondition: user history recorded no email")
	}
	if err := d.DeleteAccount(context.Background(), u.ID, nil); err != nil {
		t.Fatal(err)
	}
	for _, email := range []string{"private@example.test", "private-new@example.test"} {
		if n := c.UserHistory.Query().Where(userhistory.EmailEQ(email)).CountX(deletionCtx); n != 0 {
			t.Errorf("user_histories still holds %d rows with %s", n, email)
		}
	}
}
