ALTER TABLE "relationships"
  ADD COLUMN "company_categories" jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN "company_description" text NULL,
  ADD COLUMN "linkedin_url" character varying NULL,
  ADD COLUMN "company_enrichment_refs" jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN "company_enrichment_version" character varying NULL,
  ADD COLUMN "company_enriched_at" timestamptz NULL;
