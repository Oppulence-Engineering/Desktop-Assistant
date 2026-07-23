-- RFC 031 Layer-1 push sync: the Gmail History API cursor per workspace.
ALTER TABLE `revenue_workspaces` ADD COLUMN `mail_history_id` text NULL;
