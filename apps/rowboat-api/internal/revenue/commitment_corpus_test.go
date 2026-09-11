package revenue

import (
	"fmt"
	"strings"
	"testing"
)

// The extraction corpus.
//
// One-pager §17: "Manual reports first; measure precision explicitly before
// automating." This is that measurement, kept in the repository so the number
// cannot quietly regress. Every phrasing here is the kind of sentence a
// founder-led B2B team writes to a customer.
//
// Precision is the hard constraint: §6 says one confidently wrong claim about
// what a customer was promised costs more trust than ten missed extractions
// earn. So `mustNotMatch` may never regress — a single false positive fails
// this test. Recall is reported, and allowed to improve.

// mustMatch are real obligations. Missing one costs the user a promise.
var mustMatch = []string{
	// the plain forms
	"I'll send the contract tomorrow.",
	"We'll deliver the migration by the 14th.",
	"I'll follow up with the security questionnaire.",
	"I will review the redlines today.",
	"We will provide the sandbox credentials this week.",
	// the verbs a narrow list forgets
	"I'll get you the report by Friday.",
	"I'll have that over to you Monday.",
	"We'll get that done this week.",
	"I'll take a look and revert by end of day.",
	"I'll put together a proposal this week.",
	"We'll turn that around in 48 hours.",
	"We'll circle back with pricing next week.",
	"I'll write up the migration plan.",
	"I'll set up a shared channel for the rollout.",
	"We'll add SSO to the next release.",
	"I'll check with legal and confirm.",
	"We'll cover the overage for this month.",
	"I'll walk your team through the runbook.",
	// adverbs and hedged-but-still-committed openers
	"I'll definitely send the SOC 2 report.",
	"I will personally review the contract.",
	"I'll go ahead and provision the second workspace.",
	// first person plural as a company
	"We'll hold this price through renewal.",
	"We'll waive the setup fee.",
	// written adversarially, after the pattern existed
	"I'll go ahead and cancel the old subscription.",
	"We'll issue a credit on the next invoice.",
	"I'll send over the revised SOW this afternoon.",
	"We'll get back to you with a firm date.",
	"I'll reach out to their security team.",
	"We'll document the rollback plan before go-live.",
	"I'll sign off on the change request today.",
}

// mustNotMatch are the things §4 excludes: aspirations, hedges, questions,
// other people's promises, and anything already closed. A match here is a
// confidently wrong claim about what someone was promised.
var mustNotMatch = []string{
	// aspirations and hedges — §4 excludes these by name
	"We'd love to get that to you next week.",
	"Ideally we would send the report by Friday.",
	"Hopefully I can review the contract this week.",
	"We might be able to deliver that in Q3.",
	"I was hoping to send you the deck.",
	"We should probably schedule a call.",
	// questions and requests, not promises
	"Will you send the signed order form?",
	"Could you confirm the delivery date?",
	"Can we get the invoice by Friday?",
	"Do you want me to send the report?",
	// somebody else's promise
	"They will send the contract tomorrow.",
	"Legal will review the redlines this week.",
	"The vendor will deliver by the 14th.",
	// already done, not owed
	"I sent the contract yesterday.",
	"We delivered the migration last week.",
	"I have already reviewed the redlines.",
	// negations
	"I will not be able to send that this week.",
	"We won't be delivering before Q3.",
	// unrelated future tense
	"I'll be out of office next week.",
	"We'll see how the pilot goes.",
	"I'll think about it.",
	// Written adversarially, after the pattern existed — every one of these
	// was a false positive on the first widened draft. Phrasal verbs that read
	// as delivery and are not: encountering a problem, deferring, accepting a
	// point, glancing, or receiving a benefit rather than owing one.
	"We'll run into issues if the data is not clean.",
	"I'll take that as a yes.",
	"We'll start seeing results in a few weeks.",
	"I'll have a look when I get a chance.",
	"We will hold off on the migration for now.",
	"If we sign this week, we'll get the discount.",
	"We'll see if we can get that done.",
	"I'll need to check with the team first.",
	"We'll try to deliver that in Q3.",
	"I'll be sure to mention it if it comes up.",
	"I'll leave that with you.",
	"We'll cross that bridge when we come to it.",
	"I'll let you know if anything changes.",
	"We'll be in touch.",
}

func measureCorpus(t *testing.T) (recall float64, falsePositives []string) {
	t.Helper()
	matched := 0
	for _, s := range mustMatch {
		if commitmentQuote(s) != "" {
			matched++
		}
	}
	for _, s := range mustNotMatch {
		if commitmentQuote(s) != "" {
			falsePositives = append(falsePositives, s)
		}
	}
	return float64(matched) / float64(len(mustMatch)), falsePositives
}

// TestCommitmentCorpusPrecision is the gate. Precision must be perfect; a
// single false positive is a promise the product invented.
func TestCommitmentCorpusPrecision(t *testing.T) {
	_, falsePositives := measureCorpus(t)
	for _, s := range falsePositives {
		t.Errorf("FALSE POSITIVE — this is not a commitment: %q", s)
	}
}

// TestCommitmentCorpusRecall reports recall and holds the floor, so a change
// that quietly narrows extraction fails here instead of in a customer's
// mailbox.
func TestCommitmentCorpusRecall(t *testing.T) {
	const floor = 0.80

	recall, _ := measureCorpus(t)
	var missed []string
	for _, s := range mustMatch {
		if commitmentQuote(s) == "" {
			missed = append(missed, s)
		}
	}
	fmt.Printf("commitment recall: %d/%d (%.0f%%)\n",
		len(mustMatch)-len(missed), len(mustMatch), recall*100)
	for _, s := range missed {
		t.Logf("missed: %q", s)
	}
	if recall < floor {
		t.Errorf("recall %.0f%% is below the %.0f%% floor", recall*100, floor*100)
	}
}

// Found by running an audit over a real mailbox: a promise that followed a link
// was quoted from inside the link. The evidence a customer is shown to prove
// what they were promised began "com/general/others/new-billing-model".
func TestCommitmentQuoteDoesNotStartInsideAURL(t *testing.T) {
	body := "See https://signoz.io/docs/general/others/new-billing-model Please bear with us; we will get back to you shortly."

	quote := commitmentQuote(body)
	if quote == "" {
		t.Fatal("the promise was not found at all")
	}
	if strings.Contains(quote, "signoz.io") || strings.HasPrefix(quote, "com/") {
		t.Fatalf("quote begins inside the URL: %q", quote)
	}
	if !strings.HasPrefix(quote, "Please bear with us") {
		t.Fatalf("quote does not start at the sentence: %q", quote)
	}

	// A decimal point is not a sentence boundary either.
	priced := commitmentQuote("The total is 1.5k. I'll send the invoice today.")
	if !strings.HasPrefix(priced, "I'll send") {
		t.Fatalf("quote mis-split on a decimal: %q", priced)
	}
}
