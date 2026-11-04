CREATE TABLE `team_meeting_participants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meeting_id` integer NOT NULL,
	`employee_id` integer,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL,
	`signed_at` text,
	`signed_via` text,
	FOREIGN KEY (`meeting_id`) REFERENCES `team_meetings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_meeting_participants_meeting_employee` ON `team_meeting_participants` (`meeting_id`,`employee_id`);