-- Rich cited Parallel enrichment remains flexible in JSON/attribute rows while
-- the fields needed on high-volume tables are projected for fast list views.
ALTER TABLE `relationships`
  ADD COLUMN `company_enrichment_data` json NOT NULL DEFAULT ('{}');

ALTER TABLE `relationship_persons`
  ADD COLUMN `linkedin_url` text NULL;
ALTER TABLE `relationship_persons`
  ADD COLUMN `department` text NULL;
