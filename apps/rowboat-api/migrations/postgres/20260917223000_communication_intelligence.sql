-- Owner-bound communication metadata and privacy controls. Bodies and
-- attachment bytes remain private unless an active explicit grant admits them.
CREATE TABLE "communication_interactions" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "source" varchar NOT NULL,
  "source_account_id" varchar NOT NULL,
  "provider_object_id" varchar NOT NULL,
  "source_version" varchar NOT NULL DEFAULT '1',
  "interaction_type" varchar NOT NULL,
  "direction" varchar NULL,
  "subject" varchar NULL,
  "occurred_at" timestamptz NOT NULL,
  "received_at" timestamptz NOT NULL,
  "visibility" varchar NOT NULL DEFAULT 'metadata',
  "deleted" boolean NOT NULL DEFAULT false,
  "content_hash" varchar NOT NULL,
  "metadata_json" text NOT NULL DEFAULT '{}',
  "relationship_id" uuid NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_owned_communication_interactions" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "communication_interactions_source_check"
    CHECK ("source" IN ('gmail', 'calendar')),
  CONSTRAINT "communication_interactions_type_check"
    CHECK ("interaction_type" IN ('email', 'meeting')),
  CONSTRAINT "communication_interactions_direction_check"
    CHECK ("direction" IS NULL OR "direction" IN ('inbound', 'outbound')),
  CONSTRAINT "communication_interactions_visibility_check"
    CHECK ("visibility" IN ('private', 'metadata', 'full')),
  CONSTRAINT "communication_interactions_relationships_communication_interactions"
    FOREIGN KEY ("relationship_id") REFERENCES "relationships" ("id")
    ON UPDATE NO ACTION ON DELETE SET NULL,
  CONSTRAINT "communication_interactions_revenue_workspaces_communication_interactions"
    FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id")
    ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "communication_interactions_users_owned_communication_interactions"
    FOREIGN KEY ("user_owned_communication_interactions") REFERENCES "users" ("id")
    ON UPDATE NO ACTION ON DELETE CASCADE
);
CREATE UNIQUE INDEX "communicationinteraction_source_source_account_id_provider_object_id_source_version_revenue_workspace_id"
  ON "communication_interactions" ("source", "source_account_id", "provider_object_id", "source_version", "revenue_workspace_id");
CREATE INDEX "communicationinteraction_occurred_at_revenue_workspace_id"
  ON "communication_interactions" ("occurred_at", "revenue_workspace_id");
CREATE INDEX "communicationinteraction_occurred_at_relationship_id"
  ON "communication_interactions" ("occurred_at", "relationship_id");
CREATE INDEX "communicationinteraction_occurred_at_user_owned_communication_interactions"
  ON "communication_interactions" ("occurred_at", "user_owned_communication_interactions");

CREATE TABLE "communication_participants" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "email" varchar NOT NULL,
  "display_name" varchar NULL,
  "role" varchar NOT NULL,
  "external" boolean NOT NULL DEFAULT true,
  "owner" boolean NOT NULL DEFAULT false,
  "communication_interaction_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "communication_participants_role_check"
    CHECK ("role" IN ('from', 'to', 'cc', 'bcc', 'organizer', 'attendee')),
  CONSTRAINT "communication_participants_communication_interactions_participants"
    FOREIGN KEY ("communication_interaction_id") REFERENCES "communication_interactions" ("id")
    ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "communication_participants_revenue_workspaces_communication_participants"
    FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id")
    ON UPDATE NO ACTION ON DELETE CASCADE
);
CREATE UNIQUE INDEX "communicationparticipant_email_role_communication_interaction_id"
  ON "communication_participants" ("email", "role", "communication_interaction_id");
CREATE INDEX "communicationparticipant_email_revenue_workspace_id"
  ON "communication_participants" ("email", "revenue_workspace_id");

CREATE TABLE "communication_attachments" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "provider_attachment_id" varchar NOT NULL,
  "filename" varchar NULL,
  "mime_type" varchar NULL,
  "size_bytes" bigint NOT NULL DEFAULT 0,
  "checksum" varchar NULL,
  "visibility" varchar NOT NULL DEFAULT 'private',
  "scan_status" varchar NOT NULL DEFAULT 'not_scanned',
  "scanned_at" timestamptz NULL,
  "expires_at" timestamptz NULL,
  "sealed_content" bytea NULL,
  "sealed_extracted_text" text NULL,
  "communication_interaction_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "communication_attachments_size_check" CHECK ("size_bytes" >= 0),
  CONSTRAINT "communication_attachments_visibility_check"
    CHECK ("visibility" IN ('private', 'metadata', 'full')),
  CONSTRAINT "communication_attachments_scan_status_check"
    CHECK ("scan_status" IN ('not_scanned', 'pending', 'clean', 'rejected', 'failed')),
  CONSTRAINT "communication_attachments_communication_interactions_attachments"
    FOREIGN KEY ("communication_interaction_id") REFERENCES "communication_interactions" ("id")
    ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "communication_attachments_revenue_workspaces_communication_attachments"
    FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id")
    ON UPDATE NO ACTION ON DELETE CASCADE
);
CREATE UNIQUE INDEX "communicationattachment_provider_attachment_id_communication_interaction_id"
  ON "communication_attachments" ("provider_attachment_id", "communication_interaction_id");
CREATE INDEX "communicationattachment_scan_status_expires_at_revenue_workspace_id"
  ON "communication_attachments" ("scan_status", "expires_at", "revenue_workspace_id");

CREATE TABLE "communication_sync_cursors" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "source" varchar NOT NULL,
  "source_account_id" varchar NOT NULL,
  "cursor" varchar NULL,
  "status" varchar NOT NULL DEFAULT 'idle',
  "last_provider_event_at" timestamptz NULL,
  "last_success_at" timestamptz NULL,
  "lease_claimed_at" timestamptz NULL,
  "retry_count" bigint NOT NULL DEFAULT 0,
  "last_error" text NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_communication_sync_cursors" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "communication_sync_cursors_source_check"
    CHECK ("source" IN ('gmail', 'calendar')),
  CONSTRAINT "communication_sync_cursors_status_check"
    CHECK ("status" IN ('idle', 'queued', 'running', 'live', 'failed')),
  CONSTRAINT "communication_sync_cursors_retry_check" CHECK ("retry_count" >= 0),
  CONSTRAINT "communication_sync_cursors_revenue_workspaces_communication_sync_cursors"
    FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id")
    ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "communication_sync_cursors_users_communication_sync_cursors"
    FOREIGN KEY ("user_communication_sync_cursors") REFERENCES "users" ("id")
    ON UPDATE NO ACTION ON DELETE CASCADE
);
CREATE UNIQUE INDEX "communicationsynccursor_source_source_account_id_revenue_workspace_id_user_communication_sync_cursors"
  ON "communication_sync_cursors" ("source", "source_account_id", "revenue_workspace_id", "user_communication_sync_cursors");
CREATE INDEX "communicationsynccursor_status_lease_claimed_at"
  ON "communication_sync_cursors" ("status", "lease_claimed_at");

CREATE TABLE "communication_privacy_policies" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "source_account_id" varchar NOT NULL,
  "metadata_visibility" varchar NOT NULL DEFAULT 'workspace',
  "share_subject" boolean NOT NULL DEFAULT true,
  "share_body" boolean NOT NULL DEFAULT false,
  "share_attachments" boolean NOT NULL DEFAULT false,
  "signature_enrichment" boolean NOT NULL DEFAULT true,
  "model_contact_extraction" boolean NOT NULL DEFAULT true,
  "retention_days" bigint NOT NULL DEFAULT 540,
  "version" bigint NOT NULL DEFAULT 1,
  "revenue_workspace_id" uuid NOT NULL,
  "user_communication_privacy_policies" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "communication_privacy_policies_visibility_check"
    CHECK ("metadata_visibility" IN ('private', 'workspace')),
  CONSTRAINT "communication_privacy_policies_retention_check"
    CHECK ("retention_days" > 0),
  CONSTRAINT "communication_privacy_policies_version_check" CHECK ("version" > 0),
  CONSTRAINT "communication_privacy_policies_revenue_workspaces_communication_privacy_policies"
    FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id")
    ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "communication_privacy_policies_users_communication_privacy_policies"
    FOREIGN KEY ("user_communication_privacy_policies") REFERENCES "users" ("id")
    ON UPDATE NO ACTION ON DELETE CASCADE
);
CREATE UNIQUE INDEX "communicationprivacypolicy_source_account_id_revenue_workspace_id_user_communication_privacy_policies"
  ON "communication_privacy_policies" ("source_account_id", "revenue_workspace_id", "user_communication_privacy_policies");

CREATE TABLE "communication_privacy_rules" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "kind" varchar NOT NULL,
  "value" varchar NOT NULL,
  "value_hash" varchar NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "revenue_workspace_id" uuid NOT NULL,
  "user_communication_privacy_rules" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "communication_privacy_rules_kind_check"
    CHECK ("kind" IN ('blocked_address', 'blocked_domain', 'protected_address', 'protected_domain')),
  CONSTRAINT "communication_privacy_rules_revenue_workspaces_communication_privacy_rules"
    FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id")
    ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "communication_privacy_rules_users_communication_privacy_rules"
    FOREIGN KEY ("user_communication_privacy_rules") REFERENCES "users" ("id")
    ON UPDATE NO ACTION ON DELETE CASCADE
);
CREATE UNIQUE INDEX "communicationprivacyrule_kind_value_hash_revenue_workspace_id_user_communication_privacy_rules"
  ON "communication_privacy_rules" ("kind", "value_hash", "revenue_workspace_id", "user_communication_privacy_rules");
CREATE INDEX "communicationprivacyrule_active_revenue_workspace_id_user_communication_privacy_rules"
  ON "communication_privacy_rules" ("active", "revenue_workspace_id", "user_communication_privacy_rules");

CREATE TABLE "communication_share_grants" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "scope" varchar NOT NULL,
  "resource_type" varchar NOT NULL,
  "resource_id" varchar NOT NULL,
  "expires_at" timestamptz NULL,
  "revoked_at" timestamptz NULL,
  "reason" varchar NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_owned_communication_share_grants" uuid NOT NULL,
  "user_received_communication_share_grants" uuid NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "communication_share_grants_scope_check"
    CHECK ("scope" IN ('body', 'attachments', 'full')),
  CONSTRAINT "communication_share_grants_resource_type_check"
    CHECK ("resource_type" IN ('message', 'thread', 'relationship')),
  CONSTRAINT "communication_share_grants_revenue_workspaces_communication_share_grants"
    FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id")
    ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "communication_share_grants_users_owned_communication_share_grants"
    FOREIGN KEY ("user_owned_communication_share_grants") REFERENCES "users" ("id")
    ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "communication_share_grants_users_received_communication_share_grants"
    FOREIGN KEY ("user_received_communication_share_grants") REFERENCES "users" ("id")
    ON UPDATE NO ACTION ON DELETE CASCADE
);
CREATE UNIQUE INDEX "communicationsharegrant_scope_resource_type_resource_id_revenue_workspace_id_user_owned_communication_share_grants_user_received_communication_share_grants"
  ON "communication_share_grants" ("scope", "resource_type", "resource_id", "revenue_workspace_id", "user_owned_communication_share_grants", "user_received_communication_share_grants");
CREATE UNIQUE INDEX "communicationsharegrant_workspace_scope_unique"
  ON "communication_share_grants" ("scope", "resource_type", "resource_id", "revenue_workspace_id", "user_owned_communication_share_grants")
  WHERE "user_received_communication_share_grants" IS NULL;
CREATE INDEX "communicationsharegrant_revoked_at_expires_at_revenue_workspace_id_user_owned_communication_share_grants"
  ON "communication_share_grants" ("revoked_at", "expires_at", "revenue_workspace_id", "user_owned_communication_share_grants");
