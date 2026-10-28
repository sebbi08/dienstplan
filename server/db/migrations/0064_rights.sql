CREATE TABLE `role_bundles` (
	`role` text NOT NULL,
	`bundle` text NOT NULL,
	`enabled` integer NOT NULL,
	`scope` text,
	PRIMARY KEY(`role`, `bundle`)
);
--> statement-breakpoint
CREATE TABLE `user_bundle_overrides` (
	`user_id` integer NOT NULL,
	`bundle` text NOT NULL,
	`effect` text NOT NULL,
	`scope` text,
	PRIMARY KEY(`user_id`, `bundle`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `user_bundle_overrides`("user_id", "bundle", "effect", "scope")
SELECT "id", 'childrenEdit', 'grant', 'group' FROM `users` WHERE "role" = 'observer' AND "can_edit_children" = 1;--> statement-breakpoint
INSERT INTO `user_bundle_overrides`("user_id", "bundle", "effect", "scope")
SELECT `users`."id", 'leavePlan', 'grant', NULL FROM `leave_planners` JOIN `users` ON `users`."id" = `leave_planners`."user_id"
WHERE `users`."role" = 'admin';--> statement-breakpoint
INSERT INTO `role_bundles`("role", "bundle", "enabled", "scope")
SELECT 'admin', 'contractView', CASE WHEN "value" = 'true' THEN 1 ELSE 0 END, NULL FROM `app_settings`
WHERE "key" = 'contract_visible_to_admins';
