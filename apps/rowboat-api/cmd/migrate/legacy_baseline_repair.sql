-- The first PostgreSQL Atlas baseline was cut after these legacy Ent changes,
-- but existing production databases were baselined before receiving them.
-- Keep this repair idempotent: it runs only when the baseline revision exists
-- and its relationship-attention sentinel table is missing.

ALTER TABLE "relationships"
  ADD COLUMN IF NOT EXISTS "state_hash" character varying NULL,
  ADD COLUMN IF NOT EXISTS "projector_version" bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "projected_at" timestamptz NULL;

ALTER TABLE "relationship_assertions"
  ADD COLUMN IF NOT EXISTS "status" character varying NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "valid_to" timestamptz NULL,
  ADD COLUMN IF NOT EXISTS "retracted_at" timestamptz NULL,
  ADD COLUMN IF NOT EXISTS "retraction_reason" text NULL,
  ADD COLUMN IF NOT EXISTS "extractor_version" character varying NOT NULL DEFAULT 'unknown-v1',
  ADD COLUMN IF NOT EXISTS "citations_json" text NULL,
  ADD COLUMN IF NOT EXISTS "projector_compat_version" bigint NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS "relationshipassertion_status_valid_to_relationship_id"
  ON "relationship_assertions" ("status", "valid_to", "relationship_id");

ALTER TABLE "relationship_state_snapshots"
  ADD COLUMN IF NOT EXISTS "state_hash" character varying NOT NULL DEFAULT 'legacy:pending-replay',
  ADD COLUMN IF NOT EXISTS "projector_version" bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "evaluated_at" timestamptz NOT NULL DEFAULT '1970-01-01 00:00:00+00:00';
UPDATE "relationship_state_snapshots"
SET "evaluated_at" = "created_at"
WHERE "evaluated_at" = '1970-01-01 00:00:00+00:00';
ALTER TABLE "relationship_state_snapshots"
  ALTER COLUMN "state_hash" DROP DEFAULT,
  ALTER COLUMN "evaluated_at" DROP DEFAULT;

ALTER TABLE "relationship_observations"
  ADD COLUMN IF NOT EXISTS "encryption_key_version" bigint NOT NULL DEFAULT 0;
ALTER TABLE "revenue_evidences"
  ADD COLUMN IF NOT EXISTS "encryption_key_version" bigint NOT NULL DEFAULT 0;

ALTER TABLE "relationship_source_status"
  ADD COLUMN IF NOT EXISTS "consenting_actor_id" uuid NULL,
  ADD COLUMN IF NOT EXISTS "backfill_phase" character varying NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS "backfill_completed" bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "backfill_total" bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "watermark" character varying NULL,
  ADD COLUMN IF NOT EXISTS "sync_started_at" timestamptz NULL,
  ADD COLUMN IF NOT EXISTS "authorization_started_at" timestamptz NULL,
  ADD COLUMN IF NOT EXISTS "authorized_at" timestamptz NULL,
  ADD COLUMN IF NOT EXISTS "backfill_completed_at" timestamptz NULL,
  ADD COLUMN IF NOT EXISTS "last_failed_sync_at" timestamptz NULL,
  ADD COLUMN IF NOT EXISTS "disconnected_at" timestamptz NULL,
  ADD COLUMN IF NOT EXISTS "revoked_at" timestamptz NULL,
  ADD COLUMN IF NOT EXISTS "last_sync_at" timestamptz NULL,
  ADD COLUMN IF NOT EXISTS "expected_cadence_seconds" bigint NOT NULL DEFAULT 900,
  ADD COLUMN IF NOT EXISTS "lag_seconds" bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "required_scopes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "granted_scopes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "missing_scopes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "error_code" character varying NULL,
  ADD COLUMN IF NOT EXISTS "retry_count" bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "next_retry_at" timestamptz NULL,
  ADD COLUMN IF NOT EXISTS "completeness" character varying NOT NULL DEFAULT 'partial',
  ADD COLUMN IF NOT EXISTS "last_provider_event_at" timestamptz NULL;
ALTER TABLE "relationship_source_status"
  ALTER COLUMN "status" SET DEFAULT 'not_connected',
  ALTER COLUMN "required_scopes" DROP DEFAULT,
  ALTER COLUMN "granted_scopes" DROP DEFAULT,
  ALTER COLUMN "missing_scopes" DROP DEFAULT;

ALTER TABLE "revenue_leak_scans"
  ADD COLUMN IF NOT EXISTS "active_claim" character varying NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "revenue_leak_scans_active_claim_key"
  ON "revenue_leak_scans" ("active_claim");

ALTER TABLE "background_tasks"
  ADD COLUMN IF NOT EXISTS "template_slug" character varying NULL,
  ADD COLUMN IF NOT EXISTS "template_version" bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "system_managed" boolean NOT NULL DEFAULT false;

ALTER TABLE "revenue_workspaces"
  ADD COLUMN IF NOT EXISTS "cloud_research_consent" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "cloud_research_consent_at" timestamptz NULL;

CREATE TABLE IF NOT EXISTS "relationship_persons" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "display_name" character varying NOT NULL,
  "aliases" jsonb NOT NULL,
  "primary_email" character varying NULL,
  "title" character varying NULL,
  "org_name" character varying NULL,
  "org_domain" character varying NULL,
  "phone" character varying NULL,
  "timezone" character varying NULL,
  "locale" character varying NULL,
  "seniority" character varying NULL,
  "location" character varying NULL,
  "employment_status" character varying NOT NULL DEFAULT 'unknown',
  "attributes_version" bigint NOT NULL DEFAULT 0,
  "attributes_hash" character varying NULL,
  "projector_version" bigint NOT NULL DEFAULT 1,
  "projected_at" timestamptz NULL,
  "status" character varying NOT NULL DEFAULT 'active',
  "merged_into_person_id" uuid NULL,
  "merged_at" timestamptz NULL,
  "first_interaction_at" timestamptz NULL,
  "last_interaction_at" timestamptz NULL,
  "relationship_count" bigint NOT NULL DEFAULT 0,
  "revenue_workspace_id" uuid NOT NULL,
  "user_relationship_persons" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "relationship_persons_revenue_workspaces_relationship_persons" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_persons_users_relationship_persons" FOREIGN KEY ("user_relationship_persons") REFERENCES "users" ("id") ON DELETE NO ACTION
);
CREATE INDEX IF NOT EXISTS "person_status_revenue_workspace_id" ON "relationship_persons" ("status", "revenue_workspace_id");
CREATE INDEX IF NOT EXISTS "person_last_interaction_at_revenue_workspace_id" ON "relationship_persons" ("last_interaction_at", "revenue_workspace_id");
CREATE INDEX IF NOT EXISTS "person_primary_email_revenue_workspace_id" ON "relationship_persons" ("primary_email", "revenue_workspace_id");

CREATE TABLE IF NOT EXISTS "person_attributes" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "dimension" character varying NOT NULL,
  "value" text NOT NULL,
  "source_type" character varying NOT NULL,
  "source" character varying NOT NULL,
  "extractor" character varying NOT NULL DEFAULT 'unknown',
  "status" character varying NOT NULL DEFAULT 'active',
  "confidence" double precision NOT NULL DEFAULT 0.5,
  "reason" text NULL,
  "observed_at" timestamptz NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz NULL,
  "retracted_at" timestamptz NULL,
  "supersedes_attribute_id" character varying NULL,
  "extractor_version" character varying NOT NULL DEFAULT 'unknown-v1',
  "citations_json" text NULL,
  "dedupe_key" character varying NOT NULL,
  "supporting_observation_ids" jsonb NOT NULL,
  "person_id" uuid NOT NULL,
  "observation_id" uuid NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_person_attributes" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "person_attributes_relationship_persons_attributes" FOREIGN KEY ("person_id") REFERENCES "relationship_persons" ("id") ON DELETE NO ACTION,
  CONSTRAINT "person_attributes_relationship_observations_person_attributes" FOREIGN KEY ("observation_id") REFERENCES "relationship_observations" ("id") ON DELETE SET NULL,
  CONSTRAINT "person_attributes_revenue_workspaces_person_attributes" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "person_attributes_users_person_attributes" FOREIGN KEY ("user_person_attributes") REFERENCES "users" ("id") ON DELETE NO ACTION
);
CREATE INDEX IF NOT EXISTS "personattribute_dimension_valid_from_person_id" ON "person_attributes" ("dimension", "valid_from", "person_id");
CREATE INDEX IF NOT EXISTS "personattribute_status_valid_to_person_id" ON "person_attributes" ("status", "valid_to", "person_id");
CREATE UNIQUE INDEX IF NOT EXISTS "personattribute_dedupe_key_revenue_workspace_id" ON "person_attributes" ("dedupe_key", "revenue_workspace_id");

CREATE TABLE IF NOT EXISTS "person_identities" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "kind" character varying NOT NULL,
  "provider" character varying NULL,
  "key_hash" character varying NOT NULL,
  "normalized_value" character varying NOT NULL,
  "source" character varying NULL,
  "confidence" double precision NOT NULL DEFAULT 1,
  "first_seen_at" timestamptz NOT NULL,
  "last_seen_at" timestamptz NOT NULL,
  "person_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_person_identities" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "person_identities_relationship_persons_identities" FOREIGN KEY ("person_id") REFERENCES "relationship_persons" ("id") ON DELETE NO ACTION,
  CONSTRAINT "person_identities_revenue_workspaces_person_identities" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "person_identities_users_person_identities" FOREIGN KEY ("user_person_identities") REFERENCES "users" ("id") ON DELETE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS "personidentity_key_hash_revenue_workspace_id" ON "person_identities" ("key_hash", "revenue_workspace_id");
CREATE INDEX IF NOT EXISTS "personidentity_kind_person_id" ON "person_identities" ("kind", "person_id");

CREATE TABLE IF NOT EXISTS "person_interaction_stats" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "first_interaction_at" timestamptz NOT NULL,
  "last_interaction_at" timestamptz NOT NULL,
  "last_inbound_at" timestamptz NULL,
  "last_outbound_at" timestamptz NULL,
  "interaction_count" bigint NOT NULL DEFAULT 0,
  "inbound_count" bigint NOT NULL DEFAULT 0,
  "outbound_count" bigint NOT NULL DEFAULT 0,
  "meeting_count" bigint NOT NULL DEFAULT 0,
  "channel_counts" jsonb NOT NULL,
  "source_counts" jsonb NOT NULL,
  "last_channel" character varying NULL,
  "last_direction" character varying NULL,
  "person_id" uuid NOT NULL,
  "relationship_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "person_interaction_stats_relationship_persons_interaction_stats" FOREIGN KEY ("person_id") REFERENCES "relationship_persons" ("id") ON DELETE NO ACTION,
  CONSTRAINT "person_interaction_stats_relationships_person_interaction_stats" FOREIGN KEY ("relationship_id") REFERENCES "relationships" ("id") ON DELETE NO ACTION,
  CONSTRAINT "person_interaction_stats_revenue_workspaces_person_interaction_stats" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS "personinteractionstat_person_id_relationship_id" ON "person_interaction_stats" ("person_id", "relationship_id");
CREATE INDEX IF NOT EXISTS "personinteractionstat_last_interaction_at_relationship_id" ON "person_interaction_stats" ("last_interaction_at", "relationship_id");

CREATE TABLE IF NOT EXISTS "person_merge_candidates" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "dedupe_key" character varying NOT NULL,
  "status" character varying NOT NULL DEFAULT 'pending',
  "candidate_type" character varying NOT NULL DEFAULT 'anchor_collision',
  "anchor_kind" character varying NOT NULL,
  "anchor_provider" character varying NULL,
  "anchor_key_hash" character varying NOT NULL,
  "anchor_preview" character varying NULL,
  "matching_anchors" jsonb NOT NULL,
  "conflicting_anchors" jsonb NOT NULL,
  "impact_json" text NOT NULL DEFAULT '{}',
  "recommended_decision" character varying NOT NULL DEFAULT 'defer',
  "confidence" double precision NOT NULL DEFAULT 0,
  "version" bigint NOT NULL DEFAULT 1,
  "decision" character varying NULL,
  "decision_reason" text NULL,
  "decision_actor_id" uuid NULL,
  "decided_at" timestamptz NULL,
  "idempotency_key" character varying NULL,
  "previous_state_json" text NOT NULL DEFAULT '{}',
  "proposed_person_id" uuid NOT NULL,
  "existing_person_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_person_merge_candidates" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "person_merge_candidates_relationship_persons_proposed_merge_candidates" FOREIGN KEY ("proposed_person_id") REFERENCES "relationship_persons" ("id") ON DELETE NO ACTION,
  CONSTRAINT "person_merge_candidates_relationship_persons_existing_merge_candidates" FOREIGN KEY ("existing_person_id") REFERENCES "relationship_persons" ("id") ON DELETE NO ACTION,
  CONSTRAINT "person_merge_candidates_revenue_workspaces_person_merge_candidates" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "person_merge_candidates_users_person_merge_candidates" FOREIGN KEY ("user_person_merge_candidates") REFERENCES "users" ("id") ON DELETE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS "personmergecandidate_dedupe_key_revenue_workspace_id" ON "person_merge_candidates" ("dedupe_key", "revenue_workspace_id");
CREATE INDEX IF NOT EXISTS "personmergecandidate_status_created_at_revenue_workspace_id" ON "person_merge_candidates" ("status", "created_at", "revenue_workspace_id");

CREATE TABLE IF NOT EXISTS "person_suppressions" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "key_hash" character varying NOT NULL,
  "kind" character varying NOT NULL,
  "reason" character varying NOT NULL DEFAULT 'user_action',
  "suppressed_at" timestamptz NOT NULL,
  "note" character varying NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_person_suppressions" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "person_suppressions_revenue_workspaces_person_suppressions" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "person_suppressions_users_person_suppressions" FOREIGN KEY ("user_person_suppressions") REFERENCES "users" ("id") ON DELETE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS "personsuppression_key_hash_revenue_workspace_id" ON "person_suppressions" ("key_hash", "revenue_workspace_id");

CREATE TABLE IF NOT EXISTS "relationship_attention_items" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "stable_key" character varying NOT NULL,
  "version" bigint NOT NULL DEFAULT 1,
  "reason_code" character varying NOT NULL,
  "explanation" text NOT NULL,
  "triggering_object_ref" character varying NOT NULL,
  "evidence_refs" jsonb NOT NULL,
  "urgency_band" character varying NOT NULL,
  "rank_score" bigint NOT NULL,
  "rank_factors_json" text NOT NULL,
  "source_requirements" jsonb NOT NULL,
  "recommendation_id" uuid NULL,
  "recommendation_revision" bigint NOT NULL DEFAULT 0,
  "owner_id" uuid NULL,
  "status" character varying NOT NULL DEFAULT 'open',
  "state_reason" text NULL,
  "snoozed_until" timestamptz NULL,
  "expires_at" timestamptz NULL,
  "detector_version" bigint NOT NULL DEFAULT 1,
  "projector_version" bigint NOT NULL DEFAULT 1,
  "relationship_state_version" bigint NOT NULL DEFAULT 0,
  "material_hash" character varying NOT NULL,
  "last_detected_at" timestamptz NOT NULL,
  "acknowledged_by" uuid NULL,
  "acknowledged_at" timestamptz NULL,
  "dismissed_by" uuid NULL,
  "dismissed_at" timestamptz NULL,
  "relationship_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_relationship_attention_items" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "relationship_attention_items_relationships_attention_items" FOREIGN KEY ("relationship_id") REFERENCES "relationships" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_attention_items_revenue_workspaces_relationship_attention_items" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_attention_items_users_relationship_attention_items" FOREIGN KEY ("user_relationship_attention_items") REFERENCES "users" ("id") ON DELETE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS "relationshipattentionitem_stable_key_revenue_workspace_id" ON "relationship_attention_items" ("stable_key", "revenue_workspace_id");
CREATE INDEX IF NOT EXISTS "relationshipattentionitem_status_rank_score_revenue_workspace_id" ON "relationship_attention_items" ("status", "rank_score", "revenue_workspace_id");
CREATE INDEX IF NOT EXISTS "relationshipattentionitem_status_relationship_id" ON "relationship_attention_items" ("status", "relationship_id");

CREATE TABLE IF NOT EXISTS "relationship_identity_candidates" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "dedupe_key" character varying NOT NULL,
  "status" character varying NOT NULL DEFAULT 'pending',
  "candidate_type" character varying NOT NULL DEFAULT 'anchor_collision',
  "anchor_kind" character varying NOT NULL,
  "anchor_provider" character varying NULL,
  "anchor_key_hash" character varying NOT NULL,
  "anchor_preview" character varying NULL,
  "matching_anchors" jsonb NOT NULL,
  "conflicting_anchors" jsonb NOT NULL,
  "evidence_refs" jsonb NOT NULL,
  "evidence_count" bigint NOT NULL DEFAULT 0,
  "evidence_from" timestamptz NULL,
  "evidence_to" timestamptz NULL,
  "impact_json" text NOT NULL DEFAULT '{}',
  "recommended_decision" character varying NOT NULL DEFAULT 'defer',
  "confidence" double precision NOT NULL DEFAULT 0,
  "version" bigint NOT NULL DEFAULT 1,
  "decision" character varying NULL,
  "decision_reason" character varying NULL,
  "decision_actor_id" uuid NULL,
  "decided_at" timestamptz NULL,
  "undoes_candidate_id" uuid NULL,
  "proposed_relationship_id" uuid NOT NULL,
  "existing_relationship_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_relationship_identity_candidates" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "relationship_identity_candidates_relationships_proposed_identity_candidates" FOREIGN KEY ("proposed_relationship_id") REFERENCES "relationships" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_identity_candidates_relationships_existing_identity_candidates" FOREIGN KEY ("existing_relationship_id") REFERENCES "relationships" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_identity_candidates_revenue_workspaces_identity_candidates" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_identity_candidates_users_relationship_identity_candidates" FOREIGN KEY ("user_relationship_identity_candidates") REFERENCES "users" ("id") ON DELETE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS "relationshipidentitycandidate_dedupe_key_revenue_workspace_id" ON "relationship_identity_candidates" ("dedupe_key", "revenue_workspace_id");
CREATE INDEX IF NOT EXISTS "relationshipidentitycandidate_status_created_at_revenue_workspace_id" ON "relationship_identity_candidates" ("status", "created_at", "revenue_workspace_id");

CREATE TABLE IF NOT EXISTS "relationship_identity_decisions" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "idempotency_key" character varying NOT NULL,
  "decision" character varying NOT NULL,
  "candidate_version" bigint NOT NULL,
  "actor_id" uuid NOT NULL,
  "reason" character varying NULL,
  "decided_at" timestamptz NOT NULL,
  "compensates_decision_id" uuid NULL,
  "identity_candidate_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_relationship_identity_decisions" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "relationship_identity_decisions_relationship_identity_candidates_decisions" FOREIGN KEY ("identity_candidate_id") REFERENCES "relationship_identity_candidates" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_identity_decisions_revenue_workspaces_relationship_identity_decisions" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_identity_decisions_users_relationship_identity_decisions" FOREIGN KEY ("user_relationship_identity_decisions") REFERENCES "users" ("id") ON DELETE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS "relationshipidentitydecision_idempotency_key_revenue_workspace_id" ON "relationship_identity_decisions" ("idempotency_key", "revenue_workspace_id");
CREATE UNIQUE INDEX IF NOT EXISTS "relationshipidentitydecision_candidate_version_identity_candidate_id" ON "relationship_identity_decisions" ("candidate_version", "identity_candidate_id");

CREATE TABLE IF NOT EXISTS "relationship_lineage_events" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "kind" character varying NOT NULL,
  "actor_id" uuid NOT NULL,
  "reason" character varying NULL,
  "observation_ids" jsonb NOT NULL,
  "identity_ids" jsonb NOT NULL,
  "moved_object_refs" jsonb NOT NULL,
  "before_relationship_ids" jsonb NOT NULL,
  "after_relationship_ids" jsonb NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "identity_candidate_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_relationship_lineage_events" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "relationship_lineage_events_relationship_identity_candidates_lineage_events" FOREIGN KEY ("identity_candidate_id") REFERENCES "relationship_identity_candidates" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_lineage_events_revenue_workspaces_relationship_lineage_events" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_lineage_events_users_relationship_lineage_events" FOREIGN KEY ("user_relationship_lineage_events") REFERENCES "users" ("id") ON DELETE NO ACTION
);
CREATE INDEX IF NOT EXISTS "relationshiplineageevent_occurred_at_revenue_workspace_id" ON "relationship_lineage_events" ("occurred_at", "revenue_workspace_id");
CREATE INDEX IF NOT EXISTS "relationshiplineageevent_created_at_identity_candidate_id" ON "relationship_lineage_events" ("created_at", "identity_candidate_id");

CREATE TABLE IF NOT EXISTS "relationship_projection_jobs" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "idempotency_key" character varying NOT NULL,
  "status" character varying NOT NULL DEFAULT 'pending',
  "projector_version" bigint NOT NULL DEFAULT 1,
  "evaluated_at" timestamptz NOT NULL,
  "trigger_refs" jsonb NOT NULL,
  "attempts" bigint NOT NULL DEFAULT 0,
  "next_attempt_at" timestamptz NULL,
  "lease_owner" character varying NULL,
  "lease_expires_at" timestamptz NULL,
  "last_error" text NULL,
  "completed_at" timestamptz NULL,
  "result_state_hash" character varying NULL,
  "relationship_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_relationship_projection_jobs" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "relationship_projection_jobs_relationships_projection_jobs" FOREIGN KEY ("relationship_id") REFERENCES "relationships" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_projection_jobs_revenue_workspaces_relationship_projection_jobs" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_projection_jobs_users_relationship_projection_jobs" FOREIGN KEY ("user_relationship_projection_jobs") REFERENCES "users" ("id") ON DELETE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS "relationship_projection_jobs_idempotency_key_key" ON "relationship_projection_jobs" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "relationshipprojectionjob_status_next_attempt_at_lease_expires_at" ON "relationship_projection_jobs" ("status", "next_attempt_at", "lease_expires_at");
CREATE INDEX IF NOT EXISTS "relationshipprojectionjob_status_created_at_relationship_id" ON "relationship_projection_jobs" ("status", "created_at", "relationship_id");

CREATE TABLE IF NOT EXISTS "relationship_review_acknowledgements" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "state_version" bigint NOT NULL,
  "state_hash" character varying NULL,
  "acknowledged_at" timestamptz NOT NULL,
  "relationship_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_relationship_review_acknowledgements" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "relationship_review_acknowledgements_relationships_review_acknowledgements" FOREIGN KEY ("relationship_id") REFERENCES "relationships" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_review_acknowledgements_revenue_workspaces_relationship_review_acknowledgements" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_review_acknowledgements_users_relationship_review_acknowledgements" FOREIGN KEY ("user_relationship_review_acknowledgements") REFERENCES "users" ("id") ON DELETE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS "relationshipreviewacknowledgement_state_version_relationship_id_user_relationship_review_acknowledgements" ON "relationship_review_acknowledgements" ("state_version", "relationship_id", "user_relationship_review_acknowledgements");
CREATE INDEX IF NOT EXISTS "relationshipreviewacknowledgement_acknowledged_at_revenue_workspace_id_user_relationship_review_acknowledgements" ON "relationship_review_acknowledgements" ("acknowledged_at", "revenue_workspace_id", "user_relationship_review_acknowledgements");

CREATE TABLE IF NOT EXISTS "revenue_trust_events" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "event_name" character varying NOT NULL,
  "outcome" character varying NOT NULL,
  "reason_code" character varying NULL,
  "correlation_id" character varying NULL,
  "source" character varying NULL,
  "channel" character varying NULL,
  "state_version" bigint NULL,
  "duration_ms" bigint NULL,
  "occurred_at" timestamptz NOT NULL,
  "relationship_id" uuid NULL,
  "revenue_action_id" uuid NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_revenue_trust_events" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "revenue_trust_events_relationships_trust_events" FOREIGN KEY ("relationship_id") REFERENCES "relationships" ("id") ON DELETE SET NULL,
  CONSTRAINT "revenue_trust_events_revenue_actions_trust_events" FOREIGN KEY ("revenue_action_id") REFERENCES "revenue_actions" ("id") ON DELETE SET NULL,
  CONSTRAINT "revenue_trust_events_revenue_workspaces_trust_events" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "revenue_trust_events_users_revenue_trust_events" FOREIGN KEY ("user_revenue_trust_events") REFERENCES "users" ("id") ON DELETE NO ACTION
);
CREATE INDEX IF NOT EXISTS "revenuetrustevent_event_name_occurred_at_revenue_workspace_id" ON "revenue_trust_events" ("event_name", "occurred_at", "revenue_workspace_id");
CREATE INDEX IF NOT EXISTS "revenuetrustevent_correlation_id" ON "revenue_trust_events" ("correlation_id");

CREATE TABLE IF NOT EXISTS "tenant_evidence_keys" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "version" bigint NOT NULL,
  "status" character varying NOT NULL DEFAULT 'active',
  "wrapped_key" bytea NULL,
  "key_fingerprint" character varying NOT NULL,
  "rotated_at" timestamptz NULL,
  "destroyed_at" timestamptz NULL,
  "erasure_proof" character varying NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_tenant_evidence_keys" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "tenant_evidence_keys_revenue_workspaces_evidence_keys" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "tenant_evidence_keys_users_tenant_evidence_keys" FOREIGN KEY ("user_tenant_evidence_keys") REFERENCES "users" ("id") ON DELETE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS "tenantevidencekey_version_revenue_workspace_id" ON "tenant_evidence_keys" ("version", "revenue_workspace_id");
CREATE INDEX IF NOT EXISTS "tenantevidencekey_status_revenue_workspace_id" ON "tenant_evidence_keys" ("status", "revenue_workspace_id");

CREATE TABLE IF NOT EXISTS "workspace_feature_controls" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "capability" character varying NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "rollout_stage" character varying NOT NULL DEFAULT 'synthetic',
  "reason_code" character varying NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_workspace_feature_controls" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "workspace_feature_controls_revenue_workspaces_feature_controls" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "workspace_feature_controls_users_workspace_feature_controls" FOREIGN KEY ("user_workspace_feature_controls") REFERENCES "users" ("id") ON DELETE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS "workspacefeaturecontrol_capability_revenue_workspace_id" ON "workspace_feature_controls" ("capability", "revenue_workspace_id");

ALTER TABLE "relationship_participants"
  ADD COLUMN IF NOT EXISTS "person_id" uuid NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'relationship_participants_relationship_persons_participants'
  ) THEN
    ALTER TABLE "relationship_participants"
      ADD CONSTRAINT "relationship_participants_relationship_persons_participants"
      FOREIGN KEY ("person_id") REFERENCES "relationship_persons" ("id") ON DELETE SET NULL;
  END IF;
END
$$;

UPDATE "relationships" AS r
SET "last_touch_at" = observations.last_touch_at
FROM (
  SELECT "relationship_id", MAX("occurred_at") AS last_touch_at
  FROM "relationship_observations"
  GROUP BY "relationship_id"
) AS observations
WHERE observations."relationship_id" = r."id";
