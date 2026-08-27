-- Durable RFC 012 provider revocation outbox. Connection rows are disabled and
-- scrubbed immediately while failed upstream revocations retry from this table.
CREATE TABLE "connector_revocation_jobs" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "connection_id" uuid NOT NULL,
  "owner_id" uuid NOT NULL,
  "connector" character varying NOT NULL,
  "refresh_token_encrypted" bytea NOT NULL,
  "status" character varying NOT NULL DEFAULT 'pending',
  "attempts" bigint NOT NULL DEFAULT 0,
  "next_attempt_at" timestamptz NOT NULL,
  "last_error" character varying NULL,
  "completed_at" timestamptz NULL,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "connector_revocation_jobs_connection_id_key" ON "connector_revocation_jobs" ("connection_id");
CREATE INDEX "connectorrevocationjob_status_next_attempt_at" ON "connector_revocation_jobs" ("status", "next_attempt_at");
