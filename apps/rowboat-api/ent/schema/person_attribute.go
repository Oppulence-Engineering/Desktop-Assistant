package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// PersonAttribute is a provenance-bearing claim about a canonical person, derived
// from owned data only: email signatures, transcripts, calendar invites, connected
// CRM, or a direct user correction.
//
// This is the RelationshipAssertion pattern applied to person enrichment, and it is
// resolved by the same precedence ladder — user_correction > source_fact >
// deterministic > ai_inference. Two rejected alternatives are worth recording:
//
//   - Last-write-wins is wrong because signature blocks are stale by construction.
//     A 2023 email ingested during a backfill today would overwrite a title learned
//     last week. Truth orders by observed_at, not by write time.
//   - Highest-confidence is wrong because, with no third-party vendors, every
//     confidence number is self-reported by our own extractors. A signature parser
//     emitting 0.99 would outrank a user correction on a rounding accident.
//
// Enrichment values are therefore never written directly to Person. They are asserted
// here and projected, so "why does it say she works at Acme?" always has an answer
// with a source, a confidence, and a timestamp.
type PersonAttribute struct{ ent.Schema }

// Mixin adds the shared immutable ID and timestamp fields.
func (PersonAttribute) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Fields defines the person attribute columns.
func (PersonAttribute) Fields() []ent.Field {
	return []ent.Field{
		field.String("dimension").
			Validate(oneOfRevenue("dimension",
				"display_name", "alias", "title", "org_name", "org_domain",
				"phone", "timezone", "locale", "handle")),
		field.Text("value").NotEmpty().Sensitive(),
		field.String("source_type").
			Validate(oneOfRevenue("source_type",
				"user_correction", "source_fact", "deterministic", "ai_inference")),
		// Which owned surface produced it; mirrors RelationshipObservation.source.
		field.String("source").
			Validate(oneOfRevenue("source",
				"gmail", "calendar", "slack", "hubspot", "meeting",
				"desktop_note", "voice_note", "browser", "crm", "user")),
		// Narrower than `source`: which extractor. This is what lets the UI say
		// "from their email signature" rather than just "from email".
		field.String("extractor").
			Default("unknown").
			Validate(oneOfRevenue("extractor",
				"unknown", "email_signature", "email_header", "calendar_invite",
				"transcript_intro", "crm_field", "user_entry", "display_name_header")),
		field.String("status").
			Default("active").
			Validate(oneOfRevenue("status", "active", "retracted", "superseded")),
		field.Float("confidence").Default(0.5).Min(0).Max(1),
		field.Text("reason").Optional().Sensitive(),
		// The provider's occurrence time, never ingest time. See the LWW note above.
		field.Time("observed_at"),
		field.Time("valid_from"),
		field.Time("valid_to").Optional().Nillable(),
		field.Time("retracted_at").Optional().Nillable(),
		field.String("supersedes_attribute_id").Optional(),
		field.String("extractor_version").Default("unknown-v1"),
		// sha256(personID, dimension, normalizedValue, source, externalID): replay is free.
		field.String("dedupe_key").NotEmpty(),
		field.JSON("supporting_observation_ids", []string{}).Default([]string{}),
	}
}

// Edges defines the attribute's workspace, person, observation, and user ownership.
func (PersonAttribute) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("workspace", RevenueWorkspace.Type).
			Ref("person_attributes").Unique().Required(),
		edge.From("person", Person.Type).
			Ref("attributes").Unique().Required(),
		// Optional: a user correction has no observation behind it.
		edge.From("observation", RelationshipObservation.Type).
			Ref("person_attributes").Unique(),
		edge.From("user", User.Type).
			Ref("person_attributes").Unique().Required(),
	}
}

// Indexes supports projection reads and makes replay idempotent.
func (PersonAttribute) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("person").Fields("dimension", "valid_from"),
		index.Edges("person").Fields("status", "valid_to"),
		index.Edges("workspace").Fields("dedupe_key").Unique(),
	}
}
