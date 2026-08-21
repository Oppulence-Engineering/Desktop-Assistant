package schema

import (
	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"

	"entgo.io/contrib/entgql"
	"entgo.io/ent"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/flume/enthistory"
	"github.com/google/uuid"
)

// LLMUsage records one LLM gateway call for analytics and per-feature cost
// allocation. The telemetry dimensions come from x-rowboat-* request headers.
type LLMUsage struct{ ent.Schema }

// Mixin adds tenant metadata/privacy without changing this legacy usage
// table's id and timestamp columns.
func (LLMUsage) Mixin() []ent.Mixin { return []ent.Mixin{mixin.UserTenantPolicyMixin{}} }

// Annotations of the LLMUsage (GraphQL exposure via entgql).
func (LLMUsage) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entgql.RelayConnection(),
		entgql.QueryField(),
		enthistory.Annotations{Annotations: []schema.Annotation{entgql.Skip()}},
	}
}

// Fields of the LLMUsage.
func (LLMUsage) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Default(uuid.New),
		field.String("model"),
		field.String("use_case").Optional(),     // x-rowboat-use-case
		field.String("sub_use_case").Optional(), // x-rowboat-sub-use-case
		field.String("agent_name").Optional(),   // x-rowboat-agent-name
		field.Int("input_tokens").Default(0).NonNegative(),
		field.Int("output_tokens").Default(0).NonNegative(),
		field.Int("cost_units").Default(0).NonNegative(), // credits decremented for this call
		field.UUID("request_id", uuid.UUID{}),
		field.Time("ts").Default(mixin.UTCNow).Immutable(),
	}
}

// Edges of the LLMUsage.
func (LLMUsage) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("llm_usages").Unique().Required().Immutable(),
	}
}

// Indexes of the LLMUsage.
func (LLMUsage) Indexes() []ent.Index {
	return []ent.Index{
		// One usage row per metered request: an idempotent retry (same request_id)
		// must not insert a second row and double-count tokens/cost in analytics.
		index.Fields("request_id").Unique(),
		index.Fields("model"),
		// Per-user index on the user FK for billing's usedSince aggregations
		// (scoped to one user); the ts range reuses it for the user equality.
		index.Edges("user"),
	}
}
