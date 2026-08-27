-- RFC 012 credential lifecycle fencing and replica-safe revocation claims.
ALTER TABLE "mcp_connections"
  ADD COLUMN "credential_generation" bigint NOT NULL DEFAULT 1;

ALTER TABLE "connector_revocation_jobs"
  ALTER COLUMN "refresh_token_encrypted" DROP NOT NULL,
  ADD COLUMN "credential_generation" bigint NOT NULL DEFAULT 1,
  ADD COLUMN "terminal_status" character varying NOT NULL DEFAULT 'revoked',
  ADD COLUMN "terminal_reason" character varying NOT NULL DEFAULT 'user_disconnect',
  ADD COLUMN "terminal_actor" character varying NOT NULL DEFAULT 'user',
  ADD COLUMN "claim_id" uuid NULL,
  ADD COLUMN "claimed_until" timestamptz NULL;

ALTER TABLE "connector_revocation_jobs"
  ALTER COLUMN "credential_generation" DROP DEFAULT,
  ALTER COLUMN "terminal_status" DROP DEFAULT,
  ALTER COLUMN "terminal_reason" DROP DEFAULT,
  ALTER COLUMN "terminal_actor" DROP DEFAULT;
