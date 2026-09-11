package composioapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/internal/outbound"
)

func withServer(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	client := New("comp_project_key", outbound.Policy{})
	client.SetBaseURL(server.URL)
	return client
}

func TestSearchToolsSendsTheProjectKeyAndBoundsResults(t *testing.T) {
	var gotKey, gotToolkit, gotLimit, gotSearch string
	client := withServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotKey = r.Header.Get("x-api-key")
		gotToolkit = r.URL.Query().Get("toolkit_slug")
		gotLimit = r.URL.Query().Get("limit")
		gotSearch = r.URL.Query().Get("search")
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"items":[
			{"slug":"JIRA_CREATE_ISSUE","name":"Create issue","description":"Create a Jira issue","toolkit":{"slug":"jira"}},
			{"slug":"JIRA_ADD_COMMENT","name":"Add comment","toolkit":"jira"}
		],"total_items":2}`)
	})

	tools, err := client.SearchTools(context.Background(), "create issue", "jira", 100)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	// The catalog runs past 54,000 tools, so an over-large limit is clamped
	// rather than passed through into a model's prompt.
	if gotKey != "comp_project_key" || gotLimit != "25" {
		t.Fatalf("key = %q, limit = %q", gotKey, gotLimit)
	}
	if gotToolkit != "jira" || gotSearch != "create issue" {
		t.Fatalf("toolkit = %q, search = %q", gotToolkit, gotSearch)
	}
	if len(tools) != 2 || tools[0].Slug != "JIRA_CREATE_ISSUE" || tools[0].Name != "Create issue" {
		t.Fatalf("tools = %+v", tools)
	}
	// The toolkit arrives as an object on one entry and a plain string on the
	// other; both have to read the same way.
	if tools[0].Toolkit != "jira" || tools[1].Toolkit != "jira" {
		t.Fatalf("toolkits = %q, %q", tools[0].Toolkit, tools[1].Toolkit)
	}
}

func TestSearchToolsAcceptsABareArray(t *testing.T) {
	client := withServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `[{"slug":"ASANA_CREATE_TASK"}]`)
	})

	tools, err := client.SearchTools(context.Background(), "", "", 0)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(tools) != 1 || tools[0].Slug != "ASANA_CREATE_TASK" {
		t.Fatalf("tools = %+v", tools)
	}
}

func TestDescribeToolReturnsTheInputSchema(t *testing.T) {
	client := withServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/tools/JIRA_CREATE_ISSUE" {
			t.Errorf("path = %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"slug":"JIRA_CREATE_ISSUE","name":"Create issue","input_parameters":{"type":"object","required":["summary"]}}`)
	})

	detail, err := client.DescribeTool(context.Background(), "JIRA_CREATE_ISSUE")
	if err != nil {
		t.Fatalf("describe: %v", err)
	}
	if detail.Slug != "JIRA_CREATE_ISSUE" || len(detail.InputParameters) == 0 {
		t.Fatalf("detail = %+v", detail)
	}
}

// The project key is shared, so the user id is the only thing keeping one
// person's call off another person's connected accounts.
func TestExecuteToolScopesTheCallToTheUser(t *testing.T) {
	var path string
	var body map[string]json.RawMessage
	client := withServer(t, func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"successful":true,"data":{"id":"ISSUE-1"}}`)
	})
	userID := uuid.New()

	result, err := client.ExecuteTool(context.Background(), userID, "JIRA_CREATE_ISSUE", json.RawMessage(`{"summary":"x"}`))
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if path != "/tools/execute/JIRA_CREATE_ISSUE" {
		t.Fatalf("path = %q", path)
	}
	if string(body["arguments"]) != `{"summary":"x"}` {
		t.Fatalf("arguments = %s", body["arguments"])
	}
	var sent string
	_ = json.Unmarshal(body["user_id"], &sent)
	if sent != userID.String() {
		t.Fatalf("user_id = %q, want %q", sent, userID)
	}
	if !result.Successful {
		t.Fatalf("result = %+v", result)
	}
}

func TestRejectedKeyIsDistinguishable(t *testing.T) {
	client := withServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	})

	_, err := client.SearchTools(context.Background(), "", "", 0)
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("err = %v, want ErrUnauthorized", err)
	}
}

// A deployment that holds no key must say so instead of calling Composio
// anonymously and reporting an opaque 401.
func TestAnUnconfiguredDeploymentSaysSo(t *testing.T) {
	client := New("  ", outbound.Policy{})
	if client.Configured() {
		t.Fatal("a blank key must not count as configured")
	}
	_, err := client.SearchTools(context.Background(), "", "", 0)
	if !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("err = %v, want ErrNotConfigured", err)
	}
}

// Composio answers "you never connected this product" with a 404 and an error
// envelope, not a 200 carrying successful:false. Reading it as a bare status
// put "composio: status 404" in front of users.
func TestAMissingConnectionIsDistinguishable(t *testing.T) {
	client := withServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = io.WriteString(w, `{"error":{"message":"No connected account found for user ID abc for toolkit jira","code":1810}}`)
	})

	_, err := client.ExecuteTool(context.Background(), uuid.New(), "JIRA_CREATE_ISSUE", nil)
	if !errors.Is(err, ErrNoConnection) {
		t.Fatalf("err = %v, want ErrNoConnection", err)
	}
}

// Any other upstream failure keeps Composio's own words rather than collapsing
// to a status code.
func TestUpstreamFailuresCarryTheProviderMessage(t *testing.T) {
	client := withServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"error":{"message":"Validation error while processing request"}}`)
	})

	_, err := client.SearchTools(context.Background(), "", "", 0)
	if err == nil || !strings.Contains(err.Error(), "Validation error") {
		t.Fatalf("err = %v, want the provider message", err)
	}
}
