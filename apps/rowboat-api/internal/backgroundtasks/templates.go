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
	Version            int
	FirstParty         bool
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
	Version            int             `json:"version"`
	FirstParty         bool            `json:"firstParty"`
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
		Slug:            "relationship-refresh",
		TaskSlug:        "oppulence-relationship-refresh",
		Name:            "Relationship Refresh",
		Description:     "Continuously summarize relationship state, evidence freshness, commitments, and material changes.",
		Instructions:    "Use relationship.read with view=portfolio and run_history.read. Compare current versioned relationship state with the prior run, identify only material changes, cite relationship and evidence references returned by the tool, and write a concise markdown portfolio refresh. Never invent evidence or execute an external action.",
		Active:          true,
		Triggers:        mustTemplateJSON(`{"cronExpr":"*/15 * * * *","timezone":"UTC"}`),
		ExecutionTarget: "api",
		Tags:            []string{"first-party", "relationships", "evidence", "scheduled"},
		Version:         1,
		FirstParty:      true,
	},
	{
		Slug:            "attention-monitor",
		TaskSlug:        "oppulence-attention-monitor",
		Name:            "Attention Monitor",
		Description:     "Explain which relationships need attention now and why.",
		Instructions:    "Use relationship.read with view=attention and run_history.read. Rank open attention items by urgency and score, explain the deterministic reason and freshness, cite every triggering object and evidence reference, and write an operator-ready markdown brief. Recommend review actions only; do not perform external actions.",
		Active:          true,
		Triggers:        mustTemplateJSON(`{"cronExpr":"0 8 * * *","timezone":"America/New_York"}`),
		ExecutionTarget: "api",
		Tags:            []string{"first-party", "attention", "risk", "scheduled"},
		Version:         1,
		FirstParty:      true,
	},
	{
		Slug:               "meeting-pre-brief",
		TaskSlug:           "oppulence-meeting-pre-brief",
		Name:               "Meeting Pre-Brief",
		Description:        "Prepare evidence-linked context, commitments, risks, and goals for upcoming customer meetings.",
		Instructions:       "Use connector.read.calendar for upcoming meetings, relationship.read with view=portfolio for matching customer context, and run_history.read. For meetings in the next 24 hours, write a concise brief with participants, relationship health, open commitments, risks, last material change, desired outcome, and evidence references. If no relevant meeting exists, record that clearly. Do not contact participants.",
		Active:             true,
		Triggers:           mustTemplateJSON(`{"cronExpr":"*/30 * * * *","timezone":"UTC"}`),
		ExecutionTarget:    "api",
		Tags:               []string{"first-party", "meeting", "brief", "scheduled"},
		RequiredConnectors: []string{"google"},
		Version:            1,
		FirstParty:         true,
	},
	{
		Slug:               "post-meeting-processor",
		TaskSlug:           "oppulence-post-meeting-processor",
		Name:               "Post-Meeting Processor",
		Description:        "Turn completed meetings and transcripts into evidence-linked commitments, risks, and approval-ready follow-ups.",
		Instructions:       "Use event.read when event-triggered, connector.read.calendar for recently completed meetings, relationship.read with view=portfolio, and run_history.read. Produce a markdown meeting record containing decisions, commitments with owners and dates, risks, unresolved questions, relationship changes, and draft follow-up recommendations. Cite source references. Any outward action must remain a proposal requiring human approval.",
		Active:             true,
		Triggers:           mustTemplateJSON(`{"cronExpr":"*/15 * * * *","timezone":"UTC","events":{"sources":["google"],"eventTypes":["resource.exists","resource.update"]}}`),
		ExecutionTarget:    "api",
		Tags:               []string{"first-party", "meeting", "transcript", "event", "scheduled"},
		RequiredConnectors: []string{"google"},
		Version:            1,
		FirstParty:         true,
	},
	{
		Slug:            "recommendation-review",
		TaskSlug:        "oppulence-recommendation-review",
		Name:            "Recommendation Review",
		Description:     "Assemble pending recommendations into a transparent, approval-ready review queue.",
		Instructions:    "Use relationship.read with view=recommendations and run_history.read. Group pending recommendations by relationship, show priority, reason, revision, policy and approval state, flag stale or conflicting evidence, and write a review brief. Never approve, reject, or execute on the user's behalf.",
		Active:          true,
		Triggers:        mustTemplateJSON(`{"cronExpr":"0 9 * * 1-5","timezone":"America/New_York"}`),
		ExecutionTarget: "api",
		Tags:            []string{"first-party", "recommendations", "approval", "scheduled"},
		Version:         1,
		FirstParty:      true,
	},
	{
		Slug:               "connector-health-repair",
		TaskSlug:           "oppulence-connector-health-repair",
		Name:               "Connector Health and Repair",
		Description:        "Monitor source freshness, scopes, retries, and backfill progress with actionable repair guidance.",
		Instructions:       "Use relationship.read with view=sources and run_history.read. Report each connector's authorization, freshness, completeness, missing scopes, retry state, lag, and backfill progress. Separate transient retries from reconnect-required failures and write safe operator repair steps. Never request or expose secrets and never reconnect a provider automatically.",
		Active:             true,
		Triggers:           mustTemplateJSON(`{"cronExpr":"*/30 * * * *","timezone":"UTC","events":{"sources":["google","slack","hubspot"],"eventTypes":["*"]}}`),
		ExecutionTarget:    "api",
		Tags:               []string{"first-party", "connectors", "health", "repair", "scheduled"},
		RequiredConnectors: []string{"google", "slack", "hubspot"},
		Version:            1,
		FirstParty:         true,
	},
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
	if tpl.FirstParty {
		httpx.Error(w, http.StatusBadRequest, "first-party workflows are provisioned through /v1/background-tasks/first-party/ensure", "bad_request")
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

func isFirstPartyTaskSlug(slug string) bool {
	for _, tpl := range builtInTaskTemplates {
		if tpl.FirstParty && tpl.TaskSlug == slug {
			return true
		}
	}
	return false
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
		Version:            max(tpl.Version, 1),
		FirstParty:         tpl.FirstParty,
	}
}
