-- Versioned provenance for the six server-managed product workflows. Active
-- remains user-controlled so pausing survives definition reconciliation.
ALTER TABLE `background_tasks` ADD COLUMN `template_slug` text NULL;
ALTER TABLE `background_tasks` ADD COLUMN `template_version` integer NOT NULL DEFAULT (0);
ALTER TABLE `background_tasks` ADD COLUMN `system_managed` bool NOT NULL DEFAULT (false);
