-- Whether a person's mail still reaches them.
--
-- Projected from the `employment_status` PersonAttribute by the person projector,
-- which is the only writer. Nothing else may set it.
--
-- This exists so the attention detectors can filter on a departure without joining
-- attributes per relationship. `quiet_account` fires whenever an account goes
-- silent, and a departed contact makes an account go silent forever — so without
-- it the product asks the user to follow up with someone whose mailbox rejects
-- mail, once per cooldown, indefinitely.
--
-- Default `unknown`, not `active`: absent means we have never had a reason to ask.
-- Only a mail delivery report or the user saying so moves it off that, so existing
-- rows are correctly left as "we do not know" rather than silently asserted live.
--
-- NOTE ON HOW THIS FILE IS USED. Nothing executes it. Schema reaches every
-- environment through ent auto-migration: deploys run `cmd/migrate apply`, which
-- turns AutoMigrate on for that step regardless of the AUTO_MIGRATE=false the app
-- pods then run with. These files are the human-readable record of what each
-- change did to the schema, mirroring ent/migrate/schema.go — kept because a
-- generated Go table definition is a poor place to explain why a column exists.
-- Written to match the shape of the surrounding migrations so it can be applied by
-- hand against a database that has drifted.
ALTER TABLE `relationship_persons`
  ADD COLUMN `employment_status` text NOT NULL DEFAULT ('unknown');

-- No backfill statement, deliberately. `projector_version` gates reprojection, and
-- bumping it to 2 in code makes every person reproject once on next read, which
-- populates this column from attributes that already exist. Rows still claiming
-- version 1 are stale by definition.
