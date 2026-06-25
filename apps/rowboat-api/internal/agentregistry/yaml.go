package agentregistry

import (
	"fmt"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentspec"
)

// LoadYAML decodes + compiles an agent document (YAML or JSON) into a resolved
// Spec plus the canonical compiled form (for the content hash). It does NOT
// validate against the registry/policy — call ValidateCompiled for that — so
// the same decode/compile runs offline in the CLI. resolvedInstructions is used
// when the document referenced an external instructionsFile.
func LoadYAML(raw []byte, resolvedInstructions, sourceFormat string) (*Spec, agentspec.Compiled, error) {
	doc, err := agentspec.Decode(raw)
	if err != nil {
		return nil, agentspec.Compiled{}, err
	}
	comp, err := agentspec.Compile(doc, resolvedInstructions)
	if err != nil {
		return nil, agentspec.Compiled{}, err
	}
	source := SourceTenant
	if sourceFormat == "builtin" {
		source = SourceBuiltin
	}
	return specFromCompiled(comp, source, sourceFormat), comp, nil
}

// specFromCompiled maps the neutral compiled form onto the runtime Spec.
func specFromCompiled(comp agentspec.Compiled, source, sourceFormat string) *Spec {
	spec := &Spec{
		Slug:          comp.Slug,
		Name:          comp.Name,
		Source:        source,
		SourceFormat:  sourceFormat,
		Instructions:  comp.Instructions,
		Model:         comp.Model,
		Provider:      comp.Provider,
		EnabledTools:  append([]string(nil), comp.EnabledTools...),
		Tools:         append([]agentspec.ToolConfig(nil), comp.Tools...),
		SubagentRefs:  append([]string(nil), comp.Subagents...),
		ConnectorReqs: append([]string(nil), comp.ConnectorReqs...),
		Channels:      append([]string(nil), comp.Channels...),
		Limits: SpecLimits{
			MaxTurnsPerSession:    comp.Limits.MaxTurns,
			MaxLLMCallsPerSession: comp.Limits.MaxLLMCalls,
			MaxToolCallsPerTurn:   comp.Limits.MaxToolCalls,
		},
	}
	return spec
}

// Policy is the tenant-side input to semantic validation: the model allowlist,
// the per-tenant limit ceilings, and whether declarative (OpenAPI/MCP) tools
// are permitted.
type Policy struct {
	AllowedModels           []string // empty → all models allowed
	MaxTurns                int      // 0 → no cap
	MaxLLMCalls             int
	MaxToolCalls            int
	DeclarativeToolsEnabled bool
}

// FieldError is one validation failure with a field path + machine code.
type FieldError struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e FieldError) Error() string { return fmt.Sprintf("%s: %s (%s)", e.Field, e.Message, e.Code) }

// ValidateCompiled runs the shared semantic validation over a compiled spec —
// the SAME check the API runs on apply and the CLI runs offline (RFC 028). It
// is a pure function over (compiled, registry, policy, knownAgent).
func (c *Catalog) ValidateCompiled(comp agentspec.Compiled, policy Policy, knownAgent func(slug string) bool) []FieldError {
	var errs []FieldError

	// Tools: code-backed must resolve in the deny-by-default registry;
	// declarative (openapi/mcp) are trust-gated and need a manifestRef.
	for i, t := range comp.Tools {
		field := fmt.Sprintf("spec.tools[%d]", i)
		switch t.Kind {
		case agentspec.ToolKindCode:
			if _, ok := c.Get(t.Name); !ok {
				errs = append(errs, FieldError{Field: field, Code: "tool_not_registered", Message: fmt.Sprintf("unknown tool %q (not in the capability registry)", t.Name)})
			}
		case agentspec.ToolKindOpenAPI, agentspec.ToolKindMCP:
			if !policy.DeclarativeToolsEnabled {
				errs = append(errs, FieldError{Field: field, Code: "declarative_tools_disabled", Message: "declarative (openapi/mcp) tools are not enabled (RFC 020)"})
			}
			if strings.TrimSpace(t.ManifestRef) == "" {
				errs = append(errs, FieldError{Field: field + ".manifestRef", Code: "manifest_ref_required", Message: "declarative tools require a manifestRef"})
			}
		default:
			errs = append(errs, FieldError{Field: field + ".kind", Code: "unknown_tool_kind", Message: fmt.Sprintf("unknown tool kind %q (want openapi or mcp)", t.Kind)})
		}
	}

	// Model: must be in the allowlist when one is configured (empty model →
	// runtime default, allowed).
	if comp.Model != "" && len(policy.AllowedModels) > 0 && !containsStr(policy.AllowedModels, comp.Model) {
		errs = append(errs, FieldError{Field: "spec.model", Code: "model_not_allowed", Message: fmt.Sprintf("model %q is not allowed", comp.Model)})
	}

	// Limits: clamped to tenant caps — over-cap is rejected, never silently lowered.
	if policy.MaxTurns > 0 && comp.Limits.MaxTurns > policy.MaxTurns {
		errs = append(errs, FieldError{Field: "spec.limits.maxTurns", Code: "limit_over_cap", Message: fmt.Sprintf("maxTurns %d exceeds the tenant cap %d", comp.Limits.MaxTurns, policy.MaxTurns)})
	}
	if policy.MaxLLMCalls > 0 && comp.Limits.MaxLLMCalls > policy.MaxLLMCalls {
		errs = append(errs, FieldError{Field: "spec.limits.maxLLMCalls", Code: "limit_over_cap", Message: fmt.Sprintf("maxLLMCalls %d exceeds the tenant cap %d", comp.Limits.MaxLLMCalls, policy.MaxLLMCalls)})
	}
	if policy.MaxToolCalls > 0 && comp.Limits.MaxToolCalls > policy.MaxToolCalls {
		errs = append(errs, FieldError{Field: "spec.limits.maxToolCalls", Code: "limit_over_cap", Message: fmt.Sprintf("maxToolCalls %d exceeds the tenant cap %d", comp.Limits.MaxToolCalls, policy.MaxToolCalls)})
	}

	// Connections: scope must match {product}:{resource}.{action} (RFC 012 shape).
	for i, scope := range comp.ConnectorReqs {
		if !validScope(scope) {
			errs = append(errs, FieldError{Field: fmt.Sprintf("spec.connections[%d].scope", i), Code: "invalid_scope", Message: fmt.Sprintf("scope %q must be {product}:{resource}.{action}", scope)})
		}
	}

	// Subagent refs: must resolve, and a self-reference is a trivial cycle.
	for i, ref := range comp.Subagents {
		field := fmt.Sprintf("spec.subagents[%d]", i)
		if ref == comp.Slug {
			errs = append(errs, FieldError{Field: field, Code: "subagent_cycle", Message: "an agent cannot delegate to itself"})
			continue
		}
		if knownAgent != nil && !knownAgent(ref) {
			errs = append(errs, FieldError{Field: field, Code: "subagent_not_found", Message: fmt.Sprintf("subagent %q does not exist", ref)})
		}
	}
	return errs
}

func containsStr(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}

// validScope checks the {product}:{resource}.{action} shape.
func validScope(scope string) bool {
	product, rest, ok := strings.Cut(scope, ":")
	if !ok || product == "" {
		return false
	}
	resource, action, ok := strings.Cut(rest, ".")
	return ok && resource != "" && action != ""
}
