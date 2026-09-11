-- The commitment register lists obligations across every account at once:
-- "what we owe" and "what they owe us". Those queries filter by workspace,
-- direction and status, and order by due date, so they need real indexes.
-- Before this migration the commitments table carried none.
CREATE INDEX "commitment_status_due_at_revenue_workspace_id" ON "commitments" ("status", "due_at", "revenue_workspace_id");
CREATE INDEX "commitment_direction_status_revenue_workspace_id" ON "commitments" ("direction", "status", "revenue_workspace_id");

-- A scan already counts the relationships, evidence and actions it created.
-- The Open Promises report counts commitments, so the scan must record them.
ALTER TABLE "revenue_leak_scans" ADD COLUMN "commitments_created" bigint NOT NULL DEFAULT 0;
