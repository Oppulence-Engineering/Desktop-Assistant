package agents

import (
	"context"
	"errors"
	"net/http"
	"strings"

	entsql "entgo.io/ent/dialect/sql"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentdefinition"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentdefinitionhistory"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentgitops"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentregistry"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentspec"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	ghodss "github.com/ghodss/yaml"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// PutAgent handles PUT /v1/agents/{slug} — apply a declarative agent document
// (YAML or JSON) as a new revision (RFC 028). Decode → shared validation →
// content-hash idempotency → persist. A managed_by=gitops agent rejects API
// edits (git is authoritative).
func (h *Handler) PutAgent(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	slug := chi.URLParam(r, "slug")
	raw, ok := httpx.ReadBody(w, r, maxBody)
	if !ok {
		return
	}
	format := sourceFormat(r)
	comp, ferrs, decErr := h.compileAndValidate(r.Context(), raw)
	if decErr != "" {
		httpx.Error(w, http.StatusBadRequest, decErr, "invalid_document")
		return
	}
	if comp.Slug != slug {
		httpx.Error(w, http.StatusBadRequest, "metadata.slug does not match the URL", "slug_mismatch")
		return
	}
	if len(ferrs) > 0 {
		httpx.ErrorWith(w, http.StatusBadRequest, "agent definition is invalid", "validation_failed", map[string]any{"errors": ferrs})
		return
	}
	row, created, status, errCode := h.persistCompiled(r.Context(), u, comp, raw, format)
	if errCode != "" {
		writePersistError(w, status, errCode)
		return
	}
	code := http.StatusOK
	if created {
		code = http.StatusCreated
	}
	httpx.WriteJSON(w, code, viewSpec(specFromRow(row)))
}

// ValidateAgent handles POST /v1/agents/validate — the dry-run the CLI and CI
// use: decode + validate against the live registry/policy, persist nothing.
func (h *Handler) ValidateAgent(w http.ResponseWriter, r *http.Request) {
	raw, ok := httpx.ReadBody(w, r, maxBody)
	if !ok {
		return
	}
	comp, ferrs, decErr := h.compileAndValidate(r.Context(), raw)
	if decErr != "" {
		httpx.ErrorWith(w, http.StatusBadRequest, decErr, "invalid_document", map[string]any{"valid": false})
		return
	}
	if len(ferrs) > 0 {
		httpx.ErrorWith(w, http.StatusBadRequest, "agent definition is invalid", "validation_failed", map[string]any{"valid": false, "errors": ferrs})
		return
	}
	hash, _ := agentspec.ContentHash(comp)
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"valid": true, "slug": comp.Slug, "contentHash": hash})
}

// ListRevisions handles GET /v1/agents/{slug}/revisions — the revision history
// from the enthistory table.
func (h *Handler) ListRevisions(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	def, err := h.client.AgentDefinition.Query().Where(agentdefinition.SlugEQ(slug)).Only(r.Context())
	if err != nil {
		if ent.IsNotFound(err) {
			httpx.Error(w, http.StatusNotFound, "agent not found", "not_found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "could not load agent", "internal_error")
		return
	}
	rows, err := h.client.AgentDefinitionHistory.Query().
		Where(agentdefinitionhistory.Ref(def.ID)).
		Order(agentdefinitionhistory.ByHistoryTime(entsql.OrderDesc())).
		All(auth.WithInternal(r.Context()))
	if err != nil {
		h.log.Error("list agent revisions", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not list revisions", "internal_error")
		return
	}
	type revView struct {
		Revision    int    `json:"revision"`
		Operation   string `json:"operation"`
		ContentHash string `json:"contentHash,omitempty"`
		At          string `json:"at"`
	}
	views := make([]revView, 0, len(rows))
	for _, h := range rows {
		views = append(views, revView{
			Revision: h.Revision, Operation: string(h.Operation), ContentHash: h.ContentHash,
			At: h.HistoryTime.UTC().Format("2006-01-02T15:04:05Z"),
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"agent": slug, "revisions": views})
}

type rollbackRequest struct {
	Revision int `json:"revision"`
}

// RollbackAgent handles POST /v1/agents/{slug}/rollback — re-apply a prior
// revision's source as a NEW revision (RFC 028: rollback = re-apply).
func (h *Handler) RollbackAgent(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	slug := chi.URLParam(r, "slug")
	var req rollbackRequest
	if !httpx.DecodeJSON(w, r, maxBody, &req) {
		return
	}
	def, err := h.client.AgentDefinition.Query().Where(agentdefinition.SlugEQ(slug)).Only(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "agent not found", "not_found")
		return
	}
	hist, err := h.client.AgentDefinitionHistory.Query().
		Where(agentdefinitionhistory.Ref(def.ID), agentdefinitionhistory.Revision(req.Revision)).
		Order(agentdefinitionhistory.ByHistoryTime(entsql.OrderDesc())).
		First(auth.WithInternal(r.Context()))
	if err != nil || strings.TrimSpace(hist.RawSource) == "" {
		httpx.Error(w, http.StatusNotFound, "revision not found or has no recoverable source", "revision_not_found")
		return
	}
	raw := []byte(hist.RawSource)
	comp, ferrs, decErr := h.compileAndValidate(r.Context(), raw)
	if decErr != "" || len(ferrs) > 0 {
		httpx.ErrorWith(w, http.StatusBadRequest, "prior revision no longer validates", "validation_failed", map[string]any{"errors": ferrs})
		return
	}
	row, _, status, errCode := h.persistCompiled(r.Context(), u, comp, raw, hist.SourceFormat)
	if errCode != "" {
		writePersistError(w, status, errCode)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, viewSpec(specFromRow(row)))
}

type reconcileRequest struct {
	UserID string `json:"userId"`
	Agents []struct {
		Slug         string `json:"slug"`
		YAML         string `json:"yaml"`
		Instructions string `json:"instructions"`
	} `json:"agents"`
}

// ReconcileGitOps handles POST /v1/internal/agent-gitops/reconcile — a
// server-to-server (internal-secret) entry point for a git-sync sidecar/CI:
// apply a declared set of agent YAMLs for one owner, repairing drift (RFC 028 P4).
func (h *Handler) ReconcileGitOps(w http.ResponseWriter, r *http.Request) {
	if h.gitops == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "gitops is not enabled", "gitops_disabled")
		return
	}
	var req reconcileRequest
	if !httpx.DecodeJSON(w, r, maxBody, &req) {
		return
	}
	uid, perr := uuid.Parse(req.UserID)
	if perr != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid userId", "bad_request")
		return
	}
	owner, uerr := h.client.User.Get(auth.WithInternal(r.Context()), uid)
	if uerr != nil {
		httpx.Error(w, http.StatusNotFound, "user not found", "not_found")
		return
	}
	declared := make([]agentgitops.DeclaredAgent, 0, len(req.Agents))
	for _, a := range req.Agents {
		declared = append(declared, agentgitops.DeclaredAgent{Slug: a.Slug, Raw: []byte(a.YAML), Instructions: a.Instructions})
	}
	res, err := h.gitops.ReconcileOnce(r.Context(), owner, declared)
	if err != nil {
		h.log.Error("gitops reconcile", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "reconcile failed", "internal_error")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, res)
}

// --- shared helpers ----------------------------------------------------------

// compileAndValidate decodes + compiles a document and runs the shared semantic
// validation. decErr is non-empty on a decode/compile failure; ferrs holds
// per-field semantic errors.
func (h *Handler) compileAndValidate(ctx context.Context, raw []byte) (agentspec.Compiled, []agentregistry.FieldError, string) {
	doc, err := agentspec.Decode(raw)
	if err != nil {
		return agentspec.Compiled{}, nil, err.Error()
	}
	comp, err := agentspec.Compile(doc, "")
	if err != nil {
		return agentspec.Compiled{}, nil, err.Error()
	}
	known := func(s string) bool {
		_, rerr := h.loader.Resolve(ctx, s)
		return rerr == nil
	}
	return comp, h.loader.Catalog().ValidateCompiled(comp, h.policy, known), ""
}

// persistCompiled upserts the AgentDefinition via the shared registry upsert
// (content-hash idempotency, revision bump, managed_by=gitops edit-protection)
// and maps the outcome to an HTTP status. Returns (row, created, status, errCode).
func (h *Handler) persistCompiled(ctx context.Context, u *ent.User, comp agentspec.Compiled, raw []byte, format string) (*ent.AgentDefinition, bool, int, string) {
	res, err := agentregistry.Persist(ctx, h.client, u, comp, raw, format, "api")
	switch {
	case errors.Is(err, agentregistry.ErrManagedByGitops):
		return nil, false, http.StatusConflict, "managed_by_gitops"
	case ent.IsConstraintError(err):
		return nil, false, http.StatusConflict, "conflict"
	case err != nil:
		h.log.Error("persist agent definition", zap.Error(err))
		return nil, false, http.StatusInternalServerError, "internal_error"
	}
	if res.Created {
		return res.Row, true, http.StatusCreated, ""
	}
	return res.Row, false, http.StatusOK, ""
}

func writePersistError(w http.ResponseWriter, status int, code string) {
	switch code {
	case "managed_by_gitops":
		httpx.Error(w, http.StatusConflict, "this agent is managed by GitOps; edit it in git, not the API", code)
	case "conflict":
		httpx.Error(w, http.StatusConflict, "an agent with this slug already exists", code)
	default:
		httpx.Error(w, status, "could not apply agent definition", code)
	}
}

// sourceFormat classifies the request body format from Content-Type.
func sourceFormat(r *http.Request) string {
	ct := strings.ToLower(r.Header.Get("Content-Type"))
	if strings.Contains(ct, "yaml") {
		return "yaml"
	}
	return "json"
}

// renderYAML produces the canonical agent.yaml for a resolved spec — the raw
// source when it was YAML-authored, else a re-emitted canonical document.
func renderYAML(spec *agentregistry.Spec, raw string, format string) ([]byte, error) {
	if format == "yaml" && strings.TrimSpace(raw) != "" {
		return []byte(raw), nil
	}
	doc := agentspec.Document{
		APIVersion: agentspec.APIVersion,
		Kind:       agentspec.Kind,
		Metadata:   agentspec.Metadata{Slug: spec.Slug, Name: spec.Name},
		Spec: agentspec.Spec{
			Model: spec.Model, Provider: spec.Provider, Instructions: spec.Instructions,
			Subagents: spec.SubagentRefs, Channels: spec.Channels,
		},
	}
	for _, t := range spec.Tools {
		doc.Spec.Tools = append(doc.Spec.Tools, agentspec.Tool(t))
	}
	if len(spec.Tools) == 0 {
		for _, n := range spec.EnabledTools {
			doc.Spec.Tools = append(doc.Spec.Tools, agentspec.Tool{Name: n})
		}
	}
	for _, s := range spec.ConnectorReqs {
		doc.Spec.Connections = append(doc.Spec.Connections, agentspec.Connection{Scope: s})
	}
	return ghodss.Marshal(doc)
}
