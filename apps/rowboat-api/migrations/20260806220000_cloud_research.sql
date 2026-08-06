-- Cloud research (RFC 039): the external_research provenance tier, the citations
-- that justify it, workspace consent, and the two person columns it can fill.
--
-- NOTE ON HOW THIS FILE IS USED. Nothing executes it. Schema reaches every
-- environment through ent auto-migration: deploys run `cmd/migrate apply`, which
-- turns AutoMigrate on for that step regardless of the AUTO_MIGRATE=false the app
-- pods then run with. These files are the human-readable record of what each
-- change did to the schema, mirroring ent/migrate/schema.go — kept because a
-- generated Go table definition is a poor place to explain why a column exists.

-- Consent to send a COUNTERPARTY's name and domain to a research vendor.
--
-- On the server and not only in desktop config because the data subject is not
-- the user: they are consenting on behalf of someone who never agreed to
-- anything, and a gate the client can assert its way past is not a gate. The
-- research path reads this column and nowhere else.
--
-- Default false, and deliberately independent of every capability and plan
-- check. An operator enabling the cloud_research capability, or a user upgrading
-- to the intelligence plan, must not turn this on as a side effect. Existing
-- workspaces are therefore correctly left as "has not agreed" rather than
-- inheriting consent from a purchase.
ALTER TABLE `revenue_workspaces`
  ADD COLUMN `cloud_research_consent` bool NOT NULL DEFAULT (false);
-- Cleared to NULL on revocation, so the column can never display a consent date
-- for a consent that is no longer in force.
ALTER TABLE `revenue_workspaces`
  ADD COLUMN `cloud_research_consent_at` datetime NULL;

-- Where an external_research claim came from: a JSON array of
-- {title, url, excerpts[]}.
--
-- Nullable and empty for every owned-data source. Required for external_research
-- — enforced in acceptPersonAttribute, not by the column — because a vendor
-- claim with nothing to click is a guess wearing a better source_type, and it is
-- rejected rather than stored at low confidence.
ALTER TABLE `person_attributes`
  ADD COLUMN `citations_json` text NULL;
ALTER TABLE `relationship_assertions`
  ADD COLUMN `citations_json` text NULL;

-- Projected from cloud-research attributes only. Both stay empty for every
-- workspace that never enables research, so "" reads as "we were never told"
-- rather than as an assertion of anything.
ALTER TABLE `relationship_persons`
  ADD COLUMN `seniority` text NULL;
ALTER TABLE `relationship_persons`
  ADD COLUMN `location` text NULL;

-- No backfill statement, deliberately. `personProjectorVersion` moves 2 -> 3 in
-- code, which makes every person reproject once on next read; rows still
-- claiming version 2 are stale by definition. There is nothing to backfill in
-- any case: no external_research attribute exists until someone consents.
--
-- Enum widenings carried by this change have no DDL because the validators are
-- application-level (oneOfRevenue), not CHECK constraints:
--   person_attributes.source_type        + external_research
--   person_attributes.source             + web
--   person_attributes.extractor          + parallel
--   person_attributes.dimension          + seniority, location
--   relationship_assertions.source_type  + external_research
--   relationship_attention_items.reason_code + external_trigger
--   subscriptions.plan                   + intelligence
--
-- The provenance ladder in assertionPriority also renumbered, from 4/3/2/1 to
-- 5/4/3/2/1, to open a slot for external_research between deterministic and
-- ai_inference. Nothing persists those numbers — they are compared only against
-- each other — so no data migration is needed.
