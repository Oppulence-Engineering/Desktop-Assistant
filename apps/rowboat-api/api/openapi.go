package api

import _ "embed"

// OpenAPIJSON is the generated OpenAPI document served by the docs endpoints.
//
//go:embed openapi.json
var OpenAPIJSON []byte
