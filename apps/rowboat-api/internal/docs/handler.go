// Package docs serves the rowboat-api OpenAPI document and API reference UI.
package docs

import (
	"net/http"

	rowboatapi "github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/api"
)

// Handler serves the OpenAPI document and Scalar API reference UI.
type Handler struct{}

// New builds a docs handler.
func New() *Handler {
	return &Handler{}
}

// OpenAPI serves the embedded OpenAPI document.
func (h *Handler) OpenAPI(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(rowboatapi.OpenAPIJSON)
}

// Scalar serves the Scalar API reference UI.
func (h *Handler) Scalar(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(scalarHTML))
}

const scalarHTML = `<!doctype html>
<html lang="en">
  <head>
    <title>Solomon AI API Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        margin: 0;
      }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
    <script>
      Scalar.createApiReference("#app", {
        url: "/openapi.json"
      });
    </script>
  </body>
</html>
`
