package llm

import (
	"net/http"
	"sort"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/httpx"
)

type modelRow struct {
	ID string `json:"id"`
}

type modelsResponse struct {
	Data []modelRow `json:"data"`
}

// Models handles GET /v1/llm/models. The catalog is the set of priced/routable
// model ids, so the list the desktop sees is exactly what it can call. The
// desktop only reads `id` from each row.
func (h *Handler) Models(w http.ResponseWriter, _ *http.Request) {
	ids := make([]string, 0, len(h.prices.Models))
	for id := range h.prices.Models {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	rows := make([]modelRow, 0, len(ids))
	for _, id := range ids {
		rows = append(rows, modelRow{ID: id})
	}
	httpx.WriteJSON(w, http.StatusOK, modelsResponse{Data: rows})
}
