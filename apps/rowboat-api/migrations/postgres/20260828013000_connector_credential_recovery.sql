-- Independent encrypted recovery journal for connector credentials. This table
-- is intentionally separate from connector_credential_cleanup_jobs so a
-- cleanup-outbox mutation failure cannot erase the only recoverable copy of a
-- provider-issued rotating credential.
CREATE TABLE "connector_credential_recoveries" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "connector" varchar NOT NULL,
  "owner_kind" varchar NOT NULL,
  "owner_id" varchar NOT NULL,
  "refresh_token_encrypted" bytea NOT NULL,
  "status" varchar NOT NULL DEFAULT 'pending',
  "attempts" bigint NOT NULL DEFAULT 0,
  "next_attempt_at" timestamptz NOT NULL,
  "claim_id" uuid NULL,
  "claimed_until" timestamptz NULL,
  "last_error_code" varchar NULL,
  PRIMARY KEY ("id")
);
CREATE INDEX "connectorcredentialrecovery_status_next_attempt_at" ON "connector_credential_recoveries" ("status", "next_attempt_at");
CREATE INDEX "connectorcredentialrecovery_owner_kind_owner_id" ON "connector_credential_recoveries" ("owner_kind", "owner_id");
