-- Cross-replica scan admission. A non-NULL workspace claim is owned only by
-- the current pending/running scan and is cleared at every terminal transition.
-- The nullable unique column gives SQLite and Postgres identical semantics.
ALTER TABLE `revenue_leak_scans` ADD COLUMN `active_claim` text NULL;
CREATE UNIQUE INDEX IF NOT EXISTS `revenue_leak_scans_active_claim_key`
  ON `revenue_leak_scans` (`active_claim`);
