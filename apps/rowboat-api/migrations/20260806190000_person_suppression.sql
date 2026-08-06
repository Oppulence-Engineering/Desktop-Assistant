-- Person suppression: make a person deletion stick.
--
-- Deleting person rows alone does not delete a person. Every sync re-derives
-- people from message headers and calendar invites, so resolvePerson recreates
-- whoever was removed on the next pass. This table is the tombstone that ingest
-- consults before creating anyone.
--
-- Stores the identity anchor hash, never the address: the point is to recognise
-- an identity on sight without retaining the identifier that was asked to be
-- forgotten.
CREATE TABLE IF NOT EXISTS person_suppressions (
    id                       uuid PRIMARY KEY,
    created_at               timestamp NOT NULL,
    updated_at               timestamp NOT NULL,
    key_hash                 text NOT NULL,
    kind                     text NOT NULL,
    reason                   text NOT NULL DEFAULT 'user_action',
    suppressed_at            timestamp NOT NULL,
    note                     text,
    revenue_workspace_id     uuid NOT NULL,
    user_person_suppressions uuid NOT NULL
);

-- One suppression per identity per workspace, and the index resolution hits on
-- every person it considers.
CREATE UNIQUE INDEX IF NOT EXISTS personsuppression_key_hash_revenue_workspace_id
    ON person_suppressions (key_hash, revenue_workspace_id);
