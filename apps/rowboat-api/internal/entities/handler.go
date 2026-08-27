package entities

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/go-chi/chi/v5"
)

const maxBody = 256 << 10

type Handler struct{ service *Service }

func NewHandler(service *Service) *Handler { return &Handler{service: service} }
func (h *Handler) Mount(r chi.Router) {
	r.Put("/v1/entities/{id}", h.Put)
	r.Get("/v1/entities", h.Resolve)
	r.Get("/v1/entities/{id}", h.Get)
	r.Post("/v1/entities/merge", h.Merge)
}
func strict(w http.ResponseWriter, r *http.Request, dst any) bool {
	if !httpx.JSONContentType(r.Header.Get("Content-Type")) {
		httpx.Error(w, 415, "Content-Type must be application/json", "unsupported_media_type")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			httpx.Error(w, http.StatusRequestEntityTooLarge, "request body exceeds 262144 bytes", "request_body_too_large")
			return false
		}
		httpx.Error(w, 400, "invalid projection JSON", "bad_request")
		return false
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		httpx.Error(w, 400, "request body must contain exactly one JSON document", "bad_request")
		return false
	}
	return true
}
func writeErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		httpx.Error(w, 404, err.Error(), "not_found")
	case errors.Is(err, ErrForbidden):
		httpx.Error(w, 403, err.Error(), "forbidden")
	case errors.Is(err, ErrAmbiguous):
		httpx.Error(w, 409, err.Error(), "entity_ambiguous")
	case errors.Is(err, ErrConflict):
		httpx.Error(w, 409, err.Error(), "version_conflict")
	default:
		if strings.Contains(err.Error(), "required") || strings.Contains(err.Error(), "invalid") || strings.Contains(err.Error(), "limit") {
			httpx.Error(w, 400, err.Error(), "bad_request")
		} else {
			httpx.Error(w, 500, "entity operation failed", "internal_error")
		}
	}
}
func (h *Handler) Put(w http.ResponseWriter, r *http.Request) {
	var in Projection
	if !strict(w, r, &in) {
		return
	}
	if in.ID != "" && strings.TrimSpace(in.ID) != chi.URLParam(r, "id") {
		httpx.Error(w, 400, "body id must match path id", "bad_request")
		return
	}
	out, err := h.service.Upsert(r.Context(), chi.URLParam(r, "id"), in)
	if err != nil {
		writeErr(w, err)
		return
	}
	httpx.WriteJSON(w, 200, out)
}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	out, err := h.service.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, err)
		return
	}
	httpx.WriteJSON(w, 200, out)
}
func (h *Handler) Resolve(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if len(q) != 1 || len(q["ref"]) != 1 || strings.TrimSpace(q["ref"][0]) == "" {
		httpx.Error(w, 400, "exactly one ref query parameter is required", "bad_request")
		return
	}
	out, err := h.service.ResolveRef(r.Context(), r.URL.Query().Get("ref"))
	if err != nil {
		writeErr(w, err)
		return
	}
	httpx.WriteJSON(w, 200, out)
}
func (h *Handler) Merge(w http.ResponseWriter, r *http.Request) {
	var in MergeInput
	if !strict(w, r, &in) {
		return
	}
	out, err := h.service.Merge(r.Context(), in)
	if err != nil {
		writeErr(w, err)
		return
	}
	httpx.WriteJSON(w, 200, out)
}
