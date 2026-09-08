ALTER TABLE "relationships"
  ADD COLUMN "company_enrichment_data" jsonb NOT NULL DEFAULT '{}';

ALTER TABLE "relationship_persons"
  ADD COLUMN "linkedin_url" character varying NULL,
  ADD COLUMN "department" character varying NULL;
