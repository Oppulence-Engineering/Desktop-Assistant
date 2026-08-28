-- Immutable MCP/OAuth connection history is lifecycle metadata, never credential
-- storage. Backfill safe presence/generation metadata, purge all retained
-- ciphertext, and keep mixed-version replicas from repopulating it.

ALTER TABLE "mcp_connections"
  ADD COLUMN "refresh_token_present" boolean NOT NULL DEFAULT false,
  ADD COLUMN "api_key_present" boolean NOT NULL DEFAULT false;
ALTER TABLE "oauth_connections"
  ADD COLUMN "refresh_token_present" boolean NOT NULL DEFAULT false,
  ADD COLUMN "credential_generation" bigint NOT NULL DEFAULT 1;
ALTER TABLE "oauth_connections"
  ADD CONSTRAINT "oauth_connections_credential_generation_positive"
  CHECK ("credential_generation" > 0);

ALTER TABLE "mcp_connection_histories"
  ADD COLUMN "refresh_token_present" boolean NOT NULL DEFAULT false,
  ADD COLUMN "api_key_present" boolean NOT NULL DEFAULT false;
ALTER TABLE "oauth_connection_histories"
  ADD COLUMN "refresh_token_present" boolean NOT NULL DEFAULT false,
  ADD COLUMN "credential_generation" bigint NOT NULL DEFAULT 1;
ALTER TABLE "oauth_connection_histories"
  ADD CONSTRAINT "oauth_connection_histories_credential_generation_positive"
  CHECK ("credential_generation" > 0);

UPDATE "mcp_connections"
SET "refresh_token_present" = COALESCE(octet_length("refresh_token_encrypted") > 0, false),
    "api_key_present" = COALESCE(octet_length("api_key_encrypted") > 0, false);
UPDATE "oauth_connections"
SET "refresh_token_present" = COALESCE(octet_length("refresh_token_encrypted") > 0, false);

UPDATE "mcp_connection_histories"
SET "refresh_token_present" = COALESCE(octet_length("refresh_token_encrypted") > 0, false),
    "api_key_present" = COALESCE(octet_length("api_key_encrypted") > 0, false);
UPDATE "oauth_connection_histories"
SET "refresh_token_present" = COALESCE(octet_length("refresh_token_encrypted") > 0, false);

-- OAuth history used to require a credential on every row. Make the compatibility
-- sink nullable before erasing it.
ALTER TABLE "oauth_connection_histories"
  ALTER COLUMN "refresh_token_encrypted" DROP NOT NULL;

-- This UPDATE is the authoritative logical purge. The legacy columns remain only
-- as mixed-version compatibility sinks and are forced NULL below.
UPDATE "mcp_connection_histories"
SET "refresh_token_encrypted" = NULL,
    "api_key_encrypted" = NULL
WHERE "refresh_token_encrypted" IS NOT NULL
   OR "api_key_encrypted" IS NOT NULL;
UPDATE "oauth_connection_histories"
SET "refresh_token_encrypted" = NULL
WHERE "refresh_token_encrypted" IS NOT NULL;

CREATE OR REPLACE FUNCTION rowboat_derive_mcp_credential_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."refresh_token_present" := COALESCE(octet_length(NEW."refresh_token_encrypted") > 0, false);
  NEW."api_key_present" := COALESCE(octet_length(NEW."api_key_encrypted") > 0, false);
  RETURN NEW;
END;
$$;

CREATE TRIGGER "mcp_connections_derive_credential_metadata"
BEFORE INSERT OR UPDATE OF "refresh_token_encrypted", "api_key_encrypted"
ON "mcp_connections"
FOR EACH ROW
EXECUTE FUNCTION rowboat_derive_mcp_credential_metadata();

CREATE OR REPLACE FUNCTION rowboat_derive_oauth_credential_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."refresh_token_present" := COALESCE(octet_length(NEW."refresh_token_encrypted") > 0, false);
  IF TG_OP = 'UPDATE'
     AND NEW."refresh_token_encrypted" IS DISTINCT FROM OLD."refresh_token_encrypted"
     AND NEW."credential_generation" = OLD."credential_generation" THEN
    NEW."credential_generation" := OLD."credential_generation" + 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "oauth_connections_derive_credential_metadata"
BEFORE INSERT OR UPDATE OF "refresh_token_encrypted", "credential_generation"
ON "oauth_connections"
FOR EACH ROW
EXECUTE FUNCTION rowboat_derive_oauth_credential_metadata();

CREATE OR REPLACE FUNCTION rowboat_redact_mcp_history_credentials()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."refresh_token_present" := COALESCE(NEW."refresh_token_present", false)
    OR COALESCE(octet_length(NEW."refresh_token_encrypted") > 0, false);
  NEW."api_key_present" := COALESCE(NEW."api_key_present", false)
    OR COALESCE(octet_length(NEW."api_key_encrypted") > 0, false);
  NEW."refresh_token_encrypted" := NULL;
  NEW."api_key_encrypted" := NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "mcp_connection_histories_redact_credentials"
BEFORE INSERT OR UPDATE
ON "mcp_connection_histories"
FOR EACH ROW
EXECUTE FUNCTION rowboat_redact_mcp_history_credentials();

CREATE OR REPLACE FUNCTION rowboat_redact_oauth_history_credentials()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."refresh_token_present" := COALESCE(NEW."refresh_token_present", false)
    OR COALESCE(octet_length(NEW."refresh_token_encrypted") > 0, false);
  NEW."refresh_token_encrypted" := NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "oauth_connection_histories_redact_credentials"
BEFORE INSERT OR UPDATE
ON "oauth_connection_histories"
FOR EACH ROW
EXECUTE FUNCTION rowboat_redact_oauth_history_credentials();

ALTER TABLE "mcp_connection_histories"
  ADD CONSTRAINT "mcp_connection_histories_refresh_token_purged"
    CHECK ("refresh_token_encrypted" IS NULL),
  ADD CONSTRAINT "mcp_connection_histories_api_key_purged"
    CHECK ("api_key_encrypted" IS NULL);
ALTER TABLE "oauth_connection_histories"
  ADD CONSTRAINT "oauth_connection_histories_refresh_token_purged"
    CHECK ("refresh_token_encrypted" IS NULL);
