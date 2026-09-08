package revenue

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
)

// Cloud research HTTP surface (RFC 039).
//
// Everything here is gated server-side. The desktop's own mode toggle is a
// display of this state, never the enforcement of it: the vendor key lives here,
// so the capability, plan and consent checks live here too.

// MountResearch registers the research endpoints.
func (h *Handler) MountResearch(r chi.Router) {
	r.Route("/v1/research", func(r chi.Router) {
		// Consent is readable and writable even when research is unconfigured or
		// the plan is wrong: a user must always be able to see and withdraw what
		// they agreed to, regardless of billing state.
		r.Get("/consent", h.CloudResearchConsent)
		r.Put("/consent", h.SetCloudResearchConsent)

		r.Get("/status", h.ResearchStatus)
		r.Get("/people/pending", h.PendingPersonEnrichment)
		r.Get("/people/estimate", h.PersonEnrichmentEstimate)
		r.Post("/people/{personId}", h.EnrichPerson)
		r.Post("/people", h.EnrichPersons)
		r.Get("/companies/pending", h.PendingCompanyEnrichment)
		r.Get("/companies/estimate", h.CompanyEnrichmentEstimate)
		r.Post("/companies/{relationshipId}", h.EnrichCompany)
		r.Post("/companies", h.EnrichCompanies)
		r.Post("/accounts/{relationshipId}/trigger", h.ResearchAccountTrigger)
	})
}

// CloudResearchConsent handles GET /v1/research/consent.
func (h *Handler) CloudResearchConsent(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	state, err := h.svc.CloudResearchConsent(r.Context(), u)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, state)
}

// SetCloudResearchConsent handles PUT /v1/research/consent.
func (h *Handler) SetCloudResearchConsent(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	var body struct {
		Consented bool `json:"consented"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	state, err := h.svc.SetCloudResearchConsent(r.Context(), u, body.Consented)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, state)
}

// researchStatusDTO is what the desktop needs to render the mode control
// honestly: whether the server can do research at all, and whether this caller
// may. A client that only knew about consent would show "Cloud" as available on
// a plan that refuses it.
type researchStatusDTO struct {
	Available bool                      `json:"available"`
	Allowed   bool                      `json:"allowed"`
	Reason    string                    `json:"reason,omitempty"`
	Plan      string                    `json:"requiredPlan"`
	Consent   CloudResearchConsentState `json:"consent"`
}

// ResearchStatus handles GET /v1/research/status.
func (h *Handler) ResearchStatus(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	state, err := h.svc.CloudResearchConsent(r.Context(), u)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	dto := researchStatusDTO{
		Available: h.svc.ResearchAvailable(),
		Plan:      ResearchPlan,
		Consent:   state,
	}
	if err := h.svc.CloudResearchAdmission(r.Context(), u); err != nil {
		dto.Reason = ResearchRefusalCode(err)
	} else {
		dto.Allowed = dto.Available
		if !dto.Available {
			dto.Reason = "provider_unconfigured"
		}
	}
	httpx.WriteJSON(w, http.StatusOK, dto)
}

// PendingPersonEnrichment handles GET /v1/research/people/pending.
func (h *Handler) PendingPersonEnrichment(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	ids, err := h.svc.PendingPersonEnrichmentIDs(r.Context(), u)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"personIds": ids})
}

// PersonEnrichmentEstimate handles GET /v1/research/people/estimate.
func (h *Handler) PersonEnrichmentEstimate(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	estimate, err := h.svc.EstimatePersonEnrichment(r.Context(), u)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, estimate)
}

// EnrichPerson handles POST /v1/research/people/{personId}.
func (h *Handler) EnrichPerson(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	personID, ok := pathUUID(w, r, "personId")
	if !ok {
		return
	}
	outcome, err := h.svc.EnrichPerson(r.Context(), u, personID)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, outcome)
}

// EnrichPersons handles POST /v1/research/people: one bounded chunk of a bulk
// run. The caller reads /people/pending, confirms /people/estimate, then walks
// the list in batches of the size the estimate reported.
func (h *Handler) EnrichPersons(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	var body struct {
		PersonIDs []uuid.UUID `json:"personIds"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	outcomes, err := h.svc.EnrichPersons(r.Context(), u, body.PersonIDs)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"outcomes": outcomes})
}

// PendingCompanyEnrichment handles GET /v1/research/companies/pending.
func (h *Handler) PendingCompanyEnrichment(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	ids, err := h.svc.PendingCompanyEnrichmentIDs(r.Context(), u)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"relationshipIds": ids})
}

// CompanyEnrichmentEstimate handles GET /v1/research/companies/estimate.
func (h *Handler) CompanyEnrichmentEstimate(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	estimate, err := h.svc.EstimateCompanyEnrichment(r.Context(), u)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, estimate)
}

// EnrichCompany handles POST /v1/research/companies/{relationshipId}.
func (h *Handler) EnrichCompany(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	relationshipID, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	outcome, err := h.svc.EnrichCompany(r.Context(), u, relationshipID)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, outcome)
}

// EnrichCompanies handles POST /v1/research/companies.
func (h *Handler) EnrichCompanies(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	var body struct {
		RelationshipIDs []uuid.UUID `json:"relationshipIds"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	outcomes, err := h.svc.EnrichCompanies(r.Context(), u, body.RelationshipIDs)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"outcomes": outcomes})
}

// ResearchAccountTrigger handles POST /v1/research/accounts/{relationshipId}/trigger.
func (h *Handler) ResearchAccountTrigger(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	relationshipID, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	outcome, err := h.svc.ResearchAccountTrigger(r.Context(), u, relationshipID)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, outcome)
}
