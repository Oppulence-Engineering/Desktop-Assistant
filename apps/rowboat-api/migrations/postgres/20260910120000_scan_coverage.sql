-- Coverage, so "conversations reviewed" cannot imply a depth the scan did not
-- have. A thread whose body could not be read was judged on a ~200 character
-- snippet; a skipped thread was never judged at all.
ALTER TABLE "revenue_leak_scans"
  ADD COLUMN "threads_deep_read" bigint NOT NULL DEFAULT 0,
  ADD COLUMN "threads_snippet_only" bigint NOT NULL DEFAULT 0,
  ADD COLUMN "threads_skipped" bigint NOT NULL DEFAULT 0;
