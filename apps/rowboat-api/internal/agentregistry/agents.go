package agentregistry

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentdefinition"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentspec"
)

//go:embed builtins/agents
var builtinFS embed.FS

// Source values for a resolved agent.
const (
	SourceBuiltin = "builtin"
	SourceTenant  = "tenant"
)

// ErrAgentNotFound is returned when neither a tenant row nor a built-in matches.
var ErrAgentNotFound = errors.New("agent definition not found")

// SpecLimits are per-agent budget overrides. A zero field inherits the runtime
// default (appconfig.AGENT_*); set fields cap below it.
type SpecLimits struct {
	MaxLLMCallsPerTurn     int `json:"maxLlmCallsPerTurn,omitempty"`
	MaxToolCallsPerTurn    int `json:"maxToolCallsPerTurn,omitempty"`
	MaxTurnsPerSession     int `json:"maxTurnsPerSession,omitempty"`
	MaxLLMCallsPerSession  int `json:"maxLlmCallsPerSession,omitempty"`
	MaxCostUnitsPerSession int `json:"maxCostUnitsPerSession,omitempty"`
}

// Spec is a resolved agent definition — the single shape consumed by the
// session starter and workflow, regardless of whether it came from a tenant ent
// row, the embedded built-in directory, or compiled YAML (RFC 028).
type Spec struct {
	Slug          string
	Name          string
	Source        string // builtin | tenant
	Instructions  string
	Model         string
	Provider      string
	EnabledTools  []string
	Tools         []agentspec.ToolConfig // RFC 028 rich per-tool config (approval overrides, declarative refs)
	SubagentRefs  []string
	ConnectorReqs []string
	Channels      []string
	Limits        SpecLimits
	Revision      int
	ContentHash   string
	SourceFormat  string // builtin | yaml | json
}

// ToolApprovalOverrides maps tool name → requiresApproval from the rich tool
// config, so the session starter can bump a tool's effective trust tier.
func (s *Spec) ToolApprovalOverrides() map[string]bool {
	if len(s.Tools) == 0 {
		return nil
	}
	m := make(map[string]bool, len(s.Tools))
	for _, t := range s.Tools {
		if t.RequiresApproval {
			m[t.Name] = true
		}
	}
	return m
}

// Loader resolves agents by slug: tenant ent rows first (tenant-scoped via the
// db interceptor), then the embedded built-ins as read-only fallbacks.
type Loader struct {
	client   *ent.Client
	catalog  *Catalog
	builtins map[string]*Spec
}

// NewLoader parses the embedded built-ins, validating each one's tool allowlist
// against the catalog (an unknown built-in tool is a programming error that
// fails boot, not a silent runtime denial).
func NewLoader(client *ent.Client, catalog *Catalog) (*Loader, error) {
	builtins, err := loadBuiltins()
	if err != nil {
		return nil, err
	}
	if catalog != nil {
		for slug, spec := range builtins {
			if verr := catalog.Validate(spec.EnabledTools); verr != nil {
				return nil, fmt.Errorf("built-in agent %q: %w", slug, verr)
			}
		}
	}
	return &Loader{client: client, catalog: catalog, builtins: builtins}, nil
}

// Catalog returns the capability catalog this loader validates against.
func (l *Loader) Catalog() *Catalog { return l.catalog }

// Resolve returns the agent for slug, preferring a tenant row over a built-in.
// ctx must carry the viewer (the db interceptor scopes the tenant query).
func (l *Loader) Resolve(ctx context.Context, slug string) (*Spec, error) {
	if l.client != nil {
		def, err := l.client.AgentDefinition.Query().
			Where(agentdefinition.SlugEQ(slug)).
			Only(ctx)
		switch {
		case err == nil:
			return specFromEnt(def), nil
		case ent.IsNotFound(err):
			// fall through to built-ins
		default:
			return nil, err
		}
	}
	if spec, ok := l.builtins[slug]; ok {
		return spec.clone(), nil
	}
	return nil, ErrAgentNotFound
}

// Builtins returns the embedded built-in specs in stable slug order.
func (l *Loader) Builtins() []*Spec {
	out := make([]*Spec, 0, len(l.builtins))
	for _, s := range l.builtins {
		out = append(out, s.clone())
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Slug < out[j].Slug })
	return out
}

// specFromEnt maps a tenant AgentDefinition row to a resolved Spec.
func specFromEnt(def *ent.AgentDefinition) *Spec {
	spec := &Spec{
		Slug:          def.Slug,
		Name:          def.Name,
		Source:        def.Source,
		Instructions:  def.Instructions,
		Model:         def.Model,
		Provider:      def.Provider,
		EnabledTools:  append([]string(nil), def.EnabledTools...),
		SubagentRefs:  append([]string(nil), def.SubagentRefs...),
		ConnectorReqs: append([]string(nil), def.ConnectorReqs...),
		Revision:      def.Revision,
		ContentHash:   def.ContentHash,
		SourceFormat:  def.SourceFormat,
	}
	if spec.Source == "" {
		spec.Source = SourceTenant
	}
	if strings.TrimSpace(def.LimitsJSON) != "" {
		_ = json.Unmarshal([]byte(def.LimitsJSON), &spec.Limits)
	}
	if strings.TrimSpace(def.ToolsJSON) != "" {
		_ = json.Unmarshal([]byte(def.ToolsJSON), &spec.Tools)
	}
	if strings.TrimSpace(def.ChannelBindings) != "" {
		_ = json.Unmarshal([]byte(def.ChannelBindings), &spec.Channels)
	}
	return spec
}

// loadBuiltins walks the embedded directory, compiling one Spec per
// builtins/agents/<slug>/ folder from agent.yaml + instructions.md (RFC 028:
// built-ins use YAML as the source format, the same pipeline as tenant YAML).
func loadBuiltins() (map[string]*Spec, error) {
	const root = "builtins/agents"
	entries, err := builtinFS.ReadDir(root)
	if err != nil {
		return nil, fmt.Errorf("read built-in agents: %w", err)
	}
	out := make(map[string]*Spec)
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		slug := e.Name()
		dir := path.Join(root, slug)

		rawAgent, err := fs.ReadFile(builtinFS, path.Join(dir, "agent.yaml"))
		if err != nil {
			return nil, fmt.Errorf("built-in %q: read agent.yaml: %w", slug, err)
		}
		instructions, err := fs.ReadFile(builtinFS, path.Join(dir, "instructions.md"))
		if err != nil {
			return nil, fmt.Errorf("built-in %q: read instructions.md: %w", slug, err)
		}
		spec, _, err := LoadYAML(rawAgent, strings.TrimSpace(string(instructions)), "builtin")
		if err != nil {
			return nil, fmt.Errorf("built-in %q: compile: %w", slug, err)
		}
		if spec.Slug != slug {
			return nil, fmt.Errorf("built-in %q: agent.yaml slug %q does not match its directory", slug, spec.Slug)
		}
		spec.Revision = 1
		out[slug] = spec
	}
	return out, nil
}

func (s *Spec) clone() *Spec {
	if s == nil {
		return nil
	}
	cp := *s
	cp.EnabledTools = append([]string(nil), s.EnabledTools...)
	cp.SubagentRefs = append([]string(nil), s.SubagentRefs...)
	cp.ConnectorReqs = append([]string(nil), s.ConnectorReqs...)
	return &cp
}
