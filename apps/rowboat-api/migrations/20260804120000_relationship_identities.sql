-- RFC 038: the durable identity anchor table.
--
-- relationship_identities has existed in ent/migrate/schema.go since the identity
-- engine landed, but it never got a reviewed migration file. Its three dependents
-- -- relationship_identity_candidates, relationship_identity_decisions and
-- relationship_lineage_events -- were all created in
-- 20260731203000_relationship_projection_temporal.sql, so any environment that
-- treats these files as the source of truth has candidates referencing an absent
-- parent, and the anchor lookup in resolveObservationRelationship has nothing to
-- read. Only AutoMigrate has been creating it.
--
-- Mirrors ent/migrate/schema.go RelationshipIdentitiesTable exactly: column order,
-- types, foreign-key constraint symbols and index names. Fully idempotent, so it is
-- safe where AutoMigrate already created the table.

CREATE TABLE IF NOT EXISTS `relationship_identities` (
  `id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL,
  `kind` text NOT NULL, `provider` text NULL,
  `key_hash` text NOT NULL, `normalized_value` text NOT NULL,
  `source` text NULL, `confidence` real NOT NULL DEFAULT (1),
  `first_seen_at` datetime NOT NULL, `last_seen_at` datetime NOT NULL,
  `relationship_id` uuid NOT NULL,
  `revenue_workspace_id` uuid NOT NULL,
  `user_relationship_identities` uuid NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `relationship_identities_relationships_identities`
    FOREIGN KEY (`relationship_id`) REFERENCES `relationships` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_identities_revenue_workspaces_relationship_identities`
    FOREIGN KEY (`revenue_workspace_id`) REFERENCES `revenue_workspaces` (`id`) ON DELETE NO ACTION,
  CONSTRAINT `relationship_identities_users_relationship_identities`
    FOREIGN KEY (`user_relationship_identities`) REFERENCES `users` (`id`) ON DELETE NO ACTION
);

-- One workspace, one owner per anchor. This unique index is the entire safety
-- property of the identity design: it is what forces a collision to surface as a
-- reviewable candidate instead of silently merging two accounts.
CREATE UNIQUE INDEX IF NOT EXISTS `relationshipidentity_key_hash_revenue_workspace_id`
  ON `relationship_identities` (`key_hash`, `revenue_workspace_id`);
CREATE INDEX IF NOT EXISTS `relationshipidentity_kind_relationship_id`
  ON `relationship_identities` (`kind`, `relationship_id`);
