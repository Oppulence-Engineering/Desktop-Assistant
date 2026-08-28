ALTER TABLE oauth_consent_sessions
  ADD COLUMN hydra_redirect_to text,
  ADD COLUMN decision_claim_token text,
  ADD COLUMN decision_lease_until timestamptz,
  ADD COLUMN decision_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN decision_next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN decision_last_error text;

DROP INDEX oauth_consent_sessions_one_active_challenge_idx;
CREATE UNIQUE INDEX oauth_consent_sessions_challenge_unique_idx ON oauth_consent_sessions (challenge);
CREATE INDEX oauth_consent_sessions_decision_pending_idx
  ON oauth_consent_sessions (decision_next_attempt_at, created_at)
  WHERE status = 'processing' AND decision IS NOT NULL;

ALTER TABLE oauth_consent_browser_flows
  ADD COLUMN state_value text,
  ADD COLUMN claim_token text,
  ADD COLUMN lease_until timestamptz,
  ADD COLUMN superseded_by text;
CREATE INDEX oauth_consent_browser_flows_superseded_idx ON oauth_consent_browser_flows (superseded_by)
  WHERE superseded_by IS NOT NULL;
