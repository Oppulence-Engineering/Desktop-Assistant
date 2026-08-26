-- RFC 036 R1.1: typed assertion authority and complete lifecycle metadata.
-- Existing rows were accepted by the pre-R1.1 ingestion path, so the migration
-- derives the same deterministic authority rank used by the projector.
-- Deploy this additive migration before the new binary. Existing rows and the
-- database default intentionally remain status='active' until every legacy
-- projector has drained. The new projector reads both active and accepted while
-- all new writers explicitly emit accepted. A later cleanup migration may
-- rewrite active rows and the database default after the rolling-deploy window.

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
