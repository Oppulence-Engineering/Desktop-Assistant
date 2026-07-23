package actions

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestEndToEndRoundTrip is the RFC 023 headline acceptance signal: a finance
// action closes the loop end to end — propose → approve → execute (against a
// real product Act seam) → the product's return event closes the loop — with a
// full, queryable audit chain linking proposal ↔ token ↔ execution ↔ return
// event, and money moving only behind a valid single-use token.
func TestEndToEndRoundTrip(t *testing.T) {
	f := newFixture(t)

	// A real HTTP Act seam standing in for the product.
	var got actRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &got)
		_ = json.NewEncoder(w).Encode(actResponse{ResultRef: "conduit:step:s9"})
	}))
	defer srv.Close()
	f.broker.exec = NewHTTPActSeam(HTTPActSeamConfig{BaseURL: srv.URL})

	// 1. PROPOSE — as the runtime propose-only tool would, carrying its run id.
	p, err := f.broker.Propose(f.ctx, f.user, ProposeInput{
		Target:      "conduit:invoice:inv_777",
		Kind:        "conduit.dunning.advance",
		ParamsJSON:  `{"step":3}`,
		Financial:   true,
		Rationale:   "Acme 21 days overdue",
		OriginRunID: "live-note-run-1",
	})
	if err != nil {
		t.Fatalf("propose: %v", err)
	}

	// 2. APPROVE — issues the single-use, params-bound token (step-up satisfied).
	appr, err := f.broker.Approve(f.ctx, f.user, p.ID, true)
	if err != nil {
		t.Fatalf("approve: %v", err)
	}

	// 3. EXECUTE — verifies+consumes the token, calls the product, records result.
	done, err := f.broker.Execute(f.ctx, f.user, p.ID, appr.Token)
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if done.Status != StatusExecuted || done.ResultRef != "conduit:step:s9" {
		t.Fatalf("post-execute: status=%q result=%q", done.Status, done.ResultRef)
	}
	if got.CorrelationID != p.CorrelationID || got.Target != "conduit:invoice:inv_777" {
		t.Fatalf("product did not receive the correlated action: %+v", got)
	}

	// 4. WATCH — the product's return event closes the loop, linked by correlation.
	ev := f.returnEvent(t, p.CorrelationID)
	m, err := f.broker.CorrelateReturn(f.ctx, f.user, ev)
	if err != nil {
		t.Fatalf("correlate return: %v", err)
	}
	if !m.Matched || m.AlreadyClosed {
		t.Fatalf("return did not close the loop: %+v", m)
	}
	if m.OriginRunID != "live-note-run-1" {
		t.Fatalf("loop close lost the originating run: %q", m.OriginRunID)
	}

	// 5. AUDIT — the full chain is queryable, all four legs linked by ids.
	entries, err := f.broker.Audit(f.ctx, "conduit:invoice:inv_777")
	if err != nil || len(entries) != 1 {
		t.Fatalf("audit: %v len=%d", err, len(entries))
	}
	e := entries[0]
	if e.Proposal.ResolvedAt == nil || e.Proposal.ReturnEventID != ev.ID.String() {
		t.Fatalf("audit proposal not linked to return event: %+v", e.Proposal)
	}
	if e.Proposal.ExecutedAt == nil || e.Proposal.ResultRef != "conduit:step:s9" {
		t.Fatalf("audit proposal missing execution linkage")
	}
	if len(e.Tokens) != 1 || !e.Tokens[0].Consumed {
		t.Fatalf("audit token chain wrong: %+v", e.Tokens)
	}
}
