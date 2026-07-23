package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
)

type fakeProposer struct {
	got ActionProposalRequest
	err error
}

func (f *fakeProposer) ProposeAction(_ context.Context, req ActionProposalRequest) (ActionProposal, error) {
	f.got = req
	if f.err != nil {
		return ActionProposal{}, f.err
	}
	return ActionProposal{ProposalID: "prop_1", CorrelationID: "corr_1", Status: "pending"}, nil
}

func TestProposeActionToolMetadata(t *testing.T) {
	tool := NewProposeActionTool(&fakeProposer{})
	if tool.Name() != "action.propose" {
		t.Fatalf("name = %q", tool.Name())
	}
	// It must audit as a write, never an act/money-moving tier — proposing does
	// not pause for HITL and moves no money.
	ap, ok := tool.(ToolAuditProvider)
	if !ok {
		t.Fatal("propose tool should provide audit info")
	}
	if tier := ap.AuditInfo(nil).TrustTier; tier != TierWrite {
		t.Fatalf("trust tier = %q, want write", tier)
	}
	if RequiresApproval(ap.AuditInfo(nil).TrustTier) {
		t.Fatal("proposing must not require HITL approval")
	}
}

func TestProposeActionToolInvoke(t *testing.T) {
	fp := &fakeProposer{}
	tool := NewProposeActionTool(fp)
	uid := uuid.New()
	scope := ToolScope{UserID: uid.String(), RunID: "run_42"}
	args := json.RawMessage(`{"target":"conduit:invoice:inv_1","kind":"conduit.dunning.advance","params":{"step":2},"financial":true,"rationale":"overdue"}`)

	out, err := tool.Invoke(context.Background(), scope, args)
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	if fp.got.UserID != uid || fp.got.RunID != "run_42" {
		t.Fatalf("scope not propagated: %+v", fp.got)
	}
	if fp.got.Target != "conduit:invoice:inv_1" || fp.got.Kind != "conduit.dunning.advance" ||
		!fp.got.Financial || fp.got.ParamsJSON != `{"step":2}` {
		t.Fatalf("request mismatch: %+v", fp.got)
	}
	var res map[string]any
	if err := json.Unmarshal(out, &res); err != nil {
		t.Fatalf("result json: %v", err)
	}
	if res["proposalId"] != "prop_1" || res["status"] != "pending" {
		t.Fatalf("result = %v", res)
	}
}

func TestProposeActionToolRequiresTargetAndKind(t *testing.T) {
	tool := NewProposeActionTool(&fakeProposer{})
	scope := ToolScope{UserID: uuid.New().String()}
	if _, err := tool.Invoke(context.Background(), scope, json.RawMessage(`{"kind":"x"}`)); err == nil {
		t.Fatal("missing target should error")
	}
	if _, err := tool.Invoke(context.Background(), scope, json.RawMessage(`{"target":"t"}`)); err == nil {
		t.Fatal("missing kind should error")
	}
}

func TestProposeActionToolRejectsBadOwner(t *testing.T) {
	tool := NewProposeActionTool(&fakeProposer{})
	scope := ToolScope{UserID: "not-a-uuid"}
	_, err := tool.Invoke(context.Background(), scope, json.RawMessage(`{"target":"t","kind":"k"}`))
	if err == nil || !strings.Contains(err.Error(), "run owner") {
		t.Fatalf("bad owner err = %v", err)
	}
}

func TestProposeActionToolOmitsNullParams(t *testing.T) {
	fp := &fakeProposer{}
	tool := NewProposeActionTool(fp)
	scope := ToolScope{UserID: uuid.New().String()}
	if _, err := tool.Invoke(context.Background(), scope, json.RawMessage(`{"target":"t","kind":"k","params":null}`)); err != nil {
		t.Fatalf("invoke: %v", err)
	}
	if fp.got.ParamsJSON != "" {
		t.Fatalf("null params should be empty, got %q", fp.got.ParamsJSON)
	}
}
