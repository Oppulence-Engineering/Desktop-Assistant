package account_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/connectorrevocationjob"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspacemember"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/account"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/billing"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/connectors"
)

type failingIdentity struct{ calls int }

func (f *failingIdentity) DeleteUser(context.Context, string) error {
	f.calls++
	return errors.New("workos: user delete returned 503")
}

func deleteRequest(ctx context.Context, body string) *http.Request {
	req := httptest.NewRequestWithContext(ctx, http.MethodDelete, "/v1/me", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	return req
}

func serveDelete(t *testing.T, handler *account.Handler, req *http.Request) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	handler.Delete(rec, req)
	return rec
}

func problemCode(rec *httptest.ResponseRecorder) string {
	var problem struct {
		Code string `json:"code"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &problem)
	return problem.Code
}

func (h *harness) exists(u *ent.User) bool {
	return h.client.User.Query().Where(user.IDEQ(u.ID)).ExistX(internal)
}

func (h *harness) member(ws *ent.RevenueWorkspace, u *ent.User, role, status string) {
	h.client.RevenueWorkspaceMember.Create().SetWorkspace(ws).SetUser(u).SetRole(role).SetStatus(status).SaveX(internal)
}

func (h *harness) ownerOf(ws *ent.RevenueWorkspace) uuid.UUID {
	return h.client.RevenueWorkspace.Query().Where(revenueworkspace.IDEQ(ws.ID)).QueryUser().OnlyIDX(internal)
}

func TestDeleteRejectsARequestWithoutAnAuthenticatedUser(t *testing.T) {
	h := newHarness(t)
	rec := serveDelete(t, h.handler, deleteRequest(context.Background(), `{"confirm":"DELETE"}`))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	if h.stripe.calls != 0 || len(h.identity.deleted) != 0 {
		t.Fatal("an unauthenticated request reached Stripe or WorkOS")
	}
}

func TestDeleteRejectsMalformedBodiesWithoutSideEffects(t *testing.T) {
	h := newHarness(t)
	u := newUser(h.client, "malformed")
	h.stripe.status["sub_live"] = "active"
	h.client.Subscription.Create().SetUser(u).SetSanctionedCredits(10000).SetStripeCustomerID("cus_1").SaveX(internal)
	ctx := auth.WithUser(context.Background(), u)

	escapedNUL := "\\" + "u0000" // a JSON escape that decodes to a NUL byte
	bodies := []string{
		``,
		`{`,
		`[]`,
		`null`,
		`"DELETE"`,
		`{"confirm":123}`,
		`{"confirm":true}`,
		`{"confirm":["DELETE"]}`,
		`{"confirm":"DELETE"}{"confirm":"DELETE"}`,
		`{"Confirm":"delete"}`,
		`{"confirm":"DELETE` + escapedNUL + `"}`,
		`{"confirm":"deleted"}`,
		`{"confirm":" DELETE"}`,
	}
	for _, body := range bodies {
		rec := serveDelete(t, h.handler, deleteRequest(ctx, body))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %q: status = %d (%s), want 400", body, rec.Code, rec.Body.String())
		}
	}
	if !h.exists(u) || h.stripe.calls != 0 || len(h.identity.deleted) != 0 {
		t.Fatalf("malformed requests had side effects: exists %v, stripe calls %d, identity %v", h.exists(u), h.stripe.calls, h.identity.deleted)
	}
}

func TestDeleteRejectsAnOversizedBody(t *testing.T) {
	h := newHarness(t)
	u := newUser(h.client, "oversized")
	body := `{"confirm":"DELETE","padding":"` + strings.Repeat("x", 4096) + `"}`
	rec := serveDelete(t, h.handler, deleteRequest(auth.WithUser(context.Background(), u), body))
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", rec.Code)
	}
	if !h.exists(u) {
		t.Fatal("an oversized request deleted the account")
	}
}

func TestDeleteReceiptHasOnlyReviewedFieldsAndNoPersonalData(t *testing.T) {
	h := newHarness(t)
	u := newUser(h.client, "receipt")
	before := time.Now().UTC().Truncate(time.Second)

	rec := serveDelete(t, h.handler, deleteRequest(auth.WithUser(context.Background(), u), `{"confirm":"DELETE"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("Content-Type = %q", ct)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	keys := make([]string, 0, len(body))
	for key := range body {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	want := []string{"completedAt", "connectorsRevoked", "identityDeleted", "receiptId", "requestedAt", "subscriptionsCancelled", "workspacesDeleted", "workspacesTransferred"}
	if !slices.Equal(keys, want) {
		t.Fatalf("receipt keys = %v, want %v", keys, want)
	}
	if _, err := uuid.Parse(fmt.Sprint(body["receiptId"])); err != nil {
		t.Errorf("receiptId %v is not a UUID", body["receiptId"])
	}
	requested, err1 := time.Parse(time.RFC3339, fmt.Sprint(body["requestedAt"]))
	completed, err2 := time.Parse(time.RFC3339, fmt.Sprint(body["completedAt"]))
	if err1 != nil || err2 != nil {
		t.Fatalf("timestamps are not RFC 3339: %v, %v", body["requestedAt"], body["completedAt"])
	}
	if requested.Before(before) || completed.Before(requested) {
		t.Errorf("requestedAt %s / completedAt %s are out of order", requested, completed)
	}
	for _, private := range []string{u.Email, u.WorkosUserID, u.ID.String()} {
		if strings.Contains(rec.Body.String(), private) {
			t.Errorf("receipt contains %q", private)
		}
	}
}

func TestDeleteReceiptsAreUniquePerDeletion(t *testing.T) {
	h := newHarness(t)
	seen := map[string]bool{}
	for i := 0; i < 3; i++ {
		u := newUser(h.client, fmt.Sprintf("unique%d", i))
		rec, receipt := h.deleteAccount(t, u, "DELETE")
		if rec.Code != http.StatusOK {
			t.Fatalf("deletion %d: status = %d", i, rec.Code)
		}
		if seen[receipt.ReceiptID] {
			t.Fatalf("receipt id %s reused", receipt.ReceiptID)
		}
		seen[receipt.ReceiptID] = true
	}
}

func TestDeleteStillSucceedsWhenTheIdentityProviderFails(t *testing.T) {
	h := newHarness(t)
	identity := &failingIdentity{}
	handler := account.New(h.database, h.billing, h.connectors, identity, zap.NewNop())
	u := newUser(h.client, "idp_down")
	newWorkspace(h.client, u)

	rec := serveDelete(t, handler, deleteRequest(auth.WithUser(context.Background(), u), `{"confirm":"DELETE"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	var receipt account.Receipt
	if err := json.Unmarshal(rec.Body.Bytes(), &receipt); err != nil {
		t.Fatal(err)
	}
	if receipt.IdentityDeleted || identity.calls != 1 {
		t.Fatalf("identityDeleted = %v after %d calls; want false after 1", receipt.IdentityDeleted, identity.calls)
	}
	if h.exists(u) {
		t.Fatal("the data must be deleted even when WorkOS is down")
	}
}

func TestDeleteRefusesABilledUserWhenStripeIsNotConfigured(t *testing.T) {
	h := newHarness(t)
	unconfigured := billing.New(h.client, 10000, 0, nil, zap.NewNop())
	handler := account.New(h.database, unconfigured, h.connectors, h.identity, zap.NewNop())
	u := newUser(h.client, "billed_unconfigured")
	h.client.Subscription.Create().SetUser(u).SetPlan("pro").SetSanctionedCredits(10000).SetStripeCustomerID("cus_1").SaveX(internal)

	rec := serveDelete(t, handler, deleteRequest(auth.WithUser(context.Background(), u), `{"confirm":"DELETE"}`))
	if rec.Code != http.StatusBadGateway || problemCode(rec) != "billing_cancellation_failed" {
		t.Fatalf("status = %d code = %q, want 502 billing_cancellation_failed", rec.Code, problemCode(rec))
	}
	if !h.exists(u) || len(h.identity.deleted) != 0 {
		t.Fatal("the account was deleted although billing could not be cancelled")
	}
}

func TestDeleteSucceedsForAnUnbilledUserWhenStripeIsNotConfigured(t *testing.T) {
	h := newHarness(t)
	unconfigured := billing.New(h.client, 10000, 0, nil, zap.NewNop())
	handler := account.New(h.database, unconfigured, h.connectors, h.identity, zap.NewNop())
	u := newUser(h.client, "free_unconfigured")
	h.client.Subscription.Create().SetUser(u).SetSanctionedCredits(10000).SaveX(internal)

	rec := serveDelete(t, handler, deleteRequest(auth.WithUser(context.Background(), u), `{"confirm":"DELETE"}`))
	if rec.Code != http.StatusOK || h.exists(u) {
		t.Fatalf("status = %d exists = %v, want 200 and deleted", rec.Code, h.exists(u))
	}
}

func TestDeleteChoosesTheSuccessorByRole(t *testing.T) {
	cases := []struct {
		name    string
		members []string // roles, created in this order
		want    int      // index of the expected successor, -1 for a refusal
	}{
		{name: "owner_role_beats_admin_and_member", members: []string{"admin", "member", "owner"}, want: 2},
		{name: "admin_beats_member", members: []string{"member", "admin"}, want: 1},
		{name: "member_when_alone", members: []string{"member"}, want: 0},
		{name: "viewer_is_never_chosen", members: []string{"viewer"}, want: -1},
		{name: "viewer_skipped_for_member", members: []string{"viewer", "member"}, want: 1},
		{name: "oldest_admin_first", members: []string{"admin", "admin"}, want: 0},
	}
	h := newHarness(t)
	for i, tc := range cases {
		owner := newUser(h.client, fmt.Sprintf("role_owner_%d", i))
		ws := newWorkspace(h.client, owner)
		var members []*ent.User
		for j, role := range tc.members {
			m := newUser(h.client, fmt.Sprintf("role_%d_%d_%s", i, j, role))
			h.member(ws, m, role, "active")
			members = append(members, m)
			time.Sleep(2 * time.Millisecond) // distinct created_at for the oldest-first rule
		}

		rec, _ := h.deleteAccount(t, owner, "DELETE")
		if tc.want < 0 {
			if rec.Code != http.StatusConflict || problemCode(rec) != "workspace_successor_required" {
				t.Errorf("%s: status = %d code = %q, want 409 workspace_successor_required", tc.name, rec.Code, problemCode(rec))
			}
			if !h.exists(owner) {
				t.Errorf("%s: the refused owner was deleted", tc.name)
			}
			continue
		}
		if rec.Code != http.StatusOK {
			t.Errorf("%s: status = %d: %s", tc.name, rec.Code, rec.Body.String())
			continue
		}
		if got := h.ownerOf(ws); got != members[tc.want].ID {
			t.Errorf("%s: successor = %s, want member %d (%s)", tc.name, got, tc.want, tc.members[tc.want])
		}
	}
}

func TestDeleteSkipsACandidateWhoAlreadyOwnsAWorkspace(t *testing.T) {
	h := newHarness(t)
	owner := newUser(h.client, "skip_owner")
	ws := newWorkspace(h.client, owner)
	busyAdmin := newUser(h.client, "skip_busy_admin")
	newWorkspace(h.client, busyAdmin)
	h.member(ws, busyAdmin, "admin", "active")
	freeMember := newUser(h.client, "skip_free_member")
	h.member(ws, freeMember, "member", "active")

	rec, receipt := h.deleteAccount(t, owner, "DELETE")
	if rec.Code != http.StatusOK || receipt.WorkspacesTransferred != 1 {
		t.Fatalf("status = %d receipt = %+v", rec.Code, receipt)
	}
	if got := h.ownerOf(ws); got != freeMember.ID {
		t.Fatalf("successor = %s, want the member who owns no workspace", got)
	}
}

func TestDeleteTreatsAWorkspaceWithOnlyRemovedMembersAsUnshared(t *testing.T) {
	h := newHarness(t)
	owner := newUser(h.client, "removed_owner")
	ws := newWorkspace(h.client, owner)
	former := newUser(h.client, "removed_former")
	h.member(ws, former, "admin", "removed")

	rec, receipt := h.deleteAccount(t, owner, "DELETE")
	if rec.Code != http.StatusOK || receipt.WorkspacesDeleted != 1 || receipt.WorkspacesTransferred != 0 {
		t.Fatalf("status = %d receipt = %+v", rec.Code, receipt)
	}
	if h.client.RevenueWorkspace.Query().Where(revenueworkspace.IDEQ(ws.ID)).ExistX(internal) {
		t.Error("the workspace survived")
	}
	if !h.exists(former) {
		t.Error("the removed member's own account was deleted")
	}
}

func TestDeleteByANonOwnerMemberKeepsTheOwnersWorkspace(t *testing.T) {
	h := newHarness(t)
	owner := newUser(h.client, "stay_owner")
	ws := newWorkspace(h.client, owner)
	leaver := newUser(h.client, "stay_leaver")
	h.member(ws, leaver, "member", "active")
	rel := h.client.Relationship.Create().SetWorkspace(ws).SetUser(leaver).SetKind("company").SetDisplayName("Leaver's account").SaveX(internal)

	rec, receipt := h.deleteAccount(t, leaver, "DELETE")
	if rec.Code != http.StatusOK || receipt.WorkspacesTransferred != 0 || receipt.WorkspacesDeleted != 0 {
		t.Fatalf("status = %d receipt = %+v", rec.Code, receipt)
	}
	if h.ownerOf(ws) != owner.ID {
		t.Fatal("the owner lost the workspace")
	}
	if got := h.client.Relationship.Query().Where(relationship.IDEQ(rel.ID)).QueryUser().OnlyIDX(internal); got != owner.ID {
		t.Errorf("relationship author = %s, want the workspace owner", got)
	}
	if n := h.client.RevenueWorkspaceMember.Query().Where(revenueworkspacemember.HasWorkspaceWith(revenueworkspace.IDEQ(ws.ID))).CountX(internal); n != 1 {
		t.Errorf("memberships = %d, want only the owner", n)
	}
}

func TestDeleteRevokesLiveConnectorsAndKeepsARetryableJob(t *testing.T) {
	h := newHarness(t)
	u := h.client.User.Create().SetEmail("connected@example.test").SetWorkosUserID("user_connected").SetWorkosOrgID("org_connected").SaveX(internal)
	ownerCtx := auth.WithUser(context.Background(), u)
	canvas, ok := connectors.DefaultRegistry().Get("canvas")
	if !ok {
		t.Fatal("canvas connector missing")
	}
	sealed, err := h.sealer.SealString("refresh-live")
	if err != nil {
		t.Fatal(err)
	}
	live := h.client.MCPConnection.Create().SetUser(u).SetConnector(canvas.Name).SetAudience(canvas.Audience).
		SetOrganizationID(connectors.OrganizationIDForUser(u)).SetScopes([]string{"canvas:invoices.read"}).
		SetRefreshTokenEncrypted(sealed).SetStatus("active").SetConnectedAt(time.Now()).SaveX(ownerCtx)

	rec, receipt := h.deleteAccount(t, u, "DELETE")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	if receipt.ConnectorsRevoked != 1 {
		t.Fatalf("connectorsRevoked = %d, want 1", receipt.ConnectorsRevoked)
	}
	job := h.client.ConnectorRevocationJob.Query().Where(connectorrevocationjob.ConnectionIDEQ(live.ID)).OnlyX(internal)
	if job.OwnerID != u.ID || job.TerminalReason != "account_deleted" {
		t.Fatalf("revocation job = owner %s reason %q", job.OwnerID, job.TerminalReason)
	}
	if job.Status == "pending" && len(job.RefreshTokenEncrypted) == 0 {
		t.Fatal("a pending job lost the credential it must revoke")
	}
}

func TestDeleteWithACancelledRequestChangesNothing(t *testing.T) {
	h := newHarness(t)
	u := newUser(h.client, "cancelled")
	h.stripe.status["sub_live"] = "active"
	h.client.Subscription.Create().SetUser(u).SetSanctionedCredits(10000).SetStripeCustomerID("cus_1").SaveX(internal)
	ctx, cancel := context.WithCancel(auth.WithUser(context.Background(), u))
	cancel()

	rec := serveDelete(t, h.handler, deleteRequest(ctx, `{"confirm":"DELETE"}`))
	if rec.Code == http.StatusOK {
		t.Fatal("a cancelled request reported success")
	}
	if !h.exists(u) || h.stripe.calls != 0 || len(h.identity.deleted) != 0 {
		t.Fatalf("a cancelled request had side effects: exists %v, stripe calls %d, identity %v", h.exists(u), h.stripe.calls, h.identity.deleted)
	}
}

func TestDeleteWritesAnAuditLineWithoutPersonalData(t *testing.T) {
	h := newHarness(t)
	core, logs := observer.New(zapcore.InfoLevel)
	handler := account.New(h.database, h.billing, h.connectors, h.identity, zap.New(core))
	u := newUser(h.client, "audited")
	h.stripe.status["sub_live"] = "active"
	h.client.Subscription.Create().SetUser(u).SetPlan("pro").SetSanctionedCredits(10000).SetStripeCustomerID("cus_1").SaveX(internal)

	rec := serveDelete(t, handler, deleteRequest(auth.WithUser(context.Background(), u), `{"confirm":"DELETE"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	entries := logs.FilterMessage("account deleted").All()
	if len(entries) != 1 {
		t.Fatalf("audit lines = %d, want 1", len(entries))
	}
	fields := entries[0].ContextMap()
	for key, want := range map[string]any{
		"user_id":                 u.ID.String(),
		"plan":                    "pro",
		"stripe_customer_id":      "cus_1",
		"subscriptions_cancelled": int64(1),
		"identity_deleted":        true,
	} {
		if fields[key] != want {
			t.Errorf("audit field %s = %v (%T), want %v", key, fields[key], fields[key], want)
		}
	}
	if _, ok := fields["receipt_id"]; !ok {
		t.Error("audit line has no receipt_id")
	}
	for key, value := range fields {
		for _, private := range []string{u.Email, u.WorkosUserID} {
			if strings.Contains(fmt.Sprint(value), private) {
				t.Errorf("audit field %s contains %q", key, private)
			}
		}
	}
}

func TestDeleteLogsTheIdentityFailureForAManualRetry(t *testing.T) {
	h := newHarness(t)
	core, logs := observer.New(zapcore.InfoLevel)
	handler := account.New(h.database, h.billing, h.connectors, &failingIdentity{}, zap.New(core))
	u := newUser(h.client, "manual_retry")

	if rec := serveDelete(t, handler, deleteRequest(auth.WithUser(context.Background(), u), `{"confirm":"DELETE"}`)); rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var found bool
	for _, entry := range logs.All() {
		if entry.Level == zapcore.ErrorLevel && strings.Contains(entry.Message, "WorkOS identity remains") {
			found = entry.ContextMap()["workos_user_id"] == u.WorkosUserID
		}
	}
	if !found {
		t.Fatal("no error log names the WorkOS identity that support must delete")
	}
}
