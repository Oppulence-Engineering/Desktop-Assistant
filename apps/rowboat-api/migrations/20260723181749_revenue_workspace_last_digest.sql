-- RFC 030 proactive digest: track when each workspace was last emailed a
-- digest, so the scheduled sender honors a per-user minimum interval.
ALTER TABLE `revenue_workspaces` ADD COLUMN `last_digest_at` datetime NULL;
