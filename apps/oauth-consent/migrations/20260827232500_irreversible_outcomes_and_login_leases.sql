ALTER TABLE oauth_consent_sessions
  DROP CONSTRAINT oauth_consent_sessions_status_check,
  ADD CONSTRAINT oauth_consent_sessions_status_check
    CHECK (status IN ('created','shown','step_up_pending','processing','approved','denied','invalidated','failed')),
  ADD COLUMN hydra_outcome_phase text
    CHECK (hydra_outcome_phase IN ('accept_pending','accepted','reject_pending','rejected')),
  ADD COLUMN grant_recorded_at timestamptz;

ALTER TABLE oauth_consent_browser_flows
  ADD COLUMN login_subject text,
  ADD COLUMN upstream_phase text
    CHECK (upstream_phase IN ('workos_exchanged','hydra_pending','completed')),
  ADD COLUMN upstream_redirect_to text,
  ADD COLUMN completed_at timestamptz;

CREATE INDEX oauth_consent_browser_flows_login_recovery_idx
  ON oauth_consent_browser_flows (lease_until, created_at)
  WHERE kind = 'login' AND completed_at IS NULL;
