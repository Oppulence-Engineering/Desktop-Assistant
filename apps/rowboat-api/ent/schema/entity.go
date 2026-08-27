package schema

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"entgo.io/contrib/entoas"
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// Entity is the projection-only, org-scoped identity spine from RFC 022.
// User-authored note bodies and mirrored product payloads remain on-device.
type Entity struct{ ent.Schema }

// Mixin enforces workspace tenant predicates at the Ent boundary.
func (Entity) Mixin() []ent.Mixin { return []ent.Mixin{mixin.WorkspaceTenantMixin{}} }

// Fields defines only the projection allowlist plus merge bookkeeping.
func (Entity) Fields() []ent.Field {
	return []ent.Field{
		field.String("entity_id").NotEmpty().Immutable().Validate(maxRunes("entity_id", 64)),
		field.String("kind").NotEmpty().Validate(maxRunes("kind", 64)),
		field.String("display_name").NotEmpty().Validate(maxRunes("display_name", 200)),
		field.JSON("resource_refs", []string{}).Default([]string{}),
		field.JSON("identifiers", map[string][]string{}).
			Default(map[string][]string{}).
			Sensitive().
			Annotations(entoas.Skip(true)),
		field.String("one_line_summary").Optional().Validate(maxRunes("one_line_summary", 500)),
		field.String("status").Default("active").Validate(oneOfRevenue("status", "active", "merged", "archived")),
		field.String("canonical_entity_id").Optional().Validate(maxRunes("canonical_entity_id", 64)),
		field.Int("version").Default(1).Positive(),
	}
}

// Edges ties every entity to the exact workspace and actor that projected it.
func (Entity) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("entities").Unique().Required().Immutable(),
		edge.From("user", User.Type).
			Ref("entities").Unique().Required().Immutable(),
		edge.To("normalized_resource_refs", EntityResourceRef.Type),
		edge.To("normalized_identifiers", EntityIdentifier.Type),
	}
}

// Indexes supports bounded workspace listing and lifecycle filtering.
func (Entity) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace").Fields("entity_id").Unique(),
		index.Edges("workspace").Fields("status"),
		index.Edges("workspace").Fields("display_name"),
	}
}

func maxRunes(name string, limit int) func(string) error {
	return func(value string) error {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%s must not be blank", name)
		}
		if utf8.RuneCountInString(value) > limit {
			return fmt.Errorf("%s must be at most %d characters", name, limit)
		}
		return nil
	}
}
