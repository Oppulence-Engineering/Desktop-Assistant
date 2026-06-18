package agentregistry

import (
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentspec"
)

func compile(t *testing.T, yaml string) agentspec.Compiled {
	t.Helper()
	doc, err := agentspec.Decode([]byte(yaml))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	comp, err := agentspec.Compile(doc, "")
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	return comp
}

const baseAgent = `
apiVersion: agent.rowboat.dev/v1
kind: Agent
metadata: {slug: a, name: A}
spec:
  tools: [echo, current_time]
`

func codes(errs []FieldError) map[string]bool {
	m := map[string]bool{}
	for _, e := range errs {
		m[e.Code] = true
	}
	return m
}

func TestValidateCompiledHappyPath(t *testing.T) {
	c := DefaultCatalog()
	errs := c.ValidateCompiled(compile(t, baseAgent), Policy{}, func(string) bool { return true })
	if len(errs) != 0 {
		t.Fatalf("expected no errors, got %v", errs)
	}
}

func TestValidateUnknownTool(t *testing.T) {
	c := DefaultCatalog()
	y := strings.Replace(baseAgent, "[echo, current_time]", "[echo, shell]", 1)
	errs := c.ValidateCompiled(compile(t, y), Policy{}, nil)
	if !codes(errs)["tool_not_registered"] {
		t.Fatalf("expected tool_not_registered, got %v", errs)
	}
}

func TestValidateModelNotAllowed(t *testing.T) {
	c := DefaultCatalog()
	y := strings.Replace(baseAgent, "spec:", "spec:\n  model: evil/model", 1)
	errs := c.ValidateCompiled(compile(t, y), Policy{AllowedModels: []string{"good/model"}}, nil)
	if !codes(errs)["model_not_allowed"] {
		t.Fatalf("expected model_not_allowed, got %v", errs)
	}
	// With no allowlist, any model is fine.
	if errs := c.ValidateCompiled(compile(t, y), Policy{}, nil); codes(errs)["model_not_allowed"] {
		t.Fatal("empty allowlist should allow any model")
	}
}

func TestValidateLimitsOverCap(t *testing.T) {
	c := DefaultCatalog()
	y := strings.Replace(baseAgent, "spec:", "spec:\n  limits: {maxTurns: 999}", 1)
	errs := c.ValidateCompiled(compile(t, y), Policy{MaxTurns: 100}, nil)
	if !codes(errs)["limit_over_cap"] {
		t.Fatalf("expected limit_over_cap (rejected, not clamped), got %v", errs)
	}
}

func TestValidateInvalidScope(t *testing.T) {
	c := DefaultCatalog()
	y := strings.Replace(baseAgent, "spec:", "spec:\n  connections:\n    - scope: notascope", 1)
	errs := c.ValidateCompiled(compile(t, y), Policy{}, nil)
	if !codes(errs)["invalid_scope"] {
		t.Fatalf("expected invalid_scope, got %v", errs)
	}
}

func TestValidateSubagentCycleAndMissing(t *testing.T) {
	c := DefaultCatalog()
	self := strings.Replace(baseAgent, "spec:", "spec:\n  subagents: [a]", 1) // a → a
	if !codes(c.ValidateCompiled(compile(t, self), Policy{}, func(string) bool { return true }))["subagent_cycle"] {
		t.Fatal("expected subagent_cycle for self-reference")
	}
	missing := strings.Replace(baseAgent, "spec:", "spec:\n  subagents: [ghost]", 1)
	if !codes(c.ValidateCompiled(compile(t, missing), Policy{}, func(string) bool { return false }))["subagent_not_found"] {
		t.Fatal("expected subagent_not_found for unresolved ref")
	}
}

func TestValidateDeclarativeToolGate(t *testing.T) {
	c := DefaultCatalog()
	y := strings.Replace(baseAgent, "tools: [echo, current_time]",
		"tools:\n    - {name: portal, kind: openapi, manifestRef: m.yaml}", 1)
	// Disabled → rejected.
	if !codes(c.ValidateCompiled(compile(t, y), Policy{DeclarativeToolsEnabled: false}, nil))["declarative_tools_disabled"] {
		t.Fatal("declarative tool must be rejected when the feature is disabled")
	}
	// Enabled → accepted.
	if errs := c.ValidateCompiled(compile(t, y), Policy{DeclarativeToolsEnabled: true}, nil); len(errs) != 0 {
		t.Fatalf("declarative tool with manifestRef should pass when enabled, got %v", errs)
	}
	// Enabled but missing manifestRef → rejected.
	y2 := strings.Replace(baseAgent, "tools: [echo, current_time]", "tools:\n    - {name: portal, kind: mcp}", 1)
	if !codes(c.ValidateCompiled(compile(t, y2), Policy{DeclarativeToolsEnabled: true}, nil))["manifest_ref_required"] {
		t.Fatal("declarative tool without manifestRef must be rejected")
	}
}

// TestBuiltinYAMLRoundTrip is the P0 gate: a built-in agent.yaml compiles to the
// same resolved spec the runtime consumes and validates cleanly.
func TestBuiltinYAMLRoundTrip(t *testing.T) {
	l, err := NewLoader(nil, DefaultCatalog())
	if err != nil {
		t.Fatalf("loader: %v", err)
	}
	concierge, ok := func() (*Spec, bool) {
		for _, b := range l.Builtins() {
			if b.Slug == "concierge" {
				return b, true
			}
		}
		return nil, false
	}()
	if !ok {
		t.Fatal("missing built-in concierge")
	}
	if concierge.SourceFormat != "builtin" || concierge.Source != SourceBuiltin {
		t.Fatalf("concierge source wrong: %+v", concierge)
	}
	// The per-tool requiresApproval override survived compilation.
	if ov := concierge.ToolApprovalOverrides(); !ov["demo.payment"] {
		t.Fatalf("expected demo.payment requiresApproval override, got %v", ov)
	}
	if !containsStr(concierge.SubagentRefs, "assistant") {
		t.Fatalf("concierge should delegate to assistant: %v", concierge.SubagentRefs)
	}
}
