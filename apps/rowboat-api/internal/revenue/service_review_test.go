package revenue

import (
	"errors"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/revenueleakscan"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
)

// These tests lock in the fixes from the 10-round review. Each is named for
// the finding it regresses.

// fakeClock lets a test drive s.now() so decision expiry and scan staleness
// are deterministic.
type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time          { return c.t }
func (c *fakeClock) advance(d time.Duration) { c.t = c.t.Add(d) }

// R2/R4 governance bypass: re-evaluating to review_required AFTER approval must
// invalidate the approval, and Execute must never send against a decision the
// operator did not approve.
func TestReEvaluateAfterApproveInvalidatesApprovalAndBlocksSend(t *testing.T) {
	f := newFixture(t)
	clk := &fakeClock{t: time.Date(2026, 7, 23, 12, 0, 0, 0, time.UTC)}
	f.svc.now = clk.now
	f.link(t)

	// Decision A: passed, expires in 1h.
	f.facade.decision = &PolicyDecision{
		DecisionID: "dec_A", Status: PolicyPassed, ReasonCodes: []string{},
		EvaluatedAt: clk.t, ExpiresAt: clk.t.Add(time.Hour), ResponseHash: "sha256:a",
	}
	action := f.action(t, ExecModeSend)
	if _, err := f.svc.Evaluate(f.ctx, f.user, action.ID); err != nil {
		t.Fatalf("evaluate A: %v", err)
	}
	if _, err := f.svc.Approve(f.ctx, f.user, action.ID, false); err != nil {
		t.Fatalf("approve: %v", err)
	}

	// A expires; the UI's retry re-evaluates and the facade now says
	// review_required (decision B).
	clk.advance(2 * time.Hour)
	f.facade.decision = &PolicyDecision{
		DecisionID: "dec_B", Status: PolicyReviewRequired, ReasonCodes: []string{},
		EvaluatedAt: clk.t, ExpiresAt: clk.t.Add(time.Hour), ResponseHash: "sha256:b",
	}
	if _, err := f.svc.Evaluate(f.ctx, f.user, action.ID); err != nil {
		t.Fatalf("evaluate B: %v", err)
	}

	// The stale approval must be gone.
	got, err := f.svc.GetAction(f.ctx, action.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.ApprovalStatus != ApprovalPending || got.ApprovedDecisionID != nil {
		t.Fatalf("re-evaluate must invalidate approval, got status=%s decision=%v",
			got.ApprovalStatus, got.ApprovedDecisionID)
	}
	// Execute must refuse: not approved for the new decision.
	if _, err := f.svc.Execute(f.ctx, f.user, action.ID); !errors.Is(err, ErrNotApproved) {
		t.Fatalf("execute after re-eval: want ErrNotApproved, got %v", err)
	}
	if f.exec.calls != 0 {
		t.Fatalf("nothing must be sent, executor ran %d times", f.exec.calls)
	}
}

// R1 spec-invariants: an approved action that is then dismissed (or snoozed)
// must not execute.
func TestDismissedApprovedActionDoesNotExecute(t *testing.T) {
	f := newFixture(t)
	action := f.action(t, ExecModeDraft)
	if _, err := f.svc.Approve(f.ctx, f.user, action.ID, false); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if _, err := f.svc.Dismiss(f.ctx, f.user, action.ID, "changed_my_mind"); err != nil {
		t.Fatalf("dismiss: %v", err)
	}
	if _, err := f.svc.Execute(f.ctx, f.user, action.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("execute of a dismissed action: want ErrConflict, got %v", err)
	}
	if f.exec.calls != 0 {
		t.Fatalf("dismissed action must not reach the executor, ran %d", f.exec.calls)
	}
}

// R5 idempotency: a definite (non-ambiguous) execution failure returns the
// action to pending so it can be retried, not permanently locked.
func TestDefiniteFailureIsRetryable(t *testing.T) {
	f := newFixture(t)
	action := f.action(t, ExecModeDraft)
	if _, err := f.svc.Approve(f.ctx, f.user, action.ID, false); err != nil {
		t.Fatalf("approve: %v", err)
	}
	f.exec.err = errors.New("gmail returned 403")
	got, err := f.svc.Execute(f.ctx, f.user, action.ID)
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if got.ExecutionStatus != ExecPending {
		t.Fatalf("definite failure must return to pending, got %s", got.ExecutionStatus)
	}
	if got.ExecutionError == "" {
		t.Fatal("failure must record the error for the UI")
	}
	// The action is still editable (invariant: ExecPending is editable).
	subject := "Second attempt"
	if _, err := f.svc.EditAction(f.ctx, f.user, action.ID, EditInput{ProposedSubject: &subject}); err != nil {
		t.Fatalf("edit after failure: %v", err)
	}
	// Re-approve the new revision, clear the fault, and retry: it sends.
	if _, err := f.svc.Approve(f.ctx, f.user, action.ID, false); err != nil {
		t.Fatalf("re-approve: %v", err)
	}
	f.exec.err = nil
	sent, err := f.svc.Execute(f.ctx, f.user, action.ID)
	if err != nil {
		t.Fatalf("retry: %v", err)
	}
	if sent.ExecutionStatus != ExecSent {
		t.Fatalf("retry must send, got %s", sent.ExecutionStatus)
	}
}

// R2/R3 concurrency: one workspace per owner. CurrentWorkspace is idempotent,
// and a duplicate insert is refused by the unique constraint.
func TestWorkspaceUniquePerOwner(t *testing.T) {
	f := newFixture(t)
	ws1, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	ws2, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if ws1.ID != ws2.ID {
		t.Fatalf("CurrentWorkspace must be idempotent: %s != %s", ws1.ID, ws2.ID)
	}
	// A direct duplicate insert (the racing writer) must hit the constraint.
	_, err = f.client.RevenueWorkspace.Create().SetUser(f.user).Save(f.ctx)
	if err == nil || !ent.IsConstraintError(err) {
		t.Fatalf("second workspace for the same owner must violate the unique constraint, got %v", err)
	}
}

// R2/R10 robustness: a scan wedged in "running" by a crash must not block all
// future scans forever.
func TestStaleRunningScanIsReclaimed(t *testing.T) {
	f := newFixture(t)
	clk := &fakeClock{t: time.Date(2026, 7, 23, 12, 0, 0, 0, time.UTC)}
	f.svc.now = clk.now
	f.svc.SetSweeper(&fakeSweeper{threads: nil, email: selfAddr})
	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatalf("ws: %v", err)
	}
	// A previous run crashed while "running".
	stale := f.client.RevenueLeakScan.Create().
		SetWorkspace(ws).SetUser(f.user).SetStatus("running").SetMode("local").
		SetLookbackDays(90).SetStartedAt(clk.t).SaveX(f.ctx)

	// Long after the run could possibly still be alive, a new scan is started.
	clk.advance(3 * scanDeadline)
	scan, err := f.svc.StartScan(f.ctx, f.user, 90)
	if err != nil {
		t.Fatalf("start after stale: %v", err)
	}
	if scan.ID == stale.ID {
		t.Fatal("a new scan row must be created")
	}
	// The stale one is now failed.
	reaped := f.client.RevenueLeakScan.Query().Where(revenueleakscan.IDEQ(stale.ID)).OnlyX(f.ctx)
	if reaped.Status != "failed" {
		t.Fatalf("stale scan must be reclaimed as failed, got %s", reaped.Status)
	}
}

// R1 (critical) robustness: a whitespace-only display name must not panic the
// detector path (the scan goroutine has no user-facing recover in tests).
func TestWhitespaceDisplayNameDoesNotPanic(t *testing.T) {
	// Inbound message whose From display name is all whitespace (the crash
	// input): parseAddress must trim it and firstName must not index an empty
	// slice.
	msgs := []googleapi.GmailThreadMessage{
		msg("tp", "\"  \" <lead@acme.com>", selfAddr, "Question", "can you confirm the date?", false, day(5)),
	}
	sum := summarizeThread(selfAddr, msgs)
	if sum == nil {
		t.Fatal("summary should not be nil")
	}
	if sum.Counterparty != "lead@acme.com" {
		t.Fatalf("counterparty = %q", sum.Counterparty)
	}
	// Must not panic; firstName falls back to the local part.
	hit := detectThread(sum, time.Now().UTC())
	if hit == nil {
		t.Fatal("expected a detector hit")
	}
	if firstName(sum) != "lead" {
		t.Fatalf("firstName fallback = %q", firstName(sum))
	}
}

// R9 detector quality: a keyword that appears only in the persistent Subject
// (not the latest message) must NOT fire the detector.
func TestSubjectOnlyKeywordDoesNotFire(t *testing.T) {
	// Subject says "Proposal" but the last outbound message is unrelated chit-chat.
	msgs := []googleapi.GmailThreadMessage{
		msg("ts", selfAddr, "buyer@example.com", "Proposal follow up", "thanks for lunch, great catching up!", true, day(10)),
	}
	sum := summarizeThread(selfAddr, msgs)
	if hit := detectThread(sum, time.Now().UTC()); hit != nil && hit.Detector == "unanswered_proposal" {
		t.Fatalf("subject-only keyword must not fire unanswered_proposal, got %s", hit.Detector)
	}
}

// R5 idempotency: a thread whose winning detector changes across reruns must
// not create a second queue action (dedupe is thread-scoped).
func TestScanDedupeIsThreadStableAcrossDetectorChange(t *testing.T) {
	f := newFixture(t)
	rel := f.relationship(t)
	ws, _ := f.svc.CurrentWorkspace(f.ctx, f.user)
	// First run: waiting_on_me wins for this thread.
	a1, err := f.svc.CreateAction(f.ctx, f.user, ActionInput{
		RelationshipID: rel.ID, ActionType: "warm_follow_up", Channel: "email",
		Detector: "waiting_on_me", DedupeKey: "scan:thread-1", Reason: "r", PriorityScore: 30,
	})
	if err != nil {
		t.Fatalf("create 1: %v", err)
	}
	// Second run: a different detector wins, but same thread => same dedupe key.
	a2, err := f.svc.CreateAction(f.ctx, f.user, ActionInput{
		RelationshipID: rel.ID, ActionType: "warm_follow_up", Channel: "email",
		Detector: "dormant_warm_opportunity", DedupeKey: "scan:thread-1", Reason: "r2", PriorityScore: 25,
	})
	if err != nil {
		t.Fatalf("create 2: %v", err)
	}
	if a1.ID != a2.ID {
		t.Fatal("same thread must not create a second action across a detector change")
	}
	total := f.client.RevenueAction.Query().CountX(f.ctx)
	if total != 1 {
		t.Fatalf("expected exactly one action for the thread, got %d", total)
	}
	_ = ws
}
