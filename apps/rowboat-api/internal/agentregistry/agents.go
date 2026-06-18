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
// row or the embedded built-in directory.
type Spec struct {
	Slug          string
	Name          string
	Source        string // builtin | tenant
	Instructions  string
	Model         string
	Provider      string
	EnabledTools  []string
	SubagentRefs  []string
	ConnectorReqs []string
	Limits        SpecLimits
}

// agentJSON is the on-disk shape of a built-in's agent.json.
type agentJSON struct {
	Name          string     `json:"name"`
	Model         string     `json:"model"`
	Provider      string     `json:"provider"`
	SubagentRefs  []string   `json:"subagentRefs"`
	ConnectorReqs []string   `json:"connectorReqs"`
	Limits        SpecLimits `json:"limits"`
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
	}
	if spec.Source == "" {
		spec.Source = SourceTenant
	}
	if strings.TrimSpace(def.LimitsJSON) != "" {
		_ = json.Unmarshal([]byte(def.LimitsJSON), &spec.Limits)
	}
	return spec
}

// loadBuiltins walks the embedded directory, building one Spec per
// builtins/agents/<slug>/ folder from instructions.md + agent.json + tools.json.
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

		instructions, err := fs.ReadFile(builtinFS, path.Join(dir, "instructions.md"))
		if err != nil {
			return nil, fmt.Errorf("built-in %q: read instructions.md: %w", slug, err)
		}
		rawAgent, err := fs.ReadFile(builtinFS, path.Join(dir, "agent.json"))
		if err != nil {
			return nil, fmt.Errorf("built-in %q: read agent.json: %w", slug, err)
		}
		var aj agentJSON
		if err := json.Unmarshal(rawAgent, &aj); err != nil {
			return nil, fmt.Errorf("built-in %q: parse agent.json: %w", slug, err)
		}
		rawTools, err := fs.ReadFile(builtinFS, path.Join(dir, "tools.json"))
		if err != nil {
			return nil, fmt.Errorf("built-in %q: read tools.json: %w", slug, err)
		}
		var tools []string
		if err := json.Unmarshal(rawTools, &tools); err != nil {
			return nil, fmt.Errorf("built-in %q: parse tools.json: %w", slug, err)
		}

		out[slug] = &Spec{
			Slug:          slug,
			Name:          aj.Name,
			Source:        SourceBuiltin,
			Instructions:  strings.TrimSpace(string(instructions)),
			Model:         aj.Model,
			Provider:      aj.Provider,
			EnabledTools:  tools,
			SubagentRefs:  aj.SubagentRefs,
			ConnectorReqs: aj.ConnectorReqs,
			Limits:        aj.Limits,
		}
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
