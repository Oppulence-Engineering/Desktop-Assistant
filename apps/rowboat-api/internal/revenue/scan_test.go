package revenue

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
)

// fakeSweeper returns scripted threads.
type fakeSweeper struct {
	threads [][]googleapi.GmailThreadMessage
	email   string
	err     error
}

func (f *fakeSweeper) SweepThreads(context.Context, uuid.UUID, int, int, *time.Time) ([][]googleapi.GmailThreadMessage, string, error) {
	return f.threads, f.email, f.err
}

const selfAddr = "owner@x.co"

func msg(thread, from, to, subject, snippet string, outbound bool, age time.Duration) googleapi.GmailThreadMessage {
	return googleapi.GmailThreadMessage{
		ID:       thread + ":" + snippet[:min(8, len(snippet))],
		ThreadID: thread,
		From:     from,
		To:       to,
		Subject:  subject,
		Snippet:  snippet,
		Outbound: outbound,
		At:       time.Now().UTC().Add(-age),
	}
}

func day(n int) time.Duration { return time.Duration(n) * 24 * time.Hour }

// --- detector units ----------------------------------------------------------

func TestDetectUnansweredProposal(t *testing.T) {
	sum := summarizeThread(selfAddr, []googleapi.GmailThreadMessage{
		msg("t1", "Buyer <buyer@example.com>", selfAddr, "Project inquiry", "can you send details", false, day(12)),
		msg("t1", selfAddr, "buyer@example.com", "Project inquiry", "here is the proposal and pricing", true, day(10)),
	})
	if sum == nil {
		t.Fatal("summary is nil")
	}
	hit := detectThread(sum, time.Now().UTC())
	if hit == nil || hit.Detector != "unanswered_proposal" {
		t.Fatalf("want unanswered_proposal, got %+v", hit)
	}
	if hit.ActionType != "proposal_nudge" {
		t.Fatalf("action type: %s", hit.ActionType)
	}
	if score := scoreOf(hit.Components); score <= 0 || score > 100 {
		t.Fatalf("score out of range: %d", score)
	}
}

func TestDetectWaitingOnMe(t *testing.T) {
	sum := summarizeThread(selfAddr, []googleapi.GmailThreadMessage{
		msg("t2", selfAddr, "buyer@example.com", "Timeline", "here is the plan", true, day(8)),
		msg("t2", "Buyer <buyer@example.com>", selfAddr, "Timeline", "what do you think about the budget?", false, day(5)),
	})
	hit := detectThread(sum, time.Now().UTC())
	if hit == nil || hit.Detector != "waiting_on_me" {
		t.Fatalf("want waiting_on_me, got %+v", hit)
	}
}

func TestDetectDormantWarmOpportunity(t *testing.T) {
	sum := summarizeThread(selfAddr, []googleapi.GmailThreadMessage{
		msg("t3", selfAddr, "buyer@example.com", "Partnership", "great chatting", true, day(80)),
		msg("t3", "buyer@example.com", selfAddr, "Partnership", "likewise, sounds good", false, day(75)),
		msg("t3", selfAddr, "buyer@example.com", "Partnership", "next steps attached", true, day(70)),
		msg("t3", "buyer@example.com", selfAddr, "Partnership", "reviewing this now", false, day(45)),
	})
	hit := detectThread(sum, time.Now().UTC())
	if hit == nil || hit.Detector != "dormant_warm_opportunity" {
		t.Fatalf("want dormant_warm_opportunity, got %+v", hit)
	}
}

func TestDetectRequestedFollowUpDue(t *testing.T) {
	sum := summarizeThread(selfAddr, []googleapi.GmailThreadMessage{
		msg("t4", "buyer@example.com", selfAddr, "Budget cycle", "circle back next quarter when budget opens", false, day(40)),
	})
	hit := detectThread(sum, time.Now().UTC())
	if hit == nil || hit.Detector != "requested_follow_up_due" {
		t.Fatalf("want requested_follow_up_due, got %+v", hit)
	}
}

func TestDetectSkipsFreshAndNoise(t *testing.T) {
	// Fresh thread: no detector should fire.
	fresh := summarizeThread(selfAddr, []googleapi.GmailThreadMessage{
		msg("t5", selfAddr, "buyer@example.com", "Quick sync", "here is the proposal", true, day(1)),
	})
	if hit := detectThread(fresh, time.Now().UTC()); hit != nil {
		t.Fatalf("fresh thread must not fire, got %s", hit.Detector)
	}
	// No-reply sender: no counterparty, thread skipped entirely.
	if sum := summarizeThread(selfAddr, []googleapi.GmailThreadMessage{
		msg("t6", "Notifications <no-reply@saas.com>", selfAddr, "Your invoice", "invoice attached", false, day(30)),
	}); sum != nil {
		t.Fatalf("noreply thread must be skipped, got counterparty %q", sum.Counterparty)
	}
	// Self-only mail: skipped.
	if sum := summarizeThread(selfAddr, []googleapi.GmailThreadMessage{
		msg("t7", selfAddr, selfAddr, "note to self", "remember the thing", true, day(30)),
	}); sum != nil {
		t.Fatal("self-mail must be skipped")
	}
}

func TestDetectSkipsClosedAndAutomatedThreads(t *testing.T) {
	closed := summarizeThread(selfAddr, []googleapi.GmailThreadMessage{
		msg("closed", "buyer@example.com", selfAddr, "Invoice follow up", "invoice attached", false, day(40)),
		msg("closed", selfAddr, "buyer@example.com", "Invoice follow up", "Confirmed: I received the test invoice email. No payment is required.", true, day(35)),
	})
	automated := summarizeThread(selfAddr, []googleapi.GmailThreadMessage{
		msg("closed", selfAddr, "buyer@example.com", "Invoice follow up", "proposal sent", true, day(50)),
		msg("closed", "buyer@example.com", selfAddr, "Invoice follow up", "sounds good", false, day(45)),
		msg("closed", selfAddr, "buyer@example.com", "Invoice follow up", "pricing attached", true, day(40)),
		msg("closed", "buyer@example.com", selfAddr, "Invoice follow up", "We'd love your feedback! Unsubscribe from these emails or manage email preferences.", false, day(35)),
	})
	for _, sum := range []*threadSummary{closed, automated} {
		if hit := detectThread(sum, time.Now().UTC()); hit != nil {
			t.Fatalf("closed or automated thread must not fire, got %s for %q", hit.Detector, lastSnippet(sum))
		}
	}
}

func TestSummarizeThreadCollectsEveryExternalRecipient(t *testing.T) {
	sum := summarizeThread(selfAddr, []googleapi.GmailThreadMessage{
		msg("tm", selfAddr, `Avery <avery@acme.example>, Bea <bea@gmail.com>, no-reply@alerts.example`, "Intro", "connecting you", true, day(2)),
	})
	if sum == nil || len(sum.Counterparties) != 2 {
		t.Fatalf("counterparties = %+v", sum)
	}
	if sum.Counterparties[0].Email != "avery@acme.example" || sum.Counterparties[1].Email != "bea@gmail.com" {
		t.Fatalf("unexpected counterparties: %+v", sum.Counterparties)
	}
	if accountDomain("person@msn.com") != "" {
		t.Fatal("msn.com must remain a person mailbox, not a company")
	}
}

func TestDetectExplicitCommitment(t *testing.T) {
	outbound := summarizeThread(selfAddr, []googleapi.GmailThreadMessage{
		msg("tc1", selfAddr, "buyer@example.com", "Launch", "I'll send the final launch plan tomorrow.", true, day(1)),
	})
	got := detectExplicitCommitment(outbound, lastSnippet(outbound))
	if got == nil || got.Direction != "promised_by_me" || got.OwnerRef != "local-user" || got.CounterpartyRef != "buyer@example.com" {
		t.Fatalf("outbound commitment: %+v", got)
	}
	if got.Text != "I'll send the final launch plan tomorrow." {
		t.Fatalf("exact commitment quote: %q", got.Text)
	}

	inbound := summarizeThread(selfAddr, []googleapi.GmailThreadMessage{
		msg("tc2", "buyer@example.com", selfAddr, "Contract", "We will sign the agreement Friday.", false, day(1)),
	})
	got = detectExplicitCommitment(inbound, lastSnippet(inbound))
	if got == nil || got.Direction != "promised_by_them" || got.OwnerRef != "buyer@example.com" || got.CounterpartyRef != "local-user" {
		t.Fatalf("inbound commitment: %+v", got)
	}

	negative := summarizeThread(selfAddr, []googleapi.GmailThreadMessage{
		msg("tc3", selfAddr, "buyer@example.com", "Launch", "I will not send this yet. Will you review it?", true, day(1)),
	})
	if got := detectExplicitCommitment(negative, lastSnippet(negative)); got != nil {
		t.Fatalf("negated promise must not become a candidate: %+v", got)
	}
}

func TestCommitmentQuoteIgnoresQuotedReply(t *testing.T) {
	text := "Thanks, that works.\n\nOn Thu, Sep 3, 2026 at 9:00 AM Buyer wrote:\n> I'll send the agreement tomorrow."
	if got := commitmentQuote(text); got != "" {
		t.Fatalf("quoted promise must not be attributed to the reply sender: %q", got)
	}
}

// --- scan end-to-end ---------------------------------------------------------

func scanFixtureThreads() [][]googleapi.GmailThreadMessage {
	return [][]googleapi.GmailThreadMessage{
		{ // unanswered proposal
			msg("tp", selfAddr, "buyer@example.com", "SOW draft", "attached the proposal and pricing", true, day(10)),
		},
		{ // waiting on me
			msg("tw", selfAddr, "Casey Lee <casey@corp.com>", "Contract", "sharing the draft", true, day(8)),
			msg("tw", "Casey Lee <casey@corp.com>", selfAddr, "Contract", "could you confirm the start date?", false, day(6)),
		},
		{ // fresh explicit promise: commitment candidate, not a recovery action
			msg("tc", selfAddr, "client@example.org", "Launch plan", "I'll send the final launch plan tomorrow.", true, day(1)),
		},
		{ // noise
			msg("tn", "no-reply@bank.com", selfAddr, "Statement", "your statement is ready", false, day(20)),
		},
	}
}

func TestScanCreatesEvidenceBackedActions(t *testing.T) {
	f := newFixture(t)
	threads := append(scanFixtureThreads(), []googleapi.GmailThreadMessage{
		msg("ti", "stranger@example.net", selfAddr, "Cold outreach", "could you review this?", false, day(6)),
	})
	f.svc.SetSweeper(&fakeSweeper{threads: threads, email: selfAddr})

	scan, err := f.svc.StartScan(f.ctx, f.user, 90)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	// The runner is async in production; poll briefly for the terminal state.
	deadline := time.Now().Add(5 * time.Second)
	for {
		got, err := f.svc.GetScan(f.ctx, scan.ID)
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		if got.Status == "completed" || got.Status == "failed" {
			scan = got
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("scan did not finish: %s", got.Status)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if scan.Status != "completed" {
		t.Fatalf("scan failed: %s", scan.Error)
	}
	if scan.ThreadsSeen != 5 || scan.CandidatesSeen != 3 || scan.ActionsCreated != 2 {
		t.Fatalf("counts: threads=%d candidates=%d actions=%d",
			scan.ThreadsSeen, scan.CandidatesSeen, scan.ActionsCreated)
	}
	if scan.RelationshipsCreated != 3 || scan.EvidencesCreated != 3 {
		t.Fatalf("side rows: rel=%d ev=%d", scan.RelationshipsCreated, scan.EvidencesCreated)
	}

	actions, err := f.svc.ListActions(f.ctx, f.user, ListFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(actions) != 2 {
		t.Fatalf("queue size: %d", len(actions))
	}
	for _, a := range actions {
		if a.ExecutionMode != ExecModeDraft {
			t.Fatalf("scan actions must be draft-first, got %s", a.ExecutionMode)
		}
		if a.PriorityComponentsJSON == "" {
			t.Fatal("priority components must be stored (explainable ranking)")
		}
		if a.Reason == "" || a.RecipientEmail == "" {
			t.Fatalf("action missing evidence-backed fields: %+v", a)
		}
	}
	promise, err := f.client.Commitment.Query().WithEvents().WithEvidences().Only(f.ctx)
	if err != nil {
		t.Fatalf("commitment candidate: %v", err)
	}
	if promise.Direction != "promised_by_me" || promise.UserConfirmed || promise.Acceptance != "candidate" || promise.SourcePhrase == "" {
		t.Fatalf("commitment fields: %+v", promise)
	}
	if len(promise.Edges.Events) != 1 || promise.Edges.Events[0].Kind != "proposed" || len(promise.Edges.Evidences) != 1 {
		t.Fatalf("commitment provenance: events=%d evidences=%d", len(promise.Edges.Events), len(promise.Edges.Evidences))
	}

	// Rerun: everything dedupes, nothing new is created.
	scan2, err := f.svc.StartScan(f.ctx, f.user, 90)
	if err != nil {
		t.Fatalf("rescan: %v", err)
	}
	for {
		got, err := f.svc.GetScan(f.ctx, scan2.ID)
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		if got.Status == "completed" || got.Status == "failed" {
			scan2 = got
			break
		}
		if time.Now().After(deadline.Add(5 * time.Second)) {
			t.Fatal("rescan did not finish")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if scan2.ActionsCreated != 0 || scan2.RelationshipsCreated != 0 {
		t.Fatalf("rerun must dedupe: actions=%d rel=%d", scan2.ActionsCreated, scan2.RelationshipsCreated)
	}
	actions, _ = f.svc.ListActions(f.ctx, f.user, ListFilter{})
	if len(actions) != 2 {
		t.Fatalf("queue must not grow on rerun: %d", len(actions))
	}
	if count := f.client.Commitment.Query().CountX(f.ctx); count != 1 {
		t.Fatalf("commitments must not grow on rerun: %d", count)
	}
}

func TestResolveScanRecommendationAfterNewReply(t *testing.T) {
	f := newFixture(t)
	ws, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatalf("workspace: %v", err)
	}
	proposal := summarizeThread(selfAddr, []googleapi.GmailThreadMessage{
		msg("resolved-thread", selfAddr, "buyer@example.com", "Proposal", "proposal and pricing attached", true, day(10)),
	})
	hit := detectThread(proposal, time.Now().UTC())
	if hit == nil {
		t.Fatal("proposal must produce a recommendation")
	}
	if _, _, _, _, err := f.svc.materializeHit(f.ctx, f.user, proposal, hit); err != nil {
		t.Fatalf("materialize: %v", err)
	}
	replied := summarizeThread(selfAddr, append(proposal.Messages,
		msg("resolved-thread", "buyer@example.com", selfAddr, "Re: Proposal", "Thanks, we received it.", false, day(1))))
	if hit := detectThread(replied, time.Now().UTC()); hit != nil {
		t.Fatalf("reply must close the recommendation, got %+v", hit)
	}
	if err := f.svc.resolveScanAction(f.ctx, ws.ID, replied); err != nil {
		t.Fatalf("resolve: %v", err)
	}
	action := f.client.RevenueAction.Query().OnlyX(f.ctx)
	if action.QueueStatus != QueueDismissed || action.DismissReason != "resolved_by_new_evidence" {
		t.Fatalf("action was not resolved: status=%s reason=%s", action.QueueStatus, action.DismissReason)
	}
}

func TestScanDetectsCommitmentFromActualBody(t *testing.T) {
	f := newFixture(t)
	f.svc.SetSweeper(&fakeSweeper{threads: [][]googleapi.GmailThreadMessage{{
		msg("body-thread", selfAddr, "buyer@example.com", "Launch", "Details attached.", true, day(1)),
	}}, email: selfAddr})
	fetcher := &fakeBodyFetcher{body: "Quick update. I'll send the signed launch plan tomorrow. Thanks."}
	f.svc.SetBodyFetcher(fetcher, newSealer(t), time.Hour)

	scan, err := f.svc.StartScan(f.ctx, f.user, 90)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		scan, err = f.svc.GetScan(f.ctx, scan.ID)
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		if scan.Status == "completed" || scan.Status == "failed" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("scan did not finish")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if scan.Status != "completed" || fetcher.calls != 1 {
		t.Fatalf("scan=%s body fetches=%d error=%s", scan.Status, fetcher.calls, scan.Error)
	}
	promise := f.client.Commitment.Query().WithEvidences().OnlyX(f.ctx)
	if promise.SourcePhrase != "I'll send the signed launch plan tomorrow." || len(promise.Edges.Evidences) != 1 ||
		promise.Edges.Evidences[0].Excerpt != promise.SourcePhrase {
		t.Fatalf("body-backed commitment: phrase=%q evidence=%+v", promise.SourcePhrase, promise.Edges.Evidences)
	}
}

func TestScanUnavailableWithoutSweeper(t *testing.T) {
	f := newFixture(t)
	if _, err := f.svc.StartScan(f.ctx, f.user, 90); err == nil {
		t.Fatal("scan without a sweeper must fail")
	}
}

func TestListScansIsTenantScopedAndNewestFirst(t *testing.T) {
	f := newFixture(t)
	internal := auth.WithInternal(context.Background())
	workspace, err := f.svc.CurrentWorkspace(f.ctx, f.user)
	if err != nil {
		t.Fatalf("owner workspace: %v", err)
	}
	other := newUser(t, f.client, "other@x.co", "user_other")
	otherWorkspace, err := f.svc.CurrentWorkspace(auth.WithUser(context.Background(), other), other)
	if err != nil {
		t.Fatalf("other workspace: %v", err)
	}

	older := f.client.RevenueLeakScan.Create().SetWorkspace(workspace).SetUser(f.user).
		SetStatus("failed").SetLookbackDays(90).SaveX(internal)
	newer := f.client.RevenueLeakScan.Create().SetWorkspace(workspace).SetUser(f.user).
		SetStatus("completed").SetLookbackDays(90).SaveX(internal)
	f.client.RevenueLeakScan.Create().SetWorkspace(otherWorkspace).SetUser(other).
		SetStatus("completed").SetLookbackDays(90).SaveX(internal)

	got, err := f.svc.ListScans(f.ctx, f.user, 10)
	if err != nil {
		t.Fatalf("list scans: %v", err)
	}
	if len(got) != 2 || got[0].ID != newer.ID || got[1].ID != older.ID {
		t.Fatalf("scans = %v, want newest owner scans only", got)
	}
	limited, err := f.svc.ListScans(f.ctx, f.user, 1)
	if err != nil {
		t.Fatalf("list limited scans: %v", err)
	}
	if len(limited) != 1 || limited[0].ID != newer.ID {
		t.Fatalf("limited scans = %v, want newest scan", limited)
	}
}

func TestScanRejectsConcurrentRun(t *testing.T) {
	f := newFixture(t)
	block := make(chan struct{})
	f.svc.SetSweeper(&blockingSweeper{unblock: block})
	if _, err := f.svc.StartScan(f.ctx, f.user, 90); err != nil {
		t.Fatalf("first: %v", err)
	}
	if _, err := f.svc.StartScan(f.ctx, f.user, 90); err == nil {
		t.Fatal("second concurrent scan must be rejected")
	}
	close(block)
}

func TestScanAdmissionIsReplicaSafe(t *testing.T) {
	f := newFixture(t)
	unblock := make(chan struct{})
	f.svc.SetSweeper(&blockingSweeper{unblock: unblock})

	start := make(chan struct{})
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := f.svc.StartScan(f.ctx, f.user, 90)
			errs <- err
		}()
	}
	close(start)
	wg.Wait()
	close(errs)

	succeeded, rejected := 0, 0
	for err := range errs {
		switch {
		case err == nil:
			succeeded++
		case errors.Is(err, ErrScanUnavailable):
			rejected++
		default:
			t.Fatalf("unexpected concurrent admission error: %v", err)
		}
	}
	if succeeded != 1 || rejected != 1 {
		t.Fatalf("concurrent admission: succeeded=%d rejected=%d, want 1/1", succeeded, rejected)
	}
	if count := f.client.RevenueLeakScan.Query().CountX(f.ctx); count != 1 {
		t.Fatalf("concurrent admission created %d scans, want 1", count)
	}
	close(unblock)
}

type blockingSweeper struct{ unblock chan struct{} }

func (b *blockingSweeper) SweepThreads(context.Context, uuid.UUID, int, int, *time.Time) ([][]googleapi.GmailThreadMessage, string, error) {
	<-b.unblock
	return nil, selfAddr, nil
}

// A promise is made once and then buried by whatever was said after it. The
// scan used to read only a thread's final message, so "I'll send the contract
// Friday" in the middle of a long thread was never seen — which is how ninety
// real conversations produced nothing.
func TestScanFindsAPromiseBuriedMidThread(t *testing.T) {
	f := newFixture(t)
	base := time.Now().UTC().Add(-10 * 24 * time.Hour)
	thread := [][]googleapi.GmailThreadMessage{{
		{
			ID: "m1", ThreadID: "t1", From: selfAddr, To: "buyer@example.com",
			Subject: "Security review", Snippet: "Thanks for the call today.",
			Outbound: true, At: base,
		},
		{
			ID: "m2", ThreadID: "t1", From: selfAddr, To: "buyer@example.com",
			Subject:  "Security review",
			Snippet:  "I'll send the signed security packet on Friday.",
			Outbound: true, At: base.Add(time.Hour),
		},
		{
			ID: "m3", ThreadID: "t1", From: "buyer@example.com", To: selfAddr,
			Subject: "Security review", Snippet: "Sounds good, thanks.",
			Outbound: false, At: base.Add(2 * time.Hour),
		},
	}}
	f.svc.SetSweeper(&fakeSweeper{threads: thread, email: selfAddr})

	scan, err := f.svc.StartScan(f.ctx, f.user, 90)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		got, err := f.svc.GetScan(f.ctx, scan.ID)
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		if got.Status == "completed" || got.Status == "failed" {
			if got.Status != "completed" {
				t.Fatalf("scan failed: %s", got.Error)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("scan did not finish: %s", got.Status)
		}
		time.Sleep(20 * time.Millisecond)
	}

	rows, err := f.svc.ListCommitments(f.ctx, f.user, CommitmentFilter{IncludeCandidates: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("want 1 commitment from the buried promise, got %d", len(rows))
	}
	if !strings.Contains(rows[0].Text, "signed security packet") {
		t.Fatalf("wrong promise captured: %q", rows[0].Text)
	}
	// The promise was outbound even though the thread ends with an inbound
	// reply: direction follows the message the promise was written in.
	if rows[0].Direction != "promised_by_me" {
		t.Fatalf("direction = %q, want promised_by_me", rows[0].Direction)
	}
}

// Coverage must add up. "90 conversations reviewed" implied the scan had read
// ninety conversations; it had read ten and glanced at the rest. A scan that
// reports a total it did not examine is the same confidently-wrong claim the
// product exists to avoid.
func TestScanReportsHonestCoverage(t *testing.T) {
	f := newFixture(t)
	base := time.Now().UTC().Add(-5 * 24 * time.Hour)
	threads := [][]googleapi.GmailThreadMessage{
		// judged: real counterparty, outbound
		{{
			ID: "a1", ThreadID: "ta", From: selfAddr, To: "buyer@example.com",
			Subject: "Kickoff", Snippet: "Thanks for the call.",
			Outbound: true, At: base,
		}},
		// skipped: self-mail only, no external counterparty
		{{
			ID: "b1", ThreadID: "tb", From: selfAddr, To: selfAddr,
			Subject: "Note to self", Snippet: "Remember the deck.",
			Outbound: true, At: base,
		}},
		// skipped: no-reply counterparty
		{{
			ID: "c1", ThreadID: "tc", From: selfAddr, To: "no-reply@vendor.com",
			Subject: "Receipt", Snippet: "Thanks.",
			Outbound: true, At: base,
		}},
	}
	f.svc.SetSweeper(&fakeSweeper{threads: threads, email: selfAddr})

	scan, err := f.svc.StartScan(f.ctx, f.user, 90)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	var got *ent.RevenueLeakScan
	for {
		got, err = f.svc.GetScan(f.ctx, scan.ID)
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		if got.Status == "completed" || got.Status == "failed" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("scan did not finish: %s", got.Status)
		}
		time.Sleep(20 * time.Millisecond)
	}

	if got.ThreadsSeen != 3 {
		t.Fatalf("threads seen = %d, want 3", got.ThreadsSeen)
	}
	if got.ThreadsSkipped != 2 {
		t.Errorf("threads skipped = %d, want 2 (self-mail and no-reply)", got.ThreadsSkipped)
	}
	// Every thread is either judged or skipped; none may go uncounted.
	judged := got.ThreadsDeepRead + got.ThreadsSnippetOnly
	if judged+got.ThreadsSkipped != got.ThreadsSeen {
		t.Errorf("coverage does not add up: %d judged + %d skipped != %d seen",
			judged, got.ThreadsSkipped, got.ThreadsSeen)
	}
	// No body is available in this fixture, so the judged thread was read on a
	// snippet — and must say so rather than claim a deep read.
	if got.ThreadsDeepRead != 0 || got.ThreadsSnippetOnly != 1 {
		t.Errorf("deep=%d snippet=%d, want deep=0 snippet=1",
			got.ThreadsDeepRead, got.ThreadsSnippetOnly)
	}
}
