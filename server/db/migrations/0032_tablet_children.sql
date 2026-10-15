CREATE TABLE `terminal_unlocks` (
	`id` text PRIMARY KEY NOT NULL,
	`terminal_user_id` integer NOT NULL,
	`facility_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`created_at` text NOT NULL,
	`last_active_at` text NOT NULL,
	FOREIGN KEY (`terminal_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `terminal_unlocks_terminal_user_id_unique` ON `terminal_unlocks` (`terminal_user_id`);--> statement-breakpoint
ALTER TABLE `facilities` ADD `tablet_lock_minutes` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `tablet_show_waitlist` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `tablet_show_future_contracts` integer DEFAULT false NOT NULL;