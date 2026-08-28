-- RFC 012 connector broker hardening: hashed pending state metadata,
-- explicit connection revocation tombstones, and semantic audit events.

ALTER TABLE "oauth_pendings"
  ADD COLUMN "state_hash" character varying NULL,
  ADD COLUMN "lifecycle_status" character varying NULL,
  ADD COLUMN "owner_workos_user_id" character varying NULL,
  ADD COLUMN "owner_org_id" character varying NULL,
  ADD COLUMN "requested_scopes" jsonb NULL,
  ADD COLUMN "redirect_target" character varying NULL,
  ADD COLUMN "consent_challenge" character varying NULL,
  ADD COLUMN "context_request_id" character varying NULL,
  ADD COLUMN "hydra_client_id" character varying NULL,
  ADD COLUMN "callback_at" timestamptz NULL,
  ADD COLUMN "claimed_at" timestamptz NULL,
  ADD COLUMN "failure_reason" character varying NULL;

CREATE UNIQUE INDEX "oauth_pendings_state_hash_key" ON "oauth_pendings" ("state_hash");
CREATE INDEX "oauthpending_provider_lifecycle_status" ON "oauth_pendings" ("provider", "lifecycle_status");
CREATE INDEX "oauthpending_owner_workos_user_id" ON "oauth_pendings" ("owner_workos_user_id");
CREATE INDEX "oauthpending_context_request_id" ON "oauth_pendings" ("context_request_id");
CREATE INDEX "oauthpending_consent_challenge" ON "oauth_pendings" ("consent_challenge");

ALTER TABLE "mcp_connections"
  ADD COLUMN "status" character varying NOT NULL DEFAULT 'active',
  ADD COLUMN "revoked_at" timestamptz NULL,
  ADD COLUMN "revoked_reason" character varying NULL,
  ADD COLUMN "revoked_by" character varying NULL,
  ADD COLUMN "revocation_attempted_at" timestamptz NULL,
  ADD COLUMN "revocation_succeeded" boolean NULL;

CREATE INDEX "mcpconnection_status" ON "mcp_connections" ("status");
CREATE INDEX "mcpconnection_connector_status" ON "mcp_connections" ("connector", "status");

ALTER TABLE "mcp_connection_histories"
  ADD COLUMN "status" character varying NOT NULL DEFAULT 'active',
  ADD COLUMN "revoked_at" timestamptz NULL,
  ADD COLUMN "revoked_reason" character varying NULL,
  ADD COLUMN "revoked_by" character varying NULL,
  ADD COLUMN "revocation_attempted_at" timestamptz NULL,
  ADD COLUMN "revocation_succeeded" boolean NULL;

CREATE TABLE "connector_audit_events" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "event_type" character varying NOT NULL,
  "event_id" character varying NULL,
  "connector" character varying NOT NULL,
  "connection_id" uuid NULL,
  "owner_workos_user_id" character varying NOT NULL,
  "org_id" character varying NULL,
  "audience" character varying NULL,
  "requested_scopes" jsonb NULL,
  "granted_scopes" jsonb NULL,
  "actor_kind" character varying NULL,
  "reason" character varying NULL,
  "metadata_json" character varying NULL,
  "consent_session_id" character varying NULL,
  "context_request_id" character varying NULL,
  "challenge" character varying NULL,
  "client_id" character varying NULL,
  "result" character varying NULL,
  "occurred_at" timestamptz NULL,
  "user_connector_audit_events" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "connector_audit_events_users_connector_audit_events"
    FOREIGN KEY ("user_connector_audit_events") REFERENCES "users" ("id") ON DELETE NO ACTION
);

CREATE UNIQUE INDEX "connector_audit_events_event_id_key" ON "connector_audit_events" ("event_id");
CREATE INDEX "connectorauditevent_event_type_created_at" ON "connector_audit_events" ("event_type", "created_at");
CREATE INDEX "connectorauditevent_connector_created_at" ON "connector_audit_events" ("connector", "created_at");
CREATE INDEX "connectorauditevent_connection_id_created_at" ON "connector_audit_events" ("connection_id", "created_at");
CREATE INDEX "connectorauditevent_owner_workos_user_id_created_at" ON "connector_audit_events" ("owner_workos_user_id", "created_at");
CREATE INDEX "connectorauditevent_org_id_created_at" ON "connector_audit_events" ("org_id", "created_at");
CREATE INDEX "connectorauditevent_consent_session_id_created_at" ON "connector_audit_events" ("consent_session_id", "created_at");
CREATE INDEX "connectorauditevent_context_request_id_created_at" ON "connector_audit_events" ("context_request_id", "created_at");
