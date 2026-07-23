-- RFC 023 closed-loop actions: the propose→approve→execute→watch broker.
-- action_proposals holds one typed, human-approved finance action per row;
-- approval_tokens is the single-use ledger backing the params-bound approval
-- token (only the token hash is stored, never the token). Per-user tenancy is
-- carried by the user_* foreign keys, matching every other domain table.
CREATE TABLE `action_proposals` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `target` text NOT NULL, `kind` text NOT NULL, `params_json` text NULL, `financial` bool NOT NULL DEFAULT (false), `rationale` text NULL, `status` text NOT NULL DEFAULT ('pending'), `correlation_id` text NULL, `entity_id` text NULL, `origin_run_id` text NULL, `expires_at` datetime NULL, `approved_at` datetime NULL, `executed_at` datetime NULL, `reason` text NULL, `result_ref` text NULL, `user_action_proposals` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `action_proposals_users_action_proposals` FOREIGN KEY (`user_action_proposals`) REFERENCES `users` (`id`) ON DELETE NO ACTION);
CREATE INDEX `actionproposal_status` ON `action_proposals` (`status`);
CREATE INDEX `actionproposal_target` ON `action_proposals` (`target`);
CREATE INDEX `actionproposal_correlation_id` ON `action_proposals` (`correlation_id`);
CREATE TABLE `approval_tokens` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `token_hash` text NOT NULL, `proposal_id` text NOT NULL, `params_hash` text NOT NULL, `operator_user_id` text NOT NULL, `step_up` bool NOT NULL DEFAULT (false), `expires_at` datetime NOT NULL, `consumed` bool NOT NULL DEFAULT (false), `consumed_at` datetime NULL, `user_approval_tokens` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `approval_tokens_users_approval_tokens` FOREIGN KEY (`user_approval_tokens`) REFERENCES `users` (`id`) ON DELETE NO ACTION);
CREATE UNIQUE INDEX `approval_tokens_token_hash_key` ON `approval_tokens` (`token_hash`);
CREATE INDEX `approvaltoken_proposal_id` ON `approval_tokens` (`proposal_id`);
