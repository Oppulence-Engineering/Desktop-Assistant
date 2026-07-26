-- RFC 036: canonical relationship state. Existing relationships gain the
-- materialized projection used by both clients; the append-only observation,
-- assertion, and snapshot tables retain the evidence and projection history.

ALTER TABLE `relationships` ADD COLUMN `next_action` text NULL;
ALTER TABLE `relationships` ADD COLUMN `lifecycle` text NOT NULL DEFAULT ('prospect');
ALTER TABLE `relationships` ADD COLUMN `engagement` text NOT NULL DEFAULT ('unknown');
ALTER TABLE `relationships` ADD COLUMN `sentiment` text NOT NULL DEFAULT ('unknown');
ALTER TABLE `relationships` ADD COLUMN `health` text NOT NULL DEFAULT ('unknown');
ALTER TABLE `relationships` ADD COLUMN `state_reason` text NULL;
ALTER TABLE `relationships` ADD COLUMN `state_version` integer NOT NULL DEFAULT (0);
ALTER TABLE `relationships` ADD COLUMN `last_changed_at` datetime NULL;
ALTER TABLE `relationships` ADD COLUMN `risks` json NOT NULL DEFAULT ('[]');
ALTER TABLE `relationships` ADD COLUMN `milestones` json NOT NULL DEFAULT ('[]');

CREATE TABLE IF NOT EXISTS `relationship_participants` (
  `id` uuid NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `display_name` text NOT NULL,
  `email` text NULL,
  `role` text NOT NULL DEFAULT ('contact'),
  `title` text NULL,
  `active` bool NOT NULL DEFAULT (true),
  `external_refs` json NOT NULL,
  `relationship_id` uuid NOT NULL,
  `revenue_workspace_id` uuid NOT NULL,
  `user_relationship_participants` uuid NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `relationship_participants_relationships_participants`
    FOREIGN KEY (`relationship_id`) REFERENCES `relationships` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_participants_revenue_workspaces_relationship_participants`
    FOREIGN KEY (`revenue_workspace_id`) REFERENCES `revenue_workspaces` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_participants_users_relationship_participants`
    FOREIGN KEY (`user_relationship_participants`) REFERENCES `users` (`id`) ON DELETE NO ACTION
);
CREATE INDEX IF NOT EXISTS `relationshipparticipant_email_relationship_id`
  ON `relationship_participants` (`email`, `relationship_id`);
CREATE INDEX IF NOT EXISTS `relationshipparticipant_email_revenue_workspace_id`
  ON `relationship_participants` (`email`, `revenue_workspace_id`);

CREATE TABLE IF NOT EXISTS `relationship_observations` (
  `id` uuid NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `source` text NOT NULL,
  `source_account_id` text NULL,
  `external_id` text NOT NULL,
  `source_version` text NOT NULL DEFAULT ('1'),
  `event_type` text NOT NULL,
  `occurred_at` datetime NOT NULL,
  `received_at` datetime NOT NULL,
  `summary` text NULL,
  `normalized_facts_json` text NOT NULL DEFAULT ('{}'),
  `content_hash` text NOT NULL,
  `payload_ciphertext` blob NULL,
  `relationship_id` uuid NOT NULL,
  `revenue_workspace_id` uuid NOT NULL,
  `user_relationship_observations` uuid NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `relationship_observations_relationships_observations`
    FOREIGN KEY (`relationship_id`) REFERENCES `relationships` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_observations_revenue_workspaces_relationship_observations`
    FOREIGN KEY (`revenue_workspace_id`) REFERENCES `revenue_workspaces` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_observations_users_relationship_observations`
    FOREIGN KEY (`user_relationship_observations`) REFERENCES `users` (`id`) ON DELETE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS `relationshipobservation_source__00d9f626f392471f5e836274ccfa36e7`
  ON `relationship_observations` (`source`, `external_id`, `source_version`, `revenue_workspace_id`);
CREATE INDEX IF NOT EXISTS `relationshipobservation_occurred_at_relationship_id`
  ON `relationship_observations` (`occurred_at`, `relationship_id`);

CREATE TABLE IF NOT EXISTS `relationship_assertions` (
  `id` uuid NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `dimension` text NOT NULL,
  `value` text NOT NULL,
  `source_type` text NOT NULL,
  `confidence` real NOT NULL DEFAULT (1),
  `reason` text NULL,
  `valid_from` datetime NOT NULL,
  `supersedes_assertion_id` text NULL,
  `supporting_observation_ids` json NOT NULL,
  `relationship_id` uuid NOT NULL,
  `observation_id` uuid NULL,
  `revenue_workspace_id` uuid NOT NULL,
  `user_relationship_assertions` uuid NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `relationship_assertions_relationships_assertions`
    FOREIGN KEY (`relationship_id`) REFERENCES `relationships` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_assertions_relationship_observations_assertions`
    FOREIGN KEY (`observation_id`) REFERENCES `relationship_observations` (`id`) ON DELETE SET NULL,
  CONSTRAINT `relationship_assertions_revenue_workspaces_relationship_assertions`
    FOREIGN KEY (`revenue_workspace_id`) REFERENCES `revenue_workspaces` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_assertions_users_relationship_assertions`
    FOREIGN KEY (`user_relationship_assertions`) REFERENCES `users` (`id`) ON DELETE NO ACTION
);
CREATE INDEX IF NOT EXISTS `relationshipassertion_dimension_valid_from_relationship_id`
  ON `relationship_assertions` (`dimension`, `valid_from`, `relationship_id`);

CREATE TABLE IF NOT EXISTS `relationship_state_snapshots` (
  `id` uuid NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `version` integer NOT NULL,
  `state_json` text NOT NULL DEFAULT ('{}'),
  `changed_dimensions` json NOT NULL,
  `assertion_ids` json NOT NULL,
  `relationship_id` uuid NOT NULL,
  `revenue_workspace_id` uuid NOT NULL,
  `user_relationship_state_snapshots` uuid NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `relationship_state_snapshots_relationships_snapshots`
    FOREIGN KEY (`relationship_id`) REFERENCES `relationships` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_state_snapshots_revenue_workspaces_relationship_state_snapshots`
    FOREIGN KEY (`revenue_workspace_id`) REFERENCES `revenue_workspaces` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_state_snapshots_users_relationship_state_snapshots`
    FOREIGN KEY (`user_relationship_state_snapshots`) REFERENCES `users` (`id`) ON DELETE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS `relationshipstatesnapshot_version_relationship_id`
  ON `relationship_state_snapshots` (`version`, `relationship_id`);

CREATE TABLE IF NOT EXISTS `relationship_source_status` (
  `id` uuid NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `source` text NOT NULL,
  `source_account_id` text NOT NULL DEFAULT ('default'),
  `status` text NOT NULL DEFAULT ('connected'),
  `cursor` text NULL,
  `last_success_at` datetime NULL,
  `last_observation_at` datetime NULL,
  `last_error` text NULL,
  `revenue_workspace_id` uuid NOT NULL,
  `user_relationship_source_statuses` uuid NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `relationship_source_status_revenue_workspaces_relationship_source_statuses`
    FOREIGN KEY (`revenue_workspace_id`) REFERENCES `revenue_workspaces` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_source_status_users_relationship_source_statuses`
    FOREIGN KEY (`user_relationship_source_statuses`) REFERENCES `users` (`id`) ON DELETE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS `relationshipsourcestatus_source_e9da2ca23700d2dafd7efd04e5a33b03`
  ON `relationship_source_status` (`source`, `source_account_id`, `revenue_workspace_id`);
