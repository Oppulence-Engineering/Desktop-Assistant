package revenue

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueoutboxevent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	appcrypto "github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/crypto"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
)

// --- fixtures ----------------------------------------------------------------

func openDB(t *testing.T) *ent.Client {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d.Client
}

func newUser(t *testing.T, client *ent.Client, email, workosID string) *ent.User {
	t.Helper()
	return client.User.Create().SetEmail(email).SetWorkosUserID(workosID).
		SaveX(auth.WithInternal(context.Background()))
}

// fakeFacade returns a scripted decision (or error) and counts calls.
type fakeFacade struct {
	decision *PolicyDecision
	err      error
	calls    int
}

func (f *fakeFacade) EvaluateRevenueAction(_ context.Context, req EvaluateRequest) (*PolicyDecision, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	d := *f.decision
	// Echo the request binding like the real facade contract requires.
	d.ActionID = req.Action.ActionID
	d.Revision = req.Action.Revision
	d.RevisionHash = req.Action.RevisionHash
	return &d, nil
}

func (f *fakeFacade) ReportRevenueActionOutcome(context.Context, OutcomeReport) error {
	return f.err
}

// fakeExecutor returns a scripted result (or error) and counts calls.
type fakeExecutor struct {
	result          *ExecResult
	err             error
	calls           int
	reconcileResult *ExecResult
	reconcileFound  bool
	reconcileErr    error
	reconcileCalls  int
}

func (f *fakeExecutor) Reconcile(context.Context, ExecRequest) (*ExecResult, bool, error) {
	f.reconcileCalls++
	return f.reconcileResult, f.reconcileFound, f.reconcileErr
}

func (f *fakeExecutor) Execute(context.Context, ExecRequest) (*ExecResult, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	return f.result, nil
}

func passedDecision(expires time.Time) *PolicyDecision {
	return &PolicyDecision{
		SchemaVersion: SchemaVersion,
		DecisionID:    "decision_test_1",
		Status:        PolicyPassed,
		ReasonCodes:   []string{},
		EvaluatedAt:   time.Now().UTC().Add(-time.Minute),
		ExpiresAt:     expires,
		ResponseHash:  "sha256:test",
	}
}

type fixture struct {
	client *ent.Client
	svc    *Service
	user   *ent.User
	ctx    context.Context
	facade *fakeFacade
	exec   *fakeExecutor
	// Distinct address per created relationship. Every call used to reuse one
	// address, which quietly built several accounts around a single identity --
	// harmless only while nothing enforced identity. Now that CreateRelationship
	// binds anchors, that would raise a review candidate and correctly block the
	// action queue, so each helper-made account gets its own counterparty.
	relationshipSeq int
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	client := openDB(t)
	u := newUser(t, client, "owner@x.co", "user_owner")
	facade := &fakeFacade{decision: passedDecision(time.Now().UTC().Add(24 * time.Hour))}
	exec := &fakeExecutor{result: &ExecResult{ProviderMessageID: "msg_1", ProviderThreadID: "thr_1"}}
	svc := NewService(client, facade, exec, zap.NewNop())
	sealer, err := appcrypto.NewSealer("test-tenant-evidence-kek-32-bytes-minimum")
	if err != nil {
		t.Fatalf("test evidence sealer: %v", err)
	}
	svc.SetEvidenceSealer(sealer)
	return &fixture{
		client: client,
		svc:    svc,
		user:   u,
		ctx:    auth.WithUser(context.Background(), u),
		facade: facade,
		exec:   exec,
	}
}

func (f *fixture) relationship(t *testing.T) *ent.Relationship {
	t.Helper()
	f.relationshipSeq++
	email := "buyer@example.com"
	if f.relationshipSeq > 1 {
		email = fmt.Sprintf("buyer%d@example.com", f.relationshipSeq)
	}
	rel, err := f.svc.CreateRelationship(f.ctx, f.user, RelationshipInput{
		Kind: "person", DisplayName: "Jordan Buyer",
		PrimaryEmail: email, AccountDomain: "example.com",
	})
	if err != nil {
		t.Fatalf("relationship: %v", err)
	}
	return rel
}

func (f *fixture) action(t *testing.T, mode string) *ent.RevenueAction {
	t.Helper()
	rel := f.relationship(t)
	action, err := f.svc.CreateAction(f.ctx, f.user, ActionInput{
		RelationshipID:  rel.ID,
		ActionType:      "warm_follow_up",
		Channel:         "email",
		Reason:          "they asked for a follow-up in July",
		RecipientEmail:  "buyer@example.com",
		ProposedSubject: "Following up",
		ProposedMessage: "Hi Jordan — circling back as promised.",
		ExecutionMode:   mode,
		PriorityScore:   80,
	})
	if err != nil {
		t.Fatalf("action: %v", err)
	}
	return action
}

// link puts the workspace into linked mode (facade configured in fixtures).
func (f *fixture) link(t *testing.T) {
	t.Helper()
	if _, err := f.svc.LinkWorkspace(f.ctx, f.user, LinkInput{
		OutboundOrganizationID: "org_1", OutboundWorkspaceID: "ws_1",
	}); err != nil {
		t.Fatalf("link: %v", err)
	}
}

// --- invariants --------------------------------------------------------------

// Invariant 1: a blocked action cannot be approved or executed.
func TestBlockedActionCannotBeApprovedOrExecuted(t *testing.T) {
	f := newFixture(t)
	f.link(t)
	f.facade.decision = passedDecision(time.Now().UTC().Add(24 * time.Hour))
	f.facade.decision.Status = PolicyBlocked
	action := f.action(t, ExecModeSend)

	if _, err := f.svc.Evaluate(f.ctx, f.user, action.ID); err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	if _, err := f.svc.Approve(f.ctx, f.user, action.ID, false); !errors.Is(err, ErrBlocked) {
		t.Fatalf("approve on blocked: want ErrBlocked, got %v", err)
	}
	if _, err := f.svc.Approve(f.ctx, f.user, action.ID, true); !errors.Is(err, ErrBlocked) {
		t.Fatalf("approve with acceptRisk on blocked: want ErrBlocked, got %v", err)
	}
	if _, err := f.svc.Execute(f.ctx, f.user, action.ID); !errors.Is(err, ErrBlocked) {
		t.Fatalf("execute on blocked: want ErrBlocked, got %v", err)
	}
	if f.exec.calls != 0 {
		t.Fatalf("executor must never run for a blocked action, ran %d times", f.exec.calls)
	}
}

// Invariant 3: an edit creates a new revision and invalidates the previous
// policy decision and approval.
func TestEditInvalidatesPolicyAndApproval(t *testing.T) {
	f := newFixture(t)
	f.link(t)
	action := f.action(t, ExecModeSend)

	if _, err := f.svc.Evaluate(f.ctx, f.user, action.ID); err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	if _, err := f.svc.Approve(f.ctx, f.user, action.ID, false); err != nil {
		t.Fatalf("approve: %v", err)
	}

	subject := "New subject"
	edited, err := f.svc.EditAction(f.ctx, f.user, action.ID, EditInput{ProposedSubject: &subject})
	if err != nil {
		t.Fatalf("edit: %v", err)
	}
	if edited.Revision != 2 {
		t.Fatalf("edit must bump revision: got %d", edited.Revision)
	}
	if edited.RevisionHash == action.RevisionHash {
		t.Fatal("edit must change the revision hash")
	}
	if edited.PolicyStatus != PolicyPending || edited.ApprovalStatus != ApprovalPending {
		t.Fatalf("edit must invalidate policy and approval: policy=%s approval=%s",
			edited.PolicyStatus, edited.ApprovalStatus)
	}
	if edited.ApprovedRevision != 0 || edited.ApprovedDecisionID != nil {
		t.Fatal("edit must clear the approval binding")
	}
	// The stale decision must not satisfy the new revision.
	if _, err := f.svc.Approve(f.ctx, f.user, edited.ID, false); !errors.Is(err, ErrNoDecision) {
		t.Fatalf("approve after edit without re-evaluate: want ErrNoDecision, got %v", err)
	}
	// The revision snapshot chain records both revisions.
	audit, err := f.svc.Audit(f.ctx, action.ID)
	if err != nil {
		t.Fatalf("audit: %v", err)
	}
	if got := len(audit.Edges.Revisions); got != 2 {
		t.Fatalf("want 2 revision snapshots, got %d", got)
	}
}

// A no-op edit (same content) does not bump the revision.
func TestNoOpEditKeepsRevision(t *testing.T) {
	f := newFixture(t)
	action := f.action(t, ExecModeDraft)
	same := "Following up"
	edited, err := f.svc.EditAction(f.ctx, f.user, action.ID, EditInput{ProposedSubject: &same})
	if err != nil {
		t.Fatalf("edit: %v", err)
	}
	if edited.Revision != 1 {
		t.Fatalf("no-op edit must not bump revision: got %d", edited.Revision)
	}
}

// Invariants 4 and 5: approval of a send needs a passed unexpired decision;
// review_required needs explicit risk acceptance.
func TestApproveRequiresDecision(t *testing.T) {
	f := newFixture(t)
	f.link(t)

	t.Run("no decision", func(t *testing.T) {
		action := f.action(t, ExecModeSend)
		if _, err := f.svc.Approve(f.ctx, f.user, action.ID, false); !errors.Is(err, ErrNoDecision) {
			t.Fatalf("want ErrNoDecision, got %v", err)
		}
	})

	t.Run("expired decision", func(t *testing.T) {
		f.facade.decision = passedDecision(time.Now().UTC().Add(-time.Minute))
		action := f.action(t, ExecModeSend)
		if _, err := f.svc.Evaluate(f.ctx, f.user, action.ID); err != nil {
			t.Fatalf("evaluate: %v", err)
		}
		if _, err := f.svc.Approve(f.ctx, f.user, action.ID, false); !errors.Is(err, ErrDecisionExpired) {
			t.Fatalf("want ErrDecisionExpired, got %v", err)
		}
	})

	t.Run("review required needs acceptRisk", func(t *testing.T) {
		f.facade.decision = passedDecision(time.Now().UTC().Add(24 * time.Hour))
		f.facade.decision.Status = PolicyReviewRequired
		action := f.action(t, ExecModeSend)
		if _, err := f.svc.Evaluate(f.ctx, f.user, action.ID); err != nil {
			t.Fatalf("evaluate: %v", err)
		}
		if _, err := f.svc.Approve(f.ctx, f.user, action.ID, false); !errors.Is(err, ErrReviewRequired) {
			t.Fatalf("want ErrReviewRequired, got %v", err)
		}
		approved, err := f.svc.Approve(f.ctx, f.user, action.ID, true)
		if err != nil {
			t.Fatalf("approve with acceptRisk: %v", err)
		}
		if approved.ApprovalStatus != ApprovalApproved || approved.ApprovedRevision != approved.Revision {
			t.Fatalf("approval must bind to the revision: %+v", approved)
		}
		if approved.ApprovedDecisionID == nil {
			t.Fatal("send approval must bind to the decision id")
		}
	})
}

// Invariant 7: duplicate execute returns the existing result; the provider is
// never called twice.
func TestDuplicateExecuteIsIdempotent(t *testing.T) {
	f := newFixture(t)
	f.link(t)
	action := f.action(t, ExecModeSend)
	if _, err := f.svc.Evaluate(f.ctx, f.user, action.ID); err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	if _, err := f.svc.Approve(f.ctx, f.user, action.ID, false); err != nil {
		t.Fatalf("approve: %v", err)
	}
	first, err := f.svc.Execute(f.ctx, f.user, action.ID)
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if first.ExecutionStatus != ExecSent || first.ProviderMessageID != "msg_1" {
		t.Fatalf("first execute: %+v", first)
	}
	second, err := f.svc.Execute(f.ctx, f.user, action.ID)
	if err != nil {
		t.Fatalf("duplicate execute: %v", err)
	}
	if second.ExecutionStatus != ExecSent || second.ProviderMessageID != "msg_1" {
		t.Fatalf("duplicate execute must return the stored result: %+v", second)
	}
	if f.exec.calls != 1 {
		t.Fatalf("provider must be called exactly once, got %d", f.exec.calls)
	}
}

// Invariant 8: an ambiguous provider result is persisted as ambiguous and a
// retry does not resend.
func TestAmbiguousExecutionNeverAutoResends(t *testing.T) {
	f := newFixture(t)
	action := f.action(t, ExecModeDraft)
	if _, err := f.svc.Approve(f.ctx, f.user, action.ID, false); err != nil {
		t.Fatalf("approve: %v", err)
	}
	f.exec.err = ErrAmbiguous
	got, err := f.svc.Execute(f.ctx, f.user, action.ID)
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if got.ExecutionStatus != ExecAmbiguous {
		t.Fatalf("want ambiguous, got %s", got.ExecutionStatus)
	}
	f.exec.err = nil
	again, err := f.svc.Execute(f.ctx, f.user, action.ID)
	if err != nil {
		t.Fatalf("retry: %v", err)
	}
	if again.ExecutionStatus != ExecAmbiguous {
		t.Fatalf("ambiguous must not auto-resend: %s", again.ExecutionStatus)
	}
	if f.exec.calls != 1 {
		t.Fatalf("provider must not be called again after ambiguous, got %d", f.exec.calls)
	}
}

func TestAmbiguousExecutionReconcilesByLookupWithoutResend(t *testing.T) {
	f := newFixture(t)
	action := f.action(t, ExecModeDraft)
	if _, err := f.svc.Approve(f.ctx, f.user, action.ID, false); err != nil {
		t.Fatalf("approve: %v", err)
	}
	f.exec.err = ErrAmbiguous
	ambiguous, err := f.svc.Execute(f.ctx, f.user, action.ID)
	if err != nil || ambiguous.ExecutionStatus != ExecAmbiguous {
		t.Fatalf("ambiguous execute: action=%+v err=%v", ambiguous, err)
	}
	if ambiguous.ReconciliationStatus != "pending" || ambiguous.ReconciliationNextAt == nil {
		t.Fatalf("ambiguous action must be scheduled for lookup: %+v", ambiguous)
	}
	f.exec.err = nil
	f.exec.reconcileFound = true
	f.exec.reconcileResult = &ExecResult{ProviderMessageID: "recovered-msg", ProviderThreadID: "recovered-thread"}
	reconciled, err := f.svc.ReconcileAmbiguousAction(f.ctx, f.user, action.ID)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if reconciled.ExecutionStatus != ExecSent || reconciled.QueueStatus != QueueHandled ||
		reconciled.ProviderMessageID != "recovered-msg" || reconciled.ReconciliationStatus != "found" {
		t.Fatalf("reconciled action = %+v", reconciled)
	}
	if f.exec.calls != 1 || f.exec.reconcileCalls != 1 {
		t.Fatalf("want one write and one lookup, writes=%d lookups=%d", f.exec.calls, f.exec.reconcileCalls)
	}
}

func TestAmbiguousLookupNotFoundSchedulesAnotherReadOnlyAttempt(t *testing.T) {
	f := newFixture(t)
	action := f.action(t, ExecModeDraft)
	if _, err := f.svc.Approve(f.ctx, f.user, action.ID, false); err != nil {
		t.Fatalf("approve: %v", err)
	}
	f.exec.err = ErrAmbiguous
	if _, err := f.svc.Execute(f.ctx, f.user, action.ID); err != nil {
		t.Fatalf("execute: %v", err)
	}
	f.exec.err = nil
	got, err := f.svc.ReconcileAmbiguousAction(f.ctx, f.user, action.ID)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if got.ExecutionStatus != ExecAmbiguous || got.ReconciliationStatus != "not_found" ||
		got.ReconciliationAttempts != 1 || got.ReconciliationNextAt == nil {
		t.Fatalf("not-found lookup must remain ambiguous and scheduled: %+v", got)
	}
	if f.exec.calls != 1 || f.exec.reconcileCalls != 1 {
		t.Fatalf("not-found lookup must not resend: writes=%d lookups=%d", f.exec.calls, f.exec.reconcileCalls)
	}
}

func TestAmbiguousReconciliationWithoutMarkerFailsClosed(t *testing.T) {
	f := newFixture(t)
	action := f.action(t, ExecModeDraft)
	action = f.client.RevenueAction.UpdateOneID(action.ID).
		SetExecutionStatus(ExecAmbiguous).
		SetReconciliationStatus("pending").
		ClearExecutionIdempotencyKey().
		SaveX(f.ctx)

	got, err := f.svc.ReconcileAmbiguousAction(f.ctx, f.user, action.ID)
	if err != nil {
		t.Fatalf("reconcile missing marker: %v", err)
	}
	if got.ExecutionStatus != ExecAmbiguous || got.ReconciliationStatus != "manual_review" ||
		got.ReconciliationAttempts != maxReconciliationAttempts || got.ReconciliationNextAt != nil {
		t.Fatalf("missing marker must fail closed permanently: %+v", got)
	}
	if f.exec.reconcileCalls != 0 || f.exec.calls != 0 {
		t.Fatalf("missing marker must make no provider call: lookups=%d writes=%d", f.exec.reconcileCalls, f.exec.calls)
	}
}

type executeOnlyExecutor struct{}

func (executeOnlyExecutor) Execute(context.Context, ExecRequest) (*ExecResult, error) {
	return nil, errors.New("not used")
}

func TestUnsupportedReconciliationDoesNotRetryForever(t *testing.T) {
	f := newFixture(t)
	action := f.action(t, ExecModeDraft)
	action = f.client.RevenueAction.UpdateOneID(action.ID).
		SetExecutionStatus(ExecAmbiguous).
		SetExecutionIdempotencyKey("safe-marker").
		SetReconciliationStatus("pending").
		SaveX(f.ctx)
	svc := NewService(f.client, f.facade, executeOnlyExecutor{}, zap.NewNop())

	got, err := svc.ReconcileAmbiguousAction(f.ctx, f.user, action.ID)
	if err != nil {
		t.Fatalf("unsupported reconcile: %v", err)
	}
	if got.ReconciliationStatus != "manual_review" || got.ReconciliationAttempts != maxReconciliationAttempts ||
		got.ReconciliationNextAt != nil {
		t.Fatalf("unsupported backend must leave one terminal manual-review state: %+v", got)
	}
}

func TestAmbiguousReconciliationMovesToManualReviewWhenAssignedMemberIsRemoved(t *testing.T) {
	f := newFixture(t)
	member := newUser(t, f.client, "removed-action-owner@x.co", "user_removed_action_owner")
	membership, err := f.svc.UpsertWorkspaceMember(f.ctx, f.user, member.ID, "member")
	if err != nil {
		t.Fatal(err)
	}
	memberCtx := auth.WithUser(context.Background(), member)
	action, err := f.svc.CreateAction(memberCtx, member, ActionInput{
		RelationshipID: f.relationship(t).ID, ActionType: "warm_follow_up", Channel: "email",
		Reason: "Removed actor reconciliation fixture.", RecipientEmail: "buyer@example.com",
		ProposedSubject: "Follow up", ProposedMessage: "Hello", ExecutionMode: ExecModeDraft,
	})
	if err != nil {
		t.Fatal(err)
	}
	action = action.Update().
		SetExecutionStatus(ExecAmbiguous).
		SetExecutionIdempotencyKey("removed-actor-marker").
		SetReconciliationStatus("pending").
		SetReconciliationNextAt(time.Now().UTC().Add(-time.Minute)).
		SaveX(memberCtx)
	if _, err := f.svc.RemoveWorkspaceMember(f.ctx, f.user, membership.ID); err != nil {
		t.Fatal(err)
	}

	NewAmbiguousExecutionReconciler(f.svc, time.Second, 10, zap.NewNop()).sweep(context.Background())
	got, err := f.svc.GetAction(f.ctx, action.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ExecutionStatus != ExecAmbiguous || got.ReconciliationStatus != "manual_review" ||
		got.ReconciliationAttempts != maxReconciliationAttempts || got.ReconciliationNextAt != nil {
		t.Fatalf("removed actor left ambiguous action in an automatic retry loop: %+v", got)
	}
	if f.exec.reconcileCalls != 0 || f.exec.calls != 0 {
		t.Fatalf("removed actor triggered provider access: lookups=%d writes=%d", f.exec.reconcileCalls, f.exec.calls)
	}
}

type barrierReconciler struct {
	arrived chan struct{}
	release chan struct{}
}

func (b *barrierReconciler) Execute(context.Context, ExecRequest) (*ExecResult, error) {
	return nil, errors.New("not used")
}

func (b *barrierReconciler) Reconcile(context.Context, ExecRequest) (*ExecResult, bool, error) {
	b.arrived <- struct{}{}
	<-b.release
	return &ExecResult{ProviderMessageID: "provider-once"}, true, nil
}

func TestConcurrentReconciliationProducesOneTransitionAndOutboxEvent(t *testing.T) {
	f := newFixture(t)
	action := f.action(t, ExecModeDraft)
	action = f.client.RevenueAction.UpdateOneID(action.ID).
		SetExecutionStatus(ExecAmbiguous).
		SetExecutionIdempotencyKey("concurrent-marker").
		SetReconciliationStatus("pending").
		SaveX(f.ctx)
	exec := &barrierReconciler{arrived: make(chan struct{}, 2), release: make(chan struct{})}
	svc := NewService(f.client, f.facade, exec, zap.NewNop())

	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := svc.ReconcileAmbiguousAction(f.ctx, f.user, action.ID)
			errs <- err
		}()
	}
	<-exec.arrived
	<-exec.arrived
	close(exec.release)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent reconcile: %v", err)
		}
	}
	got, err := svc.GetAction(f.ctx, action.ID)
	if err != nil || got.ExecutionStatus != ExecSent || got.ReconciliationAttempts != 1 {
		t.Fatalf("one optimistic transition must win: action=%+v err=%v", got, err)
	}
	events, err := f.client.RevenueOutboxEvent.Query().
		Where(revenueoutboxevent.IdempotencyKeyEQ("reconciled:concurrent-marker")).Count(f.ctx)
	if err != nil || events != 1 {
		t.Fatalf("reconciliation outbox must be emitted once: count=%d err=%v", events, err)
	}
}

// Local mode: drafts execute, sends fail closed.
func TestLocalModeDraftWorksSendFailsClosed(t *testing.T) {
	f := newFixture(t)

	draft := f.action(t, ExecModeDraft)
	if _, err := f.svc.Approve(f.ctx, f.user, draft.ID, false); err != nil {
		t.Fatalf("draft approve in local mode: %v", err)
	}
	executed, err := f.svc.Execute(f.ctx, f.user, draft.ID)
	if err != nil {
		t.Fatalf("draft execute in local mode: %v", err)
	}
	if executed.ExecutionStatus != ExecSent {
		t.Fatalf("draft execute: %s", executed.ExecutionStatus)
	}
	draftedEvents, err := f.client.RevenueOutboxEvent.Query().
		Where(revenueoutboxevent.EventTypeEQ("revenue.action.drafted.v1")).
		Count(f.ctx)
	if err != nil || draftedEvents != 1 {
		t.Fatalf("draft audit event: count=%d err=%v", draftedEvents, err)
	}

	send := f.action(t, ExecModeSend)
	// Send approval needs a decision, which needs a facade evaluate — and even
	// with one, execution in local mode must fail closed.
	if _, err := f.svc.Evaluate(f.ctx, f.user, send.ID); err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	if _, err := f.svc.Approve(f.ctx, f.user, send.ID, false); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if _, err := f.svc.Execute(f.ctx, f.user, send.ID); !errors.Is(err, ErrWorkspaceNotLinked) {
		t.Fatalf("send in local mode: want ErrWorkspaceNotLinked, got %v", err)
	}
}

// Fail closed: a dead facade keeps policy pending and blocks the send path.
func TestFacadeUnavailableFailsClosed(t *testing.T) {
	f := newFixture(t)
	f.facade.err = errors.New("connection refused")
	action := f.action(t, ExecModeSend)

	if _, err := f.svc.Evaluate(f.ctx, f.user, action.ID); err == nil {
		t.Fatal("evaluate must surface facade unavailability")
	}
	got, err := f.svc.GetAction(f.ctx, action.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.PolicyStatus != PolicyPending {
		t.Fatalf("policy must stay pending on facade failure, got %s", got.PolicyStatus)
	}
	if _, err := f.svc.Approve(f.ctx, f.user, action.ID, false); !errors.Is(err, ErrNoDecision) {
		t.Fatalf("approve without decision: want ErrNoDecision, got %v", err)
	}
	// The disabled facade (no configuration at all) behaves the same.
	disabled := NewService(f.client, nil, nil, zap.NewNop())
	if _, err := disabled.Evaluate(f.ctx, f.user, action.ID); !errors.Is(err, ErrFacadeUnavailable) {
		t.Fatalf("disabled facade: want ErrFacadeUnavailable, got %v", err)
	}
}

// Duplicate evaluate for an unchanged revision reuses the stored decision.
func TestDuplicateEvaluateReturnsStoredDecision(t *testing.T) {
	f := newFixture(t)
	f.link(t)
	action := f.action(t, ExecModeSend)
	first, err := f.svc.Evaluate(f.ctx, f.user, action.ID)
	if err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	second, err := f.svc.Evaluate(f.ctx, f.user, action.ID)
	if err != nil {
		t.Fatalf("re-evaluate: %v", err)
	}
	if first.ID != second.ID {
		t.Fatal("duplicate evaluate must return the stored snapshot")
	}
	if f.facade.calls != 1 {
		t.Fatalf("facade must be called exactly once, got %d", f.facade.calls)
	}
}

// Invariant 10: outcomes are append-only and idempotent on source event id.
func TestOutcomesIdempotent(t *testing.T) {
	f := newFixture(t)
	action := f.action(t, ExecModeDraft)
	in := OutcomeInput{Kind: "replied", Source: "gmail", SourceEventID: "msg_9"}
	first, err := f.svc.AppendOutcome(f.ctx, f.user, action.ID, in)
	if err != nil {
		t.Fatalf("outcome: %v", err)
	}
	second, err := f.svc.AppendOutcome(f.ctx, f.user, action.ID, in)
	if err != nil {
		t.Fatalf("duplicate outcome: %v", err)
	}
	if first.ID != second.ID {
		t.Fatal("duplicate outcome must return the stored row")
	}
	storedAction, err := f.svc.GetAction(f.ctx, action.ID)
	if err != nil {
		t.Fatalf("reload action: %v", err)
	}
	timeline, err := f.svc.RelationshipTimeline(f.ctx, actionRelationshipID(storedAction), 50)
	if err != nil {
		t.Fatalf("outcome timeline: %v", err)
	}
	if len(timeline) != 1 || timeline[0].EventType != "action.outcome.replied" {
		t.Fatalf("outcome was not published once into relationship history: %#v", timeline)
	}
}

// Duplicate detector dedupe keys collapse to one queue item.
func TestCreateActionDedupes(t *testing.T) {
	f := newFixture(t)
	rel := f.relationship(t)
	in := ActionInput{
		RelationshipID: rel.ID, ActionType: "warm_follow_up", Channel: "email",
		Reason: "r", DedupeKey: "scan:1", PriorityScore: 10,
	}
	first, err := f.svc.CreateAction(f.ctx, f.user, in)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	second, err := f.svc.CreateAction(f.ctx, f.user, in)
	if err != nil {
		t.Fatalf("duplicate create: %v", err)
	}
	if first.ID != second.ID {
		t.Fatal("duplicate dedupe key must return the existing action")
	}
}

func TestManualActionsWithoutDedupeKeyRemainDistinct(t *testing.T) {
	f := newFixture(t)
	rel := f.relationship(t)
	in := ActionInput{
		RelationshipID: rel.ID, ActionType: "follow_up_task", Channel: "task",
		Reason: "Follow up", PriorityScore: 10,
	}
	first, err := f.svc.CreateAction(f.ctx, f.user, in)
	if err != nil {
		t.Fatalf("create first task: %v", err)
	}
	second, err := f.svc.CreateAction(f.ctx, f.user, in)
	if err != nil {
		t.Fatalf("create second task: %v", err)
	}
	if first.ID == second.ID {
		t.Fatal("separate manual tasks must not collapse into one action")
	}
}

// Tenancy: another user cannot read or mutate the owner's rows.
func TestCrossTenantDenied(t *testing.T) {
	f := newFixture(t)
	action := f.action(t, ExecModeDraft)

	intruder := newUser(t, f.client, "intruder@x.co", "user_intruder")
	ctxB := auth.WithUser(context.Background(), intruder)

	if _, err := f.svc.GetAction(ctxB, action.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-tenant read: want ErrNotFound, got %v", err)
	}
	if _, err := f.svc.Approve(ctxB, intruder, action.ID, false); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-tenant approve: want ErrNotFound, got %v", err)
	}
	if _, err := f.svc.Dismiss(ctxB, intruder, action.ID, "x"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-tenant dismiss: want ErrNotFound, got %v", err)
	}
}

// Queue triage transitions.
func TestSnoozeAndDismiss(t *testing.T) {
	f := newFixture(t)

	t.Run("snooze bounds", func(t *testing.T) {
		action := f.action(t, ExecModeDraft)
		if _, err := f.svc.Snooze(f.ctx, f.user, action.ID, time.Now().Add(-time.Hour)); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("past snooze: want ErrInvalidInput, got %v", err)
		}
		if _, err := f.svc.Snooze(f.ctx, f.user, action.ID, time.Now().Add(365*24*time.Hour)); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("unbounded snooze: want ErrInvalidInput, got %v", err)
		}
		snoozed, err := f.svc.Snooze(f.ctx, f.user, action.ID, time.Now().Add(24*time.Hour))
		if err != nil {
			t.Fatalf("snooze: %v", err)
		}
		if snoozed.QueueStatus != QueueSnoozed || snoozed.SnoozedUntil == nil {
			t.Fatalf("snooze state: %+v", snoozed)
		}
	})

	t.Run("dismiss records outcome", func(t *testing.T) {
		action := f.action(t, ExecModeDraft)
		dismissed, err := f.svc.Dismiss(f.ctx, f.user, action.ID, "already_handled")
		if err != nil {
			t.Fatalf("dismiss: %v", err)
		}
		if dismissed.QueueStatus != QueueDismissed || dismissed.DismissReason != "already_handled" {
			t.Fatalf("dismiss state: %+v", dismissed)
		}
		audit, err := f.svc.Audit(f.ctx, action.ID)
		if err != nil {
			t.Fatalf("audit: %v", err)
		}
		if len(audit.Edges.Outcomes) != 1 || audit.Edges.Outcomes[0].Kind != "dismissed" {
			t.Fatalf("dismiss must record the outcome: %+v", audit.Edges.Outcomes)
		}
	})
}

// The default queue page is bounded (top-ten open actions).
func TestListDefaultsToTopTenOpen(t *testing.T) {
	f := newFixture(t)
	rel := f.relationship(t)
	for i := 0; i < 12; i++ {
		if _, err := f.svc.CreateAction(f.ctx, f.user, ActionInput{
			RelationshipID: rel.ID, ActionType: "warm_follow_up", Channel: "email",
			Reason: "r", DedupeKey: "k" + string(rune('a'+i)), PriorityScore: i * 5,
		}); err != nil {
			t.Fatalf("create %d: %v", i, err)
		}
	}
	actions, err := f.svc.ListActions(f.ctx, f.user, ListFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(actions) != 10 {
		t.Fatalf("default page must be ten actions, got %d", len(actions))
	}
	if actions[0].PriorityScore < actions[len(actions)-1].PriorityScore {
		t.Fatal("queue must be ordered by priority descending")
	}
	if listed, err := actions[0].Edges.RelationshipOrErr(); err != nil || listed.ID != rel.ID {
		t.Fatalf("queue action must include relationship context: relationship=%v err=%v", listed, err)
	}
}

// Lifecycle writes land in the transactional outbox.
func TestOutboxEventsWritten(t *testing.T) {
	f := newFixture(t)
	f.link(t)
	action := f.action(t, ExecModeSend)
	if _, err := f.svc.Evaluate(f.ctx, f.user, action.ID); err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	if _, err := f.svc.Approve(f.ctx, f.user, action.ID, false); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if _, err := f.svc.Execute(f.ctx, f.user, action.ID); err != nil {
		t.Fatalf("execute: %v", err)
	}
	types, err := f.client.RevenueOutboxEvent.Query().
		Order(ent.Asc(revenueoutboxevent.FieldCreatedAt)).
		Select(revenueoutboxevent.FieldEventType).
		Strings(f.ctx)
	if err != nil {
		t.Fatalf("outbox query: %v", err)
	}
	want := map[string]bool{
		"revenue.action.preflight_requested.v1": false,
		"revenue.action.preflight_completed.v1": false,
		"revenue.action.approved.v1":            false,
		"revenue.action.execution_requested.v1": false,
		"revenue.action.sent.v1":                false,
	}
	for _, tpe := range types {
		if _, ok := want[tpe]; ok {
			want[tpe] = true
		}
	}
	for tpe, seen := range want {
		if !seen {
			t.Fatalf("missing outbox event %s in %v", tpe, types)
		}
	}
}
