package agentregistry

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentdefinition"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/user"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentspec"
)

// ErrManagedByGitops is returned when an API caller tries to edit an agent that
// GitOps owns (git is authoritative). The HTTP layer maps it to 409.
var ErrManagedByGitops = errors.New("agent is managed by gitops")

// PersistResult reports what a Persist did.
type PersistResult struct {
	Row     *ent.AgentDefinition
	Created bool
	NoOp    bool // content-hash matched an existing revision (idempotent apply)
}

// Persist is the one shared upsert for a compiled agent definition, used by both
// the HTTP YAML/JSON apply and the GitOps reconciler (RFC 028 "one canonical
// shape"). It is content-hash idempotent (unchanged hash → no-op), bumps a
// concrete revision on change (so enthistory labels revisions correctly), and
// enforces GitOps ownership: an api writer cannot edit a gitops-owned agent, but
// the reconciler (managedBy="gitops") may adopt/edit any.
func Persist(ctx context.Context, client *ent.Client, owner *ent.User, comp agentspec.Compiled, raw []byte, sourceFormat, managedBy string) (PersistResult, error) {
	hash, err := agentspec.ContentHash(comp)
	if err != nil {
		return PersistResult{}, err
	}
	limitsJSON, _ := json.Marshal(SpecLimits{
		MaxTurnsPerSession:    comp.Limits.MaxTurns,
		MaxLLMCallsPerSession: comp.Limits.MaxLLMCalls,
		MaxToolCallsPerTurn:   comp.Limits.MaxToolCalls,
	})
	toolsJSON, _ := json.Marshal(comp.Tools)
	channelsJSON, _ := json.Marshal(comp.Channels)

	existing, qerr := client.AgentDefinition.Query().
		Where(agentdefinition.SlugEQ(comp.Slug), agentdefinition.HasUserWith(user.IDEQ(owner.ID))).
		Only(ctx)
	if ent.IsNotFound(qerr) {
		row, cerr := client.AgentDefinition.Create().
			SetUser(owner).SetSlug(comp.Slug).SetName(comp.Name).
			SetInstructions(comp.Instructions).SetModel(comp.Model).SetProvider(comp.Provider).
			SetEnabledTools(comp.EnabledTools).SetSubagentRefs(comp.Subagents).SetConnectorReqs(comp.ConnectorReqs).
			SetLimitsJSON(string(limitsJSON)).SetToolsJSON(string(toolsJSON)).SetChannelBindings(string(channelsJSON)).
			SetSource(SourceTenant).SetSourceFormat(sourceFormat).SetRawSource(string(raw)).
			SetContentHash(hash).SetManagedBy(managedBy).SetRevision(1).
			SetAgentSyncState("current").
			Save(ctx)
		if cerr != nil {
			return PersistResult{}, cerr
		}
		return PersistResult{Row: row, Created: true}, nil
	}
	if qerr != nil {
		return PersistResult{}, qerr
	}
	if existing.ManagedBy == "gitops" && managedBy != "gitops" {
		return PersistResult{}, ErrManagedByGitops
	}
	if existing.ContentHash == hash && existing.ManagedBy == managedBy {
		// Content already matches the declared state. If only the sync-state
		// drifted (e.g. a prior failed reconcile), repair it without a revision
		// bump; otherwise it is a clean no-op.
		if existing.AgentSyncState != "current" {
			row, rerr := client.AgentDefinition.UpdateOneID(existing.ID).
				SetAgentSyncState("current").ClearAgentSyncError().Save(ctx)
			if rerr != nil {
				return PersistResult{}, rerr
			}
			return PersistResult{Row: row, NoOp: true}, nil
		}
		return PersistResult{Row: existing, NoOp: true}, nil
	}
	// Concrete revision (not AddRevision's atomic increment) so the enthistory
	// row carries the correct post-update revision for /revisions + rollback.
	row, uerr := client.AgentDefinition.UpdateOneID(existing.ID).
		SetName(comp.Name).SetInstructions(comp.Instructions).SetModel(comp.Model).SetProvider(comp.Provider).
		SetEnabledTools(comp.EnabledTools).SetSubagentRefs(comp.Subagents).SetConnectorReqs(comp.ConnectorReqs).
		SetLimitsJSON(string(limitsJSON)).SetToolsJSON(string(toolsJSON)).SetChannelBindings(string(channelsJSON)).
		SetSourceFormat(sourceFormat).SetRawSource(string(raw)).SetContentHash(hash).SetManagedBy(managedBy).
		SetRevision(existing.Revision + 1).
		SetAgentSyncState("current").ClearAgentSyncError().
		Save(ctx)
	if uerr != nil {
		return PersistResult{}, uerr
	}
	return PersistResult{Row: row}, nil
}
