package actions

import (
	"context"
	"errors"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/actionproposal"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/approvaltoken"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
)

// --- fixture -----------------------------------------------------------------

type fakeExecutor struct {
	result  *ExecResult
	err     error
	calls   int
	lastReq ExecRequest
}

func (f *fakeExecutor) Execute(_ context.Context, req ExecRequest) (*ExecResult, error) {
	f.calls++
	f.lastReq = req
	if f.err != nil {
		return nil, f.err
	}
	return f.result, nil
}

type fixture struct {
	t      *testing.T
	client *ent.Client
	broker *Broker
	exec   *fakeExecutor
	user   *ent.User
	ctx    context.Context
	now    time.Time
}

// internalCtx is an internal-caller context (bypasses the tenant interceptor),
// mirroring how the cloud-event router calls the broker.
func internalCtx() context.Context {
	return auth.WithInternal(context.Background())
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })

	user := d.Client.User.Create().SetEmail("op@example.com").SetWorkosUserID("op_1").
		SaveX(auth.WithInternal(context.Background()))

	signer, err := NewSigner(testSecret)
	if err != nil {
		t.Fatalf("signer: %v", err)
	}
	exec := &fakeExecutor{result: &ExecResult{ResultRef: "conduit:step:step_1"}}
	f := &fixture{
		t:      t,
		client: d.Client,
		exec:   exec,
		user:   user,
		ctx:    auth.WithUser(context.Background(), user),
		now:    time.Unix(1_700_000_000, 0),
	}
	f.broker = NewBroker(d.Client, signer, exec, Config{
		TokenTTL:                  5 * time.Minute,
		WatchTimeout:              24 * time.Hour,
		RequireStepUpForFinancial: true,
	}, zap.NewNop())
	f.broker.now = func() time.Time { return f.now }
	return f
}

func (f *fixture) propose(financial bool) *ent.ActionProposal {
	f.t.Helper()
	p, err := f.broker.Propose(f.ctx, f.user, ProposeInput{
		Target:     "conduit:invoice:inv_456",
		Kind:       "conduit.dunning.advance",
		ParamsJSON: `{"amount":100,"step":2}`,
		Financial:  financial,
		Rationale:  "Acme is 14 days overdue",
	})
	if err != nil {
		f.t.Fatalf("propose: %v", err)
	}
	return p
}

// --- Propose / state machine -------------------------------------------------

func TestProposeCreatesPending(t *testing.T) {
	f := newFixture(t)
	p := f.propose(false)
	if p.Status != StatusPending {
		t.Fatalf("status = %q, want pending", p.Status)
	}
	if p.CorrelationID == "" {
		t.Fatal("correlation id should be auto-generated")
	}
	pending, err := f.broker.ListPending(f.ctx)
	if err != nil || len(pending) != 1 {
		t.Fatalf("ListPending: %v len=%d", err, len(pending))
	}
}

func TestProposeRejectsMissingFields(t *testing.T) {
	f := newFixture(t)
	if _, err := f.broker.Propose(f.ctx, f.user, ProposeInput{Kind: "x"}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("missing target err = %v, want ErrInvalidInput", err)
	}
	if _, err := f.broker.Propose(f.ctx, f.user, ProposeInput{Target: "t", Kind: "k", ParamsJSON: "{bad"}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("bad params err = %v, want ErrInvalidInput", err)
	}
}

func TestRejectTransition(t *testing.T) {
	f := newFixture(t)
	p := f.propose(false)
	got, err := f.broker.Reject(f.ctx, p.ID, "not now")
	if err != nil {
		t.Fatalf("reject: %v", err)
	}
	if got.Status != StatusRejected || got.Reason != "not now" {
		t.Fatalf("after reject: status=%q reason=%q", got.Status, got.Reason)
	}
	// A rejected proposal can no longer be approved.
	if _, err := f.broker.Approve(f.ctx, f.user, p.ID, true); !errors.Is(err, ErrNotPending) {
		t.Fatalf("approve after reject err = %v, want ErrNotPending", err)
	}
}

// --- Full round-trip ---------------------------------------------------------

func TestFullRoundTrip(t *testing.T) {
	f := newFixture(t)
	p := f.propose(false)

	res, err := f.broker.Approve(f.ctx, f.user, p.ID, false)
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if res.Token == "" {
		t.Fatal("approve returned no token")
	}
	if res.Proposal.Status != StatusApproved {
		t.Fatalf("status after approve = %q", res.Proposal.Status)
	}

	done, err := f.broker.Execute(f.ctx, f.user, p.ID, res.Token)
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if done.Status != StatusExecuted {
		t.Fatalf("status after execute = %q", done.Status)
	}
	if done.ResultRef != "conduit:step:step_1" {
		t.Fatalf("result ref = %q", done.ResultRef)
	}
	if f.exec.calls != 1 {
		t.Fatalf("executor calls = %d, want 1", f.exec.calls)
	}
	// The correlation id is echoed to the product for the Watch leg.
	if f.exec.lastReq.CorrelationID != p.CorrelationID {
		t.Fatalf("correlation not echoed: %q != %q", f.exec.lastReq.CorrelationID, p.CorrelationID)
	}
	if f.exec.lastReq.UserID != f.user.ID {
		t.Fatal("executor must be scoped to the operator")
	}
}

// --- Token security ----------------------------------------------------------

// The token is single-use: a consumed token cannot execute again even while the
// proposal is still approved (simulates a crash between consume and status
// update, and a concurrent replay).
func TestReusedTokenRejected(t *testing.T) {
	f := newFixture(t)
	p := f.propose(false)
	res, _ := f.broker.Approve(f.ctx, f.user, p.ID, false)

	// Simulate the token already having been consumed by a prior execute.
	n, err := f.client.ApprovalToken.Update().
		Where(approvaltoken.TokenHash(Hash(res.Token))).
		SetConsumed(true).
		Save(f.ctx)
	if err != nil || n != 1 {
		t.Fatalf("pre-consume: %v n=%d", err, n)
	}

	if _, err := f.broker.Execute(f.ctx, f.user, p.ID, res.Token); !errors.Is(err, ErrTokenReused) {
		t.Fatalf("reused token err = %v, want ErrTokenReused", err)
	}
	if f.exec.calls != 0 {
		t.Fatal("a reused token must never reach the executor")
	}
}

// A second execute after a successful one is rejected (no double execution).
func TestDoubleExecuteRejected(t *testing.T) {
	f := newFixture(t)
	p := f.propose(false)
	res, _ := f.broker.Approve(f.ctx, f.user, p.ID, false)
	if _, err := f.broker.Execute(f.ctx, f.user, p.ID, res.Token); err != nil {
		t.Fatalf("first execute: %v", err)
	}
	if _, err := f.broker.Execute(f.ctx, f.user, p.ID, res.Token); !errors.Is(err, ErrAlreadyExecuted) {
		t.Fatalf("second execute err = %v, want ErrAlreadyExecuted", err)
	}
	if f.exec.calls != 1 {
		t.Fatalf("executor called %d times, want exactly 1", f.exec.calls)
	}
}

// Editing params after approval invalidates the token (defeats approve-then-swap).
func TestEditedParamsInvalidatesToken(t *testing.T) {
	f := newFixture(t)
	p := f.propose(false)
	res, _ := f.broker.Approve(f.ctx, f.user, p.ID, false)

	// Simulate an operator edit: the params change, re-hashing them.
	if _, err := f.client.ActionProposal.UpdateOneID(p.ID).
		SetParamsJSON(`{"amount":999,"step":2}`).Save(f.ctx); err != nil {
		t.Fatalf("edit params: %v", err)
	}

	if _, err := f.broker.Execute(f.ctx, f.user, p.ID, res.Token); !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("edited-params execute err = %v, want ErrTokenInvalid", err)
	}
	if f.exec.calls != 0 {
		t.Fatal("params mismatch must never reach the executor")
	}
}

// An expired token cannot execute.
func TestExpiredTokenRejected(t *testing.T) {
	f := newFixture(t)
	p := f.propose(false)
	res, _ := f.broker.Approve(f.ctx, f.user, p.ID, false)

	f.now = f.now.Add(6 * time.Minute) // past the 5m TTL
	if _, err := f.broker.Execute(f.ctx, f.user, p.ID, res.Token); !errors.Is(err, ErrTokenExpired) {
		t.Fatalf("expired token err = %v, want ErrTokenExpired", err)
	}
	if f.exec.calls != 0 {
		t.Fatal("expired token must never reach the executor")
	}
}

// A token minted for a different proposal cannot execute this one.
func TestForeignTokenRejected(t *testing.T) {
	f := newFixture(t)
	p1 := f.propose(false)
	p2 := f.propose(false)
	res2, _ := f.broker.Approve(f.ctx, f.user, p2.ID, false)

	// Approve p1 too so it is in the executable state, then try p2's token.
	if _, err := f.broker.Approve(f.ctx, f.user, p1.ID, false); err != nil {
		t.Fatalf("approve p1: %v", err)
	}
	if _, err := f.broker.Execute(f.ctx, f.user, p1.ID, res2.Token); !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("foreign token err = %v, want ErrTokenInvalid", err)
	}
	if f.exec.calls != 0 {
		t.Fatal("a foreign token must never reach the executor")
	}
}

// --- Step-up for financial ---------------------------------------------------

func TestFinancialRequiresStepUp(t *testing.T) {
	f := newFixture(t)
	p := f.propose(true)
	if _, err := f.broker.Approve(f.ctx, f.user, p.ID, false); !errors.Is(err, ErrStepUpRequired) {
		t.Fatalf("financial approve without step-up err = %v, want ErrStepUpRequired", err)
	}
	// With step-up it succeeds.
	if _, err := f.broker.Approve(f.ctx, f.user, p.ID, true); err != nil {
		t.Fatalf("financial approve with step-up: %v", err)
	}
}

func TestNonFinancialSkipsStepUp(t *testing.T) {
	f := newFixture(t)
	p := f.propose(false)
	if _, err := f.broker.Approve(f.ctx, f.user, p.ID, false); err != nil {
		t.Fatalf("non-financial approve without step-up should pass: %v", err)
	}
}

// --- Execution unavailable (fail closed, token preserved) --------------------

func TestExecutionUnavailablePreservesToken(t *testing.T) {
	f := newFixture(t)
	f.broker.exec = nil // no Act-seam configured
	p := f.propose(false)
	res, _ := f.broker.Approve(f.ctx, f.user, p.ID, false)

	if _, err := f.broker.Execute(f.ctx, f.user, p.ID, res.Token); !errors.Is(err, ErrExecutionUnavailable) {
		t.Fatalf("execute with no backend err = %v, want ErrExecutionUnavailable", err)
	}
	// The proposal stays approved and the token stays unconsumed for retry.
	got, _ := f.broker.Get(f.ctx, p.ID)
	if got.Status != StatusApproved {
		t.Fatalf("status = %q, want approved (unchanged)", got.Status)
	}
	row := f.client.ApprovalToken.Query().Where(approvaltoken.TokenHash(Hash(res.Token))).OnlyX(f.ctx)
	if row.Consumed {
		t.Fatal("token must not be consumed when execution is unavailable")
	}
}

// A failed execution consumes the token and marks the proposal failed (retry is
// a fresh proposal — money never moves twice from one approval).
func TestFailedExecutionBurnsToken(t *testing.T) {
	f := newFixture(t)
	f.exec.err = errors.New("product 500")
	p := f.propose(false)
	res, _ := f.broker.Approve(f.ctx, f.user, p.ID, false)

	if _, err := f.broker.Execute(f.ctx, f.user, p.ID, res.Token); err == nil {
		t.Fatal("expected execute to surface the product error")
	}
	got, _ := f.broker.Get(f.ctx, p.ID)
	if got.Status != StatusFailed {
		t.Fatalf("status = %q, want failed", got.Status)
	}
	// The consumed token cannot be replayed.
	if _, err := f.broker.Execute(f.ctx, f.user, p.ID, res.Token); errors.Is(err, ErrTokenReused) {
		return // via consumed ledger
	} else if !errors.Is(err, ErrNotApproved) {
		t.Fatalf("replay after failure err = %v, want ErrNotApproved/ErrTokenReused", err)
	}
}

// --- Tenancy -----------------------------------------------------------------

func TestTenantIsolation(t *testing.T) {
	f := newFixture(t)
	p := f.propose(false)

	// A second operator with their own viewer context.
	other := f.client.User.Create().SetEmail("b@example.com").SetWorkosUserID("op_2").
		SaveX(auth.WithInternal(context.Background()))
	otherCtx := auth.WithUser(context.Background(), other)

	if _, err := f.broker.Get(otherCtx, p.ID); !ent.IsNotFound(err) {
		t.Fatalf("cross-tenant Get err = %v, want not found", err)
	}
	if _, err := f.broker.Approve(otherCtx, other, p.ID, true); !ent.IsNotFound(err) {
		t.Fatalf("cross-tenant Approve err = %v, want not found", err)
	}
	pending, err := f.broker.ListPending(otherCtx)
	if err != nil || len(pending) != 0 {
		t.Fatalf("other operator should see no proposals: %v len=%d", err, len(pending))
	}
}

// --- Audit -------------------------------------------------------------------

func TestAuditChain(t *testing.T) {
	f := newFixture(t)
	p := f.propose(false)
	res, _ := f.broker.Approve(f.ctx, f.user, p.ID, false)
	if _, err := f.broker.Execute(f.ctx, f.user, p.ID, res.Token); err != nil {
		t.Fatalf("execute: %v", err)
	}

	entries, err := f.broker.Audit(f.ctx, "conduit:invoice:inv_456")
	if err != nil {
		t.Fatalf("audit: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("audit entries = %d, want 1", len(entries))
	}
	e := entries[0]
	if e.Proposal.Status != StatusExecuted {
		t.Fatalf("audited proposal status = %q", e.Proposal.Status)
	}
	if len(e.Tokens) != 1 {
		t.Fatalf("audited tokens = %d, want 1", len(e.Tokens))
	}
	tv := e.Tokens[0]
	if !tv.Consumed || tv.ConsumedAt == nil {
		t.Fatal("audited token should be consumed with a timestamp")
	}
	// The audit view must never leak the raw token.
	if len(tv.HashPrefix) > 12 {
		t.Fatalf("hash prefix too long: %q", tv.HashPrefix)
	}
}

func TestAuditRequiresRef(t *testing.T) {
	f := newFixture(t)
	if _, err := f.broker.Audit(f.ctx, "  "); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("empty ref err = %v, want ErrInvalidInput", err)
	}
}

// sanity: the proposal count filter for pending excludes non-pending.
func TestListPendingExcludesResolved(t *testing.T) {
	f := newFixture(t)
	p1 := f.propose(false)
	p2 := f.propose(false)
	if _, err := f.broker.Reject(f.ctx, p2.ID, "x"); err != nil {
		t.Fatalf("reject: %v", err)
	}
	pending, _ := f.broker.ListPending(f.ctx)
	if len(pending) != 1 || pending[0].ID != p1.ID {
		t.Fatalf("pending should contain only p1, got %d", len(pending))
	}
	// Cross-check the underlying predicate.
	n := f.client.ActionProposal.Query().Where(actionproposal.StatusEQ(StatusPending)).CountX(f.ctx)
	if n != 1 {
		t.Fatalf("pending count = %d, want 1", n)
	}
}
