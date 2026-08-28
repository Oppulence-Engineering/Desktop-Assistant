-- RFC 012 final-review B remediation.
--
-- This is the expand phase for hashed OAuth state. The legacy state column is
-- intentionally retained and nullable state_hash is backfilled so compatibility
-- binaries can serve old-start/new-callback and new-start/old-callback traffic.
-- Hash-only storage and NOT NULL enforcement belong to a later contract migration
-- after at least the maximum pending-state TTL plus clock skew.
ALTER TABLE "oauth_pendings"
  ADD COLUMN "callback_claim_id" uuid NULL,
  ADD COLUMN "callback_claimed_until" timestamptz NULL,
  ADD COLUMN "callback_attempts" bigint NOT NULL DEFAULT 0;

UPDATE "oauth_pendings"
SET "state_hash" = encode(sha256(convert_to("state", 'UTF8')), 'hex')
WHERE "state_hash" IS NULL;

CREATE INDEX "oauthpending_callback_claimed_until"
  ON "oauth_pendings" ("callback_claimed_until")
  WHERE "lifecycle_status" = 'callback_processing';

-- Capture organization ownership on the credential itself. User.workos_org_id is
-- a mutable identity mirror and therefore cannot authorize an older credential.
ALTER TABLE "mcp_connections"
  ADD COLUMN "organization_id" character varying NULL;
ALTER TABLE "mcp_connection_histories"
  ADD COLUMN "organization_id" character varying NULL;

UPDATE "mcp_connections" AS mc
SET "organization_id" = NULLIF(u."workos_org_id", '')
FROM "users" AS u
WHERE u."id" = mc."user_mcp_connections";

-- Existing rows have no trustworthy immutable organization provenance. Park any
-- provider refresh credential in the durable revocation outbox, then invalidate
-- every legacy credential and require explicit consent in the current org.
INSERT INTO "connector_revocation_jobs" (
  "id", "created_at", "updated_at", "connection_id", "owner_id", "connector",
  "refresh_token_encrypted", "credential_generation", "terminal_status",
  "terminal_reason", "terminal_actor", "status", "attempts", "next_attempt_at"
)
SELECT
  gen_random_uuid(), now(), now(), mc."id", mc."user_mcp_connections", mc."connector",
  mc."refresh_token_encrypted", mc."credential_generation", 'invalidated',
  'organization_ownership_reconsent', 'migration', 'pending', 0, now()
FROM "mcp_connections" AS mc
WHERE mc."refresh_token_encrypted" IS NOT NULL
ON CONFLICT ("connection_id") DO UPDATE SET
  "updated_at" = EXCLUDED."updated_at",
  "refresh_token_encrypted" = EXCLUDED."refresh_token_encrypted",
  "credential_generation" = EXCLUDED."credential_generation",
  "terminal_status" = EXCLUDED."terminal_status",
  "terminal_reason" = EXCLUDED."terminal_reason",
  "terminal_actor" = EXCLUDED."terminal_actor",
  "status" = 'pending',
  "attempts" = 0,
  "next_attempt_at" = EXCLUDED."next_attempt_at",
  "claim_id" = NULL,
  "claimed_until" = NULL;

INSERT INTO "connector_audit_events" (
  "id", "created_at", "updated_at", "event_type", "event_id", "connector",
  "connection_id", "owner_workos_user_id", "org_id", "actor_kind", "reason",
  "result", "occurred_at", "user_connector_audit_events"
)
SELECT
  gen_random_uuid(), now(), now(), event.event_type,
  'connector:migration:organization-ownership:' || mc."id"::text || ':' || event.event_type,
  mc."connector", mc."id", u."workos_user_id", mc."organization_id", 'system',
  'organization_ownership_reconsent', 'invalidated', now(), mc."user_mcp_connections"
FROM "mcp_connections" AS mc
JOIN "users" AS u ON u."id" = mc."user_mcp_connections"
CROSS JOIN (VALUES ('connection_invalidated'), ('token.revoked')) AS event(event_type)
ON CONFLICT ("event_id") DO NOTHING;

UPDATE "mcp_connections"
SET "status" = 'invalidated',
    "credential_generation" = "credential_generation" + 1,
    "revoked_at" = now(),
    "revoked_reason" = 'organization_ownership_reconsent',
    "revoked_by" = 'migration',
    "revocation_attempted_at" = now(),
    "revocation_succeeded" = CASE WHEN "refresh_token_encrypted" IS NULL THEN true ELSE false END,
    "refresh_token_encrypted" = NULL,
    "api_key_encrypted" = NULL,
    "updated_at" = now()
WHERE "status" NOT IN ('revoked', 'invalidated')
   OR "refresh_token_encrypted" IS NOT NULL
   OR "api_key_encrypted" IS NOT NULL;

DROP INDEX "mcpconnection_connector_user_mcp_connections";
DROP INDEX "mcpconnection_connector_status";
CREATE UNIQUE INDEX "mcpconnection_connector_organization_id_user_mcp_connections"
  ON "mcp_connections" ("connector", "organization_id", "user_mcp_connections");
CREATE INDEX "mcpconnection_organization_id_connector_status"
  ON "mcp_connections" ("organization_id", "connector", "status");
