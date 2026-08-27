-- RFC 022 WP3: org/workspace-scoped minimal entity spine.
CREATE TABLE "entities" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "entity_id" varchar NOT NULL,
  "kind" varchar NOT NULL,
  "display_name" varchar NOT NULL,
  "resource_refs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "identifiers" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "one_line_summary" varchar NULL,
  "status" varchar NOT NULL DEFAULT 'active',
  "canonical_entity_id" varchar NULL,
  "version" bigint NOT NULL DEFAULT 1,
  "revenue_workspace_id" uuid NOT NULL,
  "user_entities" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "entities_revenue_workspaces_entities" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "entities_users_entities" FOREIGN KEY ("user_entities") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "entities_status_check" CHECK ("status" IN ('active','merged','archived')),
  CONSTRAINT "entities_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "entity_entity_id_revenue_workspace_id" ON "entities" ("entity_id", "revenue_workspace_id");
CREATE INDEX "entity_status_revenue_workspace_id" ON "entities" ("status", "revenue_workspace_id");
CREATE INDEX "entity_display_name_revenue_workspace_id" ON "entities" ("display_name", "revenue_workspace_id");

-- Normalized external refs are the concurrency-safe reverse lookup boundary.
-- The JSON projection remains the API shape, but cannot enforce workspace-wide
-- ownership under concurrent device writes by itself.
CREATE TABLE "entity_resource_refs" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "ref" varchar NOT NULL,
  "entity_normalized_resource_refs" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "entity_resource_refs_entities_normalized_resource_refs" FOREIGN KEY ("entity_normalized_resource_refs") REFERENCES "entities" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "entity_resource_refs_revenue_workspaces_entity_resource_refs" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
CREATE UNIQUE INDEX "entityresourceref_ref_revenue_workspace_id" ON "entity_resource_refs" ("ref", "revenue_workspace_id");
CREATE UNIQUE INDEX "entityresourceref_ref_entity_normalized_resource_refs" ON "entity_resource_refs" ("ref", "entity_normalized_resource_refs");

-- Deterministic identifiers are one-way fingerprints. They are indexed but not
-- workspace-unique because a shared domain can legitimately be ambiguous and
-- must remain reviewable rather than being silently merged.
CREATE TABLE "entity_identifiers" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "key" varchar NOT NULL,
  "fingerprint" varchar NOT NULL,
  "entity_normalized_identifiers" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "entity_identifiers_entities_normalized_identifiers" FOREIGN KEY ("entity_normalized_identifiers") REFERENCES "entities" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "entity_identifiers_revenue_workspaces_entity_identifiers" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
CREATE INDEX "entityidentifier_key_fingerprint_revenue_workspace_id" ON "entity_identifiers" ("key", "fingerprint", "revenue_workspace_id");
CREATE UNIQUE INDEX "entityidentifier_key_fingerprint_entity_normalized_identifiers" ON "entity_identifiers" ("key", "fingerprint", "entity_normalized_identifiers");
