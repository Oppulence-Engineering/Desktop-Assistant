-- One role assertion per (person, relationship).
--
-- APPLY ONLY AFTER BackfillWorkspacePersons reports duplicateParticipants == 0 for
-- every workspace. Shipping this alongside the person tables would fail on any
-- workspace carrying duplicate participant rows, which are reachable today through
-- the email-set-later path in upsertRelationshipParticipant.
--
-- Audit query to run first:
--   SELECT relationship_id, email, COUNT(*)
--     FROM relationship_participants
--    WHERE email IS NOT NULL AND email <> ''
--    GROUP BY 1, 2 HAVING COUNT(*) > 1;
--
-- Both SQLite and PostgreSQL treat NULLs as distinct in a unique index, so
-- participants with no person link and participants with no email continue to
-- coexist freely. Verify that holds on your PostgreSQL version before shipping --
-- it is the assumption this whole index rests on.

CREATE UNIQUE INDEX IF NOT EXISTS `relationshipparticipant_person_id_relationship_id`
  ON `relationship_participants` (`person_id`, `relationship_id`);
