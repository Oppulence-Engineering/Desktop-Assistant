package composioapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/auth"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

func handlerAgainst(t *testing.T, upstream http.HandlerFunc) (*Handler, *ent.User) {
	t.Helper()
	server := httptest.NewServer(upstream)
	t.Cleanup(server.Close)
	client := New("comp_project_key", outbound.Policy{})
	client.SetBaseURL(server.URL)
	return NewHandler(client), &ent.User{ID: uuid.New()}
}

func signedIn(r *http.Request, u *ent.User) *http.Request {
	return r.WithContext(auth.WithUser(r.Context(), u))
}

// The project key reaches every connection in the project, so the user id must
// come from the session and never from the request.
func TestConnectionsAreScopedToTheSignedInUser(t *testing.T) {
	var gotUserIDs string
	h, u := handlerAgainst(t, func(w http.ResponseWriter, r *http.Request) {
		gotUserIDs = r.URL.Query().Get("user_ids")
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"items":[]}`)
	})

	rec := httptest.NewRecorder()
	h.Connections(rec, signedIn(httptest.NewRequest(http.MethodGet, "/v1/composio/connections?user_ids=someone-else", nil), u))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if gotUserIDs != u.ID.String() {
		t.Fatalf("user_ids = %q, want the session user %q", gotUserIDs, u.ID)
	}
}

func TestAnonymousCallersAreRefused(t *testing.T) {
	h, _ := handlerAgainst(t, func(_ http.ResponseWriter, _ *http.Request) {
		t.Error("upstream must not be reached without a session")
	})

	rec := httptest.NewRecorder()
	h.Connections(rec, httptest.NewRequest(http.MethodGet, "/v1/composio/connections", nil))

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestStartConnectionReturnsTheHostedPage(t *testing.T) {
	h, u := handlerAgainst(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasPrefix(r.URL.Path, "/auth_configs"):
			_, _ = io.WriteString(w, `{"items":[{"id":"ac_1","toolkit":{"slug":"jira"}}]}`)
		default:
			_, _ = io.WriteString(w, `{"connected_account_id":"ca_1","redirect_url":"https://connect.composio.dev/link/lk_1"}`)
		}
	})

	rec := httptest.NewRecorder()
	body := strings.NewReader(`{"toolkit":"jira"}`)
	h.StartConnection(rec, signedIn(httptest.NewRequest(http.MethodPost, "/v1/composio/connections", body), u))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body)
	}
	var link ConnectLink
	if err := json.Unmarshal(rec.Body.Bytes(), &link); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if link.RedirectURL != "https://connect.composio.dev/link/lk_1" || link.ConnectionID != "ca_1" {
		t.Fatalf("link = %+v", link)
	}
}

// Reporting another user's connection as forbidden would confirm it exists.
func TestDeletingSomeoneElsesConnectionReadsAsNotFound(t *testing.T) {
	h, u := handlerAgainst(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"ca_other","user_id":"11111111-1111-1111-1111-111111111111"}`)
	})

	req := httptest.NewRequest(http.MethodDelete, "/v1/composio/connections/ca_other", nil)
	ctx := chi.NewRouteContext()
	ctx.URLParams.Add("connectionID", "ca_other")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, ctx))
	rec := httptest.NewRecorder()
	h.DeleteConnection(rec, signedIn(req, u))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestAnUnconfiguredServerSaysSoRatherThanFailing(t *testing.T) {
	h := NewHandler(New("", outbound.Policy{}))
	u := &ent.User{ID: uuid.New()}

	rec := httptest.NewRecorder()
	h.Toolkits(rec, signedIn(httptest.NewRequest(http.MethodGet, "/v1/composio/toolkits", nil), u))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
}

// The routes are mounted on chi with a URL param; exercising them through a
// real router is what proves the wiring, not just the handler methods.
func TestRoutesAreWiredThroughTheRouter(t *testing.T) {
	var upstreamPaths []string
	var ownerID string
	h, u := handlerAgainst(t, func(w http.ResponseWriter, r *http.Request) {
		upstreamPaths = append(upstreamPaths, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasPrefix(r.URL.Path, "/connected_accounts/ca_mine"):
			_, _ = io.WriteString(w, `{"id":"ca_mine","user_id":"`+ownerID+`"}`)
		case strings.HasPrefix(r.URL.Path, "/toolkits"):
			_, _ = io.WriteString(w, `{"items":[{"slug":"jira","name":"Jira","composio_managed_auth_schemes":["OAUTH2"]}]}`)
		default:
			_, _ = io.WriteString(w, `{"items":[]}`)
		}
	})

	ownerID = u.ID.String()

	router := chi.NewRouter()
	router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, signedIn(r, u))
		})
	})
	router.Route("/v1/composio", func(r chi.Router) {
		r.Get("/toolkits", h.Toolkits)
		r.Get("/connections", h.Connections)
		r.Post("/connections", h.StartConnection)
		r.Delete("/connections/{connectionID}", h.DeleteConnection)
	})

	for _, tc := range []struct {
		method, path string
		body         string
		want         int
	}{
		{http.MethodGet, "/v1/composio/toolkits", "", http.StatusOK},
		{http.MethodGet, "/v1/composio/connections", "", http.StatusOK},
		{http.MethodDelete, "/v1/composio/connections/ca_mine", "", http.StatusNoContent},
	} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		router.ServeHTTP(rec, req)
		if rec.Code != tc.want {
			t.Fatalf("%s %s = %d, want %d (%s)", tc.method, tc.path, rec.Code, tc.want, rec.Body)
		}
	}
	// The delete resolved its {connectionID} param rather than reading a literal.
	if !strings.Contains(strings.Join(upstreamPaths, " "), "/connected_accounts/ca_mine") {
		t.Fatalf("connection id never reached the client: %v", upstreamPaths)
	}
}

// A malformed body must be refused before anything reaches Composio.
func TestStartConnectionRejectsAnUnknownField(t *testing.T) {
	h, u := handlerAgainst(t, func(_ http.ResponseWriter, _ *http.Request) {
		t.Error("upstream must not be reached for an invalid body")
	})

	rec := httptest.NewRecorder()
	body := strings.NewReader(`{"toolkit":"jira","user_id":"someone-else"}`)
	h.StartConnection(rec, signedIn(httptest.NewRequest(http.MethodPost, "/v1/composio/connections", body), u))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}
