-- Durable authenticated console preferences and user-authored workspace
-- resources. Both tables are additive; old binaries ignore them safely.
CREATE TABLE "user_preferences" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "preferences_json" text NOT NULL DEFAULT '{}',
  "user_user_preferences" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "user_preferences_users_user_preferences"
    FOREIGN KEY ("user_user_preferences") REFERENCES "users" ("id")
    ON UPDATE NO ACTION ON DELETE CASCADE
);
CREATE UNIQUE INDEX "userpreference_user_user_preferences"
  ON "user_preferences" ("user_user_preferences");

CREATE TABLE "console_resources" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "kind" varchar NOT NULL,
  "name" varchar NULL,
  "name_key" varchar NULL,
  "note_id" varchar NULL,
  "payload_json" text NOT NULL,
  "sort_order" bigint NOT NULL DEFAULT 0,
  "revenue_workspace_id" uuid NOT NULL,
  "user_console_resources" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "console_resources_kind_check"
    CHECK ("kind" IN ('note_template', 'note_favorite', 'graph_saved_view')),
  CONSTRAINT "console_resources_revenue_workspaces_console_resources"
    FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id")
    ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "console_resources_users_console_resources"
    FOREIGN KEY ("user_console_resources") REFERENCES "users" ("id")
    ON UPDATE NO ACTION ON DELETE CASCADE
);
CREATE UNIQUE INDEX "consoleresource_kind_name_key_revenue_workspace_id_user_console_resources"
  ON "console_resources" ("kind", "name_key", "revenue_workspace_id", "user_console_resources");
CREATE UNIQUE INDEX "consoleresource_kind_note_id_revenue_workspace_id_user_console_resources"
  ON "console_resources" ("kind", "note_id", "revenue_workspace_id", "user_console_resources");
CREATE INDEX "consoleresource_kind_sort_order_created_at_revenue_workspace_id_user_console_resources"
  ON "console_resources" ("kind", "sort_order", "created_at", "revenue_workspace_id", "user_console_resources");
