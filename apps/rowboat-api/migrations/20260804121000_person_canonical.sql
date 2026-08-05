-- The workspace-canonical person, and everything derived from one.
--
-- A Person is NOT a Relationship: a kind="person" Relationship is an account whose
-- counterparty happens to be an individual; this is the individual, who may
-- participate in many accounts. Role and title deliberately stay on
-- relationship_participants, because they are assertions about one relationship --
-- the same human can be a champion on a renewal and a blocker on an expansion.
--
-- Mirrors ent/migrate/schema.go exactly: column order, types, foreign-key constraint
-- symbols and index names. Every statement is idempotent, so this is safe to apply
-- where AutoMigrate has already created the tables.

-- Enrichment columns here are MATERIALIZED from person_attributes by the person
-- projector. Nothing else may write them.
CREATE TABLE IF NOT EXISTS `relationship_persons` (
  `id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL,
  `display_name` text NOT NULL,
  `aliases` json NOT NULL,
  `primary_email` text NULL,
  `title` text NULL,
  `org_name` text NULL,
  `org_domain` text NULL,
  `phone` text NULL,
  `timezone` text NULL,
  `locale` text NULL,
  `attributes_version` integer NOT NULL DEFAULT (0),
  `attributes_hash` text NULL,
  `projector_version` integer NOT NULL DEFAULT (1),
  `projected_at` datetime NULL,
  `status` text NOT NULL DEFAULT ('active'),
  `merged_into_person_id` uuid NULL,
  `merged_at` datetime NULL,
  `first_interaction_at` datetime NULL,
  `last_interaction_at` datetime NULL,
  `relationship_count` integer NOT NULL DEFAULT (0),
  `revenue_workspace_id` uuid NOT NULL,
  `user_relationship_persons` uuid NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `relationship_persons_revenue_workspaces_relationship_persons`
    FOREIGN KEY (`revenue_workspace_id`) REFERENCES `revenue_workspaces` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_persons_users_relationship_persons`
    FOREIGN KEY (`user_relationship_persons`) REFERENCES `users` (`id`) ON DELETE NO ACTION
);
CREATE INDEX IF NOT EXISTS `person_status_revenue_workspace_id`
  ON `relationship_persons` (`status`, `revenue_workspace_id`);
CREATE INDEX IF NOT EXISTS `person_last_interaction_at_revenue_workspace_id`
  ON `relationship_persons` (`last_interaction_at`, `revenue_workspace_id`);
CREATE INDEX IF NOT EXISTS `person_primary_email_revenue_workspace_id`
  ON `relationship_persons` (`primary_email`, `revenue_workspace_id`);

-- Person-scope anchors. A SEPARATE table from relationship_identities, not a widened
-- one: a kind="person" Relationship and its Person both legitimately claim
-- jane@acme.com, and the workspace-unique key_hash index is the entire safety
-- property. Sharing it would let exactly one win and manufacture a review item on
-- every ingest forever.
--
-- There is no `domain` kind by construction. A corporate domain is shared by every
-- employee, so binding one to a person would collapse a company into one human.
CREATE TABLE IF NOT EXISTS `person_identities` (
  `id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL,
  `kind` text NOT NULL,
  `provider` text NULL,
  `key_hash` text NOT NULL,
  `normalized_value` text NOT NULL,
  `source` text NULL,
  `confidence` real NOT NULL DEFAULT (1),
  `first_seen_at` datetime NOT NULL,
  `last_seen_at` datetime NOT NULL,
  `person_id` uuid NOT NULL,
  `revenue_workspace_id` uuid NOT NULL,
  `user_person_identities` uuid NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `person_identities_relationship_persons_identities`
    FOREIGN KEY (`person_id`) REFERENCES `relationship_persons` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `person_identities_revenue_workspaces_person_identities`
    FOREIGN KEY (`revenue_workspace_id`) REFERENCES `revenue_workspaces` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `person_identities_users_person_identities`
    FOREIGN KEY (`user_person_identities`) REFERENCES `users` (`id`) ON DELETE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS `personidentity_key_hash_revenue_workspace_id`
  ON `person_identities` (`key_hash`, `revenue_workspace_id`);
CREATE INDEX IF NOT EXISTS `personidentity_kind_person_id`
  ON `person_identities` (`kind`, `person_id`);

-- Provenance-bearing enrichment claims, resolved by the same precedence ladder as
-- relationship_assertions: user_correction > source_fact > deterministic >
-- ai_inference. Values are asserted here and projected, never written directly, so
-- "why does it say she works at Acme?" always has a source and a timestamp.
CREATE TABLE IF NOT EXISTS `person_attributes` (
  `id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL,
  `dimension` text NOT NULL,
  `value` text NOT NULL,
  `source_type` text NOT NULL,
  `source` text NOT NULL,
  `extractor` text NOT NULL DEFAULT ('unknown'),
  `status` text NOT NULL DEFAULT ('active'),
  `confidence` real NOT NULL DEFAULT (0.5),
  `reason` text NULL,
  `observed_at` datetime NOT NULL,
  `valid_from` datetime NOT NULL,
  `valid_to` datetime NULL,
  `retracted_at` datetime NULL,
  `supersedes_attribute_id` text NULL,
  `extractor_version` text NOT NULL DEFAULT ('unknown-v1'),
  `dedupe_key` text NOT NULL,
  `supporting_observation_ids` json NOT NULL,
  `person_id` uuid NOT NULL,
  `observation_id` uuid NULL,
  `revenue_workspace_id` uuid NOT NULL,
  `user_person_attributes` uuid NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `person_attributes_relationship_persons_attributes`
    FOREIGN KEY (`person_id`) REFERENCES `relationship_persons` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `person_attributes_relationship_observations_person_attributes`
    FOREIGN KEY (`observation_id`) REFERENCES `relationship_observations` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `person_attributes_revenue_workspaces_person_attributes`
    FOREIGN KEY (`revenue_workspace_id`) REFERENCES `revenue_workspaces` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `person_attributes_users_person_attributes`
    FOREIGN KEY (`user_person_attributes`) REFERENCES `users` (`id`) ON DELETE NO ACTION
);
CREATE INDEX IF NOT EXISTS `personattribute_dimension_valid_from_person_id`
  ON `person_attributes` (`dimension`, `valid_from`, `person_id`);
CREATE INDEX IF NOT EXISTS `personattribute_status_valid_to_person_id`
  ON `person_attributes` (`status`, `valid_to`, `person_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `personattribute_dedupe_key_revenue_workspace_id`
  ON `person_attributes` (`dedupe_key`, `revenue_workspace_id`);

-- Scoped to the (person, relationship) pair, not to the person: "how often do we
-- talk to Jane" and "how often do we talk to Jane about the renewal" are different
-- questions, and only the second drives account attention. No user column -- a
-- rollup is derived and owned by the workspace, never authored.
CREATE TABLE IF NOT EXISTS `person_interaction_stats` (
  `id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL,
  `first_interaction_at` datetime NOT NULL,
  `last_interaction_at` datetime NOT NULL,
  `last_inbound_at` datetime NULL,
  `last_outbound_at` datetime NULL,
  `interaction_count` integer NOT NULL DEFAULT (0),
  `inbound_count` integer NOT NULL DEFAULT (0),
  `outbound_count` integer NOT NULL DEFAULT (0),
  `meeting_count` integer NOT NULL DEFAULT (0),
  `channel_counts` json NOT NULL,
  `source_counts` json NOT NULL,
  `last_channel` text NULL,
  `last_direction` text NULL,
  `person_id` uuid NOT NULL,
  `relationship_id` uuid NOT NULL,
  `revenue_workspace_id` uuid NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `person_interaction_stats_relationship_persons_interaction_stats`
    FOREIGN KEY (`person_id`) REFERENCES `relationship_persons` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `person_interaction_stats_relationships_person_interaction_stats`
    FOREIGN KEY (`relationship_id`) REFERENCES `relationships` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `person_interaction_stats_revenue_workspaces_person_interaction_stats`
    FOREIGN KEY (`revenue_workspace_id`) REFERENCES `revenue_workspaces` (`id`) ON DELETE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS `personinteractionstat_person_id_relationship_id`
  ON `person_interaction_stats` (`person_id`, `relationship_id`);
CREATE INDEX IF NOT EXISTS `personinteractionstat_last_interaction_at_relationship_id`
  ON `person_interaction_stats` (`last_interaction_at`, `relationship_id`);

-- Persons are never merged automatically. An anchor collision becomes a reviewable
-- candidate; the loser of an approved merge is tombstoned, not deleted, and
-- previous_state_json holds the exact moved id sets so the merge can be undone.
CREATE TABLE IF NOT EXISTS `person_merge_candidates` (
  `id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL,
  `dedupe_key` text NOT NULL,
  `status` text NOT NULL DEFAULT ('pending'),
  `candidate_type` text NOT NULL DEFAULT ('anchor_collision'),
  `anchor_kind` text NOT NULL,
  `anchor_provider` text NULL,
  `anchor_key_hash` text NOT NULL,
  `anchor_preview` text NULL,
  `matching_anchors` json NOT NULL,
  `conflicting_anchors` json NOT NULL,
  `impact_json` text NOT NULL DEFAULT ('{}'),
  `recommended_decision` text NOT NULL DEFAULT ('defer'),
  `confidence` real NOT NULL DEFAULT (0),
  `version` integer NOT NULL DEFAULT (1),
  `decision` text NULL,
  `decision_reason` text NULL,
  `decision_actor_id` uuid NULL,
  `decided_at` datetime NULL,
  `idempotency_key` text NULL,
  `previous_state_json` text NOT NULL DEFAULT ('{}'),
  `proposed_person_id` uuid NOT NULL,
  `existing_person_id` uuid NOT NULL,
  `revenue_workspace_id` uuid NOT NULL,
  `user_person_merge_candidates` uuid NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `person_merge_candidates_relationship_persons_proposed_merge_candidates`
    FOREIGN KEY (`proposed_person_id`) REFERENCES `relationship_persons` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `person_merge_candidates_relationship_persons_existing_merge_candidates`
    FOREIGN KEY (`existing_person_id`) REFERENCES `relationship_persons` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `person_merge_candidates_revenue_workspaces_person_merge_candidates`
    FOREIGN KEY (`revenue_workspace_id`) REFERENCES `revenue_workspaces` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `person_merge_candidates_users_person_merge_candidates`
    FOREIGN KEY (`user_person_merge_candidates`) REFERENCES `users` (`id`) ON DELETE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS `personmergecandidate_dedupe_key_revenue_workspace_id`
  ON `person_merge_candidates` (`dedupe_key`, `revenue_workspace_id`);
CREATE INDEX IF NOT EXISTS `personmergecandidate_status_created_at_revenue_workspace_id`
  ON `person_merge_candidates` (`status`, `created_at`, `revenue_workspace_id`);

-- Nullable, and it must be: every pre-existing participant row starts unlinked and
-- is filled in by the person backfill. Making it NOT NULL would require a
-- synchronous backfill inside this migration.
ALTER TABLE `relationship_participants` ADD COLUMN `person_id` uuid NULL
  REFERENCES `relationship_persons` (`id`) ON DELETE NO ACTION;
CREATE INDEX IF NOT EXISTS `relationshipparticipant_person_id`
  ON `relationship_participants` (`person_id`);
