package agentworkflow

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentregistry"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agenttoken"
)

func newTestActivities() *Activities {
	return &Activities{Catalog: agentregistry.DefaultCatalog()}
}

// TestToolInvokeDenyByDefault is the P1 gate: a non-allowlisted tool name
// ("shell") resolves to ErrToolNotAllowed → Denied, even though it never reaches
// any tool implementation.
func TestToolInvokeDenyByDefault(t *testing.T) {
	a := newTestActivities()
	res, err := a.ToolInvoke(context.Background(), ToolInvokeInput{
		UserID: "u", SessionID: "s", ToolName: "shell", AllowedTools: []string{"echo", "current_time"},
	})
	if err != nil {
		t.Fatalf("ToolInvoke returned transport error: %v", err)
	}
	if !res.Denied {
		t.Fatalf("expected shell to be denied, got %+v", res)
	}
	if res.ErrorCode == "" {
		t.Fatal("denied result should carry an error code")
	}
}

// TestToolInvokeAllowedRunsTool confirms an allowlisted tool executes and its
// (truncated) result is returned.
func TestToolInvokeAllowedRunsTool(t *testing.T) {
	a := newTestActivities()
	res, err := a.ToolInvoke(context.Background(), ToolInvokeInput{
		UserID: "u", SessionID: "s", ToolName: "echo", AllowedTools: []string{"echo"},
		Args: json.RawMessage(`{"text":"hello-durable-agent"}`),
	})
	if err != nil {
		t.Fatalf("ToolInvoke: %v", err)
	}
	if res.Denied || res.Failed {
		t.Fatalf("expected echo to succeed, got %+v", res)
	}
	if !strings.Contains(res.ResultJSON, "hello-durable-agent") {
		t.Fatalf("echo result missing input: %q", res.ResultJSON)
	}
}

// TestToolInvokeDeniesSubagentPseudoTool confirms the subagent pseudo-tool is
// never invokable as a normal tool (it has no Build and is excluded from the
// registry), so the loop must route it to a child workflow instead.
func TestToolInvokeDeniesSubagentPseudoTool(t *testing.T) {
	a := newTestActivities()
	res, _ := a.ToolInvoke(context.Background(), ToolInvokeInput{
		UserID: "u", SessionID: "s", ToolName: "subagent.delegate", AllowedTools: []string{"subagent.delegate"},
	})
	if !res.Denied {
		t.Fatalf("subagent.delegate should not be invokable as a tool; got %+v", res)
	}
}

// TestSessionRequestIDDeterminism is the billing-idempotency anchor target: the
// same (session, turn, call, attempt) is a stable id (a workflow replay reuses
// it → no double-charge), while a different attempt is distinct (a Temporal
// retry reserves fresh).
func TestSessionRequestIDDeterminism(t *testing.T) {
	a1 := sessionRequestID("sess-1", 2, 3, 1)
	a1again := sessionRequestID("sess-1", 2, 3, 1)
	if a1 != a1again {
		t.Fatal("same (session,turn,call,attempt) must yield the same request id")
	}
	if a1 == sessionRequestID("sess-1", 2, 3, 2) {
		t.Fatal("a different attempt must yield a different request id (retry reserves fresh)")
	}
	if a1 == sessionRequestID("sess-1", 2, 4, 1) {
		t.Fatal("a different call index must yield a different request id")
	}
	if a1 == sessionRequestID("sess-2", 2, 3, 1) {
		t.Fatal("a different session must yield a different request id")
	}
}

// TestValidateApprovalMoneyMoving is the P3 validator gate: money-moving grants
// require a structurally valid per-invocation token; act-tier grants need none.
func TestValidateApprovalMoneyMoving(t *testing.T) {
	a := newTestActivities()
	ctx := context.Background()

	if err := a.ValidateApproval(ctx, ValidateApprovalInput{TrustTier: agentregistry.TierAct}); err != nil {
		t.Fatalf("act tier should not require a token: %v", err)
	}
	if err := a.ValidateApproval(ctx, ValidateApprovalInput{TrustTier: agentregistry.TierMoneyMoving, ApprovalToken: ""}); err == nil {
		t.Fatal("money-moving with empty token must be rejected")
	}
	if err := a.ValidateApproval(ctx, ValidateApprovalInput{TrustTier: agentregistry.TierMoneyMoving, ApprovalToken: "bogus"}); err == nil {
		t.Fatal("money-moving with malformed token must be rejected")
	}
	if err := a.ValidateApproval(ctx, ValidateApprovalInput{TrustTier: agentregistry.TierMoneyMoving, ApprovalToken: "appr_abc123456789"}); err != nil {
		t.Fatalf("money-moving with a valid token must pass: %v", err)
	}
}

// TestValidateApprovalSignedToken is the real RFC-012 gate: with a signer
// configured, ValidateApproval accepts only a correctly-bound, MFA-asserting,
// unexpired token — forged, cross-bound, or non-MFA tokens are rejected.
func TestValidateApprovalSignedToken(t *testing.T) {
	signer, _ := agenttoken.NewSigner("test-secret-key")
	a := &Activities{Catalog: agentregistry.DefaultCatalog(), ApprovalSigner: signer, RequireMFA: true}
	ctx := context.Background()
	now := time.Now()

	good, _ := signer.MintApproval(agenttoken.ApprovalClaims{
		ApprovalID: "ap1", UserID: "u1", SessionID: "s1", TrustTier: agentregistry.TierMoneyMoving, MFA: true,
	}, now, time.Minute)
	in := ValidateApprovalInput{UserID: "u1", SessionID: "s1", ApprovalID: "ap1", TrustTier: agentregistry.TierMoneyMoving, ApprovalToken: good}
	if err := a.ValidateApproval(ctx, in); err != nil {
		t.Fatalf("valid signed money-moving token rejected: %v", err)
	}

	// Token bound to a DIFFERENT approval must be rejected for this gate.
	other, _ := signer.MintApproval(agenttoken.ApprovalClaims{
		ApprovalID: "ap2", UserID: "u1", SessionID: "s1", TrustTier: agentregistry.TierMoneyMoving, MFA: true,
	}, now, time.Minute)
	bad := in
	bad.ApprovalToken = other
	if err := a.ValidateApproval(ctx, bad); err == nil {
		t.Fatal("token bound to another approval must be rejected")
	}

	// Token without MFA must be rejected when MFA is required.
	noMFA, _ := signer.MintApproval(agenttoken.ApprovalClaims{
		ApprovalID: "ap1", UserID: "u1", SessionID: "s1", TrustTier: agentregistry.TierMoneyMoving, MFA: false,
	}, now, time.Minute)
	nm := in
	nm.ApprovalToken = noMFA
	if err := a.ValidateApproval(ctx, nm); err == nil {
		t.Fatal("non-MFA token must be rejected when MFA is required")
	}

	// A garbage token is rejected.
	garbage := in
	garbage.ApprovalToken = "agt_not-a-real-token"
	if err := a.ValidateApproval(ctx, garbage); err == nil {
		t.Fatal("garbage token must be rejected by the signer")
	}
}

func TestToolMetasFromCatalogFiltersSubagents(t *testing.T) {
	c := agentregistry.DefaultCatalog()
	names := []string{"echo", "subagent.delegate"}

	disabled := ToolMetasFromCatalog(c, names, false)
	for _, m := range disabled {
		if m.Kind == agentregistry.KindSubagent {
			t.Fatal("subagent tools must be dropped when subagents are disabled")
		}
	}
	if len(disabled) != 1 {
		t.Fatalf("expected 1 tool with subagents disabled, got %d", len(disabled))
	}

	enabled := ToolMetasFromCatalog(c, names, true)
	if len(enabled) != 2 {
		t.Fatalf("expected 2 tools with subagents enabled, got %d", len(enabled))
	}
}

// TestRedactArgsKeepsActionDetail confirms secrets are redacted while the
// human-meaningful action detail (amount, recipient) is preserved for approval.
func TestRedactArgsKeepsActionDetail(t *testing.T) {
	raw := json.RawMessage(`{"amount":42,"recipient":"acme","api_key":"sk-secret","token":"xyz"}`)
	got := redactedMap(raw)
	if got["amount"] != float64(42) || got["recipient"] != "acme" {
		t.Fatalf("action detail not preserved: %+v", got)
	}
	if got["api_key"] != "[redacted]" || got["token"] != "[redacted]" {
		t.Fatalf("secrets not redacted: %+v", got)
	}
}
