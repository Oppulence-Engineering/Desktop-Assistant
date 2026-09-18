package console

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const maxRequestBody = 256 << 10

// Handler translates authenticated HTTP requests into console operations.
type Handler struct {
	service *Service
	log     *zap.Logger
}

// NewHandler constructs the console HTTP adapter.
func NewHandler(service *Service, log *zap.Logger) *Handler {
	if log == nil {
		log = zap.NewNop()
	}
	return &Handler{service: service, log: log}
}

// Mount registers the authenticated /v1/console domain.
func (h *Handler) Mount(router chi.Router) {
	router.Route("/v1/console", func(router chi.Router) {
		router.Get("/preferences", h.GetPreferences)
		router.Patch("/preferences", h.PatchPreferences)
		router.Get("/resources", h.ListResources)
		router.Post("/resources", h.CreateResource)
		router.Get("/resources/{resourceId}", h.GetResource)
		router.Patch("/resources/{resourceId}", h.PatchResource)
		router.Delete("/resources/{resourceId}", h.DeleteResource)
	})
}

// GetPreferences returns the caller's cross-device preference document.
func (h *Handler) GetPreferences(w http.ResponseWriter, r *http.Request) {
	owner, _, ok := consoleIdentity(w, r)
	if !ok {
		return
	}
	preferences, err := h.service.GetPreferences(r.Context(), owner)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, preferences)
}

// PatchPreferences merges explicitly supplied preference fields.
func (h *Handler) PatchPreferences(w http.ResponseWriter, r *http.Request) {
	owner, _, ok := consoleIdentity(w, r)
	if !ok {
		return
	}
	var patch PreferencesPatch
	if !decodeStrictJSON(w, r, &patch) {
		return
	}
	preferences, err := h.service.PatchPreferences(r.Context(), owner, patch)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, preferences)
}

// ListResources returns a bounded page for one required resource kind.
func (h *Handler) ListResources(w http.ResponseWriter, r *http.Request) {
	owner, organizationID, ok := consoleIdentity(w, r)
	if !ok {
		return
	}
	if !onlyQueryKeys(r, "kind", "limit", "offset") {
		httpx.Error(w, http.StatusBadRequest, "unsupported query parameter", "console_invalid_input")
		return
	}
	kind := ResourceKind(strings.TrimSpace(r.URL.Query().Get("kind")))
	limit, valid := parseOptionalInt(r.URL.Query().Get("limit"))
	if !valid {
		httpx.Error(w, http.StatusBadRequest, "limit must be an integer", "console_invalid_input")
		return
	}
	offset, valid := parseOptionalInt(r.URL.Query().Get("offset"))
	if !valid {
		httpx.Error(w, http.StatusBadRequest, "offset must be an integer", "console_invalid_input")
		return
	}
	page, err := h.service.ListResources(r.Context(), owner, organizationID, kind, limit, offset)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, page)
}

// CreateResource creates an artifact or replays an existing favorite.
func (h *Handler) CreateResource(w http.ResponseWriter, r *http.Request) {
	owner, organizationID, ok := consoleIdentity(w, r)
	if !ok {
		return
	}
	var input ResourceCreate
	if !decodeStrictJSON(w, r, &input) {
		return
	}
	resource, created, err := h.service.CreateResource(r.Context(), owner, organizationID, input)
	if err != nil {
		h.writeError(w, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
		w.Header().Set("Location", "/v1/console/resources/"+resource.ID)
	}
	httpx.WriteJSON(w, status, resource)
}

// GetResource returns one caller-owned artifact.
func (h *Handler) GetResource(w http.ResponseWriter, r *http.Request) {
	owner, organizationID, resourceID, ok := consoleResourceIdentity(w, r)
	if !ok {
		return
	}
	resource, err := h.service.GetResource(r.Context(), owner, organizationID, resourceID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, resource)
}

// PatchResource updates one caller-owned artifact.
func (h *Handler) PatchResource(w http.ResponseWriter, r *http.Request) {
	owner, organizationID, resourceID, ok := consoleResourceIdentity(w, r)
	if !ok {
		return
	}
	var patch ResourcePatch
	if !decodeStrictJSON(w, r, &patch) {
		return
	}
	resource, err := h.service.PatchResource(r.Context(), owner, organizationID, resourceID, patch)
	if err != nil {
		h.writeError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, resource)
}

// DeleteResource removes one caller-owned artifact.
func (h *Handler) DeleteResource(w http.ResponseWriter, r *http.Request) {
	owner, organizationID, resourceID, ok := consoleResourceIdentity(w, r)
	if !ok {
		return
	}
	if err := h.service.DeleteResource(r.Context(), owner, organizationID, resourceID); err != nil {
		h.writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func consoleIdentity(w http.ResponseWriter, r *http.Request) (*ent.User, string, bool) {
	owner, hasUser := auth.UserFromCtx(r.Context())
	actor, hasActor := auth.ActorFromCtx(r.Context())
	if !hasUser || !hasActor || actor.Kind != auth.KindUser || actor.UserID != owner.ID {
		httpx.Error(w, http.StatusForbidden, "user actor required", "forbidden")
		return nil, "", false
	}
	return owner, strings.TrimSpace(actor.WorkOSOrgID), true
}

func consoleResourceIdentity(w http.ResponseWriter, r *http.Request) (*ent.User, string, uuid.UUID, bool) {
	owner, organizationID, ok := consoleIdentity(w, r)
	if !ok {
		return nil, "", uuid.Nil, false
	}
	resourceID, err := uuid.Parse(chi.URLParam(r, "resourceId"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "resourceId must be a UUID", "console_invalid_input")
		return nil, "", uuid.Nil, false
	}
	return owner, organizationID, resourceID, true
}

func decodeStrictJSON(w http.ResponseWriter, r *http.Request, destination any) bool {
	if !httpx.JSONContentType(r.Header.Get("Content-Type")) {
		httpx.Error(w, http.StatusUnsupportedMediaType, "Content-Type must be application/json", "unsupported_media_type")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBody)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			httpx.Error(w, http.StatusRequestEntityTooLarge, "request body exceeds 262144 bytes", "request_body_too_large")
			return false
		}
		httpx.Error(w, http.StatusBadRequest, "invalid JSON body", "console_invalid_input")
		return false
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		httpx.Error(w, http.StatusBadRequest, "request body must contain exactly one JSON document", "console_invalid_input")
		return false
	}
	return true
}

func onlyQueryKeys(r *http.Request, allowed ...string) bool {
	valid := make(map[string]struct{}, len(allowed))
	for _, key := range allowed {
		valid[key] = struct{}{}
	}
	for key, values := range r.URL.Query() {
		if _, ok := valid[key]; !ok || len(values) != 1 {
			return false
		}
	}
	return true
}

func parseOptionalInt(value string) (int, bool) {
	if value == "" {
		return 0, true
	}
	parsed, err := strconv.Atoi(value)
	return parsed, err == nil
}

func (h *Handler) writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpx.Error(w, http.StatusBadRequest, err.Error(), "console_invalid_input")
	case errors.Is(err, ErrForbidden):
		httpx.Error(w, http.StatusForbidden, "console access forbidden", "forbidden")
	case errors.Is(err, ErrNotFound):
		httpx.Error(w, http.StatusNotFound, "console resource not found", "console_resource_not_found")
	case errors.Is(err, ErrDuplicate):
		httpx.Error(w, http.StatusConflict, "console resource already exists", "console_resource_conflict")
	default:
		h.log.Error("console operation failed", zap.Error(err))
		httpx.Error(w, http.StatusInternalServerError, "console operation failed", "internal_error")
	}
}
