// Package gqlapi is the GraphQL server: gqlgen-generated execution + resolvers
// that delegate to the ent client, over the entgql-generated ent.graphql
// schema. Run `go generate ./internal/gqlapi/...` (gqlgen reads gqlgen.yml from
// this directory, so all paths resolve here).
package gqlapi

//go:generate go run github.com/99designs/gqlgen
