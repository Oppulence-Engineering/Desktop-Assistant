package revenue

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/googleapi"
)

// fakeExtractor returns scripted proposals, including dishonest ones.
type fakeExtractor struct {
	promises []ExtractedPromise
	err      error
	calls    int
}

func (f *fakeExtractor) ExtractPromises(context.Context, PromiseExtractInput) ([]ExtractedPromise, error) {
	f.calls++
	return f.promises, f.err
}

// The safety argument for letting a model read mail: it proposes, and code
// checks the proposal against the evidence. A quote that is not in the message
// is a promise the product would have invented.
func TestVerifyPromiseQuotesRejectsAnythingNotInTheSource(t *testing.T) {
	body := "Thanks for the call.\nI'll get you the signed order form by Friday.\nSpeak soon."

	kept := verifyPromiseQuotes([]ExtractedPromise{
		{Quote: "I'll get you the signed order form by Friday.", Text: "Send signed order form"},
		{Quote: "I'll also throw in three months free.", Text: "Three months free"},    // invented
		{Quote: "I will get you the signed order form by Friday.", Text: "Paraphrase"}, // reworded
		{Quote: "", Text: "No quote at all"},
		{Quote: "Thanks for the call.", Text: ""}, // no obligation text
	}, body)

	if len(kept) != 1 {
		t.Fatalf("kept %d promises, want only the one actually in the message: %#v", len(kept), kept)
	}
	if kept[0].Text != "Send signed order form" {
		t.Fatalf("kept the wrong promise: %#v", kept[0])
	}
}

// A quote copied across a line wrap is still the sender's words.
func TestVerifyPromiseQuotesToleratesWhitespaceAndCase(t *testing.T) {
	body := "I'll send the\n  SOC 2 report   once the audit closes."
	kept := verifyPromiseQuotes([]ExtractedPromise{
		{Quote: "i'll send the SOC 2 report once the audit closes.", Text: "Send SOC 2 report"},
	}, body)
	if len(kept) != 1 {
		t.Fatalf("a rewrapped quote was rejected: %#v", kept)
	}
}

// §6: a model may not put anything in the register. Everything it proposes is
// a candidate, which the register excludes until a person confirms it.
func TestModelProposedPromiseLandsInReviewNotTheRegister(t *testing.T) {
	f := newFixture(t)
	base := time.Now().UTC().Add(-3 * 24 * time.Hour)
	f.svc.SetSweeper(&fakeSweeper{
		email: selfAddr,
		threads: [][]googleapi.GmailThreadMessage{{
			{
				ID: "m1", ThreadID: "t1", From: selfAddr, To: "buyer@example.com",
				Subject: "Order form",
				// Phrasing the deterministic detector does not match.
				Snippet:  "Happy to get that over to you shortly.",
				Outbound: true, At: base,
			},
		}},
	})
	f.svc.SetBodyFetcher(&fakeBodyFetcher{body: "Thanks for the call. Happy to get that over to you shortly."}, newSealer(t), time.Hour)
	f.svc.SetPromiseExtractor(&fakeExtractor{promises: []ExtractedPromise{
		{Quote: "Happy to get that over to you shortly.", Text: "Send the order form"},
	}})

	scan, err := f.svc.StartScan(f.ctx, f.user, 90)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	waitForScan(t, f, scan.ID)

	// It must exist — otherwise this test passes by finding nothing at all.
	candidates, err := f.svc.ListCommitments(f.ctx, f.user, CommitmentFilter{IncludeCandidates: true})
	if err != nil {
		t.Fatal(err)
	}
	var proposed *ent.Commitment
	for _, row := range candidates {
		if strings.Contains(row.Text, "order form") {
			proposed = row
		}
	}
	if proposed == nil {
		t.Fatal("the model proposed a promise and nothing was recorded for review")
	}
	if proposed.Acceptance != "candidate" {
		t.Fatalf("acceptance = %q, want candidate: a model may not confirm its own proposal",
			proposed.Acceptance)
	}
	// The sender's own words, not the model's summary, are what a reviewer sees.
	if !strings.Contains(proposed.SourcePhrase, "get that over to you") {
		t.Fatalf("source phrase is not the sender's words: %q", proposed.SourcePhrase)
	}

	// And it stays out of the register until a person confirms it.
	inRegister, err := f.svc.ListCommitments(f.ctx, f.user, CommitmentFilter{})
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range inRegister {
		if strings.Contains(row.Text, "order form") {
			t.Fatal("a model-proposed promise was asserted into the register without review")
		}
	}
}

// The extractor is opt-in. With none installed the scan stays exactly as
// deterministic as it was.
func TestScanIsDeterministicWithoutAnExtractor(t *testing.T) {
	f := newFixture(t)
	base := time.Now().UTC().Add(-3 * 24 * time.Hour)
	f.svc.SetSweeper(&fakeSweeper{
		email: selfAddr,
		threads: [][]googleapi.GmailThreadMessage{{
			{
				ID: "m1", ThreadID: "t1", From: selfAddr, To: "buyer@example.com",
				Subject: "Order form", Snippet: "Happy to get that over to you shortly.",
				Outbound: true, At: base,
			},
		}},
	})

	scan, err := f.svc.StartScan(f.ctx, f.user, 90)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	waitForScan(t, f, scan.ID)

	rows, err := f.svc.ListCommitments(f.ctx, f.user, CommitmentFilter{IncludeCandidates: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 0 {
		t.Fatalf("no extractor installed, yet %d commitments appeared", len(rows))
	}
}

// A model failure must never fail an audit.
func TestExtractorFailureDoesNotFailTheScan(t *testing.T) {
	f := newFixture(t)
	base := time.Now().UTC().Add(-3 * 24 * time.Hour)
	f.svc.SetSweeper(&fakeSweeper{
		email: selfAddr,
		threads: [][]googleapi.GmailThreadMessage{{
			{
				ID: "m1", ThreadID: "t1", From: selfAddr, To: "buyer@example.com",
				Subject: "Order form", Snippet: "Happy to get that over to you shortly.",
				Outbound: true, At: base,
			},
		}},
	})
	f.svc.SetBodyFetcher(&fakeBodyFetcher{body: "Thanks for the call. Happy to get that over to you shortly."}, newSealer(t), time.Hour)
	f.svc.SetPromiseExtractor(&fakeExtractor{err: context.DeadlineExceeded})

	scan, err := f.svc.StartScan(f.ctx, f.user, 90)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if got := waitForScan(t, f, scan.ID); got != "completed" {
		t.Fatalf("a model timeout failed the whole audit: %s", got)
	}
}
