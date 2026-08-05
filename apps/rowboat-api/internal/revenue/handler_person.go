package revenue

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
)

// ListPersons returns the workspace's canonical people.
func (h *Handler) ListPersons(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	filter := PersonFilter{
		Query:  r.URL.Query().Get("q"),
		Status: r.URL.Query().Get("status"),
	}
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil {
			h.writeServiceError(w, fmt.Errorf("%w: invalid limit", ErrInvalidInput))
			return
		}
		filter.Limit = limit
	}
	people, err := h.svc.ListPersons(r.Context(), u, filter)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	out := make([]*personDTO, 0, len(people))
	for _, p := range people {
		out = append(out, personToDTO(p))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"persons": out})
}

// GetPerson returns one canonical person.
func (h *Handler) GetPerson(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "personId")
	if !ok {
		return
	}
	p, err := h.svc.GetPerson(r.Context(), u, id)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, personToDTO(p))
}

// PersonAttributes returns the provenance ledger behind a person's projected fields.
func (h *Handler) PersonAttributes(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "personId")
	if !ok {
		return
	}
	attributes, err := h.svc.PersonAttributes(r.Context(), u, id)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	out := make([]personAttributeDTO, 0, len(attributes))
	for _, attribute := range attributes {
		out = append(out, personAttributeToDTO(attribute))
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"attributes": out})
}

// PersonInteractions returns per-account interaction rollups for a person.
func (h *Handler) PersonInteractions(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "personId")
	if !ok {
		return
	}
	stats, err := h.svc.PersonInteractions(r.Context(), u, id)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	out := make([]personInteractionDTO, 0, len(stats))
	for _, stat := range stats {
		dto := personInteractionDTO{
			FirstInteractionAt: stat.FirstInteractionAt.UTC().Format(time.RFC3339),
			LastInteractionAt:  stat.LastInteractionAt.UTC().Format(time.RFC3339),
			InteractionCount:   stat.InteractionCount,
			InboundCount:       stat.InboundCount,
			OutboundCount:      stat.OutboundCount,
			MeetingCount:       stat.MeetingCount,
			ChannelCounts:      stat.ChannelCounts,
			LastChannel:        stat.LastChannel,
			LastDirection:      stat.LastDirection,
		}
		if rel, err := stat.Edges.RelationshipOrErr(); err == nil && rel != nil {
			dto.RelationshipID = rel.ID.String()
		}
		if dto.ChannelCounts == nil {
			dto.ChannelCounts = map[string]int{}
		}
		out = append(out, dto)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"interactions": out})
}

// CorrectPerson records a human override of a derived value.
func (h *Handler) CorrectPerson(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "personId")
	if !ok {
		return
	}
	var body PersonCorrectionInput
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	p, err := h.svc.CorrectPerson(r.Context(), u, id, body)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, personToDTO(p))
}

// RetractPersonAttribute withdraws one claim and reprojects without it.
func (h *Handler) RetractPersonAttribute(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	personID, ok := pathUUID(w, r, "personId")
	if !ok {
		return
	}
	attributeID, ok := pathUUID(w, r, "attributeId")
	if !ok {
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	p, err := h.svc.RetractPersonAttribute(r.Context(), u, personID, attributeID, body.Reason)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, personToDTO(p))
}

// ListPersonMergeCandidates returns people an anchor says might be one human.
func (h *Handler) ListPersonMergeCandidates(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	candidates, err := h.svc.ListPersonMergeCandidates(r.Context(), u, r.URL.Query().Get("status"))
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	out := make([]map[string]any, 0, len(candidates))
	for _, candidate := range candidates {
		entry := map[string]any{
			"id":                  candidate.ID.String(),
			"status":              candidate.Status,
			"candidateType":       candidate.CandidateType,
			"anchorKind":          candidate.AnchorKind,
			"anchorPreview":       candidate.AnchorPreview,
			"recommendedDecision": candidate.RecommendedDecision,
			"confidence":          candidate.Confidence,
			"version":             candidate.Version,
			"createdAt":           candidate.CreatedAt.UTC().Format(time.RFC3339),
		}
		if proposed, err := candidate.Edges.ProposedPersonOrErr(); err == nil && proposed != nil {
			entry["proposedPerson"] = personToDTO(proposed)
		}
		if existing, err := candidate.Edges.ExistingPersonOrErr(); err == nil && existing != nil {
			entry["existingPerson"] = personToDTO(existing)
		}
		out = append(out, entry)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"candidates": out})
}

// DecidePersonMergeCandidate applies a version-bound human merge decision.
func (h *Handler) DecidePersonMergeCandidate(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "candidateId")
	if !ok {
		return
	}
	var body PersonMergeDecisionInput
	if !httpx.DecodeJSON(w, r, maxBody, &body) {
		return
	}
	candidate, err := h.svc.DecidePersonMergeCandidate(r.Context(), u, id, body)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"id":       candidate.ID.String(),
		"status":   candidate.Status,
		"decision": candidate.Decision,
		"version":  candidate.Version,
	})
}
