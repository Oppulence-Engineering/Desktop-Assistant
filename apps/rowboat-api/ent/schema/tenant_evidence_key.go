package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// TenantEvidenceKey stores one tenant DEK wrapped by the deployment KEK. Raw
// evidence is encrypted with the DEK; destroying all wrapped versions makes
// retained ciphertext and backups cryptographically unreadable.
type TenantEvidenceKey struct{ ent.Schema }

// Mixin adds the common identifier and audit timestamps.
func (TenantEvidenceKey) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields defines wrapped key material and its auditable lifecycle metadata.
func (TenantEvidenceKey) Fields() []ent.Field {
	return []ent.Field{
		field.Int("version").Positive(),
		field.String("status").Default("active").
			Validate(oneOfRevenue("status", "active", "retired", "destroyed")),
		field.Bytes("wrapped_key").Optional().Sensitive(),
		field.String("key_fingerprint").NotEmpty(),
		field.Time("rotated_at").Optional().Nillable(),
		field.Time("destroyed_at").Optional().Nillable(),
		field.String("erasure_proof").Optional(),
	}
}

// Edges bind a wrapped key version to its tenant and creating user.
func (TenantEvidenceKey) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).Ref("evidence_keys").Unique().Required(),
		edge.From("user", User.Type).Ref("tenant_evidence_keys").Unique().Required(),
	}
}

// Indexes enforce tenant-local key versions and support lifecycle queries.
func (TenantEvidenceKey) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("workspace").Fields("version").Unique(),
		index.Edges("workspace").Fields("status"),
	}
}
