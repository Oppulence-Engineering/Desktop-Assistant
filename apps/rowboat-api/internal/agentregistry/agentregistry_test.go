package agentregistry

import (
	"testing"
)

func TestDefaultCatalogHasCoreCapabilities(t *testing.T) {
	c := DefaultCatalog()
	for _, name := range []string{"current_time", "echo", "demo.payment", "subagent.delegate"} {
		if _, ok := c.Get(name); !ok {
			t.Fatalf("DefaultCatalog missing %q", name)
		}
	}
	if cap, _ := c.Get("demo.payment"); cap.TrustTier != TierMoneyMoving {
		t.Fatalf("demo.payment tier = %q, want %q", cap.TrustTier, TierMoneyMoving)
	}
	if cap, _ := c.Get("subagent.delegate"); cap.Kind != KindSubagent {
		t.Fatalf("subagent.delegate kind = %q, want %q", cap.Kind, KindSubagent)
	}
	if cap, _ := c.Get("echo"); cap.Build == nil {
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
