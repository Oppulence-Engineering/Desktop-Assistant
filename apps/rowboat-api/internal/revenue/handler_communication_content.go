package revenue

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
)

// CommunicationInteractionBody returns an authorized message body.
func (h *Handler) CommunicationInteractionBody(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	interactionID, ok := pathUUID(w, r, "interactionId")
	if !ok {
		return
	}
	result, err := h.svc.CommunicationInteractionBody(r.Context(), u, interactionID)
	if err != nil {
		if errors.Is(err, ErrCommunicationContentUnavailable) {
			httpx.Error(w, http.StatusNotFound, "communication body unavailable", "communication_body_unavailable")
			return
		}
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, result)
}

// CommunicationAttachmentContent returns one authorized attachment after scan.
func (h *Handler) CommunicationAttachmentContent(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	attachmentID, ok := pathUUID(w, r, "attachmentId")
	if !ok {
		return
	}
	result, err := h.svc.CommunicationAttachmentContent(r.Context(), u, attachmentID)
	if err != nil {
		if errors.Is(err, ErrCommunicationContentUnavailable) {
			httpx.Error(w, http.StatusNotFound, "communication attachment unavailable", "communication_attachment_unavailable")
			return
		}
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, result)
}

// RelationshipCommunicationTimeline returns paginated communication metadata.
func (h *Handler) RelationshipCommunicationTimeline(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	relationshipID, ok := pathUUID(w, r, "relationshipId")
	if !ok {
		return
	}
	limit := 50
	if value := r.URL.Query().Get("limit"); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil {
			limit = parsed
		}
	}
	var before *time.Time
	if value := r.URL.Query().Get("before"); value != "" {
		if parsed, err := time.Parse(time.RFC3339, value); err == nil {
			before = &parsed
		}
	}
	page, err := h.svc.RelationshipCommunicationTimeline(r.Context(), u, relationshipID, before, limit)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, page)
}
