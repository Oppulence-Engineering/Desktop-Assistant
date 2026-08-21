-- atlas:pos action_outcomes[type=table]
-- atlas:pos action_proposals[type=table]
-- atlas:pos agent_approvals[type=table]
-- atlas:pos agent_definitions[type=table]
-- atlas:pos agentdefinition_history[type=table]
-- atlas:pos agent_sessions[type=table]
-- atlas:pos agent_session_events[type=table]
-- atlas:pos agent_tool_calls[type=table]
-- atlas:pos agent_tool_result_blobs[type=table]
-- atlas:pos agent_turns[type=table]
-- atlas:pos approval_tokens[type=table]
-- atlas:pos background_tasks[type=table]
-- atlas:pos background_task_artifacts[type=table]
-- atlas:pos background_task_runs[type=table]
-- atlas:pos background_task_run_events[type=table]
-- atlas:pos background_task_schedule_states[type=table]
-- atlas:pos cloud_events[type=table]
-- atlas:pos commitments[type=table]
-- atlas:pos commitment_dependencies[type=table]
-- atlas:pos commitment_events[type=table]
-- atlas:pos conversation_intelligence_artifacts[type=table]
-- atlas:pos credit_ledgers[type=table]
-- atlas:pos google_watches[type=table]
-- atlas:pos llm_usages[type=table]
-- atlas:pos llm_usage_histories[type=table]
-- atlas:pos mcp_connections[type=table]
-- atlas:pos mcp_connection_histories[type=table]
-- atlas:pos mail_body_caches[type=table]
-- atlas:pos mail_message_meta[type=table]
-- atlas:pos mail_signals[type=table]
-- atlas:pos mail_threads[type=table]
-- atlas:pos meeting_minute_usages[type=table]
-- atlas:pos oauth_connections[type=table]
-- atlas:pos oauth_connection_histories[type=table]
-- atlas:pos oauth_pendings[type=table]
-- atlas:pos relationship_persons[type=table]
-- atlas:pos person_attributes[type=table]
-- atlas:pos person_identities[type=table]
-- atlas:pos person_interaction_stats[type=table]
-- atlas:pos person_merge_candidates[type=table]
-- atlas:pos person_suppressions[type=table]
-- atlas:pos policy_decision_snapshots[type=table]
-- atlas:pos relationships[type=table]
-- atlas:pos relationship_assertions[type=table]
-- atlas:pos relationship_attention_items[type=table]
-- atlas:pos relationship_identities[type=table]
-- atlas:pos relationship_identity_candidates[type=table]
-- atlas:pos relationship_identity_decisions[type=table]
-- atlas:pos relationship_lineage_events[type=table]
-- atlas:pos relationship_observations[type=table]
-- atlas:pos relationship_participants[type=table]
-- atlas:pos relationship_projection_jobs[type=table]
-- atlas:pos relationship_review_acknowledgements[type=table]
-- atlas:pos relationship_source_status[type=table]
-- atlas:pos relationship_state_snapshots[type=table]
-- atlas:pos revenue_actions[type=table]
-- atlas:pos revenue_action_revisions[type=table]
-- atlas:pos revenue_evidences[type=table]
-- atlas:pos revenue_leak_scans[type=table]
-- atlas:pos revenue_outbox_events[type=table]
-- atlas:pos revenue_trust_events[type=table]
-- atlas:pos revenue_workspaces[type=table]
-- atlas:pos revenue_workspace_members[type=table]
-- atlas:pos subscriptions[type=table]
-- atlas:pos subscription_histories[type=table]
-- atlas:pos tenant_evidence_keys[type=table]
-- atlas:pos users[type=table]
-- atlas:pos user_histories[type=table]
-- atlas:pos workspace_feature_controls[type=table]
-- atlas:pos commitment_evidences[type=table]
-- atlas:pos relationship_evidences[type=table]
-- atlas:pos revenue_action_evidences[type=table]

-- Create "user_histories" table
CREATE TABLE "user_histories" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "history_time" timestamptz NOT NULL,
  "operation" character varying NOT NULL,
  "ref" uuid NULL,
  "email" character varying NULL,
  "workos_user_id" character varying NOT NULL,
  "workos_org_id" character varying NULL,
  PRIMARY KEY ("id")
);
-- Create index "userhistory_history_time" to table: "user_histories"
CREATE INDEX "userhistory_history_time" ON "user_histories" ("history_time");
-- Create "users" table
CREATE TABLE "users" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "email" character varying NULL,
  "workos_user_id" character varying NOT NULL,
  "workos_org_id" character varying NULL,
  PRIMARY KEY ("id")
);
-- Create index "users_workos_user_id_key" to table: "users"
CREATE UNIQUE INDEX "users_workos_user_id_key" ON "users" ("workos_user_id");
-- Create "mcp_connection_histories" table
CREATE TABLE "mcp_connection_histories" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "history_time" timestamptz NOT NULL,
  "operation" character varying NOT NULL,
  "ref" uuid NULL,
  "connector" character varying NOT NULL,
  "audience" character varying NOT NULL,
  "scopes" jsonb NULL,
  "refresh_token_encrypted" bytea NULL,
  "api_key_encrypted" bytea NULL,
  "connected_at" timestamptz NULL,
  "last_used_at" timestamptz NULL,
  "expires_at" timestamptz NULL,
  PRIMARY KEY ("id")
);
-- Create index "mcpconnectionhistory_history_time" to table: "mcp_connection_histories"
CREATE INDEX "mcpconnectionhistory_history_time" ON "mcp_connection_histories" ("history_time");
-- Create "oauth_pendings" table
CREATE TABLE "oauth_pendings" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "state" character varying NOT NULL,
  "provider" character varying NOT NULL,
  "payload_encrypted" bytea NOT NULL,
  "expires_at" timestamptz NOT NULL,
  PRIMARY KEY ("id")
);
-- Create index "oauth_pendings_state_key" to table: "oauth_pendings"
CREATE UNIQUE INDEX "oauth_pendings_state_key" ON "oauth_pendings" ("state");
-- Create index "oauthpending_expires_at" to table: "oauth_pendings"
CREATE INDEX "oauthpending_expires_at" ON "oauth_pendings" ("expires_at");
-- Create "agentdefinition_history" table
CREATE TABLE "agentdefinition_history" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "history_time" timestamptz NOT NULL,
  "operation" character varying NOT NULL,
  "ref" uuid NULL,
  "slug" character varying NOT NULL,
  "name" character varying NOT NULL,
  "instructions" character varying NULL,
  "model" character varying NULL,
  "provider" character varying NULL,
  "limits_json" character varying NULL,
  "enabled_tools" jsonb NULL,
  "tools_json" character varying NULL,
  "subagent_refs" jsonb NULL,
  "channel_bindings" character varying NULL,
  "connector_reqs" jsonb NULL,
  "source" character varying NOT NULL DEFAULT 'tenant',
  "forked_from" character varying NULL,
  "revision" bigint NOT NULL DEFAULT 1,
  "source_format" character varying NOT NULL DEFAULT 'json',
  "raw_source" character varying NULL,
  "content_hash" character varying NULL,
  "managed_by" character varying NOT NULL DEFAULT 'api',
  "agent_sync_state" character varying NOT NULL DEFAULT 'current',
  "agent_sync_error" character varying NULL,
  PRIMARY KEY ("id")
);
-- Create index "agentdefinitionhistory_history_time" to table: "agentdefinition_history"
CREATE INDEX "agentdefinitionhistory_history_time" ON "agentdefinition_history" ("history_time");
-- Create "llm_usage_histories" table
CREATE TABLE "llm_usage_histories" (
  "id" uuid NOT NULL,
  "history_time" timestamptz NOT NULL,
  "operation" character varying NOT NULL,
  "ref" uuid NULL,
  "model" character varying NOT NULL,
  "use_case" character varying NULL,
  "sub_use_case" character varying NULL,
  "agent_name" character varying NULL,
  "input_tokens" bigint NOT NULL DEFAULT 0,
  "output_tokens" bigint NOT NULL DEFAULT 0,
  "cost_units" bigint NOT NULL DEFAULT 0,
  "request_id" uuid NOT NULL,
  "ts" timestamptz NOT NULL,
  PRIMARY KEY ("id")
);
-- Create index "llmusagehistory_history_time" to table: "llm_usage_histories"
CREATE INDEX "llmusagehistory_history_time" ON "llm_usage_histories" ("history_time");
-- Create "oauth_connection_histories" table
CREATE TABLE "oauth_connection_histories" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "history_time" timestamptz NOT NULL,
  "operation" character varying NOT NULL,
  "ref" uuid NULL,
  "provider" character varying NOT NULL,
  "refresh_token_encrypted" bytea NOT NULL,
  "scopes" jsonb NULL,
  "external_account_id" character varying NULL,
  PRIMARY KEY ("id")
);
-- Create index "oauthconnectionhistory_history_time" to table: "oauth_connection_histories"
CREATE INDEX "oauthconnectionhistory_history_time" ON "oauth_connection_histories" ("history_time");
-- Create "subscription_histories" table
CREATE TABLE "subscription_histories" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "history_time" timestamptz NOT NULL,
  "operation" character varying NOT NULL,
  "ref" uuid NULL,
  "plan" character varying NOT NULL DEFAULT 'free',
  "status" character varying NOT NULL DEFAULT 'active',
  "trial_expires_at" timestamptz NULL,
  "sanctioned_credits" bigint NOT NULL DEFAULT 10000,
  "stripe_customer_id" character varying NULL,
  "stripe_subscription_id" character varying NULL,
  PRIMARY KEY ("id")
);
-- Create index "subscriptionhistory_history_time" to table: "subscription_histories"
CREATE INDEX "subscriptionhistory_history_time" ON "subscription_histories" ("history_time");
-- Create "revenue_workspaces" table
CREATE TABLE "revenue_workspaces" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "workos_org_id" character varying NULL,
  "outbound_organization_id" character varying NULL,
  "outbound_workspace_id" character varying NULL,
  "mode" character varying NOT NULL DEFAULT 'local',
  "status" character varying NOT NULL DEFAULT 'active',
  "last_verified_at" timestamptz NULL,
  "last_digest_at" timestamptz NULL,
  "mail_history_id" character varying NULL,
  "cloud_research_consent" boolean NOT NULL DEFAULT false,
  "cloud_research_consent_at" timestamptz NULL,
  "user_revenue_workspaces" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "revenue_workspaces_users_revenue_workspaces" FOREIGN KEY ("user_revenue_workspaces") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "revenue_workspaces_outbound_workspace_id_key" to table: "revenue_workspaces"
CREATE UNIQUE INDEX "revenue_workspaces_outbound_workspace_id_key" ON "revenue_workspaces" ("outbound_workspace_id");
-- Create index "revenueworkspace_user_revenue_workspaces" to table: "revenue_workspaces"
CREATE UNIQUE INDEX "revenueworkspace_user_revenue_workspaces" ON "revenue_workspaces" ("user_revenue_workspaces");
-- Create "relationships" table
CREATE TABLE "relationships" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "kind" character varying NOT NULL,
  "display_name" character varying NOT NULL,
  "primary_email" character varying NULL,
  "account_domain" character varying NULL,
  "outbound_lead_id" character varying NULL,
  "outbound_account_ref" character varying NULL,
  "resource_refs" jsonb NOT NULL,
  "summary" text NULL,
  "last_touch_at" timestamptz NULL,
  "next_action_at" timestamptz NULL,
  "next_action" text NULL,
  "status" character varying NOT NULL DEFAULT 'active',
  "lifecycle" character varying NOT NULL DEFAULT 'prospect',
  "engagement" character varying NOT NULL DEFAULT 'unknown',
  "sentiment" character varying NOT NULL DEFAULT 'unknown',
  "health" character varying NOT NULL DEFAULT 'unknown',
  "state_reason" text NULL,
  "state_version" bigint NOT NULL DEFAULT 0,
  "state_hash" character varying NULL,
  "projector_version" bigint NOT NULL DEFAULT 1,
  "projected_at" timestamptz NULL,
  "last_changed_at" timestamptz NULL,
  "risks" jsonb NOT NULL,
  "milestones" jsonb NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_relationships" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "relationships_revenue_workspaces_relationships" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationships_users_relationships" FOREIGN KEY ("user_relationships") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "relationship_primary_email_revenue_workspace_id" to table: "relationships"
CREATE INDEX "relationship_primary_email_revenue_workspace_id" ON "relationships" ("primary_email", "revenue_workspace_id");
-- Create index "relationship_status_revenue_workspace_id" to table: "relationships"
CREATE INDEX "relationship_status_revenue_workspace_id" ON "relationships" ("status", "revenue_workspace_id");
-- Create "revenue_actions" table
CREATE TABLE "revenue_actions" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "action_type" character varying NOT NULL,
  "channel" character varying NOT NULL,
  "detector" character varying NOT NULL,
  "dedupe_key" character varying NOT NULL,
  "revision" bigint NOT NULL DEFAULT 1,
  "revision_hash" character varying NOT NULL,
  "reason" text NOT NULL,
  "recipient_email" character varying NULL,
  "proposed_subject" text NULL,
  "proposed_message" text NULL,
  "sender_account_ref" character varying NULL,
  "assigned_user_id" uuid NULL,
  "priority_score" bigint NOT NULL,
  "priority_components_json" text NULL,
  "queue_status" character varying NOT NULL DEFAULT 'open',
  "policy_status" character varying NOT NULL DEFAULT 'pending',
  "approval_status" character varying NOT NULL DEFAULT 'pending',
  "execution_status" character varying NOT NULL DEFAULT 'pending',
  "execution_owner" character varying NOT NULL DEFAULT 'rowboat',
  "approved_revision" bigint NULL,
  "approved_decision_id" uuid NULL,
  "approved_by" uuid NULL,
  "approved_at" timestamptz NULL,
  "execution_idempotency_key" character varying NULL,
  "execution_mode" character varying NOT NULL DEFAULT 'draft',
  "provider_message_id" character varying NULL,
  "provider_thread_id" character varying NULL,
  "executed_at" timestamptz NULL,
  "execution_error" text NULL,
  "reconciliation_status" character varying NULL,
  "reconciliation_attempts" bigint NOT NULL DEFAULT 0,
  "reconciliation_checked_at" timestamptz NULL,
  "reconciliation_next_at" timestamptz NULL,
  "reconciliation_error" text NULL,
  "dismiss_reason" character varying NULL,
  "snoozed_until" timestamptz NULL,
  "due_at" timestamptz NULL,
  "handled_at" timestamptz NULL,
  "relationship_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_revenue_actions" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "revenue_actions_relationships_actions" FOREIGN KEY ("relationship_id") REFERENCES "relationships" ("id") ON DELETE NO ACTION,
  CONSTRAINT "revenue_actions_revenue_workspaces_actions" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "revenue_actions_users_revenue_actions" FOREIGN KEY ("user_revenue_actions") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "revenueaction_dedupe_key_revenue_workspace_id" to table: "revenue_actions"
CREATE UNIQUE INDEX "revenueaction_dedupe_key_revenue_workspace_id" ON "revenue_actions" ("dedupe_key", "revenue_workspace_id");
-- Create index "revenueaction_queue_status_priority_score_revenue_workspace_id" to table: "revenue_actions"
CREATE INDEX "revenueaction_queue_status_priority_score_revenue_workspace_id" ON "revenue_actions" ("queue_status", "priority_score", "revenue_workspace_id");
-- Create "action_outcomes" table
CREATE TABLE "action_outcomes" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "kind" character varying NOT NULL,
  "source" character varying NOT NULL,
  "source_event_id" character varying NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "metadata_json" text NULL,
  "revenue_action_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_action_outcomes" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "action_outcomes_revenue_actions_outcomes" FOREIGN KEY ("revenue_action_id") REFERENCES "revenue_actions" ("id") ON DELETE NO ACTION,
  CONSTRAINT "action_outcomes_revenue_workspaces_outcomes" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "action_outcomes_users_action_outcomes" FOREIGN KEY ("user_action_outcomes") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "actionoutcome_source_source_event_id_revenue_action_id" to table: "action_outcomes"
CREATE UNIQUE INDEX "actionoutcome_source_source_event_id_revenue_action_id" ON "action_outcomes" ("source", "source_event_id", "revenue_action_id");
-- Create "action_proposals" table
CREATE TABLE "action_proposals" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "target" character varying NOT NULL,
  "kind" character varying NOT NULL,
  "params_json" text NULL,
  "financial" boolean NOT NULL DEFAULT false,
  "rationale" text NULL,
  "status" character varying NOT NULL DEFAULT 'pending',
  "correlation_id" character varying NULL,
  "entity_id" character varying NULL,
  "origin_run_id" character varying NULL,
  "expires_at" timestamptz NULL,
  "approved_at" timestamptz NULL,
  "executed_at" timestamptz NULL,
  "reason" text NULL,
  "result_ref" character varying NULL,
  "return_event_id" character varying NULL,
  "resolved_at" timestamptz NULL,
  "user_action_proposals" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "action_proposals_users_action_proposals" FOREIGN KEY ("user_action_proposals") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "actionproposal_status" to table: "action_proposals"
CREATE INDEX "actionproposal_status" ON "action_proposals" ("status");
-- Create index "actionproposal_target" to table: "action_proposals"
CREATE INDEX "actionproposal_target" ON "action_proposals" ("target");
-- Create index "actionproposal_correlation_id" to table: "action_proposals"
CREATE INDEX "actionproposal_correlation_id" ON "action_proposals" ("correlation_id");
-- Create "agent_definitions" table
CREATE TABLE "agent_definitions" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "slug" character varying NOT NULL,
  "name" character varying NOT NULL,
  "instructions" text NULL,
  "model" character varying NULL,
  "provider" character varying NULL,
  "limits_json" text NULL,
  "enabled_tools" jsonb NULL,
  "tools_json" text NULL,
  "subagent_refs" jsonb NULL,
  "channel_bindings" text NULL,
  "connector_reqs" jsonb NULL,
  "source" character varying NOT NULL DEFAULT 'tenant',
  "forked_from" character varying NULL,
  "revision" bigint NOT NULL DEFAULT 1,
  "source_format" character varying NOT NULL DEFAULT 'json',
  "raw_source" text NULL,
  "content_hash" character varying NULL,
  "managed_by" character varying NOT NULL DEFAULT 'api',
  "agent_sync_state" character varying NOT NULL DEFAULT 'current',
  "agent_sync_error" text NULL,
  "user_agent_definitions" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "agent_definitions_users_agent_definitions" FOREIGN KEY ("user_agent_definitions") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "agentdefinition_slug_user_agent_definitions" to table: "agent_definitions"
CREATE UNIQUE INDEX "agentdefinition_slug_user_agent_definitions" ON "agent_definitions" ("slug", "user_agent_definitions");
-- Create index "agentdefinition_source" to table: "agent_definitions"
CREATE INDEX "agentdefinition_source" ON "agent_definitions" ("source");
-- Create "agent_sessions" table
CREATE TABLE "agent_sessions" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "session_id" character varying NOT NULL,
  "agent_slug" character varying NOT NULL,
  "agent_source" character varying NULL,
  "agent_revision" bigint NOT NULL DEFAULT 0,
  "status" character varying NOT NULL DEFAULT 'active',
  "channel" character varying NOT NULL DEFAULT 'http',
  "channel_key" character varying NULL,
  "title" text NULL,
  "temporal_workflow_id" character varying NULL,
  "temporal_run_id" character varying NULL,
  "turn_count" bigint NOT NULL DEFAULT 0,
  "llm_call_count" bigint NOT NULL DEFAULT 0,
  "tool_call_count" bigint NOT NULL DEFAULT 0,
  "cost_units" bigint NOT NULL DEFAULT 0,
  "error" text NULL,
  "error_code" character varying NULL,
  "last_activity_at" timestamptz NULL,
  "started_at" timestamptz NULL,
  "completed_at" timestamptz NULL,
  "revision" bigint NOT NULL DEFAULT 1,
  "agent_definition_sessions" uuid NULL,
  "user_agent_sessions" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "agent_sessions_agent_definitions_sessions" FOREIGN KEY ("agent_definition_sessions") REFERENCES "agent_definitions" ("id") ON DELETE SET NULL,
  CONSTRAINT "agent_sessions_users_agent_sessions" FOREIGN KEY ("user_agent_sessions") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "agentsession_session_id_user_agent_sessions" to table: "agent_sessions"
CREATE UNIQUE INDEX "agentsession_session_id_user_agent_sessions" ON "agent_sessions" ("session_id", "user_agent_sessions");
-- Create index "agentsession_status" to table: "agent_sessions"
CREATE INDEX "agentsession_status" ON "agent_sessions" ("status");
-- Create index "agentsession_temporal_workflow_id" to table: "agent_sessions"
CREATE INDEX "agentsession_temporal_workflow_id" ON "agent_sessions" ("temporal_workflow_id");
-- Create index "agentsession_channel_channel_key_user_agent_sessions" to table: "agent_sessions"
CREATE INDEX "agentsession_channel_channel_key_user_agent_sessions" ON "agent_sessions" ("channel", "channel_key", "user_agent_sessions");
-- Create "agent_approvals" table
CREATE TABLE "agent_approvals" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "approval_id" character varying NOT NULL,
  "turn_seq" bigint NOT NULL,
  "tool_call_index" bigint NOT NULL DEFAULT 0,
  "tool_name" character varying NOT NULL,
  "trust_tier" character varying NULL,
  "status" character varying NOT NULL DEFAULT 'pending',
  "args_redacted_json" text NULL,
  "approval_token_ref" character varying NULL,
  "requested_by" character varying NULL,
  "resolved_by" character varying NULL,
  "requested_at" timestamptz NOT NULL,
  "resolved_at" timestamptz NULL,
  "expires_at" timestamptz NULL,
  "agent_session_approvals" uuid NOT NULL,
  "user_agent_approvals" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "agent_approvals_agent_sessions_approvals" FOREIGN KEY ("agent_session_approvals") REFERENCES "agent_sessions" ("id") ON DELETE NO ACTION,
  CONSTRAINT "agent_approvals_users_agent_approvals" FOREIGN KEY ("user_agent_approvals") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "agentapproval_approval_id_agent_session_approvals" to table: "agent_approvals"
CREATE UNIQUE INDEX "agentapproval_approval_id_agent_session_approvals" ON "agent_approvals" ("approval_id", "agent_session_approvals");
-- Create index "agentapproval_status" to table: "agent_approvals"
CREATE INDEX "agentapproval_status" ON "agent_approvals" ("status");
-- Create "agent_session_events" table
CREATE TABLE "agent_session_events" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "seq" bigint NOT NULL,
  "turn_seq" bigint NULL,
  "event_type" character varying NULL,
  "event_json" text NOT NULL,
  "received_at" timestamptz NOT NULL,
  "agent_session_events" uuid NOT NULL,
  "user_agent_session_events" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "agent_session_events_agent_sessions_events" FOREIGN KEY ("agent_session_events") REFERENCES "agent_sessions" ("id") ON DELETE NO ACTION,
  CONSTRAINT "agent_session_events_users_agent_session_events" FOREIGN KEY ("user_agent_session_events") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "agentsessionevent_seq_agent_session_events" to table: "agent_session_events"
CREATE UNIQUE INDEX "agentsessionevent_seq_agent_session_events" ON "agent_session_events" ("seq", "agent_session_events");
-- Create index "agentsessionevent_event_type" to table: "agent_session_events"
CREATE INDEX "agentsessionevent_event_type" ON "agent_session_events" ("event_type");
-- Create "agent_turns" table
CREATE TABLE "agent_turns" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "seq" bigint NOT NULL,
  "input" text NULL,
  "status" character varying NOT NULL DEFAULT 'pending',
  "summary" text NULL,
  "finish_reason" character varying NULL,
  "llm_call_count" bigint NOT NULL DEFAULT 0,
  "tool_call_count" bigint NOT NULL DEFAULT 0,
  "cost_units" bigint NOT NULL DEFAULT 0,
  "started_at" timestamptz NULL,
  "completed_at" timestamptz NULL,
  "agent_session_turns" uuid NOT NULL,
  "user_agent_turns" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "agent_turns_agent_sessions_turns" FOREIGN KEY ("agent_session_turns") REFERENCES "agent_sessions" ("id") ON DELETE NO ACTION,
  CONSTRAINT "agent_turns_users_agent_turns" FOREIGN KEY ("user_agent_turns") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "agentturn_seq_agent_session_turns" to table: "agent_turns"
CREATE UNIQUE INDEX "agentturn_seq_agent_session_turns" ON "agent_turns" ("seq", "agent_session_turns");
-- Create index "agentturn_status" to table: "agent_turns"
CREATE INDEX "agentturn_status" ON "agent_turns" ("status");
-- Create "agent_tool_calls" table
CREATE TABLE "agent_tool_calls" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "call_index" bigint NOT NULL,
  "tool_name" character varying NOT NULL,
  "args_json" text NULL,
  "result_bytes" bigint NOT NULL DEFAULT 0,
  "status" character varying NOT NULL DEFAULT 'pending',
  "error_code" character varying NULL,
  "trust_tier" character varying NULL,
  "started_at" timestamptz NULL,
  "completed_at" timestamptz NULL,
  "agent_turn_tool_calls" uuid NOT NULL,
  "user_agent_tool_calls" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "agent_tool_calls_agent_turns_tool_calls" FOREIGN KEY ("agent_turn_tool_calls") REFERENCES "agent_turns" ("id") ON DELETE NO ACTION,
  CONSTRAINT "agent_tool_calls_users_agent_tool_calls" FOREIGN KEY ("user_agent_tool_calls") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "agenttoolcall_call_index_agent_turn_tool_calls" to table: "agent_tool_calls"
CREATE UNIQUE INDEX "agenttoolcall_call_index_agent_turn_tool_calls" ON "agent_tool_calls" ("call_index", "agent_turn_tool_calls");
-- Create index "agenttoolcall_tool_name" to table: "agent_tool_calls"
CREATE INDEX "agenttoolcall_tool_name" ON "agent_tool_calls" ("tool_name");
-- Create "agent_tool_result_blobs" table
CREATE TABLE "agent_tool_result_blobs" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "session_id" character varying NOT NULL,
  "turn_seq" bigint NOT NULL,
  "call_index" bigint NOT NULL,
  "tool_name" character varying NULL,
  "content" text NOT NULL,
  "total_bytes" bigint NOT NULL,
  "user_agent_tool_result_blobs" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "agent_tool_result_blobs_users_agent_tool_result_blobs" FOREIGN KEY ("user_agent_tool_result_blobs") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "agenttoolresultblob_session_id_turn_seq_call_index" to table: "agent_tool_result_blobs"
CREATE INDEX "agenttoolresultblob_session_id_turn_seq_call_index" ON "agent_tool_result_blobs" ("session_id", "turn_seq", "call_index");
-- Create "approval_tokens" table
CREATE TABLE "approval_tokens" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "token_hash" character varying NOT NULL,
  "proposal_id" character varying NOT NULL,
  "params_hash" character varying NOT NULL,
  "operator_user_id" character varying NOT NULL,
  "step_up" boolean NOT NULL DEFAULT false,
  "expires_at" timestamptz NOT NULL,
  "consumed" boolean NOT NULL DEFAULT false,
  "consumed_at" timestamptz NULL,
  "user_approval_tokens" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "approval_tokens_users_approval_tokens" FOREIGN KEY ("user_approval_tokens") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "approval_tokens_token_hash_key" to table: "approval_tokens"
CREATE UNIQUE INDEX "approval_tokens_token_hash_key" ON "approval_tokens" ("token_hash");
-- Create index "approvaltoken_proposal_id" to table: "approval_tokens"
CREATE INDEX "approvaltoken_proposal_id" ON "approval_tokens" ("proposal_id");
-- Create "background_tasks" table
CREATE TABLE "background_tasks" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "slug" character varying NOT NULL,
  "name" character varying NOT NULL,
  "instructions" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "triggers_json" text NULL,
  "model" character varying NULL,
  "provider" character varying NULL,
  "execution_target" character varying NOT NULL DEFAULT 'desktop',
  "template_slug" character varying NULL,
  "template_version" bigint NOT NULL DEFAULT 0,
  "system_managed" boolean NOT NULL DEFAULT false,
  "task_created_at" timestamptz NULL,
  "last_attempt_at" timestamptz NULL,
  "last_run_id" character varying NULL,
  "last_run_at" timestamptz NULL,
  "last_run_summary" text NULL,
  "last_run_error" text NULL,
  "schedule_sync_state" character varying NOT NULL DEFAULT 'paused',
  "schedule_sync_error" text NULL,
  "schedule_synced_at" timestamptz NULL,
  "revision" bigint NOT NULL DEFAULT 1,
  "user_background_tasks" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "background_tasks_users_background_tasks" FOREIGN KEY ("user_background_tasks") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "backgroundtask_slug_user_background_tasks" to table: "background_tasks"
CREATE UNIQUE INDEX "backgroundtask_slug_user_background_tasks" ON "background_tasks" ("slug", "user_background_tasks");
-- Create "background_task_artifacts" table
CREATE TABLE "background_task_artifacts" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "body" text NOT NULL DEFAULT '',
  "revision" bigint NOT NULL DEFAULT 1,
  "updated_by_run_id" character varying NULL,
  "content_type" character varying NOT NULL DEFAULT 'text/markdown',
  "background_task_id" uuid NOT NULL,
  "user_background_task_artifacts" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "background_task_artifacts_background_tasks_artifact" FOREIGN KEY ("background_task_id") REFERENCES "background_tasks" ("id") ON DELETE NO ACTION,
  CONSTRAINT "background_task_artifacts_users_background_task_artifacts" FOREIGN KEY ("user_background_task_artifacts") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "background_task_artifacts_background_task_id_key" to table: "background_task_artifacts"
CREATE UNIQUE INDEX "background_task_artifacts_background_task_id_key" ON "background_task_artifacts" ("background_task_id");
-- Create index "backgroundtaskartifact_background_task_id" to table: "background_task_artifacts"
CREATE UNIQUE INDEX "backgroundtaskartifact_background_task_id" ON "background_task_artifacts" ("background_task_id");
-- Create "cloud_events" table
CREATE TABLE "cloud_events" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "source" character varying NOT NULL,
  "source_event_id" character varying NULL,
  "source_account_id" character varying NULL,
  "correlation_id" character varying NULL,
  "event_type" character varying NULL,
  "subject" text NULL,
  "text" text NULL,
  "payload_ciphertext" bytea NULL,
  "routing_json" text NULL,
  "dedupe_key" character varying NOT NULL,
  "routing_status" character varying NOT NULL DEFAULT 'pending',
  "matched_task_count" bigint NOT NULL DEFAULT 0,
  "occurred_at" timestamptz NULL,
  "received_at" timestamptz NOT NULL,
  "routed_at" timestamptz NULL,
  "user_cloud_events" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "cloud_events_users_cloud_events" FOREIGN KEY ("user_cloud_events") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "cloudevent_source_dedupe_key_user_cloud_events" to table: "cloud_events"
CREATE UNIQUE INDEX "cloudevent_source_dedupe_key_user_cloud_events" ON "cloud_events" ("source", "dedupe_key", "user_cloud_events");
-- Create index "cloudevent_routing_status" to table: "cloud_events"
CREATE INDEX "cloudevent_routing_status" ON "cloud_events" ("routing_status");
-- Create index "cloudevent_received_at" to table: "cloud_events"
CREATE INDEX "cloudevent_received_at" ON "cloud_events" ("received_at");
-- Create index "cloudevent_correlation_id" to table: "cloud_events"
CREATE INDEX "cloudevent_correlation_id" ON "cloud_events" ("correlation_id");
-- Create "background_task_runs" table
CREATE TABLE "background_task_runs" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "run_id" character varying NOT NULL,
  "trigger" character varying NOT NULL DEFAULT 'manual',
  "status" character varying NOT NULL DEFAULT 'running',
  "executor" character varying NOT NULL DEFAULT 'desktop',
  "attempt" bigint NOT NULL DEFAULT 1,
  "model" character varying NULL,
  "provider" character varying NULL,
  "use_case" character varying NULL,
  "sub_use_case" character varying NULL,
  "previous_run_id" character varying NULL,
  "retry_of_run_id" character varying NULL,
  "local_run_id" character varying NULL,
  "requested_context" text NULL,
  "summary" text NULL,
  "error" text NULL,
  "error_code" character varying NULL,
  "error_details" text NULL,
  "temporal_workflow_id" character varying NULL,
  "temporal_run_id" character varying NULL,
  "temporal_status" character varying NULL,
  "temporal_started_at" timestamptz NULL,
  "temporal_closed_at" timestamptz NULL,
  "cancel_requested_at" timestamptz NULL,
  "progress_percent" bigint NULL,
  "progress_message" text NULL,
  "last_heartbeat_at" timestamptz NULL,
  "started_at" timestamptz NULL,
  "completed_at" timestamptz NULL,
  "revision" bigint NOT NULL DEFAULT 1,
  "background_task_id" uuid NOT NULL,
  "cloud_event_id" uuid NULL,
  "user_background_task_runs" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "background_task_runs_background_tasks_runs" FOREIGN KEY ("background_task_id") REFERENCES "background_tasks" ("id") ON DELETE NO ACTION,
  CONSTRAINT "background_task_runs_cloud_events_runs" FOREIGN KEY ("cloud_event_id") REFERENCES "cloud_events" ("id") ON DELETE SET NULL,
  CONSTRAINT "background_task_runs_users_background_task_runs" FOREIGN KEY ("user_background_task_runs") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "backgroundtaskrun_run_id_user_background_task_runs" to table: "background_task_runs"
CREATE UNIQUE INDEX "backgroundtaskrun_run_id_user_background_task_runs" ON "background_task_runs" ("run_id", "user_background_task_runs");
-- Create index "backgroundtaskrun_status" to table: "background_task_runs"
CREATE INDEX "backgroundtaskrun_status" ON "background_task_runs" ("status");
-- Create index "backgroundtaskrun_executor_status" to table: "background_task_runs"
CREATE INDEX "backgroundtaskrun_executor_status" ON "background_task_runs" ("executor", "status");
-- Create index "backgroundtaskrun_temporal_workflow_id" to table: "background_task_runs"
CREATE INDEX "backgroundtaskrun_temporal_workflow_id" ON "background_task_runs" ("temporal_workflow_id");
-- Create "background_task_run_events" table
CREATE TABLE "background_task_run_events" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "seq" bigint NOT NULL,
  "event_type" character varying NULL,
  "event_json" text NOT NULL,
  "received_at" timestamptz NOT NULL,
  "background_task_id" uuid NOT NULL,
  "background_task_run_id" uuid NOT NULL,
  "user_background_task_run_events" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "background_task_run_events_background_tasks_run_events" FOREIGN KEY ("background_task_id") REFERENCES "background_tasks" ("id") ON DELETE NO ACTION,
  CONSTRAINT "background_task_run_events_background_task_runs_events" FOREIGN KEY ("background_task_run_id") REFERENCES "background_task_runs" ("id") ON DELETE NO ACTION,
  CONSTRAINT "background_task_run_events_users_background_task_run_events" FOREIGN KEY ("user_background_task_run_events") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "backgroundtaskrunevent_seq_background_task_run_id" to table: "background_task_run_events"
CREATE UNIQUE INDEX "backgroundtaskrunevent_seq_background_task_run_id" ON "background_task_run_events" ("seq", "background_task_run_id");
-- Create index "backgroundtaskrunevent_event_type" to table: "background_task_run_events"
CREATE INDEX "backgroundtaskrunevent_event_type" ON "background_task_run_events" ("event_type");
-- Create "background_task_schedule_states" table
CREATE TABLE "background_task_schedule_states" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "trigger_type" character varying NOT NULL,
  "schedule_key" character varying NOT NULL,
  "last_evaluated_at" timestamptz NULL,
  "last_due_at" timestamptz NULL,
  "last_triggered_at" timestamptz NULL,
  "last_run_id" character varying NOT NULL DEFAULT '',
  "lease_owner" character varying NOT NULL DEFAULT '',
  "lease_expires_at" timestamptz NULL,
  "revision" bigint NOT NULL DEFAULT 1,
  "background_task_id" uuid NOT NULL,
  "user_background_task_schedule_states" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "background_task_schedule_states_background_tasks_schedule_states" FOREIGN KEY ("background_task_id") REFERENCES "background_tasks" ("id") ON DELETE NO ACTION,
  CONSTRAINT "background_task_schedule_states_users_background_task_schedule_states" FOREIGN KEY ("user_background_task_schedule_states") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "backgroundtaskschedulestate_trigger_type_schedule_key_background_task_id" to table: "background_task_schedule_states"
CREATE UNIQUE INDEX "backgroundtaskschedulestate_trigger_type_schedule_key_background_task_id" ON "background_task_schedule_states" ("trigger_type", "schedule_key", "background_task_id");
-- Create index "backgroundtaskschedulestate_lease_expires_at" to table: "background_task_schedule_states"
CREATE INDEX "backgroundtaskschedulestate_lease_expires_at" ON "background_task_schedule_states" ("lease_expires_at");
-- Create index "backgroundtaskschedulestate_last_run_id" to table: "background_task_schedule_states"
CREATE INDEX "backgroundtaskschedulestate_last_run_id" ON "background_task_schedule_states" ("last_run_id");
-- Create index "backgroundtaskschedulestate_created_at" to table: "background_task_schedule_states"
CREATE INDEX "backgroundtaskschedulestate_created_at" ON "background_task_schedule_states" ("created_at");
-- Create "commitments" table
CREATE TABLE "commitments" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "direction" character varying NOT NULL,
  "text" text NOT NULL,
  "status" character varying NOT NULL DEFAULT 'open',
  "due_at" timestamptz NULL,
  "confidence" double precision NOT NULL,
  "user_confirmed" boolean NOT NULL DEFAULT false,
  "owner_participant_ref" character varying NULL,
  "counterparty_participant_ref" character varying NULL,
  "beneficiary_participant_ref" character varying NULL,
  "source_phrase" text NULL,
  "due_phrase" character varying NULL,
  "due_timezone" character varying NULL,
  "acceptance" character varying NOT NULL DEFAULT 'candidate',
  "blocker" text NULL,
  "completed_at" timestamptz NULL,
  "current_event_version" bigint NOT NULL DEFAULT 0,
  "relationship_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_commitments" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "commitments_relationships_commitments" FOREIGN KEY ("relationship_id") REFERENCES "relationships" ("id") ON DELETE NO ACTION,
  CONSTRAINT "commitments_revenue_workspaces_commitments" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "commitments_users_commitments" FOREIGN KEY ("user_commitments") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create "commitment_dependencies" table
CREATE TABLE "commitment_dependencies" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "kind" character varying NOT NULL,
  "evidence_refs" jsonb NOT NULL,
  "from_commitment_id" uuid NOT NULL,
  "to_commitment_id" uuid NOT NULL,
  "relationship_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_commitment_dependencies" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "commitment_dependencies_commitments_outgoing_dependencies" FOREIGN KEY ("from_commitment_id") REFERENCES "commitments" ("id") ON DELETE NO ACTION,
  CONSTRAINT "commitment_dependencies_commitments_incoming_dependencies" FOREIGN KEY ("to_commitment_id") REFERENCES "commitments" ("id") ON DELETE NO ACTION,
  CONSTRAINT "commitment_dependencies_relationships_commitment_dependencies" FOREIGN KEY ("relationship_id") REFERENCES "relationships" ("id") ON DELETE NO ACTION,
  CONSTRAINT "commitment_dependencies_revenue_workspaces_commitment_dependencies" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "commitment_dependencies_users_commitment_dependencies" FOREIGN KEY ("user_commitment_dependencies") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "commitmentdependency_kind_from_commitment_id_to_commitment_id" to table: "commitment_dependencies"
CREATE UNIQUE INDEX "commitmentdependency_kind_from_commitment_id_to_commitment_id" ON "commitment_dependencies" ("kind", "from_commitment_id", "to_commitment_id");
-- Create "commitment_events" table
CREATE TABLE "commitment_events" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "source_event_id" character varying NOT NULL,
  "version" bigint NOT NULL,
  "kind" character varying NOT NULL,
  "actor_type" character varying NOT NULL,
  "actor_ref" character varying NULL,
  "occurred_at" timestamptz NOT NULL,
  "source_observation_id" character varying NULL,
  "evidence_refs" jsonb NOT NULL,
  "payload_json" text NOT NULL DEFAULT '{}',
  "commitment_id" uuid NOT NULL,
  "relationship_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_commitment_events" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "commitment_events_commitments_events" FOREIGN KEY ("commitment_id") REFERENCES "commitments" ("id") ON DELETE NO ACTION,
  CONSTRAINT "commitment_events_relationships_commitment_events" FOREIGN KEY ("relationship_id") REFERENCES "relationships" ("id") ON DELETE NO ACTION,
  CONSTRAINT "commitment_events_revenue_workspaces_commitment_events" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "commitment_events_users_commitment_events" FOREIGN KEY ("user_commitment_events") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "commitmentevent_version_commitment_id" to table: "commitment_events"
CREATE UNIQUE INDEX "commitmentevent_version_commitment_id" ON "commitment_events" ("version", "commitment_id");
-- Create index "commitmentevent_source_event_id_revenue_workspace_id" to table: "commitment_events"
CREATE UNIQUE INDEX "commitmentevent_source_event_id_revenue_workspace_id" ON "commitment_events" ("source_event_id", "revenue_workspace_id");
-- Create "revenue_evidences" table
CREATE TABLE "revenue_evidences" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "source" character varying NOT NULL,
  "source_account_id" character varying NULL,
  "source_record_id" character varying NOT NULL,
  "source_message_id" character varying NULL,
  "source_uri" character varying NULL,
  "content_hash" character varying NOT NULL,
  "excerpt" text NULL,
  "payload_ciphertext" bytea NULL,
  "encryption_key_version" bigint NOT NULL DEFAULT 0,
  "occurred_at" timestamptz NOT NULL,
  "observed_at" timestamptz NOT NULL,
  "external_evidence_refs" jsonb NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_revenue_evidences" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "revenue_evidences_revenue_workspaces_evidences" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "revenue_evidences_users_revenue_evidences" FOREIGN KEY ("user_revenue_evidences") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "revenueevidence_source_source_record_id_content_hash_revenue_workspace_id" to table: "revenue_evidences"
CREATE UNIQUE INDEX "revenueevidence_source_source_record_id_content_hash_revenue_workspace_id" ON "revenue_evidences" ("source", "source_record_id", "content_hash", "revenue_workspace_id");
-- Create "commitment_evidences" table
CREATE TABLE "commitment_evidences" (
  "commitment_id" uuid NOT NULL,
  "revenue_evidence_id" uuid NOT NULL,
  PRIMARY KEY ("commitment_id", "revenue_evidence_id"),
  CONSTRAINT "commitment_evidences_commitment_id" FOREIGN KEY ("commitment_id") REFERENCES "commitments" ("id") ON DELETE CASCADE,
  CONSTRAINT "commitment_evidences_revenue_evidence_id" FOREIGN KEY ("revenue_evidence_id") REFERENCES "revenue_evidences" ("id") ON DELETE CASCADE
);
-- Create "conversation_intelligence_artifacts" table
CREATE TABLE "conversation_intelligence_artifacts" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "kind" character varying NOT NULL,
  "stable_id" character varying NOT NULL,
  "version" bigint NOT NULL DEFAULT 1,
  "status" character varying NULL,
  "subject_ref" character varying NULL,
  "effective_at" timestamptz NOT NULL,
  "evidence_refs" jsonb NOT NULL,
  "payload_json" text NOT NULL,
  "payload_hash" character varying NOT NULL,
  "relationship_id" uuid NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_conversation_intelligence_artifacts" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "conversation_intelligence_artifacts_relationships_conversation_intelligence_artifacts" FOREIGN KEY ("relationship_id") REFERENCES "relationships" ("id") ON DELETE SET NULL,
  CONSTRAINT "conversation_intelligence_artifacts_revenue_workspaces_conversation_intelligence_artifacts" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "conversation_intelligence_artifacts_users_conversation_intelligence_artifacts" FOREIGN KEY ("user_conversation_intelligence_artifacts") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "conversationintelligenceartifact_kind_stable_id_version_revenue_workspace_id" to table: "conversation_intelligence_artifacts"
CREATE UNIQUE INDEX "conversationintelligenceartifact_kind_stable_id_version_revenue_workspace_id" ON "conversation_intelligence_artifacts" ("kind", "stable_id", "version", "revenue_workspace_id");
-- Create index "conversationintelligenceartifact_kind_status_effective_at_relationship_id" to table: "conversation_intelligence_artifacts"
CREATE INDEX "conversationintelligenceartifact_kind_status_effective_at_relationship_id" ON "conversation_intelligence_artifacts" ("kind", "status", "effective_at", "relationship_id");
-- Create "credit_ledgers" table
CREATE TABLE "credit_ledgers" (
  "id" uuid NOT NULL,
  "delta" bigint NOT NULL,
  "reason" character varying NOT NULL,
  "request_id" uuid NOT NULL,
  "ts" timestamptz NOT NULL,
  "user_ledger_entries" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "credit_ledgers_users_ledger_entries" FOREIGN KEY ("user_ledger_entries") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "creditledger_request_id_reason" to table: "credit_ledgers"
CREATE UNIQUE INDEX "creditledger_request_id_reason" ON "credit_ledgers" ("request_id", "reason");
-- Create index "creditledger_user_ledger_entries" to table: "credit_ledgers"
CREATE INDEX "creditledger_user_ledger_entries" ON "credit_ledgers" ("user_ledger_entries");
-- Create "google_watches" table
CREATE TABLE "google_watches" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "kind" character varying NOT NULL,
  "account_email" character varying NOT NULL,
  "channel_id" character varying NULL,
  "resource_id" character varying NULL,
  "history_id" character varying NULL,
  "expires_at" timestamptz NOT NULL,
  "renew_claimed_at" timestamptz NULL,
  "last_error" text NULL,
  "user_google_watches" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "google_watches_users_google_watches" FOREIGN KEY ("user_google_watches") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "googlewatch_kind_user_google_watches" to table: "google_watches"
CREATE UNIQUE INDEX "googlewatch_kind_user_google_watches" ON "google_watches" ("kind", "user_google_watches");
-- Create index "googlewatch_expires_at" to table: "google_watches"
CREATE INDEX "googlewatch_expires_at" ON "google_watches" ("expires_at");
-- Create "llm_usages" table
CREATE TABLE "llm_usages" (
  "id" uuid NOT NULL,
  "model" character varying NOT NULL,
  "use_case" character varying NULL,
  "sub_use_case" character varying NULL,
  "agent_name" character varying NULL,
  "input_tokens" bigint NOT NULL DEFAULT 0,
  "output_tokens" bigint NOT NULL DEFAULT 0,
  "cost_units" bigint NOT NULL DEFAULT 0,
  "request_id" uuid NOT NULL,
  "ts" timestamptz NOT NULL,
  "user_llm_usages" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "llm_usages_users_llm_usages" FOREIGN KEY ("user_llm_usages") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "llmusage_request_id" to table: "llm_usages"
CREATE UNIQUE INDEX "llmusage_request_id" ON "llm_usages" ("request_id");
-- Create index "llmusage_model" to table: "llm_usages"
CREATE INDEX "llmusage_model" ON "llm_usages" ("model");
-- Create index "llmusage_user_llm_usages" to table: "llm_usages"
CREATE INDEX "llmusage_user_llm_usages" ON "llm_usages" ("user_llm_usages");
-- Create "mail_body_caches" table
CREATE TABLE "mail_body_caches" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "provider" character varying NOT NULL DEFAULT 'gmail',
  "provider_message_id" character varying NOT NULL,
  "sealed_body" bytea NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "user_mail_body_caches" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "mail_body_caches_users_mail_body_caches" FOREIGN KEY ("user_mail_body_caches") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "mailbodycache_provider_provider_message_id_user_mail_body_caches" to table: "mail_body_caches"
CREATE UNIQUE INDEX "mailbodycache_provider_provider_message_id_user_mail_body_caches" ON "mail_body_caches" ("provider", "provider_message_id", "user_mail_body_caches");
-- Create index "mailbodycache_expires_at" to table: "mail_body_caches"
CREATE INDEX "mailbodycache_expires_at" ON "mail_body_caches" ("expires_at");
-- Create "mail_threads" table
CREATE TABLE "mail_threads" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "provider" character varying NOT NULL DEFAULT 'gmail',
  "provider_thread_id" character varying NOT NULL,
  "subject" character varying NULL,
  "counterparty_email" character varying NULL,
  "account_domain" character varying NULL,
  "labels" jsonb NOT NULL,
  "reply_state" character varying NOT NULL DEFAULT 'quiet',
  "last_direction" character varying NULL,
  "last_activity_at" timestamptz NULL,
  "message_count" bigint NOT NULL DEFAULT 0,
  "outbound_count" bigint NOT NULL DEFAULT 0,
  "inbound_count" bigint NOT NULL DEFAULT 0,
  "relationship_id" uuid NULL,
  "user_mail_threads" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "mail_threads_relationships_mail_threads" FOREIGN KEY ("relationship_id") REFERENCES "relationships" ("id") ON DELETE SET NULL,
  CONSTRAINT "mail_threads_users_mail_threads" FOREIGN KEY ("user_mail_threads") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "mailthread_provider_provider_thread_id_user_mail_threads" to table: "mail_threads"
CREATE UNIQUE INDEX "mailthread_provider_provider_thread_id_user_mail_threads" ON "mail_threads" ("provider", "provider_thread_id", "user_mail_threads");
-- Create index "mailthread_last_activity_at_user_mail_threads" to table: "mail_threads"
CREATE INDEX "mailthread_last_activity_at_user_mail_threads" ON "mail_threads" ("last_activity_at", "user_mail_threads");
-- Create "mail_message_meta" table
CREATE TABLE "mail_message_meta" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "provider_message_id" character varying NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "direction" character varying NOT NULL,
  "from_addr" character varying NULL,
  "to_addr" character varying NULL,
  "subject" character varying NULL,
  "labels" jsonb NOT NULL,
  "mail_thread_id" uuid NOT NULL,
  "user_mail_message_metas" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "mail_message_meta_mail_threads_messages" FOREIGN KEY ("mail_thread_id") REFERENCES "mail_threads" ("id") ON DELETE NO ACTION,
  CONSTRAINT "mail_message_meta_users_mail_message_metas" FOREIGN KEY ("user_mail_message_metas") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "mailmessagemeta_provider_message_id_user_mail_message_metas" to table: "mail_message_meta"
CREATE UNIQUE INDEX "mailmessagemeta_provider_message_id_user_mail_message_metas" ON "mail_message_meta" ("provider_message_id", "user_mail_message_metas");
-- Create "mail_signals" table
CREATE TABLE "mail_signals" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "classification" character varying NOT NULL DEFAULT 'other',
  "summary" character varying NULL,
  "embedding_model" character varying NULL,
  "embedding" bytea NULL,
  "computed_at" timestamptz NOT NULL,
  "mail_thread_id" uuid NOT NULL,
  "user_mail_signals" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "mail_signals_mail_threads_signal" FOREIGN KEY ("mail_thread_id") REFERENCES "mail_threads" ("id") ON DELETE NO ACTION,
  CONSTRAINT "mail_signals_users_mail_signals" FOREIGN KEY ("user_mail_signals") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "mail_signals_mail_thread_id_key" to table: "mail_signals"
CREATE UNIQUE INDEX "mail_signals_mail_thread_id_key" ON "mail_signals" ("mail_thread_id");
-- Create index "mailsignal_mail_thread_id" to table: "mail_signals"
CREATE UNIQUE INDEX "mailsignal_mail_thread_id" ON "mail_signals" ("mail_thread_id");
-- Create index "mailsignal_classification_user_mail_signals" to table: "mail_signals"
CREATE INDEX "mailsignal_classification_user_mail_signals" ON "mail_signals" ("classification", "user_mail_signals");
-- Create "mcp_connections" table
CREATE TABLE "mcp_connections" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "connector" character varying NOT NULL,
  "audience" character varying NOT NULL,
  "scopes" jsonb NULL,
  "refresh_token_encrypted" bytea NULL,
  "api_key_encrypted" bytea NULL,
  "connected_at" timestamptz NULL,
  "last_used_at" timestamptz NULL,
  "expires_at" timestamptz NULL,
  "user_mcp_connections" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "mcp_connections_users_mcp_connections" FOREIGN KEY ("user_mcp_connections") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "mcpconnection_connector_user_mcp_connections" to table: "mcp_connections"
CREATE UNIQUE INDEX "mcpconnection_connector_user_mcp_connections" ON "mcp_connections" ("connector", "user_mcp_connections");
-- Create "meeting_minute_usages" table
CREATE TABLE "meeting_minute_usages" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "period" character varying NOT NULL,
  "used_seconds" bigint NOT NULL DEFAULT 0,
  "reserved_seconds" bigint NOT NULL DEFAULT 0,
  "user_meeting_minute_usages" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "meeting_minute_usages_users_meeting_minute_usages" FOREIGN KEY ("user_meeting_minute_usages") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "meetingminuteusage_period_user_meeting_minute_usages" to table: "meeting_minute_usages"
CREATE UNIQUE INDEX "meetingminuteusage_period_user_meeting_minute_usages" ON "meeting_minute_usages" ("period", "user_meeting_minute_usages");
-- Create "oauth_connections" table
CREATE TABLE "oauth_connections" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "provider" character varying NOT NULL,
  "refresh_token_encrypted" bytea NOT NULL,
  "scopes" jsonb NULL,
  "external_account_id" character varying NULL,
  "user_oauth_connections" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "oauth_connections_users_oauth_connections" FOREIGN KEY ("user_oauth_connections") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "oauthconnection_provider_external_account_id" to table: "oauth_connections"
CREATE UNIQUE INDEX "oauthconnection_provider_external_account_id" ON "oauth_connections" ("provider", "external_account_id");
-- Create "relationship_persons" table
CREATE TABLE "relationship_persons" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "display_name" character varying NOT NULL,
  "aliases" jsonb NOT NULL,
  "primary_email" character varying NULL,
  "title" character varying NULL,
  "org_name" character varying NULL,
  "org_domain" character varying NULL,
  "phone" character varying NULL,
  "timezone" character varying NULL,
  "locale" character varying NULL,
  "seniority" character varying NULL,
  "location" character varying NULL,
  "employment_status" character varying NOT NULL DEFAULT 'unknown',
  "attributes_version" bigint NOT NULL DEFAULT 0,
  "attributes_hash" character varying NULL,
  "projector_version" bigint NOT NULL DEFAULT 1,
  "projected_at" timestamptz NULL,
  "status" character varying NOT NULL DEFAULT 'active',
  "merged_into_person_id" uuid NULL,
  "merged_at" timestamptz NULL,
  "first_interaction_at" timestamptz NULL,
  "last_interaction_at" timestamptz NULL,
  "relationship_count" bigint NOT NULL DEFAULT 0,
  "revenue_workspace_id" uuid NOT NULL,
  "user_relationship_persons" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "relationship_persons_revenue_workspaces_relationship_persons" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_persons_users_relationship_persons" FOREIGN KEY ("user_relationship_persons") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "person_status_revenue_workspace_id" to table: "relationship_persons"
CREATE INDEX "person_status_revenue_workspace_id" ON "relationship_persons" ("status", "revenue_workspace_id");
-- Create index "person_last_interaction_at_revenue_workspace_id" to table: "relationship_persons"
CREATE INDEX "person_last_interaction_at_revenue_workspace_id" ON "relationship_persons" ("last_interaction_at", "revenue_workspace_id");
-- Create index "person_primary_email_revenue_workspace_id" to table: "relationship_persons"
CREATE INDEX "person_primary_email_revenue_workspace_id" ON "relationship_persons" ("primary_email", "revenue_workspace_id");
-- Create "relationship_observations" table
CREATE TABLE "relationship_observations" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "source" character varying NOT NULL,
  "source_account_id" character varying NULL,
  "external_id" character varying NOT NULL,
  "source_version" character varying NOT NULL DEFAULT '1',
  "event_type" character varying NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "received_at" timestamptz NOT NULL,
  "summary" text NULL,
  "normalized_facts_json" text NOT NULL DEFAULT '{}',
  "content_hash" character varying NOT NULL,
  "payload_ciphertext" bytea NULL,
  "encryption_key_version" bigint NOT NULL DEFAULT 0,
  "relationship_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_relationship_observations" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "relationship_observations_relationships_observations" FOREIGN KEY ("relationship_id") REFERENCES "relationships" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_observations_revenue_workspaces_relationship_observations" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_observations_users_relationship_observations" FOREIGN KEY ("user_relationship_observations") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "relationshipobservation_source_external_id_source_version_revenue_workspace_id" to table: "relationship_observations"
CREATE UNIQUE INDEX "relationshipobservation_source_external_id_source_version_revenue_workspace_id" ON "relationship_observations" ("source", "external_id", "source_version", "revenue_workspace_id");
-- Create index "relationshipobservation_occurred_at_relationship_id" to table: "relationship_observations"
CREATE INDEX "relationshipobservation_occurred_at_relationship_id" ON "relationship_observations" ("occurred_at", "relationship_id");
-- Create "person_attributes" table
CREATE TABLE "person_attributes" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "dimension" character varying NOT NULL,
  "value" text NOT NULL,
  "source_type" character varying NOT NULL,
  "source" character varying NOT NULL,
  "extractor" character varying NOT NULL DEFAULT 'unknown',
  "status" character varying NOT NULL DEFAULT 'active',
  "confidence" double precision NOT NULL DEFAULT 0.5,
  "reason" text NULL,
  "observed_at" timestamptz NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz NULL,
  "retracted_at" timestamptz NULL,
  "supersedes_attribute_id" character varying NULL,
  "extractor_version" character varying NOT NULL DEFAULT 'unknown-v1',
  "citations_json" text NULL,
  "dedupe_key" character varying NOT NULL,
  "supporting_observation_ids" jsonb NOT NULL,
  "person_id" uuid NOT NULL,
  "observation_id" uuid NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_person_attributes" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "person_attributes_relationship_persons_attributes" FOREIGN KEY ("person_id") REFERENCES "relationship_persons" ("id") ON DELETE NO ACTION,
  CONSTRAINT "person_attributes_relationship_observations_person_attributes" FOREIGN KEY ("observation_id") REFERENCES "relationship_observations" ("id") ON DELETE SET NULL,
  CONSTRAINT "person_attributes_revenue_workspaces_person_attributes" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "person_attributes_users_person_attributes" FOREIGN KEY ("user_person_attributes") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "personattribute_dimension_valid_from_person_id" to table: "person_attributes"
CREATE INDEX "personattribute_dimension_valid_from_person_id" ON "person_attributes" ("dimension", "valid_from", "person_id");
-- Create index "personattribute_status_valid_to_person_id" to table: "person_attributes"
CREATE INDEX "personattribute_status_valid_to_person_id" ON "person_attributes" ("status", "valid_to", "person_id");
-- Create index "personattribute_dedupe_key_revenue_workspace_id" to table: "person_attributes"
CREATE UNIQUE INDEX "personattribute_dedupe_key_revenue_workspace_id" ON "person_attributes" ("dedupe_key", "revenue_workspace_id");
-- Create "person_identities" table
CREATE TABLE "person_identities" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "kind" character varying NOT NULL,
  "provider" character varying NULL,
  "key_hash" character varying NOT NULL,
  "normalized_value" character varying NOT NULL,
  "source" character varying NULL,
  "confidence" double precision NOT NULL DEFAULT 1,
  "first_seen_at" timestamptz NOT NULL,
  "last_seen_at" timestamptz NOT NULL,
  "person_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_person_identities" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "person_identities_relationship_persons_identities" FOREIGN KEY ("person_id") REFERENCES "relationship_persons" ("id") ON DELETE NO ACTION,
  CONSTRAINT "person_identities_revenue_workspaces_person_identities" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "person_identities_users_person_identities" FOREIGN KEY ("user_person_identities") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "personidentity_key_hash_revenue_workspace_id" to table: "person_identities"
CREATE UNIQUE INDEX "personidentity_key_hash_revenue_workspace_id" ON "person_identities" ("key_hash", "revenue_workspace_id");
-- Create index "personidentity_kind_person_id" to table: "person_identities"
CREATE INDEX "personidentity_kind_person_id" ON "person_identities" ("kind", "person_id");
-- Create "person_interaction_stats" table
CREATE TABLE "person_interaction_stats" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "first_interaction_at" timestamptz NOT NULL,
  "last_interaction_at" timestamptz NOT NULL,
  "last_inbound_at" timestamptz NULL,
  "last_outbound_at" timestamptz NULL,
  "interaction_count" bigint NOT NULL DEFAULT 0,
  "inbound_count" bigint NOT NULL DEFAULT 0,
  "outbound_count" bigint NOT NULL DEFAULT 0,
  "meeting_count" bigint NOT NULL DEFAULT 0,
  "channel_counts" jsonb NOT NULL,
  "source_counts" jsonb NOT NULL,
  "last_channel" character varying NULL,
  "last_direction" character varying NULL,
  "person_id" uuid NOT NULL,
  "relationship_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "person_interaction_stats_relationship_persons_interaction_stats" FOREIGN KEY ("person_id") REFERENCES "relationship_persons" ("id") ON DELETE NO ACTION,
  CONSTRAINT "person_interaction_stats_relationships_person_interaction_stats" FOREIGN KEY ("relationship_id") REFERENCES "relationships" ("id") ON DELETE NO ACTION,
  CONSTRAINT "person_interaction_stats_revenue_workspaces_person_interaction_stats" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION
);
-- Create index "personinteractionstat_person_id_relationship_id" to table: "person_interaction_stats"
CREATE UNIQUE INDEX "personinteractionstat_person_id_relationship_id" ON "person_interaction_stats" ("person_id", "relationship_id");
-- Create index "personinteractionstat_last_interaction_at_relationship_id" to table: "person_interaction_stats"
CREATE INDEX "personinteractionstat_last_interaction_at_relationship_id" ON "person_interaction_stats" ("last_interaction_at", "relationship_id");
-- Create "person_merge_candidates" table
CREATE TABLE "person_merge_candidates" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "dedupe_key" character varying NOT NULL,
  "status" character varying NOT NULL DEFAULT 'pending',
  "candidate_type" character varying NOT NULL DEFAULT 'anchor_collision',
  "anchor_kind" character varying NOT NULL,
  "anchor_provider" character varying NULL,
  "anchor_key_hash" character varying NOT NULL,
  "anchor_preview" character varying NULL,
  "matching_anchors" jsonb NOT NULL,
  "conflicting_anchors" jsonb NOT NULL,
  "impact_json" text NOT NULL DEFAULT '{}',
  "recommended_decision" character varying NOT NULL DEFAULT 'defer',
  "confidence" double precision NOT NULL DEFAULT 0,
  "version" bigint NOT NULL DEFAULT 1,
  "decision" character varying NULL,
  "decision_reason" text NULL,
  "decision_actor_id" uuid NULL,
  "decided_at" timestamptz NULL,
  "idempotency_key" character varying NULL,
  "previous_state_json" text NOT NULL DEFAULT '{}',
  "proposed_person_id" uuid NOT NULL,
  "existing_person_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_person_merge_candidates" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "person_merge_candidates_relationship_persons_proposed_merge_candidates" FOREIGN KEY ("proposed_person_id") REFERENCES "relationship_persons" ("id") ON DELETE NO ACTION,
  CONSTRAINT "person_merge_candidates_relationship_persons_existing_merge_candidates" FOREIGN KEY ("existing_person_id") REFERENCES "relationship_persons" ("id") ON DELETE NO ACTION,
  CONSTRAINT "person_merge_candidates_revenue_workspaces_person_merge_candidates" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "person_merge_candidates_users_person_merge_candidates" FOREIGN KEY ("user_person_merge_candidates") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "personmergecandidate_dedupe_key_revenue_workspace_id" to table: "person_merge_candidates"
CREATE UNIQUE INDEX "personmergecandidate_dedupe_key_revenue_workspace_id" ON "person_merge_candidates" ("dedupe_key", "revenue_workspace_id");
-- Create index "personmergecandidate_status_created_at_revenue_workspace_id" to table: "person_merge_candidates"
CREATE INDEX "personmergecandidate_status_created_at_revenue_workspace_id" ON "person_merge_candidates" ("status", "created_at", "revenue_workspace_id");
-- Create "person_suppressions" table
CREATE TABLE "person_suppressions" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "key_hash" character varying NOT NULL,
  "kind" character varying NOT NULL,
  "reason" character varying NOT NULL DEFAULT 'user_action',
  "suppressed_at" timestamptz NOT NULL,
  "note" character varying NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_person_suppressions" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "person_suppressions_revenue_workspaces_person_suppressions" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "person_suppressions_users_person_suppressions" FOREIGN KEY ("user_person_suppressions") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "personsuppression_key_hash_revenue_workspace_id" to table: "person_suppressions"
CREATE UNIQUE INDEX "personsuppression_key_hash_revenue_workspace_id" ON "person_suppressions" ("key_hash", "revenue_workspace_id");
-- Create "policy_decision_snapshots" table
CREATE TABLE "policy_decision_snapshots" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "action_revision" bigint NOT NULL,
  "revision_hash" character varying NOT NULL,
  "status" character varying NOT NULL,
  "outbound_lead_id" character varying NULL,
  "verification_json" text NULL,
  "suppression_json" text NULL,
  "research_json" text NULL,
  "crm_json" text NULL,
  "reason_codes" jsonb NOT NULL,
  "evidence_refs" jsonb NOT NULL,
  "evaluated_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "response_hash" character varying NOT NULL,
  "revenue_action_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_policy_decision_snapshots" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "policy_decision_snapshots_revenue_actions_decisions" FOREIGN KEY ("revenue_action_id") REFERENCES "revenue_actions" ("id") ON DELETE NO ACTION,
  CONSTRAINT "policy_decision_snapshots_revenue_workspaces_decisions" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "policy_decision_snapshots_users_policy_decision_snapshots" FOREIGN KEY ("user_policy_decision_snapshots") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create "relationship_assertions" table
CREATE TABLE "relationship_assertions" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "dimension" character varying NOT NULL,
  "value" text NOT NULL,
  "source_type" character varying NOT NULL,
  "status" character varying NOT NULL DEFAULT 'active',
  "confidence" double precision NOT NULL DEFAULT 1,
  "reason" text NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz NULL,
  "retracted_at" timestamptz NULL,
  "retraction_reason" text NULL,
  "supersedes_assertion_id" character varying NULL,
  "extractor_version" character varying NOT NULL DEFAULT 'unknown-v1',
  "citations_json" text NULL,
  "projector_compat_version" bigint NOT NULL DEFAULT 1,
  "supporting_observation_ids" jsonb NOT NULL,
  "relationship_id" uuid NOT NULL,
  "observation_id" uuid NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_relationship_assertions" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "relationship_assertions_relationships_assertions" FOREIGN KEY ("relationship_id") REFERENCES "relationships" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_assertions_relationship_observations_assertions" FOREIGN KEY ("observation_id") REFERENCES "relationship_observations" ("id") ON DELETE SET NULL,
  CONSTRAINT "relationship_assertions_revenue_workspaces_relationship_assertions" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_assertions_users_relationship_assertions" FOREIGN KEY ("user_relationship_assertions") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "relationshipassertion_dimension_valid_from_relationship_id" to table: "relationship_assertions"
CREATE INDEX "relationshipassertion_dimension_valid_from_relationship_id" ON "relationship_assertions" ("dimension", "valid_from", "relationship_id");
-- Create index "relationshipassertion_status_valid_to_relationship_id" to table: "relationship_assertions"
CREATE INDEX "relationshipassertion_status_valid_to_relationship_id" ON "relationship_assertions" ("status", "valid_to", "relationship_id");
-- Create "relationship_attention_items" table
CREATE TABLE "relationship_attention_items" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "stable_key" character varying NOT NULL,
  "version" bigint NOT NULL DEFAULT 1,
  "reason_code" character varying NOT NULL,
  "explanation" text NOT NULL,
  "triggering_object_ref" character varying NOT NULL,
  "evidence_refs" jsonb NOT NULL,
  "urgency_band" character varying NOT NULL,
  "rank_score" bigint NOT NULL,
  "rank_factors_json" text NOT NULL,
  "source_requirements" jsonb NOT NULL,
  "recommendation_id" uuid NULL,
  "recommendation_revision" bigint NOT NULL DEFAULT 0,
  "owner_id" uuid NULL,
  "status" character varying NOT NULL DEFAULT 'open',
  "state_reason" text NULL,
  "snoozed_until" timestamptz NULL,
  "expires_at" timestamptz NULL,
  "detector_version" bigint NOT NULL DEFAULT 1,
  "projector_version" bigint NOT NULL DEFAULT 1,
  "relationship_state_version" bigint NOT NULL DEFAULT 0,
  "material_hash" character varying NOT NULL,
  "last_detected_at" timestamptz NOT NULL,
  "acknowledged_by" uuid NULL,
  "acknowledged_at" timestamptz NULL,
  "dismissed_by" uuid NULL,
  "dismissed_at" timestamptz NULL,
  "relationship_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_relationship_attention_items" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "relationship_attention_items_relationships_attention_items" FOREIGN KEY ("relationship_id") REFERENCES "relationships" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_attention_items_revenue_workspaces_relationship_attention_items" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_attention_items_users_relationship_attention_items" FOREIGN KEY ("user_relationship_attention_items") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "relationshipattentionitem_stable_key_revenue_workspace_id" to table: "relationship_attention_items"
CREATE UNIQUE INDEX "relationshipattentionitem_stable_key_revenue_workspace_id" ON "relationship_attention_items" ("stable_key", "revenue_workspace_id");
-- Create index "relationshipattentionitem_status_rank_score_revenue_workspace_id" to table: "relationship_attention_items"
CREATE INDEX "relationshipattentionitem_status_rank_score_revenue_workspace_id" ON "relationship_attention_items" ("status", "rank_score", "revenue_workspace_id");
-- Create index "relationshipattentionitem_status_relationship_id" to table: "relationship_attention_items"
CREATE INDEX "relationshipattentionitem_status_relationship_id" ON "relationship_attention_items" ("status", "relationship_id");
-- Create "relationship_evidences" table
CREATE TABLE "relationship_evidences" (
  "relationship_id" uuid NOT NULL,
  "revenue_evidence_id" uuid NOT NULL,
  PRIMARY KEY ("relationship_id", "revenue_evidence_id"),
  CONSTRAINT "relationship_evidences_relationship_id" FOREIGN KEY ("relationship_id") REFERENCES "relationships" ("id") ON DELETE CASCADE,
  CONSTRAINT "relationship_evidences_revenue_evidence_id" FOREIGN KEY ("revenue_evidence_id") REFERENCES "revenue_evidences" ("id") ON DELETE CASCADE
);
-- Create "relationship_identities" table
CREATE TABLE "relationship_identities" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "kind" character varying NOT NULL,
  "provider" character varying NULL,
  "key_hash" character varying NOT NULL,
  "normalized_value" character varying NOT NULL,
  "source" character varying NULL,
  "confidence" double precision NOT NULL DEFAULT 1,
  "first_seen_at" timestamptz NOT NULL,
  "last_seen_at" timestamptz NOT NULL,
  "relationship_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_relationship_identities" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "relationship_identities_relationships_identities" FOREIGN KEY ("relationship_id") REFERENCES "relationships" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_identities_revenue_workspaces_relationship_identities" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_identities_users_relationship_identities" FOREIGN KEY ("user_relationship_identities") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "relationshipidentity_key_hash_revenue_workspace_id" to table: "relationship_identities"
CREATE UNIQUE INDEX "relationshipidentity_key_hash_revenue_workspace_id" ON "relationship_identities" ("key_hash", "revenue_workspace_id");
-- Create index "relationshipidentity_kind_relationship_id" to table: "relationship_identities"
CREATE INDEX "relationshipidentity_kind_relationship_id" ON "relationship_identities" ("kind", "relationship_id");
-- Create "relationship_identity_candidates" table
CREATE TABLE "relationship_identity_candidates" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "dedupe_key" character varying NOT NULL,
  "status" character varying NOT NULL DEFAULT 'pending',
  "candidate_type" character varying NOT NULL DEFAULT 'anchor_collision',
  "anchor_kind" character varying NOT NULL,
  "anchor_provider" character varying NULL,
  "anchor_key_hash" character varying NOT NULL,
  "anchor_preview" character varying NULL,
  "matching_anchors" jsonb NOT NULL,
  "conflicting_anchors" jsonb NOT NULL,
  "evidence_refs" jsonb NOT NULL,
  "evidence_count" bigint NOT NULL DEFAULT 0,
  "evidence_from" timestamptz NULL,
  "evidence_to" timestamptz NULL,
  "impact_json" text NOT NULL DEFAULT '{}',
  "recommended_decision" character varying NOT NULL DEFAULT 'defer',
  "confidence" double precision NOT NULL DEFAULT 0,
  "version" bigint NOT NULL DEFAULT 1,
  "decision" character varying NULL,
  "decision_reason" character varying NULL,
  "decision_actor_id" uuid NULL,
  "decided_at" timestamptz NULL,
  "undoes_candidate_id" uuid NULL,
  "proposed_relationship_id" uuid NOT NULL,
  "existing_relationship_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_relationship_identity_candidates" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "relationship_identity_candidates_relationships_proposed_identity_candidates" FOREIGN KEY ("proposed_relationship_id") REFERENCES "relationships" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_identity_candidates_relationships_existing_identity_candidates" FOREIGN KEY ("existing_relationship_id") REFERENCES "relationships" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_identity_candidates_revenue_workspaces_identity_candidates" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_identity_candidates_users_relationship_identity_candidates" FOREIGN KEY ("user_relationship_identity_candidates") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "relationshipidentitycandidate_dedupe_key_revenue_workspace_id" to table: "relationship_identity_candidates"
CREATE UNIQUE INDEX "relationshipidentitycandidate_dedupe_key_revenue_workspace_id" ON "relationship_identity_candidates" ("dedupe_key", "revenue_workspace_id");
-- Create index "relationshipidentitycandidate_status_created_at_revenue_workspace_id" to table: "relationship_identity_candidates"
CREATE INDEX "relationshipidentitycandidate_status_created_at_revenue_workspace_id" ON "relationship_identity_candidates" ("status", "created_at", "revenue_workspace_id");
-- Create "relationship_identity_decisions" table
CREATE TABLE "relationship_identity_decisions" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "idempotency_key" character varying NOT NULL,
  "decision" character varying NOT NULL,
  "candidate_version" bigint NOT NULL,
  "actor_id" uuid NOT NULL,
  "reason" character varying NULL,
  "decided_at" timestamptz NOT NULL,
  "compensates_decision_id" uuid NULL,
  "identity_candidate_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_relationship_identity_decisions" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "relationship_identity_decisions_relationship_identity_candidates_decisions" FOREIGN KEY ("identity_candidate_id") REFERENCES "relationship_identity_candidates" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_identity_decisions_revenue_workspaces_relationship_identity_decisions" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_identity_decisions_users_relationship_identity_decisions" FOREIGN KEY ("user_relationship_identity_decisions") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "relationshipidentitydecision_idempotency_key_revenue_workspace_id" to table: "relationship_identity_decisions"
CREATE UNIQUE INDEX "relationshipidentitydecision_idempotency_key_revenue_workspace_id" ON "relationship_identity_decisions" ("idempotency_key", "revenue_workspace_id");
-- Create index "relationshipidentitydecision_candidate_version_identity_candidate_id" to table: "relationship_identity_decisions"
CREATE UNIQUE INDEX "relationshipidentitydecision_candidate_version_identity_candidate_id" ON "relationship_identity_decisions" ("candidate_version", "identity_candidate_id");
-- Create "relationship_lineage_events" table
CREATE TABLE "relationship_lineage_events" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "kind" character varying NOT NULL,
  "actor_id" uuid NOT NULL,
  "reason" character varying NULL,
  "observation_ids" jsonb NOT NULL,
  "identity_ids" jsonb NOT NULL,
  "moved_object_refs" jsonb NOT NULL,
  "before_relationship_ids" jsonb NOT NULL,
  "after_relationship_ids" jsonb NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "identity_candidate_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_relationship_lineage_events" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "relationship_lineage_events_relationship_identity_candidates_lineage_events" FOREIGN KEY ("identity_candidate_id") REFERENCES "relationship_identity_candidates" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_lineage_events_revenue_workspaces_relationship_lineage_events" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_lineage_events_users_relationship_lineage_events" FOREIGN KEY ("user_relationship_lineage_events") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "relationshiplineageevent_occurred_at_revenue_workspace_id" to table: "relationship_lineage_events"
CREATE INDEX "relationshiplineageevent_occurred_at_revenue_workspace_id" ON "relationship_lineage_events" ("occurred_at", "revenue_workspace_id");
-- Create index "relationshiplineageevent_created_at_identity_candidate_id" to table: "relationship_lineage_events"
CREATE INDEX "relationshiplineageevent_created_at_identity_candidate_id" ON "relationship_lineage_events" ("created_at", "identity_candidate_id");
-- Create "relationship_participants" table
CREATE TABLE "relationship_participants" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "display_name" character varying NOT NULL,
  "email" character varying NULL,
  "role" character varying NOT NULL DEFAULT 'contact',
  "title" character varying NULL,
  "active" boolean NOT NULL DEFAULT true,
  "external_refs" jsonb NOT NULL,
  "person_id" uuid NULL,
  "relationship_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_relationship_participants" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "relationship_participants_relationship_persons_participants" FOREIGN KEY ("person_id") REFERENCES "relationship_persons" ("id") ON DELETE SET NULL,
  CONSTRAINT "relationship_participants_relationships_participants" FOREIGN KEY ("relationship_id") REFERENCES "relationships" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_participants_revenue_workspaces_relationship_participants" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_participants_users_relationship_participants" FOREIGN KEY ("user_relationship_participants") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "relationshipparticipant_email_relationship_id" to table: "relationship_participants"
CREATE INDEX "relationshipparticipant_email_relationship_id" ON "relationship_participants" ("email", "relationship_id");
-- Create index "relationshipparticipant_email_revenue_workspace_id" to table: "relationship_participants"
CREATE INDEX "relationshipparticipant_email_revenue_workspace_id" ON "relationship_participants" ("email", "revenue_workspace_id");
-- Create "relationship_projection_jobs" table
CREATE TABLE "relationship_projection_jobs" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "idempotency_key" character varying NOT NULL,
  "status" character varying NOT NULL DEFAULT 'pending',
  "projector_version" bigint NOT NULL DEFAULT 1,
  "evaluated_at" timestamptz NOT NULL,
  "trigger_refs" jsonb NOT NULL,
  "attempts" bigint NOT NULL DEFAULT 0,
  "next_attempt_at" timestamptz NULL,
  "lease_owner" character varying NULL,
  "lease_expires_at" timestamptz NULL,
  "last_error" text NULL,
  "completed_at" timestamptz NULL,
  "result_state_hash" character varying NULL,
  "relationship_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_relationship_projection_jobs" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "relationship_projection_jobs_relationships_projection_jobs" FOREIGN KEY ("relationship_id") REFERENCES "relationships" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_projection_jobs_revenue_workspaces_relationship_projection_jobs" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_projection_jobs_users_relationship_projection_jobs" FOREIGN KEY ("user_relationship_projection_jobs") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "relationship_projection_jobs_idempotency_key_key" to table: "relationship_projection_jobs"
CREATE UNIQUE INDEX "relationship_projection_jobs_idempotency_key_key" ON "relationship_projection_jobs" ("idempotency_key");
-- Create index "relationshipprojectionjob_status_next_attempt_at_lease_expires_at" to table: "relationship_projection_jobs"
CREATE INDEX "relationshipprojectionjob_status_next_attempt_at_lease_expires_at" ON "relationship_projection_jobs" ("status", "next_attempt_at", "lease_expires_at");
-- Create index "relationshipprojectionjob_status_created_at_relationship_id" to table: "relationship_projection_jobs"
CREATE INDEX "relationshipprojectionjob_status_created_at_relationship_id" ON "relationship_projection_jobs" ("status", "created_at", "relationship_id");
-- Create "relationship_review_acknowledgements" table
CREATE TABLE "relationship_review_acknowledgements" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "state_version" bigint NOT NULL,
  "state_hash" character varying NULL,
  "acknowledged_at" timestamptz NOT NULL,
  "relationship_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_relationship_review_acknowledgements" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "relationship_review_acknowledgements_relationships_review_acknowledgements" FOREIGN KEY ("relationship_id") REFERENCES "relationships" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_review_acknowledgements_revenue_workspaces_relationship_review_acknowledgements" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_review_acknowledgements_users_relationship_review_acknowledgements" FOREIGN KEY ("user_relationship_review_acknowledgements") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "relationshipreviewacknowledgement_state_version_relationship_id_user_relationship_review_acknowledgements" to table: "relationship_review_acknowledgements"
CREATE UNIQUE INDEX "relationshipreviewacknowledgement_state_version_relationship_id_user_relationship_review_acknowledgements" ON "relationship_review_acknowledgements" ("state_version", "relationship_id", "user_relationship_review_acknowledgements");
-- Create index "relationshipreviewacknowledgement_acknowledged_at_revenue_workspace_id_user_relationship_review_acknowledgements" to table: "relationship_review_acknowledgements"
CREATE INDEX "relationshipreviewacknowledgement_acknowledged_at_revenue_workspace_id_user_relationship_review_acknowledgements" ON "relationship_review_acknowledgements" ("acknowledged_at", "revenue_workspace_id", "user_relationship_review_acknowledgements");
-- Create "relationship_source_status" table
CREATE TABLE "relationship_source_status" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "source" character varying NOT NULL,
  "source_account_id" character varying NOT NULL DEFAULT 'default',
  "consenting_actor_id" uuid NULL,
  "status" character varying NOT NULL DEFAULT 'not_connected',
  "backfill_phase" character varying NOT NULL DEFAULT 'idle',
  "backfill_completed" bigint NOT NULL DEFAULT 0,
  "backfill_total" bigint NOT NULL DEFAULT 0,
  "watermark" character varying NULL,
  "sync_started_at" timestamptz NULL,
  "authorization_started_at" timestamptz NULL,
  "authorized_at" timestamptz NULL,
  "backfill_completed_at" timestamptz NULL,
  "last_failed_sync_at" timestamptz NULL,
  "disconnected_at" timestamptz NULL,
  "revoked_at" timestamptz NULL,
  "last_sync_at" timestamptz NULL,
  "expected_cadence_seconds" bigint NOT NULL DEFAULT 900,
  "lag_seconds" bigint NOT NULL DEFAULT 0,
  "required_scopes" jsonb NOT NULL,
  "granted_scopes" jsonb NOT NULL,
  "missing_scopes" jsonb NOT NULL,
  "error_code" character varying NULL,
  "retry_count" bigint NOT NULL DEFAULT 0,
  "next_retry_at" timestamptz NULL,
  "completeness" character varying NOT NULL DEFAULT 'partial',
  "cursor" character varying NULL,
  "last_success_at" timestamptz NULL,
  "last_observation_at" timestamptz NULL,
  "last_provider_event_at" timestamptz NULL,
  "last_error" text NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_relationship_source_statuses" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "relationship_source_status_revenue_workspaces_relationship_source_statuses" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_source_status_users_relationship_source_statuses" FOREIGN KEY ("user_relationship_source_statuses") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "relationshipsourcestatus_source_source_account_id_revenue_workspace_id" to table: "relationship_source_status"
CREATE UNIQUE INDEX "relationshipsourcestatus_source_source_account_id_revenue_workspace_id" ON "relationship_source_status" ("source", "source_account_id", "revenue_workspace_id");
-- Create "relationship_state_snapshots" table
CREATE TABLE "relationship_state_snapshots" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "version" bigint NOT NULL,
  "state_json" text NOT NULL DEFAULT '{}',
  "state_hash" character varying NOT NULL,
  "projector_version" bigint NOT NULL DEFAULT 1,
  "evaluated_at" timestamptz NOT NULL,
  "changed_dimensions" jsonb NOT NULL,
  "assertion_ids" jsonb NOT NULL,
  "relationship_id" uuid NOT NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_relationship_state_snapshots" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "relationship_state_snapshots_relationships_snapshots" FOREIGN KEY ("relationship_id") REFERENCES "relationships" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_state_snapshots_revenue_workspaces_relationship_state_snapshots" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "relationship_state_snapshots_users_relationship_state_snapshots" FOREIGN KEY ("user_relationship_state_snapshots") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "relationshipstatesnapshot_version_relationship_id" to table: "relationship_state_snapshots"
CREATE UNIQUE INDEX "relationshipstatesnapshot_version_relationship_id" ON "relationship_state_snapshots" ("version", "relationship_id");
-- Create "revenue_action_evidences" table
CREATE TABLE "revenue_action_evidences" (
  "revenue_action_id" uuid NOT NULL,
  "revenue_evidence_id" uuid NOT NULL,
  PRIMARY KEY ("revenue_action_id", "revenue_evidence_id"),
  CONSTRAINT "revenue_action_evidences_revenue_action_id" FOREIGN KEY ("revenue_action_id") REFERENCES "revenue_actions" ("id") ON DELETE CASCADE,
  CONSTRAINT "revenue_action_evidences_revenue_evidence_id" FOREIGN KEY ("revenue_evidence_id") REFERENCES "revenue_evidences" ("id") ON DELETE CASCADE
);
-- Create "revenue_action_revisions" table
CREATE TABLE "revenue_action_revisions" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "revision" bigint NOT NULL,
  "revision_hash" character varying NOT NULL,
  "action_type" character varying NOT NULL,
  "channel" character varying NOT NULL,
  "recipient_email" character varying NULL,
  "reason" text NULL,
  "proposed_subject" text NULL,
  "proposed_message" text NULL,
  "sender_account_ref" character varying NULL,
  "assigned_user_id" uuid NULL,
  "created_by" uuid NULL,
  "revenue_action_id" uuid NOT NULL,
  "user_revenue_action_revisions" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "revenue_action_revisions_revenue_actions_revisions" FOREIGN KEY ("revenue_action_id") REFERENCES "revenue_actions" ("id") ON DELETE NO ACTION,
  CONSTRAINT "revenue_action_revisions_users_revenue_action_revisions" FOREIGN KEY ("user_revenue_action_revisions") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "revenueactionrevision_revision_revenue_action_id" to table: "revenue_action_revisions"
CREATE UNIQUE INDEX "revenueactionrevision_revision_revenue_action_id" ON "revenue_action_revisions" ("revision", "revenue_action_id");
-- Create "revenue_leak_scans" table
CREATE TABLE "revenue_leak_scans" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "status" character varying NOT NULL DEFAULT 'pending',
  "active_claim" character varying NULL,
  "mode" character varying NOT NULL DEFAULT 'local',
  "lookback_days" bigint NOT NULL DEFAULT 90,
  "threads_seen" bigint NOT NULL DEFAULT 0,
  "candidates_seen" bigint NOT NULL DEFAULT 0,
  "relationships_created" bigint NOT NULL DEFAULT 0,
  "evidences_created" bigint NOT NULL DEFAULT 0,
  "actions_created" bigint NOT NULL DEFAULT 0,
  "started_at" timestamptz NULL,
  "completed_at" timestamptz NULL,
  "error" text NULL,
  "source_freshness_at" timestamptz NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_revenue_leak_scans" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "revenue_leak_scans_revenue_workspaces_scans" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "revenue_leak_scans_users_revenue_leak_scans" FOREIGN KEY ("user_revenue_leak_scans") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "revenue_leak_scans_active_claim_key" to table: "revenue_leak_scans"
CREATE UNIQUE INDEX "revenue_leak_scans_active_claim_key" ON "revenue_leak_scans" ("active_claim");
-- Create index "revenueleakscan_status_revenue_workspace_id" to table: "revenue_leak_scans"
CREATE INDEX "revenueleakscan_status_revenue_workspace_id" ON "revenue_leak_scans" ("status", "revenue_workspace_id");
-- Create "revenue_outbox_events" table
CREATE TABLE "revenue_outbox_events" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "event_type" character varying NOT NULL,
  "schema_version" bigint NOT NULL DEFAULT 1,
  "action_id" uuid NULL,
  "correlation_id" character varying NULL,
  "causation_id" character varying NULL,
  "idempotency_key" character varying NOT NULL,
  "payload_json" text NULL,
  "occurred_at" timestamptz NOT NULL,
  "delivery_status" character varying NOT NULL DEFAULT 'pending',
  "attempts" bigint NOT NULL DEFAULT 0,
  "next_attempt_at" timestamptz NULL,
  "last_error" text NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_revenue_outbox_events" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "revenue_outbox_events_revenue_workspaces_outbox_events" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "revenue_outbox_events_users_revenue_outbox_events" FOREIGN KEY ("user_revenue_outbox_events") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "revenue_outbox_events_idempotency_key_key" to table: "revenue_outbox_events"
CREATE UNIQUE INDEX "revenue_outbox_events_idempotency_key_key" ON "revenue_outbox_events" ("idempotency_key");
-- Create index "revenueoutboxevent_delivery_status_next_attempt_at" to table: "revenue_outbox_events"
CREATE INDEX "revenueoutboxevent_delivery_status_next_attempt_at" ON "revenue_outbox_events" ("delivery_status", "next_attempt_at");
-- Create "revenue_trust_events" table
CREATE TABLE "revenue_trust_events" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "event_name" character varying NOT NULL,
  "outcome" character varying NOT NULL,
  "reason_code" character varying NULL,
  "correlation_id" character varying NULL,
  "source" character varying NULL,
  "channel" character varying NULL,
  "state_version" bigint NULL,
  "duration_ms" bigint NULL,
  "occurred_at" timestamptz NOT NULL,
  "relationship_id" uuid NULL,
  "revenue_action_id" uuid NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_revenue_trust_events" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "revenue_trust_events_relationships_trust_events" FOREIGN KEY ("relationship_id") REFERENCES "relationships" ("id") ON DELETE SET NULL,
  CONSTRAINT "revenue_trust_events_revenue_actions_trust_events" FOREIGN KEY ("revenue_action_id") REFERENCES "revenue_actions" ("id") ON DELETE SET NULL,
  CONSTRAINT "revenue_trust_events_revenue_workspaces_trust_events" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "revenue_trust_events_users_revenue_trust_events" FOREIGN KEY ("user_revenue_trust_events") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "revenuetrustevent_event_name_occurred_at_revenue_workspace_id" to table: "revenue_trust_events"
CREATE INDEX "revenuetrustevent_event_name_occurred_at_revenue_workspace_id" ON "revenue_trust_events" ("event_name", "occurred_at", "revenue_workspace_id");
-- Create index "revenuetrustevent_correlation_id" to table: "revenue_trust_events"
CREATE INDEX "revenuetrustevent_correlation_id" ON "revenue_trust_events" ("correlation_id");
-- Create "revenue_workspace_members" table
CREATE TABLE "revenue_workspace_members" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "role" character varying NOT NULL DEFAULT 'member',
  "outbound_account_id" character varying NULL,
  "status" character varying NOT NULL DEFAULT 'active',
  "revenue_workspace_id" uuid NOT NULL,
  "user_revenue_workspace_members" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "revenue_workspace_members_revenue_workspaces_members" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "revenue_workspace_members_users_revenue_workspace_members" FOREIGN KEY ("user_revenue_workspace_members") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "revenueworkspacemember_revenue_workspace_id_user_revenue_workspace_members" to table: "revenue_workspace_members"
CREATE UNIQUE INDEX "revenueworkspacemember_revenue_workspace_id_user_revenue_workspace_members" ON "revenue_workspace_members" ("revenue_workspace_id", "user_revenue_workspace_members");
-- Create "subscriptions" table
CREATE TABLE "subscriptions" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "plan" character varying NOT NULL DEFAULT 'free',
  "status" character varying NOT NULL DEFAULT 'active',
  "trial_expires_at" timestamptz NULL,
  "sanctioned_credits" bigint NOT NULL DEFAULT 10000,
  "stripe_customer_id" character varying NULL,
  "stripe_subscription_id" character varying NULL,
  "user_subscription" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "subscriptions_users_subscription" FOREIGN KEY ("user_subscription") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "subscriptions_user_subscription_key" to table: "subscriptions"
CREATE UNIQUE INDEX "subscriptions_user_subscription_key" ON "subscriptions" ("user_subscription");
-- Create "tenant_evidence_keys" table
CREATE TABLE "tenant_evidence_keys" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "version" bigint NOT NULL,
  "status" character varying NOT NULL DEFAULT 'active',
  "wrapped_key" bytea NULL,
  "key_fingerprint" character varying NOT NULL,
  "rotated_at" timestamptz NULL,
  "destroyed_at" timestamptz NULL,
  "erasure_proof" character varying NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_tenant_evidence_keys" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "tenant_evidence_keys_revenue_workspaces_evidence_keys" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "tenant_evidence_keys_users_tenant_evidence_keys" FOREIGN KEY ("user_tenant_evidence_keys") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "tenantevidencekey_version_revenue_workspace_id" to table: "tenant_evidence_keys"
CREATE UNIQUE INDEX "tenantevidencekey_version_revenue_workspace_id" ON "tenant_evidence_keys" ("version", "revenue_workspace_id");
-- Create index "tenantevidencekey_status_revenue_workspace_id" to table: "tenant_evidence_keys"
CREATE INDEX "tenantevidencekey_status_revenue_workspace_id" ON "tenant_evidence_keys" ("status", "revenue_workspace_id");
-- Create "workspace_feature_controls" table
CREATE TABLE "workspace_feature_controls" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "capability" character varying NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "rollout_stage" character varying NOT NULL DEFAULT 'synthetic',
  "reason_code" character varying NULL,
  "revenue_workspace_id" uuid NOT NULL,
  "user_workspace_feature_controls" uuid NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "workspace_feature_controls_revenue_workspaces_feature_controls" FOREIGN KEY ("revenue_workspace_id") REFERENCES "revenue_workspaces" ("id") ON DELETE NO ACTION,
  CONSTRAINT "workspace_feature_controls_users_workspace_feature_controls" FOREIGN KEY ("user_workspace_feature_controls") REFERENCES "users" ("id") ON DELETE NO ACTION
);
-- Create index "workspacefeaturecontrol_capability_revenue_workspace_id" to table: "workspace_feature_controls"
CREATE UNIQUE INDEX "workspacefeaturecontrol_capability_revenue_workspace_id" ON "workspace_feature_controls" ("capability", "revenue_workspace_id");
