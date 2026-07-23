-- RFC 031 Layer 3: sealed short-TTL body cache (the only place a mail body
-- lives at rest) + the evidence anchor message id for on-demand retrieval.

CREATE TABLE IF NOT EXISTS `mail_body_caches` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `provider` text NOT NULL DEFAULT ('gmail'), `provider_message_id` text NOT NULL, `sealed_body` blob NOT NULL, `expires_at` datetime NOT NULL, `user_mail_body_caches` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `mail_body_caches_users_mail_body_caches` FOREIGN KEY (`user_mail_body_caches`) REFERENCES `users` (`id`) ON DELETE NO ACTION);
CREATE UNIQUE INDEX IF NOT EXISTS `mailbodycache_provider_provider_message_id_user_mail_body_caches` ON `mail_body_caches` (`provider`, `provider_message_id`, `user_mail_body_caches`);
CREATE INDEX IF NOT EXISTS `mailbodycache_expires_at` ON `mail_body_caches` (`expires_at`);
ALTER TABLE `revenue_evidences` ADD COLUMN `source_message_id` text NULL;
