//go:build accountdeletione2e

package integration

// End-to-end test of account deletion (DELETE /v1/me) against a running stack:
// rowboat-api on PostgreSQL, with devstack standing in for WorkOS (tokens,
// identity delete) and Stripe (subscriptions). scripts/account-deletion-e2e.sh
// starts that stack and runs:
//
//	go test -tags accountdeletione2e ./integration/ -run TestAccountDeletion -count=1 -v
//
// Data is seeded through Ent on the same database, the API is called over HTTP
// with devstack-signed tokens, and PostgreSQL plus the devstack fixtures are
// checked afterwards. Every identifier carries a per-run suffix, so runs never
// collide.

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/creditledger"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/mailthread"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/person"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/personinteractionstat"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationship"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/relationshipparticipant"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspace"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueworkspacemember"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/subscription"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/userhistory"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
)

var deletionInternal = auth.WithInternal(context.Background())

type deletionStack struct {
	api           string
	devstack      string
	fixtureSecret string
	http          *http.Client
	client        *ent.Client
	run           string
}

func newDeletionStack(t *testing.T) *deletionStack {
	t.Helper()
	dsn := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	secret := strings.TrimSpace(os.Getenv("DEVSTACK_FIXTURE_SECRET"))
	if dsn == "" || secret == "" {
		t.Fatal("DATABASE_URL and DEVSTACK_FIXTURE_SECRET are required; run scripts/account-deletion-e2e.sh")
	}
	database, err := db.Open(context.Background(), appconfig.Config{DatabaseURL: dsn}, zap.NewNop())
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return &deletionStack{
		api:           deletionEnv("ACCOUNT_DELETION_API_URL", "http://127.0.0.1:18080"),
		devstack:      deletionEnv("ACCOUNT_DELETION_DEVSTACK_URL", "http://127.0.0.1:8090"),
		fixtureSecret: secret,
		http:          &http.Client{Timeout: 30 * time.Second},
		client:        database.Client,
		run:           strconv.FormatInt(time.Now().UnixNano(), 36),
	}
}

func deletionEnv(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return strings.TrimRight(v, "/")
	}
	return fallback
}

func (s *deletionStack) send(t *testing.T, method, target, token, body string, headers map[string]string) (int, []byte) {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, target, reader)
	if err != nil {
		t.Fatal(err)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := s.http.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, target, err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, raw
}

func (s *deletionStack) fixture(t *testing.T, method, path, body string) []byte {
	t.Helper()
	status, raw := s.send(t, method, s.devstack+path, "", body, map[string]string{"X-Devstack-Fixture-Secret": s.fixtureSecret})
	if status != http.StatusOK {
		t.Fatalf("devstack %s %s = %d: %s", method, path, status, raw)
	}
	return raw
}

type devstackState struct {
	Subscriptions map[string]struct {
		Customer string `json:"customer"`
		Status   string `json:"status"`
	} `json:"subscriptions"`
	Cancelled          []string `json:"cancelledSubscriptions"`
	DeletedWorkOSUsers []string `json:"deletedWorkOSUsers"`
}

func (s *deletionStack) state(t *testing.T) devstackState {
	t.Helper()
	var state devstackState
	if err := json.Unmarshal(s.fixture(t, http.MethodGet, "/fixture/account-deletion/state", ""), &state); err != nil {
		t.Fatal(err)
	}
	return state
}

func (s *deletionStack) seedStripe(t *testing.T, id, customer, status string) {
	t.Helper()
	s.fixture(t, http.MethodPost, "/fixture/stripe/subscriptions", fmt.Sprintf(`{"id":%q,"customer":%q,"status":%q}`, id, customer, status))
}

func (s *deletionStack) id(prefix string) string { return prefix + "_" + s.run }

type signedIn struct {
	token    string
	workosID string
	user     *ent.User
}

// signIn mints a devstack token and lets the real auth middleware create the
// local user, exactly as a first sign-in does.
func (s *deletionStack) signIn(t *testing.T, name string) signedIn {
	t.Helper()
	workosID := s.id("user_e2e_" + name)
	query := url.Values{"workos_user_id": {workosID}, "workos_org_id": {s.id("org_e2e")}, "email": {workosID + "@example.test"}}
	status, raw := s.send(t, http.MethodGet, s.devstack+"/mint?"+query.Encode(), "", "", nil)
	if status != http.StatusOK {
		t.Fatalf("mint = %d: %s", status, raw)
	}
	var minted struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(raw, &minted); err != nil || minted.Token == "" {
		t.Fatalf("mint response %s: %v", raw, err)
	}
	if status, raw := s.send(t, http.MethodGet, s.api+"/v1/me", minted.Token, "", nil); status != http.StatusOK {
		t.Fatalf("GET /v1/me = %d: %s", status, raw)
	}
	u := s.client.User.Query().Where(user.WorkosUserIDEQ(workosID)).OnlyX(deletionInternal)
	return signedIn{token: minted.Token, workosID: workosID, user: u}
}

func (s *deletionStack) linkStripe(t *testing.T, u *ent.User, customer, subscriptionID string) {
	t.Helper()
	update := s.client.Subscription.Update().
		Where(subscription.HasUserWith(user.IDEQ(u.ID))).
		SetPlan("pro").
		SetStripeCustomerID(customer)
	if subscriptionID != "" {
		update.SetStripeSubscriptionID(subscriptionID)
	}
	if n := update.SaveX(deletionInternal); n != 1 {
		t.Fatalf("linked %d subscription rows, want 1", n)
	}
}

type accountData struct {
	workspace    *ent.RevenueWorkspace
	relationship *ent.Relationship
	person       *ent.Person
	thread       *ent.MailThread
	ledger       *ent.CreditLedger
}

func (s *deletionStack) seedAccountData(t *testing.T, u *ent.User) accountData {
	t.Helper()
	c := s.client
	now := time.Now().UTC()
	ws := c.RevenueWorkspace.Create().SetUser(u).SaveX(deletionInternal)
	c.RevenueWorkspaceMember.Create().SetWorkspace(ws).SetUser(u).SetRole("owner").SetStatus("active").SaveX(deletionInternal)
	rel := c.Relationship.Create().SetWorkspace(ws).SetUser(u).SetKind("company").SetDisplayName("Acme " + u.WorkosUserID).SaveX(deletionInternal)
	p := c.Person.Create().SetWorkspace(ws).SetUser(u).SetDisplayName("Ada").SetPrimaryEmail("ada@" + s.run + ".test").SaveX(deletionInternal)
	c.RelationshipParticipant.Create().SetWorkspace(ws).SetUser(u).SetRelationship(rel).SetPerson(p).
		SetDisplayName("Ada").SetEmail("ada@" + s.run + ".test").SetRole("champion").SaveX(deletionInternal)
	c.PersonInteractionStat.Create().SetWorkspace(ws).SetPerson(p).SetRelationship(rel).
		SetFirstInteractionAt(now.Add(-time.Hour)).SetLastInteractionAt(now).SetInteractionCount(2).
		SetInboundCount(1).SetOutboundCount(1).SetChannelCounts(map[string]int{"email": 2}).
		SetLastChannel("email").SetLastDirection("inbound").SaveX(deletionInternal)
	thread := c.MailThread.Create().SetUser(u).SetProviderThreadID("thread-" + u.WorkosUserID).SetSubject("Renewal").
		SetCounterpartyEmail("ada@" + s.run + ".test").SetRelationship(rel).SaveX(deletionInternal)
	ledger := c.CreditLedger.Create().SetUser(u).SetDelta(-25).SetReason("llm_call.reserve").
		SetRequestID(uuid.New()).SetTs(now).SaveX(deletionInternal)
	return accountData{workspace: ws, relationship: rel, person: p, thread: thread, ledger: ledger}
}

func (s *deletionStack) deleteAccount(t *testing.T, token, confirm string) (int, map[string]any) {
	t.Helper()
	status, raw := s.send(t, http.MethodDelete, s.api+"/v1/me", token, fmt.Sprintf(`{"confirm":%q}`, confirm), nil)
	body := map[string]any{}
	_ = json.Unmarshal(raw, &body)
	return status, body
}

func (s *deletionStack) userExists(u *ent.User) bool {
	return s.client.User.Query().Where(user.IDEQ(u.ID)).ExistX(deletionInternal)
}

func sorted(values []string) []string {
	out := slices.Clone(values)
	slices.Sort(out)
	return out
}

func TestAccountDeletionIsServedAndDocumentedByTheRunningAPI(t *testing.T) {
	s := newDeletionStack(t)
	status, raw := s.send(t, http.MethodGet, s.api+"/openapi.json", "", "", nil)
	if status != http.StatusOK {
		t.Fatalf("GET /openapi.json = %d", status)
	}
	for _, want := range []string{`"deleteMe"`, `"AccountDeletionReceipt"`, `"AccountDeletionRequest"`, `"workspace_successor_required"`, `"billing_cancellation_failed"`} {
		if !strings.Contains(string(raw), want) {
			t.Errorf("served OpenAPI document is missing %s", want)
		}
	}
}

// unsignedToken builds an "alg: none" JWT at runtime. The API must reject it;
// building it here keeps a token-shaped literal out of the source.
func unsignedToken(subject string) string {
	encode := func(v string) string { return base64.RawURLEncoding.EncodeToString([]byte(v)) }
	return encode(`{"alg":"none","typ":"JWT"}`) + "." + encode(`{"sub":"`+subject+`"}`) + "."
}

func TestAccountDeletionRejectsCallersWithoutAValidToken(t *testing.T) {
	s := newDeletionStack(t)
	for _, token := range []string{"", "not-a-jwt", unsignedToken("user_x")} {
		if status, _ := s.deleteAccount(t, token, "DELETE"); status != http.StatusUnauthorized {
			t.Errorf("token %q: status = %d, want 401", token, status)
		}
	}
}

func TestAccountDeletionRequiresTheExactConfirmation(t *testing.T) {
	s := newDeletionStack(t)
	u := s.signIn(t, "confirm")
	for _, confirm := range []string{"", "delete", "DELETE "} {
		status, body := s.deleteAccount(t, u.token, confirm)
		if status != http.StatusBadRequest || body["code"] != "confirmation_required" {
			t.Errorf("confirm %q: status = %d, body = %v", confirm, status, body)
		}
	}
	if !s.userExists(u.user) {
		t.Fatal("an unconfirmed request deleted the account")
	}
}

func TestAccountDeletionCancelsEveryStripeSubscriptionAndDeletesTheAccount(t *testing.T) {
	s := newDeletionStack(t)
	gone := s.signIn(t, "gone")
	bystander := s.signIn(t, "bystander")

	customer := s.id("cus_e2e_gone")
	live := []string{s.id("sub_e2e_active"), s.id("sub_e2e_past_due"), s.id("sub_e2e_trialing")}
	s.seedStripe(t, live[0], customer, "active")
	s.seedStripe(t, live[1], customer, "past_due")
	s.seedStripe(t, live[2], customer, "trialing")
	ended := s.id("sub_e2e_ended")
	s.seedStripe(t, ended, customer, "canceled")
	legacy := s.id("sub_e2e_legacy") // linked locally, billed to an older customer
	s.seedStripe(t, legacy, s.id("cus_e2e_legacy"), "active")
	s.linkStripe(t, gone.user, customer, legacy)
	goneData := s.seedAccountData(t, gone.user)

	bystanderSub := s.id("sub_e2e_bystander")
	s.seedStripe(t, bystanderSub, s.id("cus_e2e_bystander"), "active")
	s.linkStripe(t, bystander.user, s.id("cus_e2e_bystander"), bystanderSub)
	bystanderData := s.seedAccountData(t, bystander.user)

	status, receipt := s.deleteAccount(t, gone.token, "DELETE")
	if status != http.StatusOK {
		t.Fatalf("DELETE /v1/me = %d: %v", status, receipt)
	}
	if receipt["subscriptionsCancelled"] != float64(4) || receipt["workspacesDeleted"] != float64(1) || receipt["identityDeleted"] != true {
		t.Fatalf("receipt = %v", receipt)
	}
	if _, err := uuid.Parse(fmt.Sprint(receipt["receiptId"])); err != nil {
		t.Errorf("receiptId = %v is not a UUID", receipt["receiptId"])
	}
	for _, leaked := range []string{gone.workosID, gone.workosID + "@example.test", customer} {
		for key, value := range receipt {
			if strings.Contains(fmt.Sprint(value), leaked) {
				t.Errorf("receipt field %s leaks %q", key, leaked)
			}
		}
	}

	state := s.state(t)
	wantCancelled := sorted(append(slices.Clone(live), legacy))
	var gotCancelled []string
	for _, id := range state.Cancelled {
		if strings.HasSuffix(id, "_"+s.run) {
			gotCancelled = append(gotCancelled, id)
		}
	}
	if got := sorted(gotCancelled); !slices.Equal(got, wantCancelled) {
		t.Errorf("Stripe cancelled = %v, want %v", got, wantCancelled)
	}
	if state.Subscriptions[bystanderSub].Status != "active" {
		t.Error("another customer's subscription was cancelled")
	}
	if !slices.Contains(state.DeletedWorkOSUsers, gone.workosID) {
		t.Errorf("WorkOS deletes = %v, want %s", state.DeletedWorkOSUsers, gone.workosID)
	}
	if slices.Contains(state.DeletedWorkOSUsers, bystander.workosID) {
		t.Error("the bystander's WorkOS identity was deleted")
	}

	c := s.client
	stillThere := map[string]bool{
		"user":                     s.userExists(gone.user),
		"workspace":                c.RevenueWorkspace.Query().Where(revenueworkspace.IDEQ(goneData.workspace.ID)).ExistX(deletionInternal),
		"relationship":             c.Relationship.Query().Where(relationship.IDEQ(goneData.relationship.ID)).ExistX(deletionInternal),
		"person":                   c.Person.Query().Where(person.IDEQ(goneData.person.ID)).ExistX(deletionInternal),
		"participants":             c.RelationshipParticipant.Query().Where(relationshipparticipant.HasWorkspaceWith(revenueworkspace.IDEQ(goneData.workspace.ID))).ExistX(deletionInternal),
		"person_interaction_stats": c.PersonInteractionStat.Query().Where(personinteractionstat.HasWorkspaceWith(revenueworkspace.IDEQ(goneData.workspace.ID))).ExistX(deletionInternal),
		"mail_thread":              c.MailThread.Query().Where(mailthread.IDEQ(goneData.thread.ID)).ExistX(deletionInternal),
		"credit_ledger":            c.CreditLedger.Query().Where(creditledger.IDEQ(goneData.ledger.ID)).ExistX(deletionInternal),
		"billing row":              c.Subscription.Query().Where(subscription.StripeCustomerIDEQ(customer)).ExistX(deletionInternal),
		"user_histories":           c.UserHistory.Query().Where(userhistory.RefEQ(gone.user.ID)).ExistX(deletionInternal),
	}
	for name, exists := range stillThere {
		if exists {
			t.Errorf("%s of the deleted account still exists", name)
		}
	}

	bystanderKept := map[string]bool{
		"user":         s.userExists(bystander.user),
		"workspace":    c.RevenueWorkspace.Query().Where(revenueworkspace.IDEQ(bystanderData.workspace.ID)).ExistX(deletionInternal),
		"relationship": c.Relationship.Query().Where(relationship.IDEQ(bystanderData.relationship.ID)).ExistX(deletionInternal),
		"mail_thread":  c.MailThread.Query().Where(mailthread.IDEQ(bystanderData.thread.ID)).ExistX(deletionInternal),
		"billing row":  c.Subscription.Query().Where(subscription.StripeCustomerIDEQ(s.id("cus_e2e_bystander"))).ExistX(deletionInternal),
	}
	for name, exists := range bystanderKept {
		if !exists {
			t.Errorf("the bystander's %s was deleted", name)
		}
	}
}

func TestAccountDeletionGivesASharedWorkspaceToAMember(t *testing.T) {
	s := newDeletionStack(t)
	owner := s.signIn(t, "owner")
	member := s.signIn(t, "member")
	data := s.seedAccountData(t, owner.user)
	c := s.client
	c.RevenueWorkspaceMember.Create().SetWorkspace(data.workspace).SetUser(member.user).SetRole("admin").SetStatus("active").SaveX(deletionInternal)
	// The member's row points at rows the owner wrote. The deletion must keep them.
	participant := c.RelationshipParticipant.Create().SetWorkspace(data.workspace).SetUser(member.user).
		SetRelationship(data.relationship).SetPerson(data.person).SetDisplayName("Ada").SetEmail("ada@" + s.run + ".test").
		SetRole("decision_maker").SaveX(deletionInternal)

	status, receipt := s.deleteAccount(t, owner.token, "DELETE")
	if status != http.StatusOK {
		t.Fatalf("DELETE /v1/me = %d: %v", status, receipt)
	}
	if receipt["workspacesTransferred"] != float64(1) || receipt["workspacesDeleted"] != float64(0) {
		t.Fatalf("receipt = %v", receipt)
	}
	if got := c.RevenueWorkspace.Query().Where(revenueworkspace.IDEQ(data.workspace.ID)).QueryUser().OnlyIDX(deletionInternal); got != member.user.ID {
		t.Fatalf("workspace owner = %s, want the member", got)
	}
	role := c.RevenueWorkspaceMember.Query().Where(
		revenueworkspacemember.HasWorkspaceWith(revenueworkspace.IDEQ(data.workspace.ID)),
		revenueworkspacemember.HasUserWith(user.IDEQ(member.user.ID)),
	).OnlyX(deletionInternal).Role
	if role != "owner" {
		t.Fatalf("member role = %q, want owner", role)
	}
	if got := c.Relationship.Query().Where(relationship.IDEQ(data.relationship.ID)).QueryUser().OnlyIDX(deletionInternal); got != member.user.ID {
		t.Errorf("relationship author = %s, want the member", got)
	}
	if got := c.Person.Query().Where(person.IDEQ(data.person.ID)).QueryUser().OnlyIDX(deletionInternal); got != member.user.ID {
		t.Errorf("person author = %s, want the member", got)
	}
	if !c.RelationshipParticipant.Query().Where(relationshipparticipant.IDEQ(participant.ID)).ExistX(deletionInternal) {
		t.Error("the member's participant row was deleted")
	}
	if c.MailThread.Query().Where(mailthread.IDEQ(data.thread.ID)).ExistX(deletionInternal) {
		t.Error("the owner's private mail thread survived the deletion")
	}
	if s.userExists(owner.user) || !s.userExists(member.user) {
		t.Fatal("wrong user deleted")
	}
	if slices.Contains(s.state(t).DeletedWorkOSUsers, member.workosID) {
		t.Error("the member's WorkOS identity was deleted")
	}
}

func TestAccountDeletionRefusesWhenNoMemberCanTakeTheWorkspace(t *testing.T) {
	s := newDeletionStack(t)
	owner := s.signIn(t, "blocked_owner")
	member := s.signIn(t, "blocked_member")
	data := s.seedAccountData(t, owner.user)
	s.seedAccountData(t, member.user) // the member already owns a workspace
	s.client.RevenueWorkspaceMember.Create().SetWorkspace(data.workspace).SetUser(member.user).SetRole("admin").SetStatus("active").SaveX(deletionInternal)
	sub := s.id("sub_e2e_blocked")
	s.seedStripe(t, sub, s.id("cus_e2e_blocked"), "active")
	s.linkStripe(t, owner.user, s.id("cus_e2e_blocked"), sub)

	status, body := s.deleteAccount(t, owner.token, "DELETE")
	if status != http.StatusConflict || body["code"] != "workspace_successor_required" {
		t.Fatalf("DELETE /v1/me = %d: %v", status, body)
	}
	if !s.userExists(owner.user) {
		t.Fatal("the account was deleted")
	}
	state := s.state(t)
	if state.Subscriptions[sub].Status != "active" || slices.Contains(state.Cancelled, sub) {
		t.Error("Stripe was cancelled before the workspace check refused the deletion")
	}
	if slices.Contains(state.DeletedWorkOSUsers, owner.workosID) {
		t.Error("the WorkOS identity was deleted")
	}
}

func TestAccountDeletionKeepsTheAccountWhenStripeRefusesToCancel(t *testing.T) {
	s := newDeletionStack(t)
	u := s.signIn(t, "stripe_refused")
	data := s.seedAccountData(t, u.user)
	sub := s.id("sub_e2e_refused")
	s.seedStripe(t, sub, s.id("cus_e2e_refused"), "active")
	s.fixture(t, http.MethodPost, "/fixture/stripe/cancel-failure", fmt.Sprintf(`{"id":%q,"status":402}`, sub))
	s.linkStripe(t, u.user, s.id("cus_e2e_refused"), sub)

	status, body := s.deleteAccount(t, u.token, "DELETE")
	if status != http.StatusBadGateway || body["code"] != "billing_cancellation_failed" {
		t.Fatalf("DELETE /v1/me = %d: %v", status, body)
	}
	if !s.userExists(u.user) || !s.client.Relationship.Query().Where(relationship.IDEQ(data.relationship.ID)).ExistX(deletionInternal) {
		t.Fatal("data was deleted although Stripe can still charge the account")
	}
	state := s.state(t)
	if state.Subscriptions[sub].Status != "active" {
		t.Errorf("subscription status = %q, want active", state.Subscriptions[sub].Status)
	}
	if slices.Contains(state.DeletedWorkOSUsers, u.workosID) {
		t.Error("the WorkOS identity was deleted")
	}
}

func TestAccountDeletionIsRateLimitedPerUser(t *testing.T) {
	s := newDeletionStack(t)
	u := s.signIn(t, "rate_limited")
	for attempt := 1; attempt <= 5; attempt++ {
		if status, body := s.deleteAccount(t, u.token, "no"); status != http.StatusBadRequest {
			t.Fatalf("attempt %d: status = %d (%v), want 400", attempt, status, body)
		}
	}
	if status, body := s.deleteAccount(t, u.token, "DELETE"); status != http.StatusTooManyRequests {
		t.Fatalf("attempt 6: status = %d (%v), want 429", status, body)
	}
	if !s.userExists(u.user) {
		t.Fatal("a rate-limited request deleted the account")
	}
	other := s.signIn(t, "not_rate_limited")
	if status, _ := s.deleteAccount(t, other.token, "no"); status != http.StatusBadRequest {
		t.Fatalf("another user's request = %d, want 400 (limits are per user)", status)
	}
}

// A token issued before the deletion stays valid until it expires. The API
// records a tombstone for the deleted identity, so the token gets 401 and
// cannot create the account again.
func TestAccountDeletionRefusesAPreDeletionToken(t *testing.T) {
	s := newDeletionStack(t)
	u := s.signIn(t, "stale_token")
	s.seedAccountData(t, u.user)
	s.linkStripe(t, u.user, s.id("cus_e2e_stale"), "")

	if status, body := s.deleteAccount(t, u.token, "DELETE"); status != http.StatusOK {
		t.Fatalf("DELETE /v1/me = %d: %v", status, body)
	}
	for _, request := range []struct{ method, body string }{
		{http.MethodGet, ""},
		{http.MethodDelete, `{"confirm":"DELETE"}`},
	} {
		status, raw := s.send(t, request.method, s.api+"/v1/me", u.token, request.body, nil)
		if status != http.StatusUnauthorized || !strings.Contains(string(raw), `"account_deleted"`) {
			t.Fatalf("%s /v1/me after deletion = %d: %s; want 401 account_deleted", request.method, status, raw)
		}
	}
	if n := s.client.User.Query().Where(user.WorkosUserIDEQ(u.workosID)).CountX(deletionInternal); n != 0 {
		t.Fatalf("the pre-deletion token created %d accounts, want 0", n)
	}
}
