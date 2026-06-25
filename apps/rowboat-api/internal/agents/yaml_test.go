package agents

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentdefinition"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
)

const yamlAgent = `apiVersion: agent.rowboat.dev/v1
kind: Agent
metadata: {slug: helper, name: Helper}
spec:
  instructions: "Be helpful."
  tools: [echo, current_time]
`

func putYAML(t *testing.T, h *Handler, u *ent.User, slug, body string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("PUT", "/v1/agents/"+slug, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/yaml")
	req = withURLParam(req.WithContext(auth.WithUser(context.Background(), u)), "slug", slug)
	h.PutAgent(rec, req)
	return rec
}

func revisionOf(t *testing.T, h *Handler, u *ent.User, slug string) int {
	t.Helper()
	row := h.client.AgentDefinition.Query().Where(agentdefinition.SlugEQ(slug)).OnlyX(auth.WithUser(context.Background(), u))
	return row.Revision
}

// TestPutAgentApplyIdempotentAndRevision is the P1 gate: apply YAML (no
// redeploy), re-apply is a content-hash no-op, a change bumps the revision.
func TestPutAgentApplyIdempotentAndRevision(t *testing.T) {
	h, u := setupHandler(t)

	if rec := putYAML(t, h, u, "helper", yamlAgent); rec.Code != 201 {
		t.Fatalf("first apply = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	if r := revisionOf(t, h, u, "helper"); r != 1 {
		t.Fatalf("revision after create = %d, want 1", r)
	}
	// Re-apply identical → idempotent no-op (200, revision unchanged).
	if rec := putYAML(t, h, u, "helper", yamlAgent); rec.Code != 200 {
		t.Fatalf("idempotent re-apply = %d, want 200", rec.Code)
	}
	if r := revisionOf(t, h, u, "helper"); r != 1 {
		t.Fatalf("revision after no-op re-apply = %d, want 1 (unchanged)", r)
	}
	// A change bumps the revision.
	changed := strings.Replace(yamlAgent, "Be helpful.", "Be very helpful.", 1)
	if rec := putYAML(t, h, u, "helper", changed); rec.Code != 200 {
		t.Fatalf("changed apply = %d, want 200", rec.Code)
	}
	if r := revisionOf(t, h, u, "helper"); r != 2 {
		t.Fatalf("revision after change = %d, want 2", r)
	}
}

func TestPutAgentRejectsUnknownTool(t *testing.T) {
	h, u := setupHandler(t)
	bad := strings.Replace(yamlAgent, "[echo, current_time]", "[echo, shell]", 1)
	rec := putYAML(t, h, u, "helper", bad)
	if rec.Code != 400 || !strings.Contains(rec.Body.String(), "tool_not_registered") {
		t.Fatalf("expected 400 tool_not_registered, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPutAgentSlugMismatch(t *testing.T) {
	h, u := setupHandler(t)
	rec := putYAML(t, h, u, "different", yamlAgent) // body slug=helper, path=different
	if rec.Code != 400 || !strings.Contains(rec.Body.String(), "slug_mismatch") {
		t.Fatalf("expected 400 slug_mismatch, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestValidateAgentDryRun confirms the dry-run validates without persisting.
func TestValidateAgentDryRun(t *testing.T) {
	h, u := setupHandler(t)
	ctx := auth.WithUser(context.Background(), u)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/v1/agents/validate", strings.NewReader(yamlAgent)).WithContext(ctx)
	req.Header.Set("Content-Type", "application/yaml")
	h.ValidateAgent(rec, req)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"valid":true`) {
		t.Fatalf("valid dry-run = %d: %s", rec.Code, rec.Body.String())
	}
	// Nothing persisted.
	if n := h.client.AgentDefinition.Query().CountX(ctx); n != 0 {
		t.Fatalf("validate must not persist; found %d rows", n)
	}
	// Invalid → 400 valid:false.
	rec = httptest.NewRecorder()
	bad := strings.Replace(yamlAgent, "[echo, current_time]", "[shell]", 1)
	req = httptest.NewRequest("POST", "/v1/agents/validate", strings.NewReader(bad)).WithContext(ctx)
	h.ValidateAgent(rec, req)
	if rec.Code != 400 || !strings.Contains(rec.Body.String(), `"valid":false`) {
		t.Fatalf("invalid dry-run = %d: %s", rec.Code, rec.Body.String())
	}
}

// TestGetAgentYAMLRoundTrip applies YAML and reads it back as YAML.
func TestGetAgentYAMLRoundTrip(t *testing.T) {
	h, u := setupHandler(t)
	putYAML(t, h, u, "helper", yamlAgent)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/v1/agents/helper?format=yaml", nil).WithContext(auth.WithUser(context.Background(), u))
	req = withURLParam(req, "slug", "helper")
	h.GetAgent(rec, req)
	if rec.Code != 200 {
		t.Fatalf("get yaml = %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/yaml" {
		t.Fatalf("content-type = %q, want application/yaml", ct)
	}
	if !strings.Contains(rec.Body.String(), "slug: helper") {
		t.Fatalf("round-trip yaml missing slug: %s", rec.Body.String())
	}
}

// TestRevisionsAndRollback applies two revisions, lists them, and rolls back.
func TestRevisionsAndRollback(t *testing.T) {
	h, u := setupHandler(t)
	ctx := auth.WithUser(context.Background(), u)
	putYAML(t, h, u, "helper", yamlAgent)
	putYAML(t, h, u, "helper", strings.Replace(yamlAgent, "Be helpful.", "v2 instructions.", 1))

	// List revisions.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/v1/agents/helper/revisions", nil).WithContext(ctx)
	req = withURLParam(req, "slug", "helper")
	h.ListRevisions(rec, req)
	if rec.Code != 200 {
		t.Fatalf("list revisions = %d: %s", rec.Code, rec.Body.String())
	}
	var listResp struct {
		Revisions []struct {
			Revision int `json:"revision"`
		} `json:"revisions"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &listResp)
	if len(listResp.Revisions) == 0 {
		t.Fatalf("expected revision history rows, got %s", rec.Body.String())
	}

	// Roll back to revision 1.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest("POST", "/v1/agents/helper/rollback", strings.NewReader(`{"revision":1}`)).WithContext(ctx)
	req = withURLParam(req, "slug", "helper")
	h.RollbackAgent(rec, req)
	if rec.Code != 200 {
		t.Fatalf("rollback = %d: %s", rec.Code, rec.Body.String())
	}
	// Rollback re-applies v1's content as a NEW revision (≥3) and restores its instructions.
	row := h.client.AgentDefinition.Query().Where(agentdefinition.SlugEQ("helper")).OnlyX(ctx)
	if row.Revision < 3 {
		t.Fatalf("rollback should create a new revision; got %d", row.Revision)
	}
	if !strings.Contains(row.Instructions, "Be helpful.") {
		t.Fatalf("rollback did not restore v1 instructions: %q", row.Instructions)
	}
}

// TestPutAgentGitopsBlocked confirms a managed_by=gitops agent rejects API edits.
func TestPutAgentGitopsBlocked(t *testing.T) {
	h, u := setupHandler(t)
	ctx := auth.WithUser(context.Background(), u)
	h.client.AgentDefinition.Create().
		SetUser(u).SetSlug("helper").SetName("Helper").SetEnabledTools([]string{"echo"}).
		SetSource("tenant").SetManagedBy("gitops").SetContentHash("seed").SaveX(ctx)

	rec := putYAML(t, h, u, "helper", yamlAgent)
	if rec.Code != 409 || !strings.Contains(rec.Body.String(), "managed_by_gitops") {
		t.Fatalf("expected 409 managed_by_gitops, got %d: %s", rec.Code, rec.Body.String())
	}
}
