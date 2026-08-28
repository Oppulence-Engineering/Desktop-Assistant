ALTER TABLE oauth_consent_sessions
  DROP CONSTRAINT oauth_consent_sessions_status_check,
  ADD CONSTRAINT oauth_consent_sessions_status_check
    CHECK (status IN ('created','shown','step_up_pending','processing','approved','denied','invalidated','indeterminate','failed')),
  DROP CONSTRAINT oauth_consent_sessions_hydra_outcome_phase_check,
  ADD CONSTRAINT oauth_consent_sessions_hydra_outcome_phase_check
    CHECK (hydra_outcome_phase IN ('accept_pending','accepted','reject_pending','rejected','indeterminate')),
  ADD COLUMN hydra_requested_audience jsonb,
  ADD COLUMN hydra_requested_scopes jsonb,
  ADD COLUMN hydra_outcome_proof jsonb;

UPDATE oauth_consent_sessions
SET hydra_requested_audience = jsonb_build_array(context #>> '{connector,audience}'),
    hydra_requested_scopes = '["offline_access"]'::jsonb || COALESCE(
      (SELECT jsonb_agg(scope ->> 'name') FROM jsonb_array_elements(context -> 'scopes') AS scope),
      '[]'::jsonb
    );

ALTER TABLE oauth_consent_sessions
  ALTER COLUMN hydra_requested_audience SET NOT NULL,
  ALTER COLUMN hydra_requested_scopes SET NOT NULL;
