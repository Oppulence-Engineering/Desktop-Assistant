// Package agentgitops reconciles a declared repository of agent YAMLs to the
// desired state (RFC 028 P4): it diffs declared agents against the persisted
// managed_by=gitops definitions, repairs drift, and records agent_sync_state —
// mirroring internal/backgroundtaskschedule's reconciler (RFC 005). Git is the
// source of truth: out-of-band API edits to a gitops agent are rejected
// (agentregistry.Persist → ErrManagedByGitops), and the reconciler re-applies
// the declared content when it drifts.
package agentgitops

import (
	"context"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentdefinition"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentregistry"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentspec"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"go.uber.org/zap"
)

// DeclaredAgent is one agent from the source repo: the raw agent.yaml plus the
// resolved instructions (read from instructions.md by LoadDir).
type DeclaredAgent struct {
	Slug         string
	Raw          []byte
	Instructions string
}

// AgentOutcome is the per-agent reconcile result.
type AgentOutcome struct {
	Slug   string `json:"slug"`
	Action string `json:"action"` // created | updated | unchanged | failed | out_of_sync
	Error  string `json:"error,omitempty"`
}

// Result summarizes one reconcile pass.
type Result struct {
	Outcomes []AgentOutcome `json:"outcomes"`
}

// Reconciler converges declared agents to persisted state for one owner.
type Reconciler struct {
	client *ent.Client
	loader *agentregistry.Loader
	policy agentregistry.Policy
	log    *zap.Logger
}

// New builds a Reconciler.
func New(client *ent.Client, loader *agentregistry.Loader, policy agentregistry.Policy, log *zap.Logger) *Reconciler {
	if log == nil {
		log = zap.NewNop()
	}
	return &Reconciler{client: client, loader: loader, policy: policy, log: log}
}

// LoadDir reads a directory of agents (each subdir = one agent with agent.yaml +
// instructions.md) into DeclaredAgents — how a git checkout is loaded.
func LoadDir(fsys fs.FS, root string) ([]DeclaredAgent, error) {
	entries, err := fs.ReadDir(fsys, root)
	if err != nil {
		return nil, fmt.Errorf("agentgitops: read %q: %w", root, err)
	}
	var out []DeclaredAgent
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		dir := path.Join(root, e.Name())
		raw, err := fs.ReadFile(fsys, path.Join(dir, "agent.yaml"))
		if err != nil {
			continue // not an agent dir
		}
		instructions, _ := fs.ReadFile(fsys, path.Join(dir, "instructions.md"))
		out = append(out, DeclaredAgent{Slug: e.Name(), Raw: raw, Instructions: strings.TrimSpace(string(instructions))})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Slug < out[j].Slug })
	return out, nil
}

// ReconcileOnce converges the declared set for owner: it validates the whole set
// together (cross-agent subagent cycle detection), applies valid agents through
// the shared upsert (drift repaired, sync_state=current), records per-agent
// failures, and flags gitops agents removed from the repo as out_of_sync. It is
// the two-phase "validate all → persist all" the RFC calls for.
func (r *Reconciler) ReconcileOnce(ctx context.Context, owner *ent.User, declared []DeclaredAgent) (Result, error) {
	ctx = auth.WithUser(ctx, owner)

	// Phase 1: decode + compile all.
	type item struct {
		slug string
		comp agentspec.Compiled
		raw  []byte
		err  string
	}
	items := make([]item, 0, len(declared))
	declaredSlugs := map[string]bool{}
	graph := map[string][]string{}
	for _, d := range declared {
		it := item{slug: d.Slug, raw: d.Raw}
		doc, derr := agentspec.Decode(d.Raw)
		if derr != nil {
			it.err = derr.Error()
			items = append(items, it)
			continue
		}
		comp, cerr := agentspec.Compile(doc, d.Instructions)
		if cerr != nil {
			it.err = cerr.Error()
			items = append(items, it)
			continue
		}
		if comp.Slug != d.Slug {
			it.err = fmt.Sprintf("agent.yaml slug %q does not match directory %q", comp.Slug, d.Slug)
			items = append(items, it)
			continue
		}
		it.comp = comp
		items = append(items, it)
		declaredSlugs[comp.Slug] = true
		graph[comp.Slug] = comp.Subagents
	}

	// Phase 1b: cross-agent subagent cycle detection over the declared graph.
	cyclic := detectCycles(graph)

	// knownAgent resolves against the declared set, the built-ins, and existing
	// tenant rows (so a subagent ref to an already-deployed agent validates).
	knownAgent := func(slug string) bool {
		if declaredSlugs[slug] {
			return true
		}
		_, err := r.loader.Resolve(ctx, slug)
		return err == nil
	}

	var res Result
	// Phase 2: validate + apply each.
	for _, it := range items {
		if it.err != "" {
			r.markFailed(ctx, owner, it.slug, it.err)
			res.Outcomes = append(res.Outcomes, AgentOutcome{Slug: it.slug, Action: "failed", Error: it.err})
			continue
		}
		if cyclic[it.slug] {
			msg := "subagent reference cycle"
			r.markFailed(ctx, owner, it.slug, msg)
			res.Outcomes = append(res.Outcomes, AgentOutcome{Slug: it.slug, Action: "failed", Error: msg})
			continue
		}
		if verrs := r.loader.Catalog().ValidateCompiled(it.comp, r.policy, knownAgent); len(verrs) > 0 {
			msg := verrs[0].Error()
			r.markFailed(ctx, owner, it.slug, msg)
			res.Outcomes = append(res.Outcomes, AgentOutcome{Slug: it.slug, Action: "failed", Error: msg})
			continue
		}
		pr, perr := agentregistry.Persist(ctx, r.client, owner, it.comp, it.raw, "yaml", "gitops")
		if perr != nil {
			r.markFailed(ctx, owner, it.slug, perr.Error())
			res.Outcomes = append(res.Outcomes, AgentOutcome{Slug: it.slug, Action: "failed", Error: perr.Error()})
			continue
		}
		action := "updated"
		switch {
		case pr.Created:
			action = "created"
		case pr.NoOp:
			action = "unchanged"
		}
		res.Outcomes = append(res.Outcomes, AgentOutcome{Slug: it.slug, Action: action})
	}

	// Phase 3: gitops agents removed from the repo → flag out_of_sync (v1 does
	// not delete; deletion could orphan running sessions).
	res.Outcomes = append(res.Outcomes, r.flagRemoved(ctx, owner, declaredSlugs)...)
	return res, nil
}

// markFailed records a per-agent reconcile failure on the persisted row, if one
// exists (a brand-new invalid agent has no row to mark).
func (r *Reconciler) markFailed(ctx context.Context, owner *ent.User, slug, msg string) {
	_, err := r.client.AgentDefinition.Update().
		Where(agentdefinition.SlugEQ(slug), agentdefinition.HasUserWith(user.IDEQ(owner.ID)), agentdefinition.ManagedByEQ("gitops")).
		SetAgentSyncState("failed").SetAgentSyncError(truncate(msg, 500)).
		Save(ctx)
	if err != nil {
		r.log.Warn("mark agent sync failed", zap.String("slug", slug), zap.Error(err))
	}
}

// flagRemoved marks gitops-owned agents absent from the declared set out_of_sync.
func (r *Reconciler) flagRemoved(ctx context.Context, owner *ent.User, declaredSlugs map[string]bool) []AgentOutcome {
	rows, err := r.client.AgentDefinition.Query().
		Where(agentdefinition.HasUserWith(user.IDEQ(owner.ID)), agentdefinition.ManagedByEQ("gitops")).
		All(ctx)
	if err != nil {
		return nil
	}
	var out []AgentOutcome
	for _, row := range rows {
		if declaredSlugs[row.Slug] {
			continue
		}
		if row.AgentSyncState != "out_of_sync" {
			_, _ = r.client.AgentDefinition.UpdateOneID(row.ID).
				SetAgentSyncState("out_of_sync").
				SetAgentSyncError("removed from the declared repo").Save(ctx)
		}
		out = append(out, AgentOutcome{Slug: row.Slug, Action: "out_of_sync"})
	}
	return out
}

// detectCycles returns the set of slugs participating in a subagent cycle.
func detectCycles(graph map[string][]string) map[string]bool {
	const (
		white = 0
		gray  = 1
		black = 2
	)
	color := map[string]int{}
	cyclic := map[string]bool{}
	var visit func(node string) bool
	visit = func(node string) bool {
		color[node] = gray
		for _, next := range graph[node] {
			if _, declared := graph[next]; !declared {
				continue // ref outside the declared set is validated elsewhere
			}
			switch color[next] {
			case gray:
				cyclic[node] = true
				cyclic[next] = true
				return true
			case white:
				if visit(next) {
					cyclic[node] = true
					return true
				}
			}
		}
		color[node] = black
		return false
	}
	// Stable iteration order for determinism.
	slugs := make([]string, 0, len(graph))
	for s := range graph {
		slugs = append(slugs, s)
	}
	sort.Strings(slugs)
	for _, s := range slugs {
		if color[s] == white {
			visit(s)
		}
	}
	return cyclic
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
