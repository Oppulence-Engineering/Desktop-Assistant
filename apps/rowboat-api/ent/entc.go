//go:build ignore

// entc.go drives ent code generation. Run via `go generate ./ent/...`.
//
// Enabled features:
//   - privacy:   row-level access policies enforced at the ORM layer
//   - intercept: read-side query interceptors (metrics, soft-delete-ready)
//   - sql/upsert: OnConflict upserts (used for the WorkOS user upsert)
//   - entql: type-aware predicates used by privacy and repository policy code
//   - sql/versioned-migration: Atlas migration diff support
//   - schema/snapshot: deterministic schema history for safe code generation
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
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/optimistic"
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/tenant"
	"github.com/flume/enthistory"
	"github.com/ogen-go/ogen"
)

type rowboatExtension struct{ entc.DefaultExtension }

func (rowboatExtension) Hooks() []gen.Hook {
	return []gen.Hook{tenant.ValidateHook(), optimistic.ValidateHook()}
}

func main() {
	// Phase 1: generate the *History schemas for the tracked entities.
	tracked := []ent.Interface{
		schema.User{},
		schema.Subscription{},
		schema.OAuthConnection{},
		schema.MCPConnection{},
		schema.LLMUsage{},
		// RFC 028: AgentDefinition history backs revision listing + rollback.
		schema.AgentDefinition{},
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

	// entoas: base entity OpenAPI component/path spec written to api/openapi.json.
	// go generate runs cmd/openapi-enrich immediately afterward to replace the
	// path surface with the mounted runtime API and keep ent schemas as
	// documented component models.
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
				Description: "Base entity model document generated from ent schemas. cmd/openapi-enrich turns this into the mounted rowboat-api runtime document.",
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
				gen.FeatureEntQL,
				gen.FeatureUpsert,
				gen.FeatureVersionedMigration,
				gen.FeatureSnapshot,
			},
		},
		entc.Extensions(
			rowboatExtension{},
			enthistory.NewHistoryExtension(),
			oasExt,
			gqlExt,
		),
	); err != nil {
		log.Fatalf("running ent codegen: %v", err)
	}
}
