-- Seed last_touch_at from the observation set.
--
-- The field was written at exactly one site -- relationship creation in scan.go --
-- and never updated. The quiet_account detector in relationship_attention.go reads
-- it to emit "No recorded interaction for %d days", so every account's silence has
-- been measured from the day it was created rather than from its last evidence.
--
-- From here the ingest path bumps it monotonically and the projector reconciles it
-- against the observations, so deletion and merge converge correctly.
--
-- EXPECT QUEUE CHURN ON FIRST RUN. Accounts that were wrongly "quiet" go fresh and
-- their attention items should close; accounts that never had a value get one for
-- the first time and may raise new items. RefreshRelationshipAttention reopens
-- dismissed items on material input change, so users see movement in both
-- directions. Roll the projector reconcile out per workspace behind a feature
-- control rather than shipping it hot.

UPDATE `relationships`
SET `last_touch_at` = (
  SELECT MAX(`occurred_at`)
    FROM `relationship_observations`
   WHERE `relationship_observations`.`relationship_id` = `relationships`.`id`
)
WHERE EXISTS (
  SELECT 1
    FROM `relationship_observations`
   WHERE `relationship_observations`.`relationship_id` = `relationships`.`id`
);
