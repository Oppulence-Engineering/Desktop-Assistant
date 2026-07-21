-- Provider webhooks map an external account to one Rowboat tenant. Allowing
-- duplicate owners makes inbound Slack/Google events ambiguous and can route a
-- signed provider event into the wrong tenant. Existing duplicate rows must be
-- reconciled before applying this migration; failing closed is intentional.
CREATE UNIQUE INDEX IF NOT EXISTS oauthconnection_provider_external_account_id
ON oauth_connections (provider, external_account_id);
