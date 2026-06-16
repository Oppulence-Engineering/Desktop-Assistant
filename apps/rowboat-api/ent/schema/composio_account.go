package schema

import (
	"entgo.io/contrib/entgql"
	"entgo.io/contrib/entoas"
	"entgo.io/ent"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/flume/enthistory"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// ComposioAccount maps a Composio connected account id to the Rowboat user
// that created or first claimed it through the Composio proxy.
type ComposioAccount struct{ ent.Schema }

// Mixin of the ComposioAccount.
func (ComposioAccount) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Annotations keeps the mapping out of GraphQL/history exposure; it is an
// internal authorization table for the proxy, not a public API model.
func (ComposioAccount) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entgql.Skip(),
		entoas.Skip(true),
		enthistory.Annotations{Annotations: []schema.Annotation{entgql.Skip()}},
	}
}

// Fields of the ComposioAccount.
func (ComposioAccount) Fields() []ent.Field {
	return []ent.Field{
		field.String("account_id").NotEmpty(),
		field.String("toolkit").Optional(),
	}
}

// Edges of the ComposioAccount.
func (ComposioAccount) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("composio_accounts").Unique().Required(),
	}
}

// Indexes of the ComposioAccount.
func (ComposioAccount) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("account_id").Unique(),
	}
}
