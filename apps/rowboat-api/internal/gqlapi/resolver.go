package gqlapi

// This file is not regenerated. It holds the resolver root and its
// dependencies (the ent client).

import (
	"github.com/99designs/gqlgen/graphql"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent"
)

// Resolver is the GraphQL resolver root; it delegates to the ent client.
type Resolver struct {
	client *ent.Client
}

// NewResolver builds a Resolver bound to the ent client.
func NewResolver(client *ent.Client) *Resolver {
	return &Resolver{client: client}
}

// NewSchema builds the executable GraphQL schema for the ent client.
func NewSchema(client *ent.Client) graphql.ExecutableSchema {
	return NewExecutableSchema(Config{Resolvers: NewResolver(client)})
}
