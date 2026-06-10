package schema

import (
	"entgo.io/contrib/entgql"
	"entgo.io/ent"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// CloudEvent is the normalized envelope for one inbound external/connector
// event (RFC 003). Events are ingested idempotently (unique per user, source,
// dedupe_key), routed to matching API-target background tasks, and linked to
// the runs they trigger for auditability.
type CloudEvent struct{ ent.Schema }

// Mixin of the CloudEvent.
func (CloudEvent) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Annotations of the CloudEvent. No enthistory: events are append-mostly audit
// rows (only routing_* fields mutate, once), matching BackgroundTaskRun.
func (CloudEvent) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entgql.RelayConnection(),
		entgql.QueryField(),
	}
}

// Fields of the CloudEvent.
func (CloudEvent) Fields() []ent.Field {
	return []ent.Field{
		field.String("source").
			Validate(oneOfBackgroundTask("source",
				"gmail", "google_calendar", "slack", "webhook", "internal")),
		field.String("source_event_id").Optional(),   // provider's id (e.g. Gmail historyId)
		field.String("source_account_id").Optional(), // which connected account
		field.String("event_type").Optional(),        // provider-specific, e.g. "message.new"
		field.Text("subject").Optional(),
		// text is the normalized human-readable gist. subject/text stay plaintext
		// because they are what the router's prompts read; the full provider
		// payload (which may hold PII like email bodies) is sealed below.
		field.Text("text").Optional(),
		field.Bytes("payload_ciphertext").Optional().Sensitive(),
		// routing_json stores Rowboat's own bounded decision summary (threshold,
		// prompt versions, per-task decisions) — never third-party raw payload.
		field.Text("routing_json").Optional().Validate(validJSON),
		// dedupe_key is the idempotency anchor; unique per (user, source).
		field.String("dedupe_key").NotEmpty(),
		field.String("routing_status").
			Default("pending").
			Validate(oneOfBackgroundTask("routing_status",
				"pending", "routed", "skipped", "failed")),
		field.Int("matched_task_count").Default(0),
		field.Time("occurred_at").Optional().Nillable(), // provider event time
		field.Time("received_at").Default(mixin.UTCNow).Immutable(),
		field.Time("routed_at").Optional().Nillable(),
	}
}

// Edges of the CloudEvent.
func (CloudEvent) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("cloud_events").Unique().Required(),
		// runs this event triggered (0..N) — the audit link. The FK column lives
		// on background_task_runs and is exposed there as the field-backed
		// cloud_event_id (see BackgroundTaskRun).
		edge.To("runs", BackgroundTaskRun.Type),
	}
}

// Indexes of the CloudEvent.
func (CloudEvent) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("source", "dedupe_key").Edges("user").Unique(), // idempotency guard
		index.Fields("routing_status"),
		index.Fields("received_at"),
	}
}
