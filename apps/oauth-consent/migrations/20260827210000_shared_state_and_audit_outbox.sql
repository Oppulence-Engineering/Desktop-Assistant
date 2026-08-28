CREATE TABLE oauth_consent_sessions (
  id text PRIMARY KEY,
  challenge text NOT NULL,
  csrf text NOT NULL,
  subject text NOT NULL,
  hydra_client_id text NOT NULL,
  context jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('created','shown','step_up_pending','processing','approved','denied','failed')),
  selected_scopes jsonb,
  decision text CHECK (decision IN ('approve','deny')),
  decision_payload jsonb,
  hydra_committed_at timestamptz,
  version bigint NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_consent_sessions_challenge_idx ON oauth_consent_sessions (challenge);
CREATE INDEX oauth_consent_sessions_expiry_idx ON oauth_consent_sessions (expires_at);
CREATE UNIQUE INDEX oauth_consent_sessions_one_active_challenge_idx ON oauth_consent_sessions (challenge)
  WHERE status NOT IN ('approved','denied','failed');

CREATE TABLE oauth_consent_browser_flows (
  state_hash text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('login','step_up')),
  cookie_binding text NOT NULL,
  nonce text NOT NULL,
  challenge text,
  consent_session_id text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_consent_browser_flows_expiry_idx ON oauth_consent_browser_flows (expires_at);

CREATE TABLE oauth_consent_audit_outbox (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  locked_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_consent_audit_outbox_pending_idx ON oauth_consent_audit_outbox (next_attempt_at) WHERE delivered_at IS NULL;
