package actions

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

// A dark feature must say so. A bare 404 reads as "no such route" to every
// client, so the web app could not tell "off on purpose" from "wrong URL".
func TestMountDisabledAnswersNotImplemented(t *testing.T) {
	r := chi.NewRouter()
	MountDisabled(r)
	for _, path := range []string{
		"/v1/action-proposals?status=pending",
		"/v1/action-proposals/prop_1/approve",
	} {
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusNotImplemented {
			t.Fatalf("%s: status = %d, want 501", path, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "actions_disabled") {
			t.Fatalf("%s: body = %s, want code actions_disabled", path, rec.Body.String())
		}
	}
}
