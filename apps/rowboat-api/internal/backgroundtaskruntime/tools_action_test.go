package backgroundtaskruntime

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

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

func TestActionProposalReadToolIsTenantScopedAndReadOnly(t *testing.T) {
	client, owner, ctx := setupDB(t)
	now := time.Date(2026, 9, 9, 18, 0, 0, 0, time.UTC)
	pending := client.ActionProposal.Create().SetUser(owner).
		SetTarget("conduit:invoice:inv_1").SetKind("conduit.dunning.advance").
		SetParamsJSON(`{"step":2}`).SetFinancial(true).SetRationale("invoice overdue").
		SetStatus("pending").SetCreatedAt(now).SaveX(ctx)
	failed := client.ActionProposal.Create().SetUser(owner).
		SetTarget("conduit:invoice:inv_2").SetKind("conduit.dispute.mark").
		SetStatus("failed").SetReason("product unavailable").SetCreatedAt(now.Add(-time.Minute)).SaveX(ctx)
	other := client.User.Create().SetEmail("other-actions@x.co").SetWorkosUserID("user_other_actions").SaveX(ctx)
	client.ActionProposal.Create().SetUser(other).SetTarget("other-secret").SetKind("conduit.dunning.advance").SaveX(ctx)
	unchangedAt := pending.UpdatedAt

	tool := NewActionProposalReadTool(client, owner.ID)
	out, err := tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{}`))
	if err != nil || !strings.Contains(string(out), pending.ID.String()) || !strings.Contains(string(out), `"financial":true`) ||
		!strings.Contains(string(out), `\"step\":2`) || strings.Contains(string(out), failed.ID.String()) || strings.Contains(string(out), "other-secret") {
		t.Fatalf("action_proposal.read pending = %s err=%v", out, err)
	}
	out, err = tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"status":"failed"}`))
	if err != nil || !strings.Contains(string(out), failed.ID.String()) || !strings.Contains(string(out), "product unavailable") || strings.Contains(string(out), pending.ID.String()) {
		t.Fatalf("action_proposal.read failed = %s err=%v", out, err)
	}
	out, err = tool.Invoke(ctx, ToolScope{UserID: owner.ID.String()}, json.RawMessage(`{"proposalId":"`+failed.ID.String()+`"}`))
	if err != nil || !strings.Contains(string(out), failed.ID.String()) {
		t.Fatalf("action_proposal.read exact = %s err=%v", out, err)
	}
	if got := client.ActionProposal.GetX(ctx, pending.ID).UpdatedAt; !got.Equal(unchangedAt) {
		t.Fatalf("action_proposal.read mutated proposal: updatedAt=%v want %v", got, unchangedAt)
	}
	if _, err := tool.Invoke(ctx, ToolScope{UserID: other.ID.String()}, json.RawMessage(`{}`)); err == nil {
		t.Fatal("action_proposal.read accepted another workflow owner")
	}
}
