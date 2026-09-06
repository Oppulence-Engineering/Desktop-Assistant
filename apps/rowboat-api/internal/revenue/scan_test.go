package revenue

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

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
	f.svc.SetSweeper(&fakeSweeper{threads: scanFixtureThreads(), email: selfAddr})

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
	if scan.ThreadsSeen != 4 || scan.CandidatesSeen != 3 || scan.ActionsCreated != 2 {
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
