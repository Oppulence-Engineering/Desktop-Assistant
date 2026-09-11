package agentregistry

import (
	"slices"
	"testing"
)

func TestDefaultCatalogHasCoreCapabilities(t *testing.T) {
	c := DefaultCatalog()
	for _, name := range []string{"current_time", "echo", "demo.payment", "relationship.read", "relationship.create", "relationship.correct", "relationship.assertion.retract", "relationship.review.acknowledge", "relationship.identity.decide", "relationship.attention.decide", "conversation.delete", "source.retry_sync", "task.create", "task.update", "task.complete", "task.snooze", "recommendation.create", "recommendation.dismiss", "recommendation.snooze", "recommendation.update", "action.audit", "action.outcome.record", "commitment.export", "commitment.accept", "commitment.block", "commitment.confirm", "commitment.correct", "commitment.complete", "commitment.dispute", "commitment.unblock", "person.create", "person.correct", "person.attribute.retract", "person.identity.decide", "person.delete", "note.create", "note.update", "note.delete", "action_proposal.read", "action.propose", "subagent.delegate"} {
		if _, ok := c.Get(name); !ok {
			t.Fatalf("DefaultCatalog missing %q", name)
		}
	}
	if capability, ok := c.Get("workspace.read"); !ok || capability.TrustTier != TierRead {
		t.Fatalf("workspace.read capability = %+v, want read tier", capability)
	}
	if capability, ok := c.Get("run_history.read"); !ok || capability.TrustTier != TierRead {
		t.Fatalf("run_history.read capability = %+v, want read tier", capability)
	}
	if capability, ok := c.Get("workflow.read"); !ok || capability.TrustTier != TierRead {
		t.Fatalf("workflow.read capability = %+v, want read tier", capability)
	}
	if capability, _ := c.Get("demo.payment"); capability.TrustTier != TierMoneyMoving {
		t.Fatalf("demo.payment tier = %q, want %q", capability.TrustTier, TierMoneyMoving)
	}
	if capability, _ := c.Get("action.propose"); capability.TrustTier != TierWrite {
		t.Fatalf("action.propose tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("action_proposal.read"); capability.TrustTier != TierRead {
		t.Fatalf("action_proposal.read tier = %q, want %q", capability.TrustTier, TierRead)
	}
	if capability, _ := c.Get("action.audit"); capability.TrustTier != TierRead {
		t.Fatalf("action.audit tier = %q, want %q", capability.TrustTier, TierRead)
	}
	if capability, _ := c.Get("action.outcome.record"); capability.TrustTier != TierWrite {
		t.Fatalf("action.outcome.record tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("relationship.correct"); capability.TrustTier != TierWrite {
		t.Fatalf("relationship.correct tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("relationship.assertion.retract"); capability.TrustTier != TierWrite {
		t.Fatalf("relationship.assertion.retract tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("relationship.review.acknowledge"); capability.TrustTier != TierWrite {
		t.Fatalf("relationship.review.acknowledge tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("relationship.identity.decide"); capability.TrustTier != TierWrite {
		t.Fatalf("relationship.identity.decide tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("relationship.attention.decide"); capability.TrustTier != TierWrite {
		t.Fatalf("relationship.attention.decide tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("conversation.delete"); capability.TrustTier != TierAct {
		t.Fatalf("conversation.delete tier = %q, want %q", capability.TrustTier, TierAct)
	}
	if capability, _ := c.Get("task.create"); capability.TrustTier != TierWrite {
		t.Fatalf("task.create tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("source.retry_sync"); capability.TrustTier != TierWrite {
		t.Fatalf("source.retry_sync tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("task.update"); capability.TrustTier != TierWrite {
		t.Fatalf("task.update tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("task.complete"); capability.TrustTier != TierWrite {
		t.Fatalf("task.complete tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("task.snooze"); capability.TrustTier != TierWrite {
		t.Fatalf("task.snooze tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("recommendation.create"); capability.TrustTier != TierWrite {
		t.Fatalf("recommendation.create tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("recommendation.dismiss"); capability.TrustTier != TierWrite {
		t.Fatalf("recommendation.dismiss tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("recommendation.snooze"); capability.TrustTier != TierWrite {
		t.Fatalf("recommendation.snooze tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("recommendation.update"); capability.TrustTier != TierWrite {
		t.Fatalf("recommendation.update tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("commitment.complete"); capability.TrustTier != TierWrite {
		t.Fatalf("commitment.complete tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("commitment.export"); capability.TrustTier != TierRead {
		t.Fatalf("commitment.export tier = %q, want %q", capability.TrustTier, TierRead)
	}
	if capability, _ := c.Get("commitment.correct"); capability.TrustTier != TierWrite {
		t.Fatalf("commitment.correct tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("commitment.confirm"); capability.TrustTier != TierWrite {
		t.Fatalf("commitment.confirm tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("commitment.accept"); capability.TrustTier != TierWrite {
		t.Fatalf("commitment.accept tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("commitment.block"); capability.TrustTier != TierWrite {
		t.Fatalf("commitment.block tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("commitment.unblock"); capability.TrustTier != TierWrite {
		t.Fatalf("commitment.unblock tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("commitment.dispute"); capability.TrustTier != TierWrite {
		t.Fatalf("commitment.dispute tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("person.correct"); capability.TrustTier != TierWrite {
		t.Fatalf("person.correct tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("person.attribute.retract"); capability.TrustTier != TierWrite {
		t.Fatalf("person.attribute.retract tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("person.identity.decide"); capability.TrustTier != TierWrite {
		t.Fatalf("person.identity.decide tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("person.delete"); capability.TrustTier != TierAct {
		t.Fatalf("person.delete tier = %q, want %q", capability.TrustTier, TierAct)
	}
	if capability, _ := c.Get("note.create"); capability.TrustTier != TierWrite {
		t.Fatalf("note.create tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("note.update"); capability.TrustTier != TierWrite {
		t.Fatalf("note.update tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("note.delete"); capability.TrustTier != TierWrite {
		t.Fatalf("note.delete tier = %q, want %q", capability.TrustTier, TierWrite)
	}
	if capability, _ := c.Get("subagent.delegate"); capability.Kind != KindSubagent {
		t.Fatalf("subagent.delegate kind = %q, want %q", capability.Kind, KindSubagent)
	}
	if capability, _ := c.Get("echo"); capability.Build == nil {
		t.Fatal("echo capability has no Build")
	}
}

func TestCatalogValidateDenyUnknown(t *testing.T) {
	c := DefaultCatalog()
	if err := c.Validate([]string{"echo", "current_time"}); err != nil {
		t.Fatalf("Validate(known) = %v, want nil", err)
	}
	// Deny-by-default: an unknown tool (e.g. "shell") is rejected at the
	// registry boundary — a manifest can only reference compiled-in tools.
	if err := c.Validate([]string{"echo", "shell"}); err == nil {
		t.Fatal("Validate([echo, shell]) = nil, want error for unknown tool")
	}
}

// TestSandboxCodeExecIsNotARegisteredCapability enforces the RFC 027 Non-Goal:
// untrusted / model-generated code execution (eve's sandbox/*) is NOT shipped —
// it requires an isolated compute boundary (gVisor/Firecracker/microVM) and is
// explicitly deferred. No shell/exec/eval/code-running capability may exist in
// the catalog; deny-by-default does the rest (a model asking for "shell" hits
// ErrToolNotAllowed). This test fails loudly if such a tool is ever added
// without the compute-boundary work.
func TestSandboxCodeExecIsNotARegisteredCapability(t *testing.T) {
	forbidden := []string{
		"shell", "bash", "sh", "exec", "execute", "eval", "run_code", "code_exec",
		"python", "node", "subprocess", "system", "sandbox", "container", "spawn",
	}
	c := DefaultCatalog()
	byName := map[string]struct{}{}
	for _, n := range c.Names() {
		byName[n] = struct{}{}
	}
	for _, name := range forbidden {
		if _, exists := byName[name]; exists {
			t.Fatalf("capability %q must not be registered: untrusted code execution is an RFC 027 Non-Goal (needs an isolated compute boundary)", name)
		}
	}
}

func TestRequiresApproval(t *testing.T) {
	cases := map[string]bool{
		TierRead: false, TierWrite: false, TierAct: true, TierMoneyMoving: true,
	}
	for tier, want := range cases {
		if got := RequiresApproval(tier); got != want {
			t.Fatalf("RequiresApproval(%q) = %v, want %v", tier, got, want)
		}
	}
}

func TestCatalogDefsSkipsSubagent(t *testing.T) {
	c := DefaultCatalog()
	defs := c.Defs([]string{"echo", "subagent.delegate"})
	for _, d := range defs {
		if d.Name == "subagent.delegate" {
			t.Fatal("Defs should not advertise the subagent pseudo-tool")
		}
	}
}

func TestLoaderBuiltins(t *testing.T) {
	// nil ent client → loader resolves built-ins only (no tenant rows).
	l, err := NewLoader(nil, DefaultCatalog())
	if err != nil {
		t.Fatalf("NewLoader: %v", err)
	}
	builtins := l.Builtins()
	if len(builtins) == 0 {
		t.Fatal("expected at least one built-in agent")
	}
	bySlug := map[string]*Spec{}
	for _, b := range builtins {
		bySlug[b.Slug] = b
	}
	assistant, ok := bySlug["assistant"]
	if !ok {
		t.Fatal("missing built-in agent 'assistant'")
	}
	if assistant.Source != SourceBuiltin {
		t.Fatalf("assistant source = %q, want builtin", assistant.Source)
	}
	if len(assistant.EnabledTools) == 0 || assistant.Instructions == "" {
		t.Fatalf("assistant spec under-populated: %+v", assistant)
	}
	for _, tool := range []string{"web.search", "tool_result.read", "relationship.read", "relationship.create", "relationship.correct", "relationship.assertion.retract", "relationship.review.acknowledge", "relationship.identity.decide", "relationship.attention.decide", "conversation.delete", "source.retry_sync", "task.create", "task.update", "task.complete", "task.snooze", "recommendation.create", "recommendation.dismiss", "recommendation.snooze", "recommendation.update", "action.audit", "action.outcome.record", "commitment.export", "commitment.accept", "commitment.block", "commitment.confirm", "commitment.correct", "commitment.complete", "commitment.dispute", "commitment.unblock", "person.create", "person.correct", "person.attribute.retract", "person.identity.decide", "person.delete", "note.create", "note.update", "note.delete", "action_proposal.read", "action.propose", "connector.read.gmail", "connector.write.gmail_draft", "connector.write.gmail_send", "connector.read.calendar"} {
		if !slices.Contains(assistant.EnabledTools, tool) {
			t.Fatalf("assistant missing capability %q", tool)
		}
	}
	if !slices.Contains(assistant.EnabledTools, "workspace.read") {
		t.Fatal("assistant missing capability \"workspace.read\"")
	}
	if !slices.Contains(assistant.EnabledTools, "run_history.read") {
		t.Fatal("assistant missing capability \"run_history.read\"")
	}
	if !slices.Contains(assistant.EnabledTools, "workflow.read") {
		t.Fatal("assistant missing capability \"workflow.read\"")
	}
	// Every built-in's allowlist must validate against the catalog (the loader
	// enforces this at construction; assert the property holds).
	for _, b := range builtins {
		if err := DefaultCatalog().Validate(b.EnabledTools); err != nil {
			t.Fatalf("built-in %q references unknown tool: %v", b.Slug, err)
		}
	}
}

func TestLoaderRejectsBuiltinWithUnknownTool(t *testing.T) {
	// A catalog missing the built-ins' tools must fail loader construction (a
	// built-in referencing an unknown tool is a programming error, not a silent
	// runtime denial).
	bare := NewCatalog(currentTimeCapability())
	if _, err := NewLoader(nil, bare); err == nil {
		t.Fatal("NewLoader with incomplete catalog = nil error, want failure")
	}
}
