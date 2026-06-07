// Package api embeds the generated OpenAPI document served by rowboat-api.
package api

import _ "embed"

// OpenAPIJSON is the generated OpenAPI document served by the docs endpoints.
//
//go:embed openapi.json
var OpenAPIJSON []byte
