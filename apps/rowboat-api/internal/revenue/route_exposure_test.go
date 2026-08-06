package revenue

import (
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

// A handler nobody can reach is a handler that does not exist.
//
// DeletePerson was written, tested at the service layer, and left unmounted — so
// the only remedy in the product for "please remove me from your records" was
// unreachable over HTTP while every test still passed. Service-level tests cannot
// catch that, because they call the method directly.
//
// This walks the router the server actually mounts and asserts the person surface
// is complete.
func TestPersonRoutesAreMounted(t *testing.T) {
	router := chi.NewRouter()
	NewHandler(nil, zap.NewNop()).Mount(router)

	mounted := map[string]bool{}
	if err := chi.Walk(router, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		mounted[method+" "+route] = true
		return nil
	}); err != nil {
		t.Fatalf("walk: %v", err)
	}

	for _, want := range []string{
		"GET /v1/relationship-persons/",
		"GET /v1/relationship-persons/{personId}",
		"GET /v1/relationship-persons/{personId}/attributes",
		"GET /v1/relationship-persons/{personId}/interactions",
		"POST /v1/relationship-persons/{personId}/corrections",
		"POST /v1/relationship-persons/{personId}/attributes/{attributeId}/retract",
		// The one that was missing: without it a person can be corrected and
		// retracted but never removed.
		"DELETE /v1/relationship-persons/{personId}",
	} {
		if !mounted[want] {
			t.Errorf("route not mounted: %s", want)
		}
	}
}
