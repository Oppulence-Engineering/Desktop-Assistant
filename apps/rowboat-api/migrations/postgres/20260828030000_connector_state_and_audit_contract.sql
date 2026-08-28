-- RFC 012 contract phase. Deploy only after the expand migration has been live
-- for at least the maximum pending-state TTL plus clock skew. The statements are
-- idempotent so a partially completed operational rollout can be retried safely.

-- Expired pending handoffs cannot be redeemed and must not retain bearer state.
DELETE FROM "oauth_pendings" WHERE "expires_at" <= now();

-- Complete any missed expand-phase hash backfill, then replace legacy raw bearer
-- state with the same non-secret sentinel emitted by steady-state writers.
UPDATE "oauth_pendings"
SET "state_hash" = encode(sha256(convert_to("state", 'UTF8')), 'hex')
WHERE "state_hash" IS NULL;

UPDATE "oauth_pendings"
SET "state" = 'sha256:' || "state_hash"
WHERE "state" IS DISTINCT FROM 'sha256:' || "state_hash";

ALTER TABLE "oauth_pendings" ALTER COLUMN "state_hash" SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE "oauth_pendings"
    ADD CONSTRAINT "oauth_pendings_state_is_hash_sentinel"
    CHECK ("state" = 'sha256:' || "state_hash") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE "oauth_pendings" VALIDATE CONSTRAINT "oauth_pendings_state_is_hash_sentinel";

-- Audit rows are ledger entries. Ent prevents application-level field mutation,
-- while this trigger also rejects direct SQL and privileged accidental tampering.
CREATE OR REPLACE FUNCTION reject_connector_audit_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'connector_audit_events are append-only' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS connector_audit_events_append_only ON "connector_audit_events";
CREATE TRIGGER connector_audit_events_append_only
BEFORE UPDATE OR DELETE ON "connector_audit_events"
FOR EACH ROW EXECUTE FUNCTION reject_connector_audit_event_mutation();
