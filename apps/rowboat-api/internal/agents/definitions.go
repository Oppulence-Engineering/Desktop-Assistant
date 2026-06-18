package agents

import (
	"encoding/json"
	"net/http"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/agentdefinition"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentregistry"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/agentworkflow"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

type agentView struct {
	Slug          string                   `json:"slug"`
	Name          string                   `json:"name"`
	Source        string                   `json:"source"`
	Instructions  string                   `json:"instructions,omitempty"`
	Model         string                   `json:"model,omitempty"`
	Provider      string                   `json:"provider,omitempty"`
	EnabledTools  []string                 `json:"enabledTools"`
	SubagentRefs  []string                 `json:"subagentRefs,omitempty"`
	ConnectorReqs []string                 `json:"connectorReqs,omitempty"`
	Limits        agentregistry.SpecLimits `json:"limits,omitempty"`
}

func viewSpec(s *agentregistry.Spec) agentView {
	return agentView{
		Slug: s.Slug, Name: s.Name, Source: s.Source, Instructions: s.Instructions,
		Model: s.Model, Provider: s.Provider, EnabledTools: nonNilStrings(s.EnabledTools),
		SubagentRefs: s.SubagentRefs, ConnectorReqs: s.ConnectorReqs, Limits: s.Limits,
	}
}

type createAgentRequest struct {
	Slug          string                   `json:"slug"`
	Name          string                   `json:"name"`
	Instructions  string                   `json:"instructions"`
	Model         string                   `json:"model"`
	Provider      string                   `json:"provider"`
	EnabledTools  []string                 `json:"enabledTools"`
	SubagentRefs  []string                 `json:"subagentRefs"`
	ConnectorReqs []string                 `json:"connectorReqs"`
	ForkedFrom    string                   `json:"forkedFrom"`
	Limits        agentregistry.SpecLimits `json:"limits"`
}

// ListAgents handles GET /v1/agents — tenant definitions plus the read-only
// embedded built-ins available to fork.
func (h *Handler) ListAgents(w http.ResponseWriter, r *http.Request) {
	rows, err := h.client.AgentDefinition.Query().Order(agentdefinition.BySlug()).All(r.Context())
	if err != nil {
		h.log.Error("list agent definitions", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not list agents", "internal_error")
		return
	}
	views := make([]agentView, 0, len(rows)+2)
	seen := map[string]struct{}{}
	for _, row := range rows {
		spec := specFromRow(row)
		views = append(views, viewSpec(spec))
		seen[row.Slug] = struct{}{}
	}
	for _, b := range h.loader.Builtins() {
		if _, shadowed := seen[b.Slug]; shadowed {
			continue // a tenant agent of the same slug overrides the built-in
		}
		views = append(views, viewSpec(b))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"agents": views})
}

// CreateAgent handles POST /v1/agents — create a tenant AgentDefinition whose
// tool allowlist is validated by name against the capability registry
// (deny-by-default: an unknown tool is a 400, never a silent runtime denial).
func (h *Handler) CreateAgent(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	var req createAgentRequest
	if !httpx.DecodeJSON(w, r, maxBody, &req) {
		return
	}
	if req.Slug == "" || req.Name == "" {
		httpx.Error(w, http.StatusBadRequest, "slug and name are required", "bad_request")
		return
	}
	if err := h.loader.Catalog().Validate(req.EnabledTools); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "unknown_tool")
		return
	}
	limitsJSON, err := json.Marshal(req.Limits)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid limits", "bad_request")
		return
	}
	create := h.client.AgentDefinition.Create().
		SetUser(u).
		SetSlug(req.Slug).
		SetName(req.Name).
		SetInstructions(req.Instructions).
		SetModel(req.Model).
		SetProvider(req.Provider).
		SetEnabledTools(req.EnabledTools).
		SetSubagentRefs(req.SubagentRefs).
		SetConnectorReqs(req.ConnectorReqs).
		SetLimitsJSON(string(limitsJSON)).
		SetSource(agentregistry.SourceTenant)
	if req.ForkedFrom != "" {
		create = create.SetForkedFrom(req.ForkedFrom)
	}
	row, err := create.Save(r.Context())
	if err != nil {
		if ent.IsConstraintError(err) {
			httpx.Error(w, http.StatusConflict, "an agent with this slug already exists", "conflict")
			return
		}
		h.log.Error("create agent definition", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not create agent", "internal_error")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, viewSpec(specFromRow(row)))
}

// GetAgent handles GET /v1/agents/{slug} — resolves a tenant row or built-in.
func (h *Handler) GetAgent(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	spec, err := h.loader.Resolve(r.Context(), slug)
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "agent not found", "not_found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, viewSpec(spec))
}

// DeleteAgent handles DELETE /v1/agents/{slug} — removes a tenant row (built-ins
// cannot be deleted; the scoped query simply won't match one).
func (h *Handler) DeleteAgent(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	row, err := h.client.AgentDefinition.Query().Where(agentdefinition.SlugEQ(slug)).Only(r.Context())
	if err != nil {
		if ent.IsNotFound(err) {
			httpx.Error(w, http.StatusNotFound, "agent not found", "not_found")
			return
		}
		h.log.Error("lookup agent definition", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not load agent", "internal_error")
		return
	}
	if err := h.client.AgentDefinition.DeleteOneID(row.ID).Exec(auth.WithInternal(r.Context())); err != nil {
		h.log.Error("delete agent definition", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "could not delete agent", "internal_error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type scheduleRequest struct {
	Cron     string `json:"cron"`
	Input    string `json:"input"`
	Timezone string `json:"timezone"`
}

// CreateSchedule handles POST /v1/agents/{slug}/schedule — create a Temporal
// Schedule that starts a session for this agent on cron (RFC 027 P5).
func (h *Handler) CreateSchedule(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	if h.scheduler == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "scheduling unavailable", "temporal_unavailable")
		return
	}
	slug := chi.URLParam(r, "slug")
	if _, err := h.loader.Resolve(r.Context(), slug); err != nil {
		httpx.Error(w, http.StatusNotFound, "agent not found", "not_found")
		return
	}
	var req scheduleRequest
	if !httpx.DecodeJSON(w, r, maxBody, &req) {
		return
	}
	if req.Cron == "" {
		httpx.Error(w, http.StatusBadRequest, "cron is required", "bad_request")
		return
	}
	if err := h.scheduler.CreateSchedule(r.Context(), agentworkflow.ScheduleSpec{
		UserID: u.ID.String(), AgentSlug: slug, Input: req.Input, Cron: req.Cron, Timezone: req.Timezone,
	}); err != nil {
		h.log.Error("create agent session schedule", zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "could not create schedule", "schedule_failed")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"agent": slug, "cron": req.Cron})
}

// DeleteSchedule handles DELETE /v1/agents/{slug}/schedule.
func (h *Handler) DeleteSchedule(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	if h.scheduler == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "scheduling unavailable", "temporal_unavailable")
		return
	}
	slug := chi.URLParam(r, "slug")
	if err := h.scheduler.DeleteSchedule(r.Context(), u.ID.String(), slug); err != nil {
		h.log.Error("delete agent session schedule", zap.Error(err))
		httpx.Error(w, http.StatusBadGateway, "could not delete schedule", "schedule_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func specFromRow(row *ent.AgentDefinition) *agentregistry.Spec {
	spec := &agentregistry.Spec{
		Slug: row.Slug, Name: row.Name, Source: row.Source, Instructions: row.Instructions,
		Model: row.Model, Provider: row.Provider,
		EnabledTools: row.EnabledTools, SubagentRefs: row.SubagentRefs, ConnectorReqs: row.ConnectorReqs,
	}
	if row.LimitsJSON != "" {
		_ = json.Unmarshal([]byte(row.LimitsJSON), &spec.Limits)
	}
	return spec
}

func nonNilStrings(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
