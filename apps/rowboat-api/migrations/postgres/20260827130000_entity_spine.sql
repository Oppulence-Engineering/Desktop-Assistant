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
