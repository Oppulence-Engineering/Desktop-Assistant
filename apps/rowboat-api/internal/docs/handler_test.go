package docs

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOpenAPIServesGeneratedSpec(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/openapi.json", nil)
	res := httptest.NewRecorder()

	New().OpenAPI(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusOK)
	}
	if contentType := res.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
		t.Fatalf("content type = %q, want application/json", contentType)
	}

	var spec struct {
		OpenAPI string `json:"openapi"`
		Info    struct {
			Title string `json:"title"`
		} `json:"info"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &spec); err != nil {
		t.Fatalf("openapi json did not parse: %v", err)
	}
	if spec.OpenAPI == "" {
		t.Fatal("openapi version is empty")
	}
	if spec.Info.Title != "Solomon AI API" {
		t.Fatalf("title = %q, want Solomon AI API", spec.Info.Title)
	}
}

func TestScalarServesReferencePage(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/docs", nil)
	res := httptest.NewRecorder()

	New().Scalar(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusOK)
	}
	body := res.Body.String()
	if !strings.Contains(body, "@scalar/api-reference") {
		t.Fatal("docs page is missing Scalar api-reference script")
	}
	if !strings.Contains(body, `url: "/openapi.json"`) {
		t.Fatal("docs page is not configured for /openapi.json")
	}
}
