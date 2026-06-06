package docs

import (
	"net/http"

	rowboatapi "github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/api"
)

// Handler serves the OpenAPI document and Scalar API reference UI.
type Handler struct{}

func New() *Handler {
	return &Handler{}
}

func (h *Handler) OpenAPI(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(rowboatapi.OpenAPIJSON)
}

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
