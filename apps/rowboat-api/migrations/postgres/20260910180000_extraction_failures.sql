-- Messages the model could not read during a scan. Non-zero means the audit
-- fell back to deterministic rules and its result is narrower than it looks.
ALTER TABLE "revenue_leak_scans"
  ADD COLUMN "extraction_failures" bigint NOT NULL DEFAULT 0;
