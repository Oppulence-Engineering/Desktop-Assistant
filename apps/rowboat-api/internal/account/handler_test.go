package account_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipparticipant"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspacemember"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/userhistory"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/account"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/billing"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/connectors"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
)

// fakeStripe serves the three Stripe endpoints that account deletion calls.
type fakeStripe struct {
	mu        sync.Mutex
	status    map[string]string // subscription id -> status, for customer cus_1
	cancelled []string
	calls     int
	failWith  int // non-zero: every cancel returns this status
}

func (f *fakeStripe) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	w.Header().Set("Content-Type", "application/json")
	sub := func(id string) map[string]any {
		return map[string]any{"id": id, "object": "subscription", "status": f.status[id], "customer": "cus_1"}
	}
	notFound := func() {
		w.WriteHeader(http.StatusNotFound)
		_, _ = fmt.Fprint(w, `{"error":{"type":"invalid_request_error","code":"resource_missing","message":"No such subscription"}}`)
	}
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/v1/subscriptions":
		if r.URL.Query().Get("customer") != "cus_1" || r.URL.Query().Get("status") != "all" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		data := []any{}
		for id := range f.status {
			data = append(data, sub(id))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"object": "list", "data": data, "has_more": false, "url": "/v1/subscriptions"})
	case strings.HasPrefix(r.URL.Path, "/v1/subscriptions/"):
		id := strings.TrimPrefix(r.URL.Path, "/v1/subscriptions/")
		if _, ok := f.status[id]; !ok {
			notFound()
			return
		}
		if r.Method == http.MethodDelete {
			if f.failWith != 0 {
				w.WriteHeader(f.failWith)
				_, _ = fmt.Fprint(w, `{"error":{"type":"invalid_request_error","message":"cannot cancel"}}`)
				return
			}
			f.status[id] = "canceled"
			f.cancelled = append(f.cancelled, id)
		}
		_ = json.NewEncoder(w).Encode(sub(id))
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

type fakeIdentity struct{ deleted []string }

func (f *fakeIdentity) DeleteUser(_ context.Context, workosUserID string) error {
	f.deleted = append(f.deleted, workosUserID)
	return nil
}

type harness struct {
	client     *ent.Client
	database   *db.DB
	billing    *billing.Handler
	connectors *connectors.Handler
	sealer     *crypto.Sealer
	handler    *account.Handler
	stripe     *fakeStripe
	identity   *fakeIdentity
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	database, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return newHarnessWith(t, database)
}

func newHarnessWith(t *testing.T, database *db.DB) *harness {
	t.Helper()
	stripeFake := &fakeStripe{status: map[string]string{}}
	stripeServer := httptest.NewServer(stripeFake)
	t.Cleanup(stripeServer.Close)
	billingH := billing.New(database.Client, 10000, 0, nil, zap.NewNop())
	billingH.ConfigureStripe(billing.StripeConfig{SecretKey: "sk_test_account", APIBaseURL: stripeServer.URL})

	sealer, err := crypto.NewSealer("account-deletion-test")
	if err != nil {
		t.Fatal(err)
	}
	connectorsH := connectors.New(database.Client, sealer, connectors.DefaultRegistry(), connectors.Config{}, zap.NewNop())
	identity := &fakeIdentity{}
	return &harness{
		client:     database.Client,
		database:   database,
		billing:    billingH,
		connectors: connectorsH,
		sealer:     sealer,
		handler:    account.New(database, billingH, connectorsH, identity, zap.NewNop()),
		stripe:     stripeFake,
		identity:   identity,
	}
}

func (h *harness) deleteAccount(t *testing.T, u *ent.User, confirm string) (*httptest.ResponseRecorder, account.Receipt) {
	t.Helper()
	req := httptest.NewRequest(http.MethodDelete, "/v1/me", strings.NewReader(fmt.Sprintf(`{"confirm":%q}`, confirm)))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(auth.WithUser(context.Background(), u)) // simulate RequireJWT
	rec := httptest.NewRecorder()
	h.handler.Delete(rec, req)
	var receipt account.Receipt
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &receipt); err != nil {
			t.Fatalf("decode receipt: %v", err)
		}
	}
	return rec, receipt
}

var internal = auth.WithInternal(context.Background())

func newUser(client *ent.Client, name string) *ent.User {
	return client.User.Create().SetEmail(name + "@example.test").SetWorkosUserID("user_" + name).SaveX(internal)
}

func newWorkspace(client *ent.Client, owner *ent.User) *ent.RevenueWorkspace {
	ws := client.RevenueWorkspace.Create().SetUser(owner).SaveX(internal)
	client.RevenueWorkspaceMember.Create().SetWorkspace(ws).SetUser(owner).SetRole("owner").SetStatus("active").SaveX(internal)
	return ws
}

func TestDeleteCancelsEveryStripeSubscriptionAndRemovesAllData(t *testing.T) {
	h := newHarness(t)
	gone := newUser(h.client, "gone")
	kept := newUser(h.client, "kept")

	// Stripe knows two subscriptions the local row does not link; the linked
	// id no longer exists in Stripe.
	h.stripe.status["sub_live"] = "active"
	h.stripe.status["sub_old"] = "canceled"
	h.client.Subscription.Create().SetUser(gone).SetPlan("pro").SetSanctionedCredits(10000).
		SetStripeCustomerID("cus_1").SetStripeSubscriptionID("sub_missing").SaveX(internal)
	h.client.Subscription.Create().SetUser(kept).SetSanctionedCredits(10000).SaveX(internal)
	h.client.CreditLedger.Create().SetUser(gone).SetDelta(-10).SetReason("llm_call.reserve").
		SetRequestID(uuid.New()).SetTs(time.Now().UTC()).SaveX(internal)

	for _, u := range []*ent.User{gone, kept} {
		ws := newWorkspace(h.client, u)
		rel := h.client.Relationship.Create().SetWorkspace(ws).SetUser(u).SetKind("company").SetDisplayName("Acme").SaveX(internal)
		person := h.client.Person.Create().SetWorkspace(ws).SetUser(u).SetDisplayName("Ada").SetPrimaryEmail("ada@acme.test").SaveX(internal)
		h.client.RelationshipParticipant.Create().SetWorkspace(ws).SetUser(u).SetRelationship(rel).SetPerson(person).
			SetDisplayName("Ada").SetEmail("ada@acme.test").SetRole("champion").SaveX(internal)
		now := time.Now().UTC()
		h.client.PersonInteractionStat.Create().SetWorkspace(ws).SetPerson(person).SetRelationship(rel).
			SetFirstInteractionAt(now.Add(-time.Hour)).SetLastInteractionAt(now).SetInteractionCount(1).
			SetInboundCount(1).SetOutboundCount(0).SetChannelCounts(map[string]int{"email": 1}).
			SetLastChannel("email").SetLastDirection("inbound").SaveX(internal)
		h.client.MailThread.Create().SetUser(u).SetProviderThreadID("thread-" + u.WorkosUserID).SetSubject("Renewal").
			SetCounterpartyEmail("ada@acme.test").SetRelationship(rel).SaveX(internal)
	}

	rec, receipt := h.deleteAccount(t, gone, "DELETE")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if receipt.SubscriptionsCancelled != 1 || receipt.WorkspacesDeleted != 1 || !receipt.IdentityDeleted {
		t.Fatalf("receipt = %+v", receipt)
	}
	if len(h.stripe.cancelled) != 1 || h.stripe.cancelled[0] != "sub_live" {
		t.Fatalf("stripe cancelled = %v, want [sub_live]", h.stripe.cancelled)
	}
	if len(h.identity.deleted) != 1 || h.identity.deleted[0] != "user_gone" {
		t.Fatalf("identity deleted = %v", h.identity.deleted)
	}

	if h.client.User.Query().Where(user.IDEQ(gone.ID)).ExistX(internal) {
		t.Fatal("user row still exists")
	}
	counts := map[string]int{
		"relationships":            h.client.Relationship.Query().CountX(internal),
		"persons":                  h.client.Person.Query().CountX(internal),
		"participants":             h.client.RelationshipParticipant.Query().CountX(internal),
		"person_interaction_stats": h.client.PersonInteractionStat.Query().CountX(internal),
		"mail_threads":             h.client.MailThread.Query().CountX(internal),
		"workspaces":               h.client.RevenueWorkspace.Query().CountX(internal),
		"subscriptions":            h.client.Subscription.Query().CountX(internal),
	}
	for table, n := range counts {
		if n != 1 {
			t.Errorf("%s = %d, want only the other user's row", table, n)
		}
	}
	if n := h.client.CreditLedger.Query().CountX(internal); n != 0 {
		t.Errorf("credit_ledgers = %d, want 0", n)
	}
	if n := h.client.UserHistory.Query().Where(userhistory.RefEQ(gone.ID)).CountX(internal); n != 0 {
		t.Errorf("user_histories for deleted user = %d, want 0", n)
	}
}

func TestDeleteGivesSharedWorkspaceToMemberAndKeepsTheirData(t *testing.T) {
	h := newHarness(t)
	owner := newUser(h.client, "owner")
	member := newUser(h.client, "member")
	ws := newWorkspace(h.client, owner)
	h.client.RevenueWorkspaceMember.Create().SetWorkspace(ws).SetUser(member).SetRole("member").SetStatus("active").SaveX(internal)

	// The member's participant row points at rows the owner wrote. Without the
	// reassignment, the cascade would delete shared data or fail on the FK.
	rel := h.client.Relationship.Create().SetWorkspace(ws).SetUser(owner).SetKind("company").SetDisplayName("Acme").SaveX(internal)
	person := h.client.Person.Create().SetWorkspace(ws).SetUser(owner).SetDisplayName("Ada").SetPrimaryEmail("ada@acme.test").SaveX(internal)
	participant := h.client.RelationshipParticipant.Create().SetWorkspace(ws).SetUser(member).SetRelationship(rel).SetPerson(person).
		SetDisplayName("Ada").SetEmail("ada@acme.test").SetRole("champion").SaveX(internal)

	rec, receipt := h.deleteAccount(t, owner, "DELETE")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if receipt.WorkspacesTransferred != 1 || receipt.WorkspacesDeleted != 0 {
		t.Fatalf("receipt = %+v", receipt)
	}
	if got := h.client.RevenueWorkspace.Query().Where(revenueworkspace.IDEQ(ws.ID)).QueryUser().OnlyIDX(internal); got != member.ID {
		t.Fatalf("workspace owner = %s, want member %s", got, member.ID)
	}
	if role := h.client.RevenueWorkspaceMember.Query().Where(revenueworkspacemember.HasUserWith(user.IDEQ(member.ID))).OnlyX(internal).Role; role != "owner" {
		t.Fatalf("member role = %q, want owner", role)
	}
	if got := h.client.Relationship.Query().Where(relationship.IDEQ(rel.ID)).QueryUser().OnlyIDX(internal); got != member.ID {
		t.Fatalf("relationship author = %s, want member", got)
	}
	if !h.client.RelationshipParticipant.Query().Where(relationshipparticipant.IDEQ(participant.ID)).ExistX(internal) {
		t.Fatal("member's participant row was deleted")
	}
	if h.stripe.calls != 0 {
		t.Fatalf("stripe calls = %d for a user without Stripe billing", h.stripe.calls)
	}
}

func TestDeleteRefusesWhenNoMemberCanTakeTheWorkspace(t *testing.T) {
	h := newHarness(t)
	owner := newUser(h.client, "owner")
	member := newUser(h.client, "member")
	ws := newWorkspace(h.client, owner)
	newWorkspace(h.client, member) // the member already owns a workspace
	h.client.RevenueWorkspaceMember.Create().SetWorkspace(ws).SetUser(member).SetRole("admin").SetStatus("active").SaveX(internal)
	h.stripe.status["sub_live"] = "active"
	h.client.Subscription.Create().SetUser(owner).SetSanctionedCredits(10000).SetStripeCustomerID("cus_1").SaveX(internal)

	rec, _ := h.deleteAccount(t, owner, "DELETE")
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "workspace_successor_required") {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !h.client.User.Query().Where(user.IDEQ(owner.ID)).ExistX(internal) {
		t.Fatal("account was deleted")
	}
	if h.stripe.calls != 0 || len(h.identity.deleted) != 0 {
		t.Fatalf("side effects ran: stripe calls %d, identity %v", h.stripe.calls, h.identity.deleted)
	}
}

func TestDeleteRequiresTheExactConfirmation(t *testing.T) {
	h := newHarness(t)
	u := newUser(h.client, "careful")
	rec, _ := h.deleteAccount(t, u, "delete")
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "confirmation_required") {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !h.client.User.Query().Where(user.IDEQ(u.ID)).ExistX(internal) {
		t.Fatal("account was deleted")
	}
}

func TestDeleteKeepsTheAccountWhenStripeRefusesToCancel(t *testing.T) {
	h := newHarness(t)
	u := newUser(h.client, "paying")
	h.stripe.status["sub_live"] = "active"
	h.stripe.failWith = http.StatusBadRequest
	h.client.Subscription.Create().SetUser(u).SetSanctionedCredits(10000).SetStripeCustomerID("cus_1").SaveX(internal)

	rec, _ := h.deleteAccount(t, u, "DELETE")
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "billing_cancellation_failed") {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !h.client.User.Query().Where(user.IDEQ(u.ID)).ExistX(internal) {
		t.Fatal("account was deleted while Stripe could still charge it")
	}
	if len(h.identity.deleted) != 0 {
		t.Fatal("identity was deleted")
	}
}
