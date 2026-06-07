package gqlapi

import (
	"net/http"

	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/handler/extension"
	"github.com/99designs/gqlgen/graphql/handler/lru"
	"github.com/99designs/gqlgen/graphql/handler/transport"
	"github.com/99designs/gqlgen/graphql/playground"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
	"github.com/vektah/gqlparser/v2/ast"
)

// HandlerOptions configures the admin GraphQL server.
type HandlerOptions struct {
	Introspection bool
	MaxComplexity int
	MaxDepth      int
}

// NewHandler returns the GraphQL HTTP handler (POST /graphql) for the ent
// client. Mount it behind admin/internal auth — it exposes the full entity
// graph.
func NewHandler(client *ent.Client, opts ...HandlerOptions) http.Handler {
	cfg := HandlerOptions{Introspection: true, MaxComplexity: 250, MaxDepth: 12}
	if len(opts) > 0 {
		cfg = opts[0]
	}
	srv := handler.New(NewSchema(client))
	srv.AddTransport(transport.Options{})
	srv.AddTransport(transport.POST{})
	srv.SetQueryCache(lru.New[*ast.QueryDocument](1000))
	srv.SetParserTokenLimit(15000)
	srv.Use(extension.FixedComplexityLimit(cfg.MaxComplexity))
	srv.Use(depthLimit{limit: cfg.MaxDepth})
	if cfg.Introspection {
		srv.Use(extension.Introspection{})
	}
	return srv
}

// PlaygroundHandler serves the GraphQL Playground UI pointed at endpoint.
func PlaygroundHandler(endpoint string) http.Handler {
	return playground.Handler("rowboat-api GraphQL", endpoint)
}
