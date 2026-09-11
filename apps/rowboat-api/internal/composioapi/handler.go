package composioapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
)

// Handler exposes the hosted connect flow: which products can be linked, which
// this user has linked, and the authorization page that links one more.
//
// Every route derives the user from the session. The project key can reach
// every connection in the project, so a user id taken from a request body would
// be an authorization hole rather than a convenience.
type Handler struct{ client *Client }

// NewHandler builds the Composio connect handler.
func NewHandler(client *Client) *Handler { return &Handler{client: client} }

// Toolkits handles GET /v1/composio/toolkits.
func (h *Handler) Toolkits(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.viewer(w, r); !ok {
		return
	}
	toolkits, err := h.client.ListToolkits(r.Context(), 0)
	if err != nil {
		h.writeError(w, err, "could not list Composio products")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"toolkits": toolkits})
}

// Connections handles GET /v1/composio/connections.
func (h *Handler) Connections(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	connections, err := h.client.ListConnections(r.Context(), u)
	if err != nil {
		h.writeError(w, err, "could not list Composio connections")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"connections": connections})
}

// StartConnection handles POST /v1/composio/connections. It returns the hosted
// page the user must visit; nothing is linked until they finish there.
func (h *Handler) StartConnection(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	var input struct {
		Toolkit string `json:"toolkit"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&input); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid connect request", "invalid_request")
		return
	}
	if strings.TrimSpace(input.Toolkit) == "" {
		httpx.Error(w, http.StatusBadRequest, "toolkit is required", "invalid_request")
		return
	}
	link, err := h.client.StartConnection(r.Context(), u, input.Toolkit)
	if err != nil {
		h.writeError(w, err, "could not start the Composio connection")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, link)
}

// DeleteConnection handles DELETE /v1/composio/connections/{connectionID}.
func (h *Handler) DeleteConnection(w http.ResponseWriter, r *http.Request) {
	u, ok := h.viewer(w, r)
	if !ok {
		return
	}
	err := h.client.DeleteConnection(r.Context(), u, chi.URLParam(r, "connectionID"))
	if err != nil {
		h.writeError(w, err, "could not disconnect")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) viewer(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	u, ok := auth.UserFromCtx(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "unauthorized")
		return uuid.Nil, false
	}
	return u.ID, true
}

func (h *Handler) writeError(w http.ResponseWriter, err error, fallback string) {
	switch {
	case errors.Is(err, ErrNotConfigured):
		httpx.Error(w, http.StatusServiceUnavailable, "Composio is not configured on this server", "provider_unconfigured")
	case errors.Is(err, ErrUnauthorized):
		httpx.Error(w, http.StatusBadGateway, "Composio rejected this server's project key", "upstream_error")
	case errors.Is(err, ErrNotOwned):
		// Not 403: naming someone else's connection as "forbidden" confirms it
		// exists. A connection this user does not own is one they do not have.
		httpx.Error(w, http.StatusNotFound, "connection not found", "not_found")
	default:
		httpx.Error(w, http.StatusBadGateway, fallback, "upstream_error")
	}
}
