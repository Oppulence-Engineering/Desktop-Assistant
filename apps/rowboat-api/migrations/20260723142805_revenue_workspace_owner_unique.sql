-- RFC 030 review fix: one revenue workspace per owner. Makes
-- CurrentWorkspace's get-or-create race-safe (a concurrent first touch
-- loses on the constraint and falls back to the winner's row).

CREATE UNIQUE INDEX IF NOT EXISTS `revenueworkspace_user_revenue_workspaces` ON `revenue_workspaces` (`user_revenue_workspaces`);
