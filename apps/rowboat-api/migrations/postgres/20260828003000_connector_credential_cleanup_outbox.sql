-- Durable credential-only compensation for provider refreshes that commit
-- upstream but lose the local lease/generation fence before adoption.
CREATE TABLE "connector_credential_cleanup_jobs" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "connection_id" uuid NOT NULL,
  "connector" varchar NOT NULL,
  "expected_credential_generation" bigint NOT NULL,
  "refresh_token_encrypted" bytea NOT NULL,
  "status" varchar NOT NULL DEFAULT 'pending',
  "attempts" bigint NOT NULL DEFAULT 0,
  "next_attempt_at" timestamptz NOT NULL,
  "claim_id" uuid NULL,
  "claimed_until" timestamptz NULL,
  "last_error_code" varchar NULL,
  "completed_at" timestamptz NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "connector_credential_cleanup_jobs_expected_generation_positive" CHECK ("expected_credential_generation" > 0)
);
CREATE INDEX "connectorcredentialcleanupjob_status_next_attempt_at" ON "connector_credential_cleanup_jobs" ("status", "next_attempt_at");
CREATE INDEX "connectorcredentialcleanupjob_connection_id_expected_credential_generation" ON "connector_credential_cleanup_jobs" ("connection_id", "expected_credential_generation");
