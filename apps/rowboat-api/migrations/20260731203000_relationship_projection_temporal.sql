-- RFC 038 Phase A: temporal assertion lifecycle and deterministic projection
-- metadata. Existing snapshots are explicitly marked for replay; the replay
-- worker replaces the legacy marker with a verified state hash.

ALTER TABLE `relationships` ADD COLUMN `state_hash` text NULL;
ALTER TABLE `relationships` ADD COLUMN `projector_version` integer NOT NULL DEFAULT (1);
ALTER TABLE `relationships` ADD COLUMN `projected_at` datetime NULL;

ALTER TABLE `relationship_assertions` ADD COLUMN `status` text NOT NULL DEFAULT ('active');
ALTER TABLE `relationship_assertions` ADD COLUMN `valid_to` datetime NULL;
ALTER TABLE `relationship_assertions` ADD COLUMN `retracted_at` datetime NULL;
ALTER TABLE `relationship_assertions` ADD COLUMN `retraction_reason` text NULL;
ALTER TABLE `relationship_assertions` ADD COLUMN `extractor_version` text NOT NULL DEFAULT ('unknown-v1');
ALTER TABLE `relationship_assertions` ADD COLUMN `projector_compat_version` integer NOT NULL DEFAULT (1);

CREATE INDEX IF NOT EXISTS `relationshipassertion_status_valid_to_relationship_id`
  ON `relationship_assertions` (`status`, `valid_to`, `relationship_id`);

ALTER TABLE `relationship_state_snapshots`
  ADD COLUMN `state_hash` text NOT NULL DEFAULT ('legacy:pending-replay');
ALTER TABLE `relationship_state_snapshots`
  ADD COLUMN `projector_version` integer NOT NULL DEFAULT (1);
ALTER TABLE `relationship_state_snapshots`
  ADD COLUMN `evaluated_at` datetime NOT NULL DEFAULT ('1970-01-01 00:00:00+00:00');

UPDATE `relationship_state_snapshots`
SET `evaluated_at` = `created_at`
WHERE `evaluated_at` = '1970-01-01 00:00:00+00:00';

CREATE TABLE IF NOT EXISTS `relationship_projection_jobs` (
  `id` uuid NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `idempotency_key` text NOT NULL,
  `status` text NOT NULL DEFAULT ('pending'),
  `projector_version` integer NOT NULL DEFAULT (1),
  `evaluated_at` datetime NOT NULL,
  `trigger_refs` json NOT NULL,
  `attempts` integer NOT NULL DEFAULT (0),
  `next_attempt_at` datetime NULL,
  `lease_owner` text NULL,
  `lease_expires_at` datetime NULL,
  `last_error` text NULL,
  `completed_at` datetime NULL,
  `result_state_hash` text NULL,
  `relationship_id` uuid NOT NULL,
  `revenue_workspace_id` uuid NOT NULL,
  `user_relationship_projection_jobs` uuid NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `relationship_projection_jobs_relationships_projection_jobs`
    FOREIGN KEY (`relationship_id`) REFERENCES `relationships` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_projection_jobs_revenue_workspaces_relationship_projection_jobs`
    FOREIGN KEY (`revenue_workspace_id`) REFERENCES `revenue_workspaces` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_projection_jobs_users_relationship_projection_jobs`
    FOREIGN KEY (`user_relationship_projection_jobs`) REFERENCES `users` (`id`) ON DELETE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS `relationship_projection_jobs_idempotency_key_key`
  ON `relationship_projection_jobs` (`idempotency_key`);
CREATE INDEX IF NOT EXISTS `relationshipprojectionjob_status_next_attempt_at_lease_expires_at`
  ON `relationship_projection_jobs` (`status`, `next_attempt_at`, `lease_expires_at`);
CREATE INDEX IF NOT EXISTS `relationshipprojectionjob_status_created_at_relationship_id`
  ON `relationship_projection_jobs` (`status`, `created_at`, `relationship_id`);

-- Per-tenant raw-evidence envelope keys. Version zero on existing ciphertext
-- means the legacy deployment key; every new encrypted row records a tenant
-- DEK version.
ALTER TABLE `relationship_observations`
  ADD COLUMN `encryption_key_version` integer NOT NULL DEFAULT (0);
ALTER TABLE `revenue_evidences`
  ADD COLUMN `encryption_key_version` integer NOT NULL DEFAULT (0);

CREATE TABLE IF NOT EXISTS `tenant_evidence_keys` (
  `id` uuid NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `version` integer NOT NULL,
  `status` text NOT NULL DEFAULT ('active'),
  `wrapped_key` blob NULL,
  `key_fingerprint` text NOT NULL,
  `rotated_at` datetime NULL,
  `destroyed_at` datetime NULL,
  `erasure_proof` text NULL,
  `revenue_workspace_id` uuid NOT NULL,
  `user_tenant_evidence_keys` uuid NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `tenant_evidence_keys_revenue_workspaces_evidence_keys`
    FOREIGN KEY (`revenue_workspace_id`) REFERENCES `revenue_workspaces` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `tenant_evidence_keys_users_tenant_evidence_keys`
    FOREIGN KEY (`user_tenant_evidence_keys`) REFERENCES `users` (`id`) ON DELETE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS `tenantevidencekey_version_revenue_workspace_id`
  ON `tenant_evidence_keys` (`version`, `revenue_workspace_id`);
CREATE INDEX IF NOT EXISTS `tenantevidencekey_status_revenue_workspace_id`
  ON `tenant_evidence_keys` (`status`, `revenue_workspace_id`);

CREATE TABLE IF NOT EXISTS `workspace_feature_controls` (
  `id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL,
  `capability` text NOT NULL, `enabled` bool NOT NULL DEFAULT (false),
  `rollout_stage` text NOT NULL DEFAULT ('synthetic'), `reason_code` text NULL,
  `revenue_workspace_id` uuid NOT NULL, `user_workspace_feature_controls` uuid NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `workspace_feature_controls_revenue_workspaces_feature_controls`
    FOREIGN KEY (`revenue_workspace_id`) REFERENCES `revenue_workspaces` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `workspace_feature_controls_users_workspace_feature_controls`
    FOREIGN KEY (`user_workspace_feature_controls`) REFERENCES `users` (`id`) ON DELETE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS `workspacefeaturecontrol_capability_revenue_workspace_id`
  ON `workspace_feature_controls` (`capability`, `revenue_workspace_id`);

CREATE TABLE IF NOT EXISTS `revenue_trust_events` (
  `id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL,
  `event_name` text NOT NULL, `outcome` text NOT NULL, `reason_code` text NULL,
  `correlation_id` text NULL, `source` text NULL, `channel` text NULL,
  `state_version` integer NULL, `duration_ms` integer NULL, `occurred_at` datetime NOT NULL,
  `relationship_id` uuid NULL, `revenue_action_id` uuid NULL,
  `revenue_workspace_id` uuid NOT NULL, `user_revenue_trust_events` uuid NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `revenue_trust_events_relationships_trust_events`
    FOREIGN KEY (`relationship_id`) REFERENCES `relationships` (`id`) ON DELETE SET NULL,
  CONSTRAINT `revenue_trust_events_revenue_actions_trust_events`
    FOREIGN KEY (`revenue_action_id`) REFERENCES `revenue_actions` (`id`) ON DELETE SET NULL,
  CONSTRAINT `revenue_trust_events_revenue_workspaces_trust_events`
    FOREIGN KEY (`revenue_workspace_id`) REFERENCES `revenue_workspaces` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `revenue_trust_events_users_revenue_trust_events`
    FOREIGN KEY (`user_revenue_trust_events`) REFERENCES `users` (`id`) ON DELETE NO ACTION
);
CREATE INDEX IF NOT EXISTS `revenuetrustevent_event_name_occurred_at_revenue_workspace_id`
  ON `revenue_trust_events` (`event_name`, `occurred_at`, `revenue_workspace_id`);
CREATE INDEX IF NOT EXISTS `revenuetrustevent_correlation_id`
  ON `revenue_trust_events` (`correlation_id`);

ALTER TABLE `relationship_source_status`
  ADD COLUMN `backfill_phase` text NOT NULL DEFAULT ('idle');
ALTER TABLE `relationship_source_status`
  ADD COLUMN `backfill_completed` integer NOT NULL DEFAULT (0);
ALTER TABLE `relationship_source_status`
  ADD COLUMN `backfill_total` integer NOT NULL DEFAULT (0);
ALTER TABLE `relationship_source_status` ADD COLUMN `watermark` text NULL;
ALTER TABLE `relationship_source_status` ADD COLUMN `sync_started_at` datetime NULL;
ALTER TABLE `relationship_source_status` ADD COLUMN `consenting_actor_id` uuid NULL;
ALTER TABLE `relationship_source_status` ADD COLUMN `authorization_started_at` datetime NULL;
ALTER TABLE `relationship_source_status` ADD COLUMN `authorized_at` datetime NULL;
ALTER TABLE `relationship_source_status` ADD COLUMN `backfill_completed_at` datetime NULL;
ALTER TABLE `relationship_source_status` ADD COLUMN `last_failed_sync_at` datetime NULL;
ALTER TABLE `relationship_source_status` ADD COLUMN `disconnected_at` datetime NULL;
ALTER TABLE `relationship_source_status` ADD COLUMN `revoked_at` datetime NULL;
ALTER TABLE `relationship_source_status` ADD COLUMN `last_sync_at` datetime NULL;
ALTER TABLE `relationship_source_status` ADD COLUMN `last_provider_event_at` datetime NULL;
ALTER TABLE `relationship_source_status`
  ADD COLUMN `expected_cadence_seconds` integer NOT NULL DEFAULT (900);
ALTER TABLE `relationship_source_status`
  ADD COLUMN `lag_seconds` integer NOT NULL DEFAULT (0);
ALTER TABLE `relationship_source_status`
  ADD COLUMN `required_scopes` json NOT NULL DEFAULT ('[]');
ALTER TABLE `relationship_source_status`
  ADD COLUMN `granted_scopes` json NOT NULL DEFAULT ('[]');
ALTER TABLE `relationship_source_status`
  ADD COLUMN `missing_scopes` json NOT NULL DEFAULT ('[]');
ALTER TABLE `relationship_source_status` ADD COLUMN `error_code` text NULL;
ALTER TABLE `relationship_source_status`
  ADD COLUMN `retry_count` integer NOT NULL DEFAULT (0);
ALTER TABLE `relationship_source_status` ADD COLUMN `next_retry_at` datetime NULL;
ALTER TABLE `relationship_source_status`
  ADD COLUMN `completeness` text NOT NULL DEFAULT ('partial');

-- Durable, fail-closed identity review. Candidates hold the current optimistic
-- projection; decisions and lineage are append-only audit records.
CREATE TABLE IF NOT EXISTS `relationship_identity_candidates` (
  `id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL,
  `dedupe_key` text NOT NULL, `status` text NOT NULL DEFAULT ('pending'),
  `candidate_type` text NOT NULL DEFAULT ('anchor_collision'),
  `anchor_kind` text NOT NULL, `anchor_provider` text NULL,
  `anchor_key_hash` text NOT NULL, `anchor_preview` text NULL,
  `matching_anchors` json NOT NULL, `conflicting_anchors` json NOT NULL,
  `evidence_refs` json NOT NULL, `evidence_count` integer NOT NULL DEFAULT (0),
  `evidence_from` datetime NULL, `evidence_to` datetime NULL,
  `impact_json` text NOT NULL DEFAULT ('{}'),
  `recommended_decision` text NOT NULL DEFAULT ('defer'),
  `confidence` real NOT NULL DEFAULT (0), `version` integer NOT NULL DEFAULT (1),
  `decision` text NULL, `decision_reason` text NULL,
  `decision_actor_id` uuid NULL, `decided_at` datetime NULL,
  `undoes_candidate_id` uuid NULL,
  `proposed_relationship_id` uuid NOT NULL, `existing_relationship_id` uuid NOT NULL,
  `revenue_workspace_id` uuid NOT NULL,
  `user_relationship_identity_candidates` uuid NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `relationship_identity_candidates_relationships_proposed_identity_candidates`
    FOREIGN KEY (`proposed_relationship_id`) REFERENCES `relationships` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_identity_candidates_relationships_existing_identity_candidates`
    FOREIGN KEY (`existing_relationship_id`) REFERENCES `relationships` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_identity_candidates_revenue_workspaces_identity_candidates`
    FOREIGN KEY (`revenue_workspace_id`) REFERENCES `revenue_workspaces` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_identity_candidates_users_relationship_identity_candidates`
    FOREIGN KEY (`user_relationship_identity_candidates`) REFERENCES `users` (`id`) ON DELETE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS `relationshipidentitycandidate_dedupe_key_revenue_workspace_id`
  ON `relationship_identity_candidates` (`dedupe_key`, `revenue_workspace_id`);
CREATE INDEX IF NOT EXISTS `relationshipidentitycandidate_status_created_at_revenue_workspace_id`
  ON `relationship_identity_candidates` (`status`, `created_at`, `revenue_workspace_id`);

CREATE TABLE IF NOT EXISTS `relationship_identity_decisions` (
  `id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL,
  `idempotency_key` text NOT NULL, `decision` text NOT NULL,
  `candidate_version` integer NOT NULL, `actor_id` uuid NOT NULL,
  `reason` text NULL, `decided_at` datetime NOT NULL,
  `compensates_decision_id` uuid NULL, `identity_candidate_id` uuid NOT NULL,
  `revenue_workspace_id` uuid NOT NULL,
  `user_relationship_identity_decisions` uuid NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `relationship_identity_decisions_relationship_identity_candidates_decisions`
    FOREIGN KEY (`identity_candidate_id`) REFERENCES `relationship_identity_candidates` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_identity_decisions_revenue_workspaces_relationship_identity_decisions`
    FOREIGN KEY (`revenue_workspace_id`) REFERENCES `revenue_workspaces` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_identity_decisions_users_relationship_identity_decisions`
    FOREIGN KEY (`user_relationship_identity_decisions`) REFERENCES `users` (`id`) ON DELETE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS `relationshipidentitydecision_idempotency_key_revenue_workspace_id`
  ON `relationship_identity_decisions` (`idempotency_key`, `revenue_workspace_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `relationshipidentitydecision_candidate_version_identity_candidate_id`
  ON `relationship_identity_decisions` (`candidate_version`, `identity_candidate_id`);

CREATE TABLE IF NOT EXISTS `relationship_lineage_events` (
  `id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL,
  `kind` text NOT NULL, `actor_id` uuid NOT NULL, `reason` text NULL,
  `observation_ids` json NOT NULL, `identity_ids` json NOT NULL,
  `moved_object_refs` json NOT NULL,
  `before_relationship_ids` json NOT NULL, `after_relationship_ids` json NOT NULL,
  `occurred_at` datetime NOT NULL, `identity_candidate_id` uuid NOT NULL,
  `revenue_workspace_id` uuid NOT NULL,
  `user_relationship_lineage_events` uuid NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `relationship_lineage_events_relationship_identity_candidates_lineage_events`
    FOREIGN KEY (`identity_candidate_id`) REFERENCES `relationship_identity_candidates` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_lineage_events_revenue_workspaces_relationship_lineage_events`
    FOREIGN KEY (`revenue_workspace_id`) REFERENCES `revenue_workspaces` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_lineage_events_users_relationship_lineage_events`
    FOREIGN KEY (`user_relationship_lineage_events`) REFERENCES `users` (`id`) ON DELETE NO ACTION
);
CREATE INDEX IF NOT EXISTS `relationshiplineageevent_occurred_at_revenue_workspace_id`
  ON `relationship_lineage_events` (`occurred_at`, `revenue_workspace_id`);
CREATE INDEX IF NOT EXISTS `relationshiplineageevent_created_at_identity_candidate_id`
  ON `relationship_lineage_events` (`created_at`, `identity_candidate_id`);

CREATE TABLE IF NOT EXISTS `relationship_review_acknowledgements` (
  `id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL,
  `state_version` integer NOT NULL, `state_hash` text NULL,
  `acknowledged_at` datetime NOT NULL, `relationship_id` uuid NOT NULL,
  `revenue_workspace_id` uuid NOT NULL,
  `user_relationship_review_acknowledgements` uuid NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `relationship_review_acknowledgements_relationships_review_acknowledgements`
    FOREIGN KEY (`relationship_id`) REFERENCES `relationships` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_review_acknowledgements_revenue_workspaces_relationship_review_acknowledgements`
    FOREIGN KEY (`revenue_workspace_id`) REFERENCES `revenue_workspaces` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_review_acknowledgements_users_relationship_review_acknowledgements`
    FOREIGN KEY (`user_relationship_review_acknowledgements`) REFERENCES `users` (`id`) ON DELETE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS `relationshipreviewacknowledgement_state_version_relationship_id_user_relationship_review_acknowledgements`
  ON `relationship_review_acknowledgements` (`state_version`, `relationship_id`, `user_relationship_review_acknowledgements`);
CREATE INDEX IF NOT EXISTS `relationshipreviewacknowledgement_acknowledged_at_revenue_workspace_id_user_relationship_review_acknowledgements`
  ON `relationship_review_acknowledgements` (`acknowledged_at`, `revenue_workspace_id`, `user_relationship_review_acknowledgements`);

-- Relationship-native portfolio attention projection. Triage state is
-- intentionally separate from recommendation approval/execution state.
CREATE TABLE IF NOT EXISTS `relationship_attention_items` (
  `id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL,
  `stable_key` text NOT NULL, `version` integer NOT NULL DEFAULT (1),
  `reason_code` text NOT NULL, `explanation` text NOT NULL,
  `triggering_object_ref` text NOT NULL, `evidence_refs` json NOT NULL,
  `urgency_band` text NOT NULL, `rank_score` integer NOT NULL,
  `rank_factors_json` text NOT NULL, `source_requirements` json NOT NULL,
  `recommendation_id` uuid NULL, `recommendation_revision` integer NOT NULL DEFAULT (0),
  `owner_id` uuid NULL, `status` text NOT NULL DEFAULT ('open'),
  `state_reason` text NULL, `snoozed_until` datetime NULL, `expires_at` datetime NULL,
  `detector_version` integer NOT NULL DEFAULT (1),
  `projector_version` integer NOT NULL DEFAULT (1),
  `relationship_state_version` integer NOT NULL DEFAULT (0),
  `material_hash` text NOT NULL, `last_detected_at` datetime NOT NULL,
  `acknowledged_by` uuid NULL, `acknowledged_at` datetime NULL,
  `dismissed_by` uuid NULL, `dismissed_at` datetime NULL,
  `relationship_id` uuid NOT NULL, `revenue_workspace_id` uuid NOT NULL,
  `user_relationship_attention_items` uuid NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `relationship_attention_items_relationships_attention_items`
    FOREIGN KEY (`relationship_id`) REFERENCES `relationships` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_attention_items_revenue_workspaces_relationship_attention_items`
    FOREIGN KEY (`revenue_workspace_id`) REFERENCES `revenue_workspaces` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_attention_items_users_relationship_attention_items`
    FOREIGN KEY (`user_relationship_attention_items`) REFERENCES `users` (`id`) ON DELETE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS `relationshipattentionitem_stable_key_revenue_workspace_id`
  ON `relationship_attention_items` (`stable_key`, `revenue_workspace_id`);
CREATE INDEX IF NOT EXISTS `relationshipattentionitem_status_rank_score_revenue_workspace_id`
  ON `relationship_attention_items` (`status`, `rank_score`, `revenue_workspace_id`);
CREATE INDEX IF NOT EXISTS `relationshipattentionitem_status_relationship_id`
  ON `relationship_attention_items` (`status`, `relationship_id`);
