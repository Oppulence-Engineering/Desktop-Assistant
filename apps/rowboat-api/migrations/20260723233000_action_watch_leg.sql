-- RFC 023 Watch leg (WP4): correlate a product Act-seam return event back to
-- the ActionProposal that produced it, and record the loop closure.
--
-- cloud_events.correlation_id ties a product return event to a proposal; the
-- index backs the router's correlation lookup. action_proposals.return_event_id
-- and resolved_at record which event closed the loop and when (resolved_at is
-- the idempotency anchor for at-least-once return delivery).
ALTER TABLE `cloud_events` ADD COLUMN `correlation_id` text NULL;
CREATE INDEX `cloudevent_correlation_id` ON `cloud_events` (`correlation_id`);
ALTER TABLE `action_proposals` ADD COLUMN `return_event_id` text NULL;
ALTER TABLE `action_proposals` ADD COLUMN `resolved_at` datetime NULL;
