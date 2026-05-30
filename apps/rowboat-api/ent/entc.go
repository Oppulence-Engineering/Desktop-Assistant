//go:build ignore

// entc.go drives ent code generation. Run via `go generate ./ent/...`.
//
// Enabled features:
//   - privacy:   row-level access policies enforced at the ORM layer
//   - intercept: read-side query interceptors (metrics, soft-delete-ready)
//   - sql/upsert: OnConflict upserts (used for the WorkOS user upsert)
//
// Extensions:
//   - enthistory: generates *_history tables for audited schemas. It runs in
//     two phases — first it writes the History schemas (via schemast), then ent
//     code-generates with the history extension. CreditLedger (already
//     append-only) and OAuthPending (TTL'd, ephemeral) are intentionally not
//     tracked.
package main

import (
	"log"
	"os"

	"entgo.io/contrib/entgql"
	"entgo.io/contrib/entoas"
	"entgo.io/ent"
	"entgo.io/ent/entc"
	"entgo.io/ent/entc/gen"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema"
	"github.com/flume/enthistory"
	"github.com/ogen-go/ogen"
)

func main() {
	// Phase 1: generate the *History schemas for the tracked entities.
	tracked := []ent.Interface{
		schema.User{},
		schema.Subscription{},
		schema.OAuthConnection{},
		schema.MCPConnection{},
		schema.LLMUsage{},
	}
	if err := enthistory.Generate("./schema", tracked,
		enthistory.WithHistoryTimeIndex(),
		enthistory.WithImmutableFields(),
		// History ids inherit the source UUID type (fresh per row) so all
		// GraphQL nodes share one id type — entgql rejects mixed id types.
		enthistory.WithInheritIdType(),
	); err != nil {
		log.Fatalf("enthistory schema generation: %v", err)
	}

	// entoas: OpenAPI 3 spec written to api/openapi.json.
	if err := os.MkdirAll("../api", 0o755); err != nil {
		log.Fatalf("mkdir api: %v", err)
	}
	specFile, err := os.Create("../api/openapi.json")
	if err != nil {
		log.Fatalf("create openapi spec: %v", err)
	}
	defer func() { _ = specFile.Close() }()

	oasExt, err := entoas.NewExtension(
		entoas.SimpleModels(),
		entoas.WriteTo(specFile),
		entoas.Spec(&ogen.Spec{
			OpenAPI: "3.0.3",
			Info: ogen.Info{
				Title:       "rowboat-api",
				Description: "Entity-shaped REST surface generated from ent schemas. Streaming/proxy endpoints are hand-curated and merged.",
				Version:     "0.1.0",
			},
		}),
	)
	if err != nil {
		log.Fatalf("entoas extension: %v", err)
	}

	// entgql: Relay-compliant GraphQL schema (internal/gqlapi/ent.graphql) + the
	// supporting Go code (Node, pagination, where-inputs) in the ent package.
	// gqlgen (server resolvers) is generated in a second step from gqlgen.yml.
	if err := os.MkdirAll("../internal/gqlapi", 0o755); err != nil {
		log.Fatalf("mkdir gqlapi: %v", err)
	}
	gqlExt, err := entgql.NewExtension(
		entgql.WithSchemaGenerator(),
		entgql.WithSchemaPath("../internal/gqlapi/ent.graphql"),
		entgql.WithWhereInputs(true),
	)
	if err != nil {
		log.Fatalf("entgql extension: %v", err)
	}

	// Phase 2: ent code generation with features + extensions.
	if err := entc.Generate("./schema",
		&gen.Config{
			Features: []gen.Feature{
				gen.FeaturePrivacy,
				gen.FeatureIntercept,
				gen.FeatureUpsert,
			},
		},
		entc.Extensions(
			enthistory.NewHistoryExtension(),
			oasExt,
			gqlExt,
		),
	); err != nil {
		log.Fatalf("running ent codegen: %v", err)
	}
}
