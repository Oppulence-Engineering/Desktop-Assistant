package schema

import (
	"fmt"
	"slices"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/Oppulence-Engineering/rowboat/apps/rowboat-api/ent/schema/mixin"
)

// oneOfRevenue validates that a revenue-domain enum field holds one of the
// allowed values. Shared by every RFC 030 schema in this package.
func oneOfRevenue(name string, allowed ...string) func(string) error {
	return func(v string) error {
		if slices.Contains(allowed, v) {
			return nil
		}
		return fmt.Errorf("%s must be one of %v, got %q", name, allowed, v)
	}
}

// oneOfRevenueOptional is oneOfRevenue that also accepts the empty string, for
// Optional enum fields that may be unset.
func oneOfRevenueOptional(name string, allowed ...string) func(string) error {
	inner := oneOfRevenue(name, allowed...)
	return func(v string) error {
		if v == "" {
			return nil
		}
		return inner(v)
	}
}

// RevenueWorkspace maps a Rowboat tenant onto the canonical OutboundConsole
// commercial workspace (RFC 030). Rowboat stores a mapping, never a second
// commercial workspace model. A workspace in "local" mode has no OutboundConsole
// link yet: observation and draft-only execution work, while preflight,
// approval of sends, and outcome reporting stay disabled (fail closed).
type RevenueWorkspace struct{ ent.Schema }

// Mixin of the RevenueWorkspace.
func (RevenueWorkspace) Mixin() []ent.Mixin { return []ent.Mixin{mixin.WorkspaceRootTenantMixin{}} }

// Fields of the RevenueWorkspace.
func (RevenueWorkspace) Fields() []ent.Field {
	return []ent.Field{
		field.String("workos_org_id").Optional(),
		field.String("outbound_organization_id").Optional(),
		field.String("outbound_workspace_id").Optional().Nillable().Unique(),
		field.String("mode").
			Default("local").
			Validate(oneOfRevenue("mode", "local", "linked")),
		field.String("status").
			Default("active").
			Validate(oneOfRevenue("status", "active", "disconnected", "repair_required")),
		field.Time("last_verified_at").Optional().Nillable(),
		// When the last proactive digest email was sent, so the scheduled
		// sender can honor a per-user minimum interval.
		field.Time("last_digest_at").Optional().Nillable(),
		// The Gmail History API cursor for push-driven Layer-1 sync (RFC 031).
		// Empty until the first push bootstraps it.
		field.String("mail_history_id").Optional(),
		// Whether a counterparty's name and domain may be sent to the research
		// vendor (RFC 039).
		//
		// This lives on the server and not only in desktop config because the data
		// subject is not the user: they are consenting on behalf of someone who
		// never agreed to anything, and a gate the client can assert its way past
		// is not a gate. The desktop toggle writes here; the research path reads
		// here and nowhere else.
		//
		// Deliberately independent of every capability and plan check. An operator
		// enabling cloud_research, or a user upgrading to the Intelligence plan,
		// must not turn this on as a side effect.
		field.Bool("cloud_research_consent").Default(false),
		// When consent was last granted, for the audit answer to "when did I agree
		// to this?". Cleared to nil on revocation so the column never claims a
		// consent that is no longer in force.
		field.Time("cloud_research_consent_at").Optional().Nillable(),
	}
}

// Edges of the RevenueWorkspace.
func (RevenueWorkspace) Edges() []ent.Edge {
	return []ent.Edge{
		// The founding owner. MVP tenancy is founder-mode: every revenue row is
		// user-scoped through the existing interceptor/hook machinery, with the
		// workspace edge in place for the WP6 member-scoped upgrade.
		edge.From("user", User.Type).Ref("revenue_workspaces").Unique().Required().Immutable(),
		edge.To("members", RevenueWorkspaceMember.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("relationships", Relationship.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("evidences", RevenueEvidence.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("commitments", Commitment.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("commitment_events", CommitmentEvent.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("commitment_dependencies", CommitmentDependency.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("conversation_intelligence_artifacts", ConversationIntelligenceArtifact.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("actions", RevenueAction.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("decisions", PolicyDecisionSnapshot.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("outcomes", ActionOutcome.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("outbox_events", RevenueOutboxEvent.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("scans", RevenueLeakScan.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("relationship_participants", RelationshipParticipant.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("relationship_identities", RelationshipIdentity.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("relationship_projection_jobs", RelationshipProjectionJob.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("evidence_keys", TenantEvidenceKey.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("feature_controls", WorkspaceFeatureControl.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("trust_events", RevenueTrustEvent.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("identity_candidates", RelationshipIdentityCandidate.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("relationship_lineage_events", RelationshipLineageEvent.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("relationship_identity_decisions", RelationshipIdentityDecision.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("relationship_review_acknowledgements", RelationshipReviewAcknowledgement.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("relationship_attention_items", RelationshipAttentionItem.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("relationship_observations", RelationshipObservation.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("relationship_assertions", RelationshipAssertion.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("relationship_state_snapshots", RelationshipStateSnapshot.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("relationship_source_statuses", RelationshipSourceStatus.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("relationship_persons", Person.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("entities", Entity.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("entity_resource_refs", EntityResourceRef.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("entity_identifiers", EntityIdentifier.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("person_identities", PersonIdentity.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("person_suppressions", PersonSuppression.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("person_attributes", PersonAttribute.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("person_interaction_stats", PersonInteractionStat.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
		edge.To("person_merge_candidates", PersonMergeCandidate.Type).
			StorageKey(edge.Column("revenue_workspace_id")),
	}
}

// Indexes of the RevenueWorkspace.
func (RevenueWorkspace) Indexes() []ent.Index {
	return []ent.Index{
		// One workspace per owner (founder-mode tenancy). This makes
		// CurrentWorkspace's get-or-create race-safe: a concurrent first
		// touch loses on the unique constraint and falls back to the winner's
		// row instead of silently splitting the tenant into two workspaces.
		index.Edges("user").Unique(),
	}
}
