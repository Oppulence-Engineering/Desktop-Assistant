package backgroundtasks

import (
	"encoding/json"
	"net/http"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/go-chi/chi/v5"
)

type taskTemplate struct {
	Slug               string
	TaskSlug           string
	Name               string
	Description        string
	Instructions       string
	Active             bool
	Triggers           json.RawMessage
	Model              string
	Provider           string
	ExecutionTarget    string
	Tags               []string
	RequiredConnectors []string
}

type taskTemplateView struct {
	Slug               string          `json:"slug"`
	TaskSlug           string          `json:"taskSlug"`
	Name               string          `json:"name"`
	Description        string          `json:"description"`
	Instructions       string          `json:"instructions"`
	Active             bool            `json:"active"`
	Triggers           json.RawMessage `json:"triggers,omitempty"`
	Model              string          `json:"model,omitempty"`
	Provider           string          `json:"provider,omitempty"`
	ExecutionTarget    string          `json:"executionTarget"`
	Tags               []string        `json:"tags,omitempty"`
	RequiredConnectors []string        `json:"requiredConnectors,omitempty"`
}

type instantiateTemplateRequest struct {
	Slug            string          `json:"slug"`
	Name            string          `json:"name"`
	Active          *bool           `json:"active"`
	Triggers        json.RawMessage `json:"triggers"`
	Model           string          `json:"model"`
	Provider        string          `json:"provider"`
	ExecutionTarget string          `json:"executionTarget"`
}

var builtInTaskTemplates = []taskTemplate{
	{
		Slug:               "inbox-digest",
		TaskSlug:           "inbox-digest",
		Name:               "Inbox Digest",
		Description:        "Summarize new priority email and produce a short follow-up plan.",
		Instructions:       "Review recent important Gmail messages, group them by account or topic, call out deadlines and blockers, and produce a markdown digest with concrete next actions.",
		Active:             true,
		Triggers:           mustTemplateJSON(`{"cronExpr":"0 8 * * 1-5","timezone":"America/New_York"}`),
		Model:              "anthropic/claude-sonnet-4-5",
		Provider:           "openrouter",
		ExecutionTarget:    "api",
		Tags:               []string{"gmail", "digest", "scheduled"},
		RequiredConnectors: []string{"google"},
	},
	{
		Slug:               "calendar-followups",
		TaskSlug:           "calendar-followups",
		Name:               "Calendar Follow-ups",
		Description:        "Turn recent meetings into follow-up notes, owners, and next steps.",
		Instructions:       "Inspect recent Google Calendar events and available notes, identify promised follow-ups, draft concise owner/action/deadline bullets, and highlight unresolved decisions.",
		Active:             true,
		Triggers:           mustTemplateJSON(`{"cronExpr":"0 17 * * 1-5","timezone":"America/New_York"}`),
		Model:              "anthropic/claude-sonnet-4-5",
		Provider:           "openrouter",
		ExecutionTarget:    "api",
		Tags:               []string{"calendar", "follow-up", "scheduled"},
		RequiredConnectors: []string{"google"},
	},
	{
		Slug:            "event-triage",
		TaskSlug:        "event-triage",
		Name:            "Event Triage",
		Description:     "Route inbound provider/webhook events into an actionable incident or support digest.",
		Instructions:    "For trigger=event runs, summarize the event payload, identify affected customers or systems, rate urgency, and recommend the next response. Include links or external ids when present.",
		Active:          true,
		Triggers:        mustTemplateJSON(`{"events":{"sources":["github","linear","stripe","webhook"],"eventTypes":["*"]}}`),
		Model:           "anthropic/claude-sonnet-4-5",
		Provider:        "openrouter",
		ExecutionTarget: "api",
		Tags:            []string{"event", "webhook", "triage"},
	},
	{
		Slug:            "data-report",
		TaskSlug:        "data-report",
		Name:            "Data Report",
		Description:     "Run sandboxed analysis and publish a markdown report artifact.",
		Instructions:    "Use sandbox.run for bounded code or data analysis when needed. Generate a concise markdown report with inputs, method, key findings, and any attached artifact references.",
		Active:          true,
		Triggers:        mustTemplateJSON(`{"manual":true}`),
		Model:           "anthropic/claude-sonnet-4-5",
		Provider:        "openrouter",
		ExecutionTarget: "api",
		Tags:            []string{"sandbox", "report", "manual"},
	},
}

func mustTemplateJSON(s string) json.RawMessage {
	raw := json.RawMessage(s)
	if !json.Valid(raw) {
		panic("invalid built-in task template JSON")
	}
	return raw
}

// ListTemplates handles GET /v1/background-task-templates.
func (h *Handler) ListTemplates(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserFromCtx(r.Context()); !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	views := make([]taskTemplateView, 0, len(builtInTaskTemplates))
	for _, tpl := range builtInTaskTemplates {
		views = append(views, viewTaskTemplate(tpl))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"templates": views})
}

// GetTemplate handles GET /v1/background-task-templates/{templateSlug}.
func (h *Handler) GetTemplate(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserFromCtx(r.Context()); !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	tpl, ok := findTaskTemplate(chi.URLParam(r, "templateSlug"))
	if !ok {
		httpx.Error(w, http.StatusNotFound, "background task template not found", "not_found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, viewTaskTemplate(tpl))
}

// InstantiateTemplate handles POST /v1/background-task-templates/{templateSlug}/instantiate.
func (h *Handler) InstantiateTemplate(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	tpl, ok := findTaskTemplate(chi.URLParam(r, "templateSlug"))
	if !ok {
		httpx.Error(w, http.StatusNotFound, "background task template not found", "not_found")
		return
	}
	var req instantiateTemplateRequest
	if r.Body != nil && r.ContentLength != 0 {
		if !readJSON(w, r, &req) {
			return
		}
	}
	task, err := h.createTaskFromRequest(r.Context(), u, tpl.createRequest(req))
	if err != nil {
		h.writeTaskCreateError(w, err, "instantiate background task template")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, viewTask(task))
}

func findTaskTemplate(slug string) (taskTemplate, bool) {
	for _, tpl := range builtInTaskTemplates {
		if tpl.Slug == slug {
			return tpl, true
		}
	}
	return taskTemplate{}, false
}

func (tpl taskTemplate) createRequest(override instantiateTemplateRequest) createTaskRequest {
	active := tpl.Active
	if override.Active != nil {
		active = *override.Active
	}
	req := createTaskRequest{
		Slug:            tpl.TaskSlug,
		Name:            tpl.Name,
		Instructions:    tpl.Instructions,
		Active:          &active,
		Triggers:        append(json.RawMessage(nil), tpl.Triggers...),
		Model:           tpl.Model,
		Provider:        tpl.Provider,
		ExecutionTarget: tpl.ExecutionTarget,
	}
	if override.Slug != "" {
		req.Slug = override.Slug
	}
	if override.Name != "" {
		req.Name = override.Name
	}
	if len(override.Triggers) > 0 {
		req.Triggers = append(json.RawMessage(nil), override.Triggers...)
	}
	if override.Model != "" {
		req.Model = override.Model
	}
	if override.Provider != "" {
		req.Provider = override.Provider
	}
	if override.ExecutionTarget != "" {
		req.ExecutionTarget = override.ExecutionTarget
	}
	return req
}

func viewTaskTemplate(tpl taskTemplate) taskTemplateView {
	return taskTemplateView{
		Slug:               tpl.Slug,
		TaskSlug:           tpl.TaskSlug,
		Name:               tpl.Name,
		Description:        tpl.Description,
		Instructions:       tpl.Instructions,
		Active:             tpl.Active,
		Triggers:           append(json.RawMessage(nil), tpl.Triggers...),
		Model:              tpl.Model,
		Provider:           tpl.Provider,
		ExecutionTarget:    tpl.ExecutionTarget,
		Tags:               append([]string(nil), tpl.Tags...),
		RequiredConnectors: append([]string(nil), tpl.RequiredConnectors...),
	}
}
