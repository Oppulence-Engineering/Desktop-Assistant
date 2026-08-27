-- RFC 012 H3/M2 closure remediation.
--
-- Revocation jobs created before this change captured the credential generation
-- being revoked. The local tombstone increments that generation in the same
-- transaction, so a later successful provider retry could not mark
-- revocation_succeeded=true. Retarget only the exact one-generation tombstone;
-- replacement grants have a newer generation and are intentionally untouched.
UPDATE "connector_revocation_jobs" AS job
SET "credential_generation" = connection."credential_generation",
    "updated_at" = now()
FROM "mcp_connections" AS connection
WHERE job."connection_id" = connection."id"
  AND job."status" IN ('pending', 'processing')
  AND connection."status" = job."terminal_status"
  AND connection."credential_generation" = job."credential_generation" + 1
  AND connection."refresh_token_encrypted" IS NULL
  AND connection."api_key_encrypted" IS NULL;
