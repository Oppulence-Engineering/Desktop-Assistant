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

// BackgroundTaskScheduleState records, per (task, trigger, cycle), which
// scheduler replica owns the cycle and whether it has fired (RFC 002). The
// unique index on (task, trigger_type, schedule_key) is the cross-replica
// duplicate guard: the first INSERT for a cycle wins; concurrent inserts
// conflict and skip. It is the durable substrate the cloud scheduler leases
// against so multiple replicas fire each scheduled cycle at most once.
type BackgroundTaskScheduleState struct{ ent.Schema }

// Mixin gives UUID id + created_at/updated_at, like every other entity.
func (BackgroundTaskScheduleState) Mixin() []ent.Mixin { return []ent.Mixin{mixin.BaseMixin{}} }

// Annotations of the BackgroundTaskScheduleState.
func (BackgroundTaskScheduleState) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entgql.RelayConnection(),
		entgql.QueryField(),
	}
}

// Fields of the BackgroundTaskScheduleState.
func (BackgroundTaskScheduleState) Fields() []ent.Field {
	return []ent.Field{
		field.String("trigger_type").
			Validate(oneOfBackgroundTask("trigger_type", "cron", "window")),
		// schedule_key is the deterministic cycle identity (see RFC 002 "Schedule keys").
		field.String("schedule_key").NotEmpty(),
		// last_evaluated_at advances only on state transitions (acquire/steal/
		// complete/release), not on every non-due scan.
		field.Time("last_evaluated_at").Optional().Nillable(),
		// last_due_at is reserved for the occurrence/window start the scheduler
		// decided was due. Not yet populated — the occurrence is already encoded
		// in schedule_key (see CronKey/WindowKey), so this stays nil until a
		// consumer needs it as a first-class column.
		field.Time("last_due_at").Optional().Nillable(),
		// last_triggered_at is when Starter.Start succeeded (set by Complete).
		field.Time("last_triggered_at").Optional().Nillable(),
		// last_run_id is the do-not-re-fire sentinel: non-empty ⇒ this cycle fired.
		// NOT NULL with "" default (no Optional) so the LastRunIDEQ("")/NEQ("")
		// guards match a never-fired row and can never see NULL — the pitfall the
		// RFC 002 migration checklist calls out (NULL = '' is NULL, not true).
		field.String("last_run_id").Default(""),
		// lease_owner is the replica id (pod name); the lease is "held" while
		// now < lease_expires_at and last_run_id == "". NOT NULL, "" default.
		field.String("lease_owner").Default(""),
		field.Time("lease_expires_at").Optional().Nillable(),
		// revision guards steal/complete via optimistic concurrency.
		field.Int("revision").Default(1).Positive(),
	}
}

// Edges of the BackgroundTaskScheduleState.
func (BackgroundTaskScheduleState) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("background_task_schedule_states").Unique().Required(),
		edge.From("task", BackgroundTask.Type).Ref("schedule_states").Unique().Required(),
	}
}

// Indexes of the BackgroundTaskScheduleState.
func (BackgroundTaskScheduleState) Indexes() []ent.Index {
	return []ent.Index{
		// The duplicate guard. Scoped by task edge so keys can't collide across tasks.
		index.Fields("trigger_type", "schedule_key").Edges("task").Unique(),
		// Operational/runbook support: list held leases by expiry, find by run.
		index.Fields("lease_expires_at"),
		index.Fields("last_run_id"),
		// Retention prune scans by created_at (CleanupExpired).
		index.Fields("created_at"),
	}
}
