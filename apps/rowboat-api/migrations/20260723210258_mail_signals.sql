-- RFC 031 Layer 2: derived signals for relevant threads (classification,
-- summary, embedding) for semantic recall. One signal per thread. Dropped
-- with the thread on disconnect; pruned by retention.

CREATE TABLE IF NOT EXISTS `mail_signals` (`id` uuid NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `classification` text NOT NULL DEFAULT ('other'), `summary` text NULL, `embedding_model` text NULL, `embedding` blob NULL, `computed_at` datetime NOT NULL, `mail_thread_id` uuid NOT NULL, `user_mail_signals` uuid NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `mail_signals_mail_threads_signal` FOREIGN KEY (`mail_thread_id`) REFERENCES `mail_threads` (`id`) ON DELETE NO ACTION, CONSTRAINT `mail_signals_users_mail_signals` FOREIGN KEY (`user_mail_signals`) REFERENCES `users` (`id`) ON DELETE NO ACTION);
CREATE UNIQUE INDEX IF NOT EXISTS `mail_signals_mail_thread_id_key` ON `mail_signals` (`mail_thread_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `mailsignal_mail_thread_id` ON `mail_signals` (`mail_thread_id`);
CREATE INDEX IF NOT EXISTS `mailsignal_classification_user_mail_signals` ON `mail_signals` (`classification`, `user_mail_signals`);
