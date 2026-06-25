package agentgitops

import (
	"context"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentdefinition"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentregistry"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/appconfig"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/db"
	"go.uber.org/zap"
)

func setup(t *testing.T) (*Reconciler, *ent.Client, *ent.User) {
	t.Helper()
	d, err := db.Open(context.Background(), appconfig.Config{
		DatabaseURL: "file:" + t.Name() + "?mode=memory&cache=shared&_pragma=foreign_keys(1)",
		AutoMigrate: true,
	}, zap.NewNop())
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	u := d.Client.User.Create().SetEmail("a@x.co").SetWorkosUserID("user_1").SaveX(context.Background())
	loader, _ := agentregistry.NewLoader(d.Client, agentregistry.DefaultCatalog())
	return New(d.Client, loader, agentregistry.Policy{}, zap.NewNop()), d.Client, u
}

func agentYAML(slug, instructions string, subagents ...string) []byte {
	y := "apiVersion: agent.rowboat.dev/v1\nkind: Agent\nmetadata: {slug: " + slug + ", name: " + slug + "}\nspec:\n  instructions: \"" + instructions + "\"\n  tools: [echo]\n"
	if len(subagents) > 0 {
		y += "  subagents: ["
		for i, s := range subagents {
			if i > 0 {
				y += ", "
			}
			y += s
		}
		y += "]\n"
	}
	return []byte(y)
}

func outcomes(res Result) map[string]string {
	m := map[string]string{}
	for _, o := range res.Outcomes {
		m[o.Slug] = o.Action
	}
	return m
}

// TestReconcileCreateThenUnchanged is the basic GitOps pass: a declared agent is
// created, and re-running with the same source is a no-op.
func TestReconcileCreateThenUnchanged(t *testing.T) {
	r, client, u := setup(t)
	ctx := context.Background()
	declared := []DeclaredAgent{{Slug: "collections", Raw: agentYAML("collections", "Collect.")}}

	res, err := r.ReconcileOnce(ctx, u, declared)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if outcomes(res)["collections"] != "created" {
		t.Fatalf("first reconcile = %v, want created", outcomes(res))
	}
	row := client.AgentDefinition.Query().Where(agentdefinition.SlugEQ("collections")).OnlyX(auth.WithUser(ctx, u))
	if row.ManagedBy != "gitops" || row.AgentSyncState != "current" {
		t.Fatalf("row not gitops/current: %+v", row)
	}

	res2, _ := r.ReconcileOnce(ctx, u, declared)
	if outcomes(res2)["collections"] != "unchanged" {
		t.Fatalf("second reconcile = %v, want unchanged", outcomes(res2))
	}
}

// TestReconcileRepairsDrift is the P4 gate: induced drift (a direct edit to the
// persisted content) is repaired back to the declared state, sync_state→current.
func TestReconcileRepairsDrift(t *testing.T) {
	r, client, u := setup(t)
	ctx := context.Background()
	declared := []DeclaredAgent{{Slug: "collections", Raw: agentYAML("collections", "Declared instructions.")}}
	if _, err := r.ReconcileOnce(ctx, u, declared); err != nil {
		t.Fatalf("seed reconcile: %v", err)
	}
	scoped := auth.WithUser(ctx, u)
	row := client.AgentDefinition.Query().Where(agentdefinition.SlugEQ("collections")).OnlyX(scoped)
	declaredHash := row.ContentHash

	// Induce drift directly (bypassing the API gitops guard).
	client.AgentDefinition.UpdateOneID(row.ID).
		SetInstructions("DRIFTED out of band").SetContentHash("driftedhash").SetAgentSyncState("out_of_sync").
		ExecX(auth.WithInternal(ctx))

	res, err := r.ReconcileOnce(ctx, u, declared)
	if err != nil {
		t.Fatalf("repair reconcile: %v", err)
	}
	if act := outcomes(res)["collections"]; act != "updated" {
		t.Fatalf("drift repair action = %q, want updated", act)
	}
	repaired := client.AgentDefinition.Query().Where(agentdefinition.SlugEQ("collections")).OnlyX(scoped)
	if repaired.ContentHash != declaredHash || repaired.AgentSyncState != "current" {
		t.Fatalf("drift not repaired: hash=%s (want %s) state=%s", repaired.ContentHash, declaredHash, repaired.AgentSyncState)
	}
	if repaired.Instructions != "Declared instructions." {
		t.Fatalf("declared content not restored: %q", repaired.Instructions)
	}
}

// TestReconcileFlagsRemoved confirms a gitops agent dropped from the repo is
// flagged out_of_sync (not deleted in v1).
func TestReconcileFlagsRemoved(t *testing.T) {
	r, client, u := setup(t)
	ctx := context.Background()
	if _, err := r.ReconcileOnce(ctx, u, []DeclaredAgent{{Slug: "temp", Raw: agentYAML("temp", "x")}}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	// Reconcile with an empty declared set → temp is removed from the repo.
	res, _ := r.ReconcileOnce(ctx, u, nil)
	if outcomes(res)["temp"] != "out_of_sync" {
		t.Fatalf("removed agent action = %v, want out_of_sync", outcomes(res))
	}
	row := client.AgentDefinition.Query().Where(agentdefinition.SlugEQ("temp")).OnlyX(auth.WithUser(ctx, u))
	if row.AgentSyncState != "out_of_sync" {
		t.Fatalf("removed agent sync_state = %q, want out_of_sync", row.AgentSyncState)
	}
}

// TestReconcileRejectsCycle confirms cross-agent subagent cycles fail both agents.
func TestReconcileRejectsCycle(t *testing.T) {
	r, _, u := setup(t)
	ctx := context.Background()
	declared := []DeclaredAgent{
		{Slug: "a", Raw: agentYAML("a", "A", "b")},
		{Slug: "b", Raw: agentYAML("b", "B", "a")},
	}
	res, _ := r.ReconcileOnce(ctx, u, declared)
	o := outcomes(res)
	if o["a"] != "failed" || o["b"] != "failed" {
		t.Fatalf("cycle should fail both agents, got %v", o)
	}
}

// TestReconcileFailsInvalidTool records a per-agent failure for an unknown tool.
func TestReconcileFailsInvalidTool(t *testing.T) {
	r, _, u := setup(t)
	ctx := context.Background()
	bad := []byte("apiVersion: agent.rowboat.dev/v1\nkind: Agent\nmetadata: {slug: bad, name: bad}\nspec:\n  tools: [shell]\n")
	res, _ := r.ReconcileOnce(ctx, u, []DeclaredAgent{{Slug: "bad", Raw: bad}})
	if outcomes(res)["bad"] != "failed" {
		t.Fatalf("invalid-tool agent should fail, got %v", outcomes(res))
	}
}
