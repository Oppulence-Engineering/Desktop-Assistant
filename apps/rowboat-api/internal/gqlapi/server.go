package gqlapi

import (
	"net/http"

	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/playground"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
)

// NewHandler returns the GraphQL HTTP handler (POST /graphql) for the ent
// client. Mount it behind admin/internal auth — it exposes the full entity
// graph.
func NewHandler(client *ent.Client) http.Handler {
	return handler.NewDefaultServer(NewSchema(client))
}

// PlaygroundHandler serves the GraphQL Playground UI pointed at endpoint.
func PlaygroundHandler(endpoint string) http.Handler {
	return playground.Handler("rowboat-api GraphQL", endpoint)
}
