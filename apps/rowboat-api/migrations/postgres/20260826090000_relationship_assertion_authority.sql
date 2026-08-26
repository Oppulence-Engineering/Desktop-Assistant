-- RFC 036 R1.1: typed assertion authority and complete lifecycle metadata.
-- Existing rows were accepted by the pre-R1.1 ingestion path, so the migration
-- derives the same deterministic authority rank used by the projector.
-- Deploy this additive migration before the new binary. Existing rows and the
-- database default intentionally remain status='active' until every legacy
-- projector has drained. The new projector reads both active and accepted while
-- all new writers explicitly emit accepted. A later cleanup migration may
-- rewrite active rows and the database default after the rolling-deploy window.
-- New projection jobs use projector version 2. A pre-R1.1 version-1 worker
-- rejects those jobs before reading assertions instead of silently completing a
-- stale projection; version-2 workers retain support for draining version-1 jobs.

-- Pre-R1.1 stored assertion values as arbitrary non-empty text. Do not label
-- incompatible legacy data as schema v1 and let the new projector dead-letter
-- every relationship that contains it. Fail the migration before changing the
-- schema so operators can repair the bounded set of invalid rows safely.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "relationship_assertions"
	WHERE btrim("value") = ''
	   OR "value" <> btrim("value")
	   OR octet_length(btrim("value")) > 4096
	   OR "dimension" NOT IN (
	     'lifecycle', 'engagement', 'sentiment', 'health',
	     'summary', 'next_action', 'risk', 'milestone'
	   )
	   OR "source_type" NOT IN (
	     'user_correction', 'source_fact', 'deterministic',
	     'external_research', 'ai_inference'
	   )
       OR ("dimension" = 'lifecycle' AND btrim("value") NOT IN (
         'prospect', 'evaluation', 'contracting', 'onboarding',
         'active_customer', 'renewal', 'churned', 'former_customer'
       ))
       OR ("dimension" = 'engagement' AND btrim("value") NOT IN (
         'unknown', 'increasing', 'steady', 'declining', 'dormant'
       ))
       OR ("dimension" = 'sentiment' AND btrim("value") NOT IN (
         'unknown', 'positive', 'mixed', 'negative'
       ))
       OR ("dimension" = 'health' AND btrim("value") NOT IN (
         'unknown', 'healthy', 'needs_attention', 'critical'
       ))
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'legacy relationship assertions violate value schema v1',
      HINT = 'repair invalid relationship_assertions values before applying 20260826090000';
  END IF;
END
$$;

ALTER TABLE "relationship_assertions"
  ADD COLUMN "authority_rank" bigint NOT NULL DEFAULT 1,
  ADD COLUMN "value_schema_version" bigint NOT NULL DEFAULT 1,
  ADD COLUMN "reviewer_id" uuid NULL,
  ADD COLUMN "review_decision" character varying NULL,
  ADD COLUMN "reviewed_at" timestamptz NULL;

UPDATE "relationship_assertions"
SET "authority_rank" = CASE "source_type"
  WHEN 'user_correction' THEN 5
  WHEN 'source_fact' THEN 4
  WHEN 'deterministic' THEN 3
  WHEN 'external_research' THEN 2
  WHEN 'ai_inference' THEN 1
  ELSE 1
END;

-- A user correction is itself an explicit user review decision. Preserve the
-- original actor and recorded time as its reviewer audit metadata.
UPDATE "relationship_assertions"
SET "reviewer_id" = "user_relationship_assertions",
    "review_decision" = 'accepted',
    "reviewed_at" = "created_at"
WHERE "source_type" = 'user_correction';

CREATE INDEX "relationshipassertion_authority_rank_valid_from_relationship_id"
  ON "relationship_assertions" ("authority_rank", "valid_from", "relationship_id");
