package console

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

func TestHandlerPreferencesAndResourceLifecycle(t *testing.T) {
	fixture := newConsoleFixture(t)
	router := chi.NewRouter()
	NewHandler(fixture.service, zap.NewNop()).Mount(router)

	response := consoleRequest(t, router, fixture, http.MethodPatch, "/v1/console/preferences", `{"displayName":"Ada","shareUsageData":true}`)
	if response.Code != http.StatusOK {
		t.Fatalf("PATCH preferences status = %d, body=%s", response.Code, response.Body.String())
	}
	var preferences Preferences
	decodeResponse(t, response, &preferences)
	if preferences.DisplayName != "Ada" || !preferences.ShareUsageData {
		t.Fatalf("PATCH preferences response = %#v", preferences)
	}

	createBody := `{"kind":"graph_saved_view","name":"Renewals","payload":{"state":{"scope":"portfolio","query":"renewals","layout":"radial","density":0.5,"hideIsolated":true,"focusDepth":1,"changedSinceReview":false}},"sortOrder":2}`
	response = consoleRequest(t, router, fixture, http.MethodPost, "/v1/console/resources", createBody)
	if response.Code != http.StatusCreated || response.Header().Get("Location") == "" {
		t.Fatalf("POST resource status=%d location=%q body=%s", response.Code, response.Header().Get("Location"), response.Body.String())
	}
	var created Resource
	decodeResponse(t, response, &created)

	response = consoleRequest(t, router, fixture, http.MethodGet, "/v1/console/resources?kind=graph_saved_view&limit=10&offset=0", "")
	if response.Code != http.StatusOK {
		t.Fatalf("GET resources status=%d body=%s", response.Code, response.Body.String())
	}
	var page ResourcePage
	decodeResponse(t, response, &page)
	if len(page.Resources) != 1 || page.Resources[0].ID != created.ID {
		t.Fatalf("GET resources response = %#v", page)
	}

	response = consoleRequest(t, router, fixture, http.MethodPatch, "/v1/console/resources/"+created.ID, `{"name":"Renewal Risk","sortOrder":1}`)
	if response.Code != http.StatusOK {
		t.Fatalf("PATCH resource status=%d body=%s", response.Code, response.Body.String())
	}
	var updated Resource
	decodeResponse(t, response, &updated)
	if updated.Name != "Renewal Risk" || updated.SortOrder != 1 {
		t.Fatalf("PATCH resource response = %#v", updated)
	}

	response = consoleRequest(t, router, fixture, http.MethodDelete, "/v1/console/resources/"+created.ID, "")
	if response.Code != http.StatusNoContent {
		t.Fatalf("DELETE resource status=%d body=%s", response.Code, response.Body.String())
	}
	response = consoleRequest(t, router, fixture, http.MethodGet, "/v1/console/resources/"+created.ID, "")
	if response.Code != http.StatusNotFound {
		t.Fatalf("GET deleted resource status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestHandlerRejectsMalformedUnboundedAndUnauthorizedRequests(t *testing.T) {
	fixture := newConsoleFixture(t)
	router := chi.NewRouter()
	NewHandler(fixture.service, zap.NewNop()).Mount(router)

	tests := []struct {
		name   string
		method string
		target string
		body   string
		status int
	}{
		{"unknown preference", http.MethodPatch, "/v1/console/preferences", `{"unknown":true}`, http.StatusBadRequest},
		{"unknown create field", http.MethodPost, "/v1/console/resources", `{"kind":"note_favorite","payload":{"noteId":"n"},"unknown":true}`, http.StatusBadRequest},
		{"trailing document", http.MethodPatch, "/v1/console/preferences", `{} {}`, http.StatusBadRequest},
		{"invalid kind", http.MethodGet, "/v1/console/resources?kind=other", "", http.StatusBadRequest},
		{"duplicate query key", http.MethodGet, "/v1/console/resources?kind=note_favorite&kind=note_template", "", http.StatusBadRequest},
		{"unknown query key", http.MethodGet, "/v1/console/resources?kind=note_favorite&all=true", "", http.StatusBadRequest},
		{"invalid resource id", http.MethodGet, "/v1/console/resources/not-a-uuid", "", http.StatusBadRequest},
		{"oversized body", http.MethodPatch, "/v1/console/preferences", `{"displayName":"` + strings.Repeat("x", maxRequestBody) + `"}`, http.StatusRequestEntityTooLarge},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := consoleRequest(t, router, fixture, test.method, test.target, test.body)
			if response.Code != test.status {
				t.Fatalf("status=%d, want %d; body=%s", response.Code, test.status, response.Body.String())
			}
		})
	}

	request := httptest.NewRequest(http.MethodGet, "/v1/console/preferences", nil)
	request = request.WithContext(auth.WithUser(context.Background(), fixture.owner))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("request without actor status=%d body=%s", response.Code, response.Body.String())
	}

	request = httptest.NewRequest(http.MethodGet, "/v1/console/resources?kind=note_favorite", nil)
	ctx := auth.WithUser(context.Background(), fixture.owner)
	ctx = auth.WithActor(ctx, &auth.Actor{Kind: auth.KindUser, UserID: fixture.owner.ID, WorkOSOrgID: "org_wrong"})
	request = request.WithContext(ctx)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("wrong organization status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestHandlerFavoriteCreateReplayReturnsSameResource(t *testing.T) {
	fixture := newConsoleFixture(t)
	router := chi.NewRouter()
	NewHandler(fixture.service, zap.NewNop()).Mount(router)
	body := `{"kind":"note_favorite","payload":{"noteId":"note-idempotent"}}`

	first := consoleRequest(t, router, fixture, http.MethodPost, "/v1/console/resources", body)
	second := consoleRequest(t, router, fixture, http.MethodPost, "/v1/console/resources", body)
	if first.Code != http.StatusCreated || second.Code != http.StatusOK {
		t.Fatalf("favorite statuses = %d, %d", first.Code, second.Code)
	}
	var firstResource, secondResource Resource
	decodeResponse(t, first, &firstResource)
	decodeResponse(t, second, &secondResource)
	if firstResource.ID != secondResource.ID {
		t.Fatalf("favorite replay ids = %q, %q", firstResource.ID, secondResource.ID)
	}
}

func consoleRequest(
	t *testing.T,
	router http.Handler,
	fixture *consoleFixture,
	method string,
	target string,
	body string,
) *httptest.ResponseRecorder {
	t.Helper()
	var requestBody *bytes.Reader
	if body == "" {
		requestBody = bytes.NewReader(nil)
	} else {
		requestBody = bytes.NewReader([]byte(body))
	}
	request := httptest.NewRequest(method, target, requestBody)
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	ctx := auth.WithUser(context.Background(), fixture.owner)
	ctx = auth.WithActor(ctx, &auth.Actor{
		Kind: auth.KindUser, UserID: fixture.owner.ID, WorkOSOrgID: testOrganizationID,
	})
	request = request.WithContext(ctx)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func decodeResponse(t *testing.T, response *httptest.ResponseRecorder, destination any) {
	t.Helper()
	if err := json.Unmarshal(response.Body.Bytes(), destination); err != nil {
		t.Fatalf("decode response %q: %v", response.Body.String(), err)
	}
}
