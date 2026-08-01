package hubspotapi

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
)

// Handler exposes the bounded read-only native HubSpot surface used by the
// signed-in desktop. CRM writes stay behind durable-agent/revenue approvals.
type Handler struct{ client *Client }

// NewHandler builds the native HubSpot HTTP handler.
func NewHandler(client *Client) *Handler { return &Handler{client: client} }

// Search handles POST /v1/hubspot/search.
func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return
	}
	var input struct {
		ObjectType string `json:"objectType"`
		Query      string `json:"query"`
		Limit      int    `json:"limit"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&input); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid HubSpot search request", "invalid_request")
		return
	}
	result, err := h.client.Search(r.Context(), u.ID, input.ObjectType, input.Query, input.Limit)
	if err != nil {
		message := strings.ToLower(err.Error())
		switch {
		case strings.Contains(message, "not connected"), strings.Contains(message, "reconnect hubspot"):
			httpx.Error(w, http.StatusConflict, "HubSpot is not connected; connect or reconnect it first", "not_connected")
		case strings.Contains(message, "objecttype"), strings.Contains(message, "query is required"):
			httpx.Error(w, http.StatusBadRequest, err.Error(), "invalid_request")
		default:
			httpx.Error(w, http.StatusBadGateway, "HubSpot search failed", "upstream_error")
		}
		return
	}
	httpx.WriteJSON(w, http.StatusOK, result)
}
