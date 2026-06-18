// Package agentregistry is the durable agent runtime's two-layer definition
// store (RFC 027):
//
//   - Layer 1 — the compiled-in Go capability registry (Catalog): every tool is
//     a backgroundtaskruntime.Tool with name, JSON-Schema params, and a required
//     trust tier (RFC 012). Type safety lives here because tools run as Temporal
//     activities; this is non-negotiable.
//   - Layer 2 — declarative AgentDefinitions (agents.go): instructions, model,
//     and a tool allowlist referencing Layer-1 capabilities BY NAME, validated
//     at save against the Catalog (unknown name → error, preserving
//     deny-by-default). First-party agents ship from an embedded convention
//     directory; tenant agents are ent rows.
//
// The Catalog is split deliberately into metadata (no deps — usable by the HTTP
// starter for validation and by the LLM activity to advertise tools) and bound
// tools (Build, worker-side, with per-session deps for invocation).
package agentregistry

import (
	"encoding/json"
	"fmt"
	"sort"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/backgroundtaskruntime"
)

// Trust tiers (RFC 012). A capability above the auto-execute line requires a
// human-in-the-loop approval before the loop may invoke it (gated by
// AGENT_HITL_ENABLED). money-moving additionally requires a per-invocation
// approval token + MFA step-up.
const (
	TierRead        = "read"         // read-only; auto-execute
	TierWrite       = "write"        // mutates owned state; auto-execute
	TierAct         = "act"          // outward-facing side effect; approval-eligible
	TierMoneyMoving = "money-moving" // moves funds; approval + token mandatory
)

// Kind distinguishes a normal tool from the subagent-delegation pseudo-tool,
// which the loop dispatches to a child workflow instead of a tool activity.
const (
	KindTool     = "tool"
	KindSubagent = "subagent"
)

// RequiresApproval reports whether a tool of the given trust tier must pause for
// human approval before invocation. act/money-moving are approval-eligible;
// when HITL is disabled the loop refuses them outright (it never silently
// auto-executes an approval-tier tool).
func RequiresApproval(tier string) bool {
	return tier == TierAct || tier == TierMoneyMoving
}

// ToolDeps are the per-session dependencies a bound tool needs at invocation.
// Client backs the claim-check reader (tool_result.read); connector/credential
// resolution is added as those tools land.
type ToolDeps struct {
	Client *ent.Client
}

// Capability is one Layer-1 tool: the metadata advertised to the model and used
// for deny-by-default validation + HITL branching, plus a Build that binds the
// tool to per-session deps for invocation. Build is nil for KindSubagent (the
// loop dispatches those to a child workflow, never a tool activity).
type Capability struct {
	Name        string
	Description string
	Parameters  json.RawMessage
	TrustTier   string
	Kind        string
	Build       func(ToolDeps) backgroundtaskruntime.Tool
}

// Def returns the model-facing advertisement for this capability.
func (c Capability) Def() backgroundtaskruntime.ToolDef {
	return backgroundtaskruntime.ToolDef{
		Name:        c.Name,
		Description: c.Description,
		Parameters:  c.Parameters,
		TrustTier:   c.TrustTier,
	}
}

// Catalog is an immutable, name-keyed set of capabilities. It is the single
// source of truth for which tools exist and at what trust tier.
type Catalog struct {
	caps  map[string]Capability
	names []string
}

// NewCatalog builds a catalog over exactly the given capabilities (tests inject
// custom ones; production uses DefaultCatalog). Later duplicates of a name are
// ignored — first registration wins — matching the deny-by-default registry's
// duplicate handling.
func NewCatalog(caps ...Capability) *Catalog {
	c := &Catalog{caps: make(map[string]Capability, len(caps))}
	for _, cap := range caps {
		if cap.Name == "" {
			continue
		}
		if _, dup := c.caps[cap.Name]; dup {
			continue
		}
		if cap.Kind == "" {
			cap.Kind = KindTool
		}
		if cap.TrustTier == "" {
			cap.TrustTier = TierRead
		}
		c.caps[cap.Name] = cap
		c.names = append(c.names, cap.Name)
	}
	sort.Strings(c.names)
	return c
}

// Get resolves a capability by name.
func (c *Catalog) Get(name string) (Capability, bool) {
	cap, ok := c.caps[name]
	return cap, ok
}

// Names lists every capability name in stable order.
func (c *Catalog) Names() []string {
	out := make([]string, len(c.names))
	copy(out, c.names)
	return out
}

// Validate rejects the first allowlist entry that is not a known capability,
// preserving deny-by-default: a manifest can only REFERENCE compiled-in tools.
// The HTTP layer maps the returned error to 400.
func (c *Catalog) Validate(names []string) error {
	for _, n := range names {
		if _, ok := c.caps[n]; !ok {
			return fmt.Errorf("unknown tool %q (not in the capability registry)", n)
		}
	}
	return nil
}

// Defs returns the model-facing ToolDefs for the allowlisted names, skipping
// unknown ones (already rejected at save) and the subagent pseudo-tools (those
// are advertised separately by the loop when subagents are enabled).
func (c *Catalog) Defs(names []string) []backgroundtaskruntime.ToolDef {
	out := make([]backgroundtaskruntime.ToolDef, 0, len(names))
	for _, n := range names {
		cap, ok := c.caps[n]
		if !ok || cap.Kind == KindSubagent {
			continue
		}
		out = append(out, cap.Def())
	}
	return out
}
