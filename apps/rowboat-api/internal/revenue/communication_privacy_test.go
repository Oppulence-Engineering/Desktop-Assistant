package revenue

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/communicationinteraction"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenuetrustevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
)

func communicationPrivacyFixture(t *testing.T) (*fixture, *ent.User, context.Context, *ent.RevenueWorkspace) {
	t.Helper()
	f := newFixture(t)
	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	teammate := newUser(t, f.client, "teammate@x.co", "user_privacy_teammate")
	if _, err := f.svc.UpsertWorkspaceMember(f.ctx, f.user, teammate.ID, "member"); err != nil {
		t.Fatal(err)
	}
	return f, teammate, auth.WithUser(context.Background(), teammate), ws
}

func TestCommunicationAuthorizationPrecedenceAndOwnerBoundary(t *testing.T) {
	f, teammate, teammateCtx, ws := communicationPrivacyFixture(t)
	authz := f.svc.communicationAuthorization()
	resource := CommunicationResource{MessageID: "message-1", ThreadID: "thread-1", RelationshipID: "relationship-1"}

	decision, err := authz.Evaluate(
		teammateCtx, ws.ID, f.user.ID, teammate.ID, "owner@x.co",
		[]string{"buyer@example.com"}, resource,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !decision.Metadata || !decision.Subject || decision.Body || decision.Attachments {
		t.Fatalf("fail-closed metadata default: %#v", decision)
	}

	grant, err := f.svc.GrantCommunicationAccess(f.ctx, f.user, CommunicationGrantInput{
		Scope: "full", ResourceType: "thread", ResourceID: "thread-1", GranteeID: &teammate.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	decision, err = authz.Evaluate(
		teammateCtx, ws.ID, f.user.ID, teammate.ID, "owner@x.co",
		[]string{"buyer@example.com"}, resource,
	)
	if err != nil || !decision.Body || !decision.Attachments || decision.Reason != "explicit_grant" {
		t.Fatalf("active explicit grant: decision=%#v err=%v", decision, err)
	}

	if _, err := f.svc.CreateCommunicationPrivacyRule(f.ctx, f.user, CommunicationRuleInput{
		Kind: "protected_domain", Value: "example.com",
	}); err != nil {
		t.Fatal(err)
	}
	decision, err = authz.Evaluate(
		teammateCtx, ws.ID, f.user.ID, teammate.ID, "owner@x.co",
		[]string{"buyer@example.com"}, resource,
	)
	if err != nil || !decision.Protected || decision.Metadata || decision.Body || decision.Attachments {
		t.Fatalf("protected rule must beat grant: decision=%#v err=%v", decision, err)
	}

	ownerDecision, err := authz.Evaluate(
		f.ctx, ws.ID, f.user.ID, f.user.ID, "owner@x.co",
		[]string{"buyer@example.com"}, resource,
	)
	if err != nil || !ownerDecision.Body || !ownerDecision.Attachments {
		t.Fatalf("mailbox owner access: decision=%#v err=%v", ownerDecision, err)
	}
	if _, err := f.svc.RevokeCommunicationAccess(teammateCtx, teammate, grant.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("teammate revoked owner grant: %v", err)
	}
}

func TestCommunicationGrantExpiryRevokeAndPrivateOverride(t *testing.T) {
	f, teammate, teammateCtx, ws := communicationPrivacyFixture(t)
	now := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	authz := f.svc.communicationAuthorization()

	expires := now.Add(time.Hour)
	grant, err := f.svc.GrantCommunicationAccess(f.ctx, f.user, CommunicationGrantInput{
		Scope: "body", ResourceType: "message", ResourceID: "message-2",
		GranteeID: &teammate.ID, ExpiresAt: &expires,
	})
	if err != nil {
		t.Fatal(err)
	}
	resource := CommunicationResource{MessageID: "message-2"}
	if got, err := authz.Evaluate(teammateCtx, ws.ID, f.user.ID, teammate.ID, "owner@x.co", nil, resource); err != nil || !got.Body {
		t.Fatalf("unexpired grant: %#v %v", got, err)
	}
	if _, err := f.svc.RevokeCommunicationAccess(f.ctx, f.user, grant.ID); err != nil {
		t.Fatal(err)
	}
	if got, err := authz.Evaluate(teammateCtx, ws.ID, f.user.ID, teammate.ID, "owner@x.co", nil, resource); err != nil || got.Body {
		t.Fatalf("revoked grant remained active: %#v %v", got, err)
	}

	expires = now.Add(2 * time.Hour)
	if _, err := f.svc.GrantCommunicationAccess(f.ctx, f.user, CommunicationGrantInput{
		Scope: "body", ResourceType: "thread", ResourceID: "thread-expiring",
		GranteeID: &teammate.ID, ExpiresAt: &expires,
	}); err != nil {
		t.Fatal(err)
	}
	authz.now = func() time.Time { return now.Add(3 * time.Hour) }
	if got, err := authz.Evaluate(
		teammateCtx, ws.ID, f.user.ID, teammate.ID, "owner@x.co", nil,
		CommunicationResource{ThreadID: "thread-expiring"},
	); err != nil || got.Body {
		t.Fatalf("expired grant remained active: %#v %v", got, err)
	}

	if _, err := f.svc.UpsertCommunicationPolicy(f.ctx, f.user, "owner@x.co", CommunicationPolicyInput{
		MetadataVisibility: "private", ShareSubject: true, ShareBody: true,
		ShareAttachments: true, RetentionDays: 30,
	}); err != nil {
		t.Fatal(err)
	}
	if got, err := f.svc.communicationAuthorization().Evaluate(
		teammateCtx, ws.ID, f.user.ID, teammate.ID, "owner@x.co", nil, resource,
	); err != nil || got.Metadata || got.Body {
		t.Fatalf("private policy must beat defaults and grants: %#v %v", got, err)
	}
}

func TestCommunicationAuthorizationCrossTenantAndAdminLimits(t *testing.T) {
	f, _, _, ws := communicationPrivacyFixture(t)
	intruder := newUser(t, f.client, "intruder@else.co", "user_privacy_intruder")
	intruderCtx := auth.WithUser(context.Background(), intruder)
	if _, err := f.svc.communicationAuthorization().Evaluate(
		intruderCtx, ws.ID, f.user.ID, intruder.ID, "owner@x.co", nil, CommunicationResource{},
	); !errors.Is(err, ErrForbidden) {
		t.Fatalf("cross-tenant evaluation: %v", err)
	}

	admin := newUser(t, f.client, "admin@x.co", "user_privacy_admin")
	if _, err := f.svc.UpsertWorkspaceMember(f.ctx, f.user, admin.ID, "admin"); err != nil {
		t.Fatal(err)
	}
	adminCtx := auth.WithUser(context.Background(), admin)
	if _, err := f.svc.SetWorkspaceCommunicationDefaults(adminCtx, admin, CommunicationPolicyInput{
		MetadataVisibility: "workspace", ShareSubject: true, RetentionDays: 30,
	}); err != nil {
		t.Fatalf("admin could not set safe metadata defaults: %v", err)
	}
	if _, err := f.svc.SetWorkspaceCommunicationDefaults(adminCtx, admin, CommunicationPolicyInput{
		MetadataVisibility: "workspace", ShareSubject: true, ShareBody: true, RetentionDays: 30,
	}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("admin forced body open: %v", err)
	}
	if _, err := f.svc.GrantCommunicationAccess(adminCtx, admin, CommunicationGrantInput{
		Scope: "body", ResourceType: "message", ResourceID: "message",
	}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("admin granted mailbox content: %v", err)
	}
}

func TestMailboxOwnerMutationBoundaryRejectsTeammate(t *testing.T) {
	f, teammate, teammateCtx, ws := communicationPrivacyFixture(t)
	internal := auth.WithInternal(context.Background())
	interaction := f.client.CommunicationInteraction.Create().
		SetWorkspace(ws).SetOwner(f.user).SetSource("gmail").
		SetSourceAccountID("owner@x.co").SetProviderObjectID("message-owned").
		SetInteractionType("email").SetOccurredAt(time.Now().UTC()).
		SetReceivedAt(time.Now().UTC()).SetContentHash("sha256:owned").SaveX(internal)

	if _, err := interaction.Update().SetSubject("teammate overwrite").Save(teammateCtx); err == nil {
		t.Fatal("teammate mutated mailbox-owner communication")
	}
	ownerRow, err := interaction.Update().SetSubject("owner update").Save(f.ctx)
	if err != nil || ownerRow.Subject != "owner update" {
		t.Fatalf("owner mutation failed: row=%#v err=%v", ownerRow, err)
	}
	if _, err := f.svc.GrantCommunicationAccess(teammateCtx, teammate, CommunicationGrantInput{
		Scope: "body", ResourceType: "message", ResourceID: interaction.ProviderObjectID,
	}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("teammate created owner-like grant: %v", err)
	}
}

func TestPurgeCommunicationRetractsCachesAndEmitsAudit(t *testing.T) {
	f := newFixture(t)
	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatal(err)
	}
	internal := auth.WithInternal(context.Background())
	interaction := f.client.CommunicationInteraction.Create().
		SetWorkspace(ws).SetOwner(f.user).SetSource("gmail").
		SetSourceAccountID("owner@x.co").SetProviderObjectID("message-purge").
		SetInteractionType("email").SetOccurredAt(time.Now().UTC()).
		SetReceivedAt(time.Now().UTC()).SetContentHash("sha256:before").
		SetSubject("private subject").SetMetadataJSON(`{"snippet":"private"}`).SaveX(internal)
	f.client.CommunicationAttachment.Create().
		SetWorkspace(ws).SetInteraction(interaction).SetProviderAttachmentID("attachment-1").
		SetSealedContent([]byte("bytes")).SetSealedExtractedText("private text").SaveX(internal)

	result, err := f.svc.PurgeCommunication(f.ctx, f.user, interaction.ID)
	if err != nil {
		t.Fatal(err)
	}
	if result.Attachments != 1 {
		t.Fatalf("purge result: %#v", result)
	}
	purged := f.client.CommunicationInteraction.Query().
		Where(communicationinteraction.IDEQ(interaction.ID)).OnlyX(internal)
	if !purged.Deleted || purged.Visibility != "private" || purged.Subject != "" || purged.MetadataJSON != "{}" {
		t.Fatalf("interaction retained private data: %#v", purged)
	}
	attachment := purged.QueryAttachments().OnlyX(internal)
	if len(attachment.SealedContent) != 0 || attachment.SealedExtractedText != "" {
		t.Fatalf("attachment cache retained content: %#v", attachment)
	}
	if got := f.client.RevenueTrustEvent.Query().Where(
		revenuetrustevent.EventNameEQ("communication_purged"),
		revenuetrustevent.CorrelationIDEQ(interaction.ID.String()),
	).CountX(internal); got != 1 {
		t.Fatalf("purge audit rows: %d", got)
	}
}
