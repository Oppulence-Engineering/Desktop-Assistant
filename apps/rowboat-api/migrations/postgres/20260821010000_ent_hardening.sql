-- Convert the stable attention-ranking document to native JSONB. Existing
-- writes were validated JSON, so the cast is deterministic.
ALTER TABLE "relationship_attention_items"
  ALTER COLUMN "rank_factors_json" TYPE jsonb
  USING "rank_factors_json"::jsonb;

-- Keep queue indexes bounded to rows workers can actually claim.
CREATE INDEX "relationshipprojectionjob_status_next_attempt_at"
  ON "relationship_projection_jobs" ("status", "next_attempt_at")
  WHERE "status" IN ('pending', 'failed');
CREATE INDEX "relationshipprojectionjob_status_lease_expires_at"
  ON "relationship_projection_jobs" ("status", "lease_expires_at")
  WHERE "status" = 'running' AND "lease_expires_at" IS NOT NULL;
DROP INDEX "relationshipprojectionjob_status_next_attempt_at_lease_expires_at";

CREATE INDEX "revenueoutboxevent_delivery_status_next_attempt_at_v2"
  ON "revenue_outbox_events" ("delivery_status", "next_attempt_at")
  WHERE "delivery_status" IN ('pending', 'failed');
DROP INDEX "revenueoutboxevent_delivery_status_next_attempt_at";
ALTER INDEX "revenueoutboxevent_delivery_status_next_attempt_at_v2"
  RENAME TO "revenueoutboxevent_delivery_status_next_attempt_at";

CREATE INDEX "backgroundtaskschedulestate_lease_expires_at_v2"
  ON "background_task_schedule_states" ("lease_expires_at")
  WHERE "last_run_id" = '' AND "lease_owner" <> '' AND "lease_expires_at" IS NOT NULL;
DROP INDEX "backgroundtaskschedulestate_lease_expires_at";
ALTER INDEX "backgroundtaskschedulestate_lease_expires_at_v2"
  RENAME TO "backgroundtaskschedulestate_lease_expires_at";

CREATE INDEX "approvaltoken_expires_at"
  ON "approval_tokens" ("expires_at")
  WHERE "consumed" = false;

CREATE INDEX "cloudevent_routing_status_received_at"
  ON "cloud_events" ("routing_status", "received_at")
  WHERE "routing_status" = 'pending';
DROP INDEX "cloudevent_routing_status";

-- PostgreSQL already treats NULLs as distinct in a unique index, but spelling
-- the partial predicate makes the active-claim mutex and its footprint clear.
CREATE UNIQUE INDEX "revenueleakscan_active_claim"
  ON "revenue_leak_scans" ("active_claim")
  WHERE "active_claim" IS NOT NULL;
DROP INDEX "revenue_leak_scans_active_claim_key";
