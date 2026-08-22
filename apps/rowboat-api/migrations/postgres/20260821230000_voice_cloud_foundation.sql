-- Oppulence Voice control plane, encrypted sync relay, and explicit Rowboat
-- capture ingestion. Sensitive capture content is either opaque ciphertext
-- (voice_sync_items) or an explicitly consented Rowboat handoff
-- (capture_artifacts).

CREATE TABLE "voice_api_keys" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "name" character varying NOT NULL,
  "key_digest" character varying NOT NULL,
  "key_prefix" character varying NOT NULL,
  "scopes" jsonb NOT NULL DEFAULT '["notes:read"]',
  "last_used_at" timestamptz NULL,
  "expires_at" timestamptz NULL,
  "revoked_at" timestamptz NULL,
  "user_voice_api_keys" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "voice_api_keys_users_voice_api_keys"
    FOREIGN KEY ("user_voice_api_keys") REFERENCES "users" ("id") ON DELETE NO ACTION
);
CREATE UNIQUE INDEX "voiceapikey_key_digest" ON "voice_api_keys" ("key_digest");
CREATE INDEX "voiceapikey_created_at_user_voice_api_keys"
  ON "voice_api_keys" ("created_at", "user_voice_api_keys");

CREATE TABLE "voice_sync_items" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "collection" character varying NOT NULL,
  "item_id" character varying NOT NULL,
  "space_id" character varying NULL,
  "operation" character varying NOT NULL,
  "revision" bigint NOT NULL DEFAULT 1,
  "key_id" character varying NOT NULL,
  "nonce" character varying NOT NULL,
  "ciphertext" text NOT NULL,
  "content_hash" character varying NOT NULL,
  "blind_index" character varying NULL,
  "occurred_at" timestamptz NOT NULL,
  "deleted_at" timestamptz NULL,
  "user_voice_sync_items" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "voice_sync_items_users_voice_sync_items"
    FOREIGN KEY ("user_voice_sync_items") REFERENCES "users" ("id") ON DELETE NO ACTION
);
CREATE UNIQUE INDEX "voicesyncitem_collection_item_id_user_voice_sync_items"
  ON "voice_sync_items" ("collection", "item_id", "user_voice_sync_items");
CREATE INDEX "voicesyncitem_updated_at_id_user_voice_sync_items"
  ON "voice_sync_items" ("updated_at", "id", "user_voice_sync_items");
CREATE INDEX "voicesyncitem_space_id_collection_blind_index_user_voice_sync_items"
  ON "voice_sync_items" ("space_id", "collection", "blind_index", "user_voice_sync_items");

CREATE TABLE "capture_artifacts" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "event_id" character varying NOT NULL,
  "artifact_id" character varying NOT NULL,
  "schema_version" character varying NOT NULL,
  "kind" character varying NOT NULL,
  "operation" character varying NOT NULL,
  "source_product" character varying NOT NULL,
  "consent_basis" character varying NOT NULL,
  "content_hash" character varying NOT NULL,
  "payload_json" text NOT NULL,
  "status" character varying NOT NULL DEFAULT 'accepted',
  "occurred_at" timestamptz NOT NULL,
  "user_capture_artifacts" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "capture_artifacts_users_capture_artifacts"
    FOREIGN KEY ("user_capture_artifacts") REFERENCES "users" ("id") ON DELETE NO ACTION
);
CREATE UNIQUE INDEX "captureartifact_event_id_user_capture_artifacts"
  ON "capture_artifacts" ("event_id", "user_capture_artifacts");
CREATE INDEX "captureartifact_artifact_id_created_at_user_capture_artifacts"
  ON "capture_artifacts" ("artifact_id", "created_at", "user_capture_artifacts");
